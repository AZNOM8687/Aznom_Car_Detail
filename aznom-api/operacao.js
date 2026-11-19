const { formatos, lerImagem, formatoValido } = require('./imagens');

function telefoneValido(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor !== 'string' || !/^[+\d ()-]{8,25}$/.test(valor.trim())) return undefined;
  const digitos = valor.replace(/\D/g, '');
  if (/^[1-9]\d{9,10}$/.test(digitos)) return '55' + digitos;
  if (/^55[1-9]\d{9,10}$/.test(digitos)) return digitos;
  return undefined;
}

const texto = (valor, limite) => typeof valor === 'string' && valor.trim().length <= limite ? valor.trim() : undefined;
const idValido = id => Number.isInteger(id) && id > 0 && id <= 2147483647;

function registrarOperacao(app, banco, { autenticar, admin, rota, limitarEspera }) {
  const orcamentos = '/api/admin/orcamentos';
  const orcamento = orcamentos + '/:id(\\d{1,10})';
  const ficha = '/api/admin/atendimentos/:id(\\d{1,10})/ficha';
  const foto = ficha + '/fotos/:etapa(antes|depois)';
  const espera = '/api/admin/lista-espera';
  const restrito = [autenticar, admin];

  app.get(orcamentos, ...restrito, rota(async (req, res) => {
    const { rows } = await banco.query(`
      SELECT id, cliente, telefone, veiculo, servico, valor_centavos, status, atendimento_id
      FROM aznom_orcamentos ORDER BY criado_em DESC, id DESC
    `);
    res.json(rows);
  }));

  const salvarOrcamento = rota(async (req, res) => {
    const { cliente, telefone, veiculo, servico, valor, status } = req.body ?? {};
    const dados = [texto(cliente, 100), telefoneValido(telefone), texto(veiculo, 100), texto(servico, 100)];
    if (!dados[0] || dados[1] === undefined || !dados[2] || !dados[3] ||
        typeof valor !== 'string' || (valor && !/^\d{1,6}([,.]\d{1,2})?$/.test(valor)) ||
        !['recebido', 'enviado', 'aguardando', 'encerrado'].includes(status)) {
      return res.status(400).json({ mensagem: 'Confira os dados do orçamento, o telefone com DDD e o valor em reais.' });
    }
    const valores = [...dados, valor ? Math.round(Number(valor.replace(',', '.')) * 100) : null, status];
    const { rowCount } = req.params.id
      ? await banco.query(`UPDATE aznom_orcamentos SET cliente=$1, telefone=$2, veiculo=$3,
          servico=$4, valor_centavos=$5, status=$6 WHERE id::bigint=$7 AND atendimento_id IS NULL`, [...valores, req.params.id])
      : await banco.query(`INSERT INTO aznom_orcamentos (cliente, telefone, veiculo, servico, valor_centavos, status)
          VALUES ($1,$2,$3,$4,$5,$6)`, valores);
    if (!rowCount) return res.status(409).json({ mensagem: 'O orçamento mudou ou já foi convertido.' });
    res.sendStatus(204);
  });
  app.post(orcamentos, ...restrito, salvarOrcamento);
  app.put(orcamento, ...restrito, salvarOrcamento);

  app.post(orcamento + '/converter', ...restrito, rota(async (req, res) => {
    const { agendaId } = req.body ?? {};
    if (!idValido(agendaId)) return res.status(400).json({ mensagem: 'Selecione um horário livre.' });
    const { rowCount } = await banco.query(`
      WITH pedido AS MATERIALIZED (
        SELECT id, cliente, telefone, veiculo, servico, valor_centavos FROM aznom_orcamentos
        WHERE id::bigint=$1 AND atendimento_id IS NULL AND status <> 'encerrado' FOR UPDATE
      ), horario AS (
        UPDATE aznom_agenda SET confirmadas=1, atendimento_registrado=true
        WHERE id=$2 AND tipo='servicos' AND confirmadas=0
          AND inicio + hora > now() AT TIME ZONE 'America/Sao_Paulo' AND EXISTS (SELECT 1 FROM pedido)
        RETURNING id, inicio, hora
      ), criado AS (
        INSERT INTO aznom_atendimentos (agenda_id, cliente, telefone, veiculo, servico, data, hora, valor_centavos)
        SELECT h.id, p.cliente, p.telefone, p.veiculo, p.servico, h.inicio, h.hora, p.valor_centavos FROM horario h CROSS JOIN pedido p
        RETURNING id
      )
      UPDATE aznom_orcamentos o SET status='confirmado', atendimento_id=c.id
      FROM pedido p, criado c WHERE o.id=p.id
    `, [req.params.id, agendaId]);
    if (!rowCount) return res.status(409).json({ mensagem: 'O horário ou orçamento mudou. Confira a lista atualizada.' });
    res.sendStatus(204);
  }));

  app.post('/api/agenda/:id(\\d{1,10})/lista-espera', limitarEspera, rota(async (req, res) => {
    const nome = texto(req.body?.nome, 100);
    const telefone = telefoneValido(req.body?.telefone);
    if (!nome || !telefone || req.body?.autorizado !== true) {
      return res.status(400).json({ mensagem: 'Informe nome, WhatsApp com DDD e autorize o contato sobre a turma.' });
    }
    const { rows: [turma] } = await banco.query(`
      WITH lotada AS (
        SELECT id FROM aznom_agenda WHERE id::bigint=$1 AND tipo='cursos' AND confirmadas=capacidade
          AND fim >= (now() AT TIME ZONE 'America/Sao_Paulo')::date FOR SHARE
      ), inscricao AS (
        INSERT INTO aznom_lista_espera (agenda_id, nome, telefone)
        SELECT id, $2, $3 FROM lotada ON CONFLICT (agenda_id, telefone) DO NOTHING
      )
      SELECT id FROM lotada
    `, [req.params.id, nome, telefone]);
    if (!turma) return res.status(409).json({ mensagem: 'A disponibilidade da turma mudou. Consulte as vagas novamente.' });
    res.sendStatus(204);
  }));

  app.get(espera, ...restrito, rota(async (req, res) => {
    const { rows } = await banco.query(`
      SELECT e.id, e.nome, e.telefone, e.contatado, e.agenda_id, m.id AS matricula_id,
        to_char(a.inicio, 'YYYY-MM-DD') AS inicio, to_char(a.fim, 'YYYY-MM-DD') AS fim,
        a.capacidade-a.confirmadas AS vagas,
        a.fim >= (now() AT TIME ZONE 'America/Sao_Paulo')::date AS vigente
      FROM aznom_lista_espera e JOIN aznom_agenda a ON a.id=e.agenda_id
      LEFT JOIN aznom_matriculas m ON m.interesse_id=e.id AND m.cancelada_em IS NULL
      WHERE a.tipo='cursos'
      ORDER BY e.contatado, a.inicio, e.criado_em, e.id
    `);
    res.json(rows);
  }));

  app.patch(espera + '/:id(\\d{1,10})', ...restrito, rota(async (req, res) => {
    const { contatado } = req.body ?? {};
    if (typeof contatado !== 'boolean') return res.sendStatus(400);
    const { rowCount } = await banco.query('UPDATE aznom_lista_espera SET contatado=$1 WHERE id::bigint=$2',
      [contatado, req.params.id]);
    res.sendStatus(rowCount ? 204 : 404);
  }));

  app.patch(ficha, ...restrito, rota(async (req, res) => {
    const telefone = telefoneValido(req.body?.telefone);
    const realizados = texto(req.body?.servicos_realizados, 1200);
    const observacoes = texto(req.body?.observacoes_veiculo, 1200);
    if ([telefone, realizados, observacoes].includes(undefined)) {
      return res.status(400).json({ mensagem: 'Confira o telefone com DDD e o tamanho das anotações.' });
    }
    const { rowCount } = await banco.query(`UPDATE aznom_atendimentos SET telefone=$1, servicos_realizados=$2,
      observacoes_veiculo=$3 WHERE id::bigint=$4`, [telefone, realizados, observacoes, req.params.id]);
    res.sendStatus(rowCount ? 204 : 404);
  }));

  app.get(foto, ...restrito, rota(async (req, res) => {
    const { rows: [imagem] } = await banco.query(`
      SELECT formato, dados FROM aznom_fotos_veiculo WHERE atendimento_id::bigint=$1 AND etapa=$2
    `, [req.params.id, req.params.etapa]);
    if (!imagem) return res.sendStatus(404);
    res.set('X-Content-Type-Options', 'nosniff').type(imagem.formato).send(imagem.dados);
  }));

  app.put(foto, ...restrito, lerImagem, rota(async (req, res) => {
    const formato = req.is(formatos);
    if (!formatoValido(req.body, formato)) {
      return res.status(400).json({ mensagem: 'Envie uma foto JPG, PNG ou WebP de até 3 MB.' });
    }
    const { rowCount } = await banco.query(`
      INSERT INTO aznom_fotos_veiculo (atendimento_id, etapa, formato, dados)
      SELECT id, $2, $3, $4 FROM aznom_atendimentos WHERE id::bigint=$1
      ON CONFLICT (atendimento_id, etapa) DO UPDATE SET formato=excluded.formato, dados=excluded.dados
    `, [req.params.id, req.params.etapa, formato, req.body]);
    res.sendStatus(rowCount ? 204 : 404);
  }));

  app.delete(foto, ...restrito, rota(async (req, res) => {
    const { rowCount } = await banco.query('DELETE FROM aznom_fotos_veiculo WHERE atendimento_id::bigint=$1 AND etapa=$2',
      [req.params.id, req.params.etapa]);
    res.sendStatus(rowCount ? 204 : 404);
  }));
}

module.exports = { registrarOperacao, telefoneValido };
