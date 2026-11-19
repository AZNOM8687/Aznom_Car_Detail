const registrarGestao = require('./gestao');
const registrarRecebimentos = require('./recebimentos');
const { registrarOperacao, telefoneValido } = require('./operacao');
const { createHash, randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');

const derivar = promisify(scrypt);
const oitoHoras = 8 * 60 * 60 * 1000;
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

function tokenDaRequisicao(req) {
  return req.headers.cookie?.match(/(?:^|;\s*)aznom_sessao=([a-f0-9]{64})(?:;|$)/)?.[1];
}

function dataValida(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor) || valor.startsWith('0000')) return false;
  const data = new Date(valor);
  return Number.isFinite(data.getTime()) && data.toISOString().slice(0, 10) === valor;
}

module.exports = function registrarAgenda(app, banco) {
  const cookie = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api',
  };
  const tentativas = new Map();

  function rota(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
  }

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method) && req.get('X-Aznom') !== '1') {
      return res.status(403).json({ mensagem: 'Solicitação inválida.' });
    }
    next();
  });

  const autenticar = rota(async (req, res, next) => {
    const token = tokenDaRequisicao(req);
    if (token) {
      const { rows } = await banco.query(
        'SELECT c.id, c.email, c.papel FROM aznom_contas c JOIN aznom_sessoes s ON s.conta_id = c.id WHERE s.token = $1 AND s.expira > now()',
        [hashToken(token)],
      );
      if (rows[0]) {
        req.conta = rows[0];
        return next();
      }
    }
    res.status(401).json({ mensagem: 'Entre na sua conta para continuar.' });
  });

  function admin(req, res, next) {
    if (req.conta.papel !== 'admin') {
      return res.status(403).json({ mensagem: 'Acesso restrito ao administrador.' });
    }
    next();
  }

  function limitar(req, res, next, grupo = 'auth') {
    const agora = Date.now();
    for (const [ip, janela] of tentativas) {
      if (janela.fim <= agora) tentativas.delete(ip);
    }
    const chave = grupo + ':' + req.ip;
    const janela = tentativas.get(chave) ?? { total: 0, fim: agora + 600000 };
    if (janela.total >= 20) return res.status(429).json({ mensagem: 'Muitas tentativas. Aguarde alguns minutos.' });
    janela.total += 1;
    tentativas.set(chave, janela);
    next();
  }

  for (const acao of ['cadastro', 'login']) {
    app.post('/api/' + acao, limitar, rota(async (req, res) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const senha = req.body?.senha;
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
          || typeof senha !== 'string' || senha.length < 10 || senha.length > 128) {
        return res.status(400).json({ mensagem: 'Informe um e-mail válido e uma senha de 10 a 128 caracteres.' });
      }

      let conta;
      if (acao === 'cadastro') {
        const sal = randomBytes(16).toString('hex');
        const chave = await derivar(senha, sal, 64);
        const { rows } = await banco.query(
          'INSERT INTO aznom_contas (email, senha) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING RETURNING id, email, papel',
          [email, sal + ':' + chave.toString('hex')],
        );
        conta = rows[0];
        if (!conta) return res.status(409).json({ mensagem: 'Não foi possível cadastrar. Tente entrar com sua conta.' });
      } else {
        const { rows } = await banco.query('SELECT id, email, papel, senha FROM aznom_contas WHERE email = $1', [email]);
        const registro = rows[0];
        const [sal, chave] = registro?.senha ? registro.senha.split(':') : ['0'.repeat(32), '0'.repeat(128)];
        const verificada = timingSafeEqual(await derivar(senha, sal, 64), Buffer.from(chave, 'hex'));
        if (!registro?.senha || !verificada) return res.status(401).json({ mensagem: 'E-mail ou senha inválidos.' });
        conta = registro;
      }

      await iniciarSessao(req, res, conta.id);
      res.json({ email: conta.email, papel: conta.papel });
    }));
  }

  async function iniciarSessao(req, res, contaId) {
    const token = randomBytes(32).toString('hex');
    const anterior = tokenDaRequisicao(req);
    await banco.query(`
      WITH sessoes_encerradas AS (
        DELETE FROM aznom_sessoes WHERE expira <= now() OR token = $1
      )
      INSERT INTO aznom_sessoes (token, conta_id, expira) VALUES ($2, $3, $4)
    `, [anterior ? hashToken(anterior) : null, hashToken(token), contaId, new Date(Date.now() + oitoHoras)]);
    res.cookie('aznom_sessao', token, { ...cookie, maxAge: oitoHoras });
  }

  require('./google')(app, banco, iniciarSessao);

  app.get('/api/conta', autenticar, (req, res) => res.json({ email: req.conta.email, papel: req.conta.papel }));
  app.post('/api/sair', rota(async (req, res) => {
    const token = tokenDaRequisicao(req);
    if (token) await banco.query('DELETE FROM aznom_sessoes WHERE token = $1', [hashToken(token)]);
    res.clearCookie('aznom_sessao', cookie).sendStatus(204);
  }));

  const camposAgenda = `id, tipo, to_char(inicio, 'YYYY-MM-DD') AS inicio,
    to_char(fim, 'YYYY-MM-DD') AS fim, left(hora::text, 5) AS hora, detalhes`;

  app.get('/api/agenda', rota(async (req, res) => {
    const { rows } = await banco.query(`
      SELECT ${camposAgenda}, capacidade - confirmadas AS vagas
      FROM aznom_agenda
      WHERE CASE WHEN tipo = 'servicos'
          THEN confirmadas < capacidade AND inicio + hora >= now() AT TIME ZONE 'America/Sao_Paulo'
          ELSE fim >= (now() AT TIME ZONE 'America/Sao_Paulo')::date END
      ORDER BY inicio, hora, fim, id
    `);
    res.json(rows);
  }));

  app.get('/api/admin/agenda', autenticar, admin, rota(async (req, res) => {
    const { semana } = req.query;
    if (semana !== undefined && !dataValida(semana)) {
      return res.status(400).json({ mensagem: 'Informe uma data válida para a semana.' });
    }
    const { rows } = await banco.query(`
      SELECT ${camposAgenda}, capacidade, confirmadas, matriculadas,
        (tipo='servicos' AND confirmadas=0 AND inicio + hora > now() AT TIME ZONE 'America/Sao_Paulo') AS livre
      FROM aznom_agenda
      WHERE ($1::date IS NULL AND coalesce(fim, inicio) >= (now() AT TIME ZONE 'America/Sao_Paulo')::date)
        OR ($1::date IS NOT NULL AND inicio < $1::date + 7 AND coalesce(fim, inicio) >= $1::date)
      ORDER BY inicio, hora, fim, id
    `, [semana ?? null]);
    res.json(rows);
  }));

  app.patch('/api/agenda/:id(\\d+)/confirmacoes', autenticar, admin, rota(async (req, res) => {
    const { atual, novo } = req.body ?? {};
    if (!Number.isInteger(atual) || !Number.isInteger(novo) ||
        atual < 0 || atual > 1000 || novo < 0 || novo > 1000 || Math.abs(novo - atual) !== 1) {
      return res.status(400).json({ mensagem: 'Informe uma alteração válida na quantidade de confirmações.' });
    }

    const { rowCount } = await banco.query(
      `UPDATE aznom_agenda SET confirmadas=$2
       WHERE id=$1 AND confirmadas=$3 AND $2 BETWEEN matriculadas AND capacidade
         AND NOT atendimento_registrado`,
      [req.params.id, novo, atual],
    );
    if (!rowCount) return res.status(409).json({ mensagem: 'A confirmação mudou, atingiu o limite de vagas ou está vinculada a uma matrícula. Confira a agenda.' });
    res.sendStatus(204);
  }));

  app.get('/api/admin/atendimentos', autenticar, admin, rota(async (req, res) => {
    const { rows } = await banco.query(`
      SELECT a.id, agenda_id, cliente, veiculo, servico, telefone, servicos_realizados, observacoes_veiculo,
        veiculo_id, v.modelo AS modelo_cadastrado, v.placa, valor_centavos, sinal_centavos, restante_pago_centavos,
        andamento, cuidados, to_char(previsao_entrega, 'YYYY-MM-DD"T"HH24:MI') AS previsao_entrega,
        to_char(entregue_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') AS entregue_em,
        coalesce((SELECT jsonb_agg(f.etapa ORDER BY f.etapa) FROM aznom_fotos_veiculo f WHERE f.atendimento_id=a.id), '[]') AS fotos,
        to_char(data, 'YYYY-MM-DD') AS data,
        left(hora::text, 5) AS hora, status,
        coalesce((SELECT jsonb_agg(jsonb_build_object(
          'anterior', to_char(r.anterior, 'YYYY-MM-DD HH24:MI'),
          'novo', to_char(r.novo, 'YYYY-MM-DD HH24:MI')
        ) ORDER BY r.registrado_em, r.id)
        FROM aznom_reagendamentos r WHERE r.atendimento_id=a.id), '[]') AS reagendamentos
      FROM aznom_atendimentos a LEFT JOIN aznom_veiculos v ON v.id=a.veiculo_id
      ORDER BY data DESC, hora DESC, a.id DESC
    `);
    res.json(rows);
  }));

  app.post('/api/admin/atendimentos', autenticar, admin, rota(async (req, res) => {
    const { agendaId } = req.body ?? {};
    const telefone = telefoneValido(req.body?.telefone);
    const campos = ['cliente', 'veiculo', 'servico'].map(campo =>
      typeof req.body?.[campo] === 'string' ? req.body[campo].trim() : '',
    );
    if (!Number.isInteger(agendaId) || agendaId < 1 || agendaId > 2147483647 ||
        telefone === undefined || campos.some(valor => !valor || valor.length > 100)) {
      return res.status(400).json({ mensagem: 'Informe o horário, o cliente, o veículo e o serviço. Se preencher o telefone, inclua o DDD.' });
    }

    const { rowCount } = await banco.query(`
      WITH horario AS (
        UPDATE aznom_agenda SET confirmadas=1, atendimento_registrado=true
        WHERE id=$1 AND tipo='servicos'
          AND NOT atendimento_registrado
        RETURNING id, inicio, hora
      )
      INSERT INTO aznom_atendimentos (agenda_id, cliente, veiculo, servico, telefone, data, hora)
      SELECT id, $2, $3, $4, $5, inicio, hora FROM horario
    `, [agendaId, ...campos, telefone]);
    if (!rowCount) return res.status(409).json({ mensagem: 'O horário foi alterado ou já tem um atendimento registrado.' });
    res.status(201).end();
  }));

  app.patch('/api/admin/atendimentos/:id(\\d+)', autenticar, admin, rota(async (req, res) => {
    const { status } = req.body ?? {};
    if (!['concluido', 'cancelado'].includes(status)) {
      return res.status(400).json({ mensagem: 'Escolha concluir ou cancelar o atendimento.' });
    }

    const { rows } = await banco.query(`
      WITH alterado AS (
        UPDATE aznom_atendimentos SET status=$2, entregue_em=CASE WHEN $2='concluido' THEN now() END
        WHERE id=$1 AND status='confirmado'
        RETURNING agenda_id
      ), liberado AS (
        UPDATE aznom_agenda SET confirmadas=0, atendimento_registrado=false
        WHERE $2='cancelado' AND id IN (SELECT agenda_id FROM alterado)
      )
      SELECT 1 FROM alterado
    `, [req.params.id, status]);
    if (!rows.length) return res.status(409).json({ mensagem: 'O atendimento já mudou de status ou não está disponível.' });
    res.sendStatus(204);
  }));

  app.patch('/api/admin/atendimentos/:id(\\d+)/reagendar', autenticar, admin, rota(async (req, res) => {
    const { agendaId, agendaAnterior } = req.body ?? {};
    if (![agendaId, agendaAnterior].every(id => Number.isInteger(id) && id > 0 && id <= 2147483647)
        || agendaId === agendaAnterior) {
      return res.status(400).json({ mensagem: 'Selecione outro horário disponível.' });
    }

    const { rowCount } = await banco.query(`
      WITH atual AS MATERIALIZED (
        SELECT id, agenda_id, data + hora AS anterior FROM aznom_atendimentos
        WHERE id=$1 AND status='confirmado' AND agenda_id=$3 FOR UPDATE
      ), destino AS (
        UPDATE aznom_agenda SET confirmadas=1, atendimento_registrado=true
        WHERE id=$2 AND tipo='servicos' AND confirmadas=0
          AND inicio + hora > now() AT TIME ZONE 'America/Sao_Paulo'
          AND EXISTS (SELECT 1 FROM atual)
        RETURNING id, inicio, hora
      ), movido AS (
        UPDATE aznom_atendimentos a SET agenda_id=d.id, data=d.inicio, hora=d.hora
        FROM atual, destino d WHERE a.id=atual.id
        RETURNING a.id, atual.agenda_id AS antiga_agenda, atual.anterior, a.data + a.hora AS novo
      ), liberado AS (
        UPDATE aznom_agenda SET confirmadas=0, atendimento_registrado=false
        WHERE id IN (SELECT antiga_agenda FROM movido)
      )
      INSERT INTO aznom_reagendamentos (atendimento_id, anterior, novo)
      SELECT id, anterior, novo FROM movido
    `, [req.params.id, agendaId, agendaAnterior]);

    if (!rowCount) return res.status(409).json({ mensagem: 'O atendimento ou o horário mudou. Confira a agenda atualizada.' });
    res.sendStatus(204);
  }));

  const salvar = rota(async (req, res) => {
    const { tipo, inicio, fim, hora, capacidade, detalhes } = req.body ?? {};
    const horario = tipo === 'servicos' && typeof hora === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hora);
    const turma = tipo === 'cursos' && dataValida(fim) && fim >= inicio;
    if (!dataValida(inicio) || (!horario && !turma)) {
      return res.status(400).json({ mensagem: 'Confira as datas e o horário da agenda.' });
    }
    if (turma && capacidade !== undefined && (!Number.isInteger(capacidade) || capacidade < 1 || capacidade > 1000)) {
      return res.status(400).json({ mensagem: 'Informe uma capacidade entre 1 e 1000 vagas.' });
    }
    let detalhesTurma = turma ? null : {};
    if (turma && detalhes !== undefined) {
      if (!detalhes || typeof detalhes !== 'object' || Array.isArray(detalhes)) {
        return res.status(400).json({ mensagem: 'Confira os detalhes da turma.' });
      }
      detalhesTurma = {};
      for (const [campo, limite] of Object.entries({ local: 200, requisitos: 600, inclusos: 600 })) {
        const valor = detalhes[campo] ?? '';
        if (typeof valor !== 'string' || valor.trim().length > limite) {
          return res.status(400).json({ mensagem: 'Confira os limites dos detalhes da turma.' });
        }
        if (valor.trim()) detalhesTurma[campo] = valor.trim();
      }
      const valor = detalhes.valor ?? '';
      if (typeof valor !== 'string' || (valor && !/^\d{1,6}([,.]\d{1,2})?$/.test(valor))) {
        return res.status(400).json({ mensagem: 'Informe um valor válido em reais.' });
      }
      if (valor) detalhesTurma.valor = Number(valor.replace(',', '.'));
    }
    const valores = [tipo, inicio, turma ? fim : null, horario ? hora : null,
      turma ? capacidade ?? null : 1, detalhesTurma];
    const resultado = req.params.id
      ? await banco.query(`UPDATE aznom_agenda SET tipo=$1, inicio=$2, fim=$3, hora=$4, capacidade=coalesce($5, capacidade), detalhes=coalesce($6, detalhes) WHERE id=$7 AND confirmadas <= coalesce($5, capacidade) AND (tipo=$1 OR (confirmadas=0 AND NOT EXISTS (SELECT 1 FROM aznom_lista_espera WHERE agenda_id=$7)))
          AND NOT atendimento_registrado`, [...valores, req.params.id])
      : await banco.query(`INSERT INTO aznom_agenda (tipo, inicio, fim, hora, capacidade, detalhes) VALUES ($1, $2, $3, $4, coalesce($5, 1), coalesce($6, '{}'::jsonb))`, valores);
    if (!resultado.rowCount) {
      const { rowCount } = await banco.query('SELECT 1 FROM aznom_agenda WHERE id=$1', [req.params.id]);
      if (!rowCount) return res.sendStatus(404);
      return res.status(409).json({ mensagem: 'O item tem confirmações ou um atendimento registrado. Confira a capacidade e o histórico.' });
    }
    res.sendStatus(204);
  });
  app.post('/api/agenda', autenticar, admin, salvar);
  app.put('/api/agenda/:id(\\d+)', autenticar, admin, salvar);
  app.delete('/api/agenda/:id(\\d+)', autenticar, admin, rota(async (req, res) => {
    const { rowCount } = await banco.query('DELETE FROM aznom_agenda WHERE id=$1 AND confirmadas=0', [req.params.id]);
    if (!rowCount) {
      const item = await banco.query('SELECT 1 FROM aznom_agenda WHERE id=$1', [req.params.id]);
      if (!item.rowCount) return res.sendStatus(404);
      return res.status(409).json({ mensagem: 'Desfaça as confirmações antes de remover este item.' });
    }
    res.sendStatus(204);
  }));

  app.get('/api/admin/servicos', autenticar, admin, rota(async (req, res) => {
    const { rows } = await banco.query(
      'SELECT id, nome, descricao, ativo FROM public.servicos ORDER BY nome',
    );
    res.json(rows);
  }));

  const salvarServico = rota(async (req, res) => {
    const nome = typeof req.body?.nome === 'string' ? req.body.nome.trim() : '';
    const descricao = typeof req.body?.descricao === 'string' ? req.body.descricao.trim() : '';
    const ativo = req.body?.ativo;

    if (!nome || nome.length > 100 || !descricao || descricao.length > 1500 || typeof ativo !== 'boolean') {
      return res.status(400).json({ mensagem: 'Informe um nome de até 100 caracteres e uma descrição de até 1500.' });
    }

    const valores = [nome, descricao, ativo];
    const resultado = req.params.id
      ? await banco.query('UPDATE public.servicos SET nome=$1, descricao=$2, ativo=$3 WHERE id=$4', [...valores, req.params.id])
      : await banco.query('INSERT INTO public.servicos (nome, descricao, ativo) VALUES ($1, $2, $3)', valores);

    if (!resultado.rowCount) return res.status(404).json({ mensagem: 'Serviço não encontrado.' });
    res.sendStatus(204);
  });
  app.post('/api/admin/servicos', autenticar, admin, salvarServico);
  app.put('/api/admin/servicos/:id(\\d+)', autenticar, admin, salvarServico);

  registrarOperacao(app, banco, {
    autenticar, admin, rota, limitarEspera: (req, res, next) => limitar(req, res, next, 'espera'),
  });
  registrarGestao(app, banco, { autenticar, admin, rota });
  registrarRecebimentos(app, banco, { autenticar, admin, rota, dataValida });
  require('./depoimentos')(app, banco, { autenticar, admin, rota });
  require('./galeria')(app, banco, { autenticar, admin, rota });

  app.use('/api', (erro, req, res, next) => {
    if (erro.code === '23505') return res.status(409).json({ mensagem: 'Esse item já está cadastrado.' });
    if (erro.status === 413) return res.status(413).json({ mensagem: 'O arquivo excede o tamanho permitido.' });
    if (erro.status === 400 || erro.status === 415) return res.status(erro.status).json({ mensagem: 'Dados inválidos.' });
    console.error('Erro da API:', erro.message);
    res.status(500).json({ mensagem: 'A operação falhou. Confira o terminal da API.' });
  });
};
