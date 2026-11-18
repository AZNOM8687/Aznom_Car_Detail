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

  function limitar(req, res, next) {
    const agora = Date.now();
    for (const [ip, janela] of tentativas) {
      if (janela.fim <= agora) tentativas.delete(ip);
    }
    const janela = tentativas.get(req.ip) ?? { total: 0, fim: agora + 600000 };
    if (janela.total >= 20) return res.status(429).json({ mensagem: 'Muitas tentativas. Aguarde alguns minutos.' });
    janela.total += 1;
    tentativas.set(req.ip, janela);
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

  app.get('/api/agenda', autenticar, rota(async (req, res) => {
    const { rows } = await banco.query(`
      SELECT id, tipo, to_char(inicio, 'YYYY-MM-DD') AS inicio,
        to_char(fim, 'YYYY-MM-DD') AS fim, left(hora::text, 5) AS hora
      FROM aznom_agenda
      WHERE coalesce(fim, inicio) >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
      ORDER BY inicio, hora, fim, id
    `);
    res.json(rows);
  }));

  const salvar = rota(async (req, res) => {
    const { tipo, inicio, fim, hora } = req.body ?? {};
    const horario = tipo === 'servicos' && typeof hora === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hora);
    const turma = tipo === 'cursos' && dataValida(fim) && fim >= inicio;
    if (!dataValida(inicio) || (!horario && !turma)) {
      return res.status(400).json({ mensagem: 'Confira as datas e o horário da agenda.' });
    }
    const valores = [tipo, inicio, turma ? fim : null, horario ? hora : null];
    const resultado = req.params.id
      ? await banco.query('UPDATE aznom_agenda SET tipo=$1, inicio=$2, fim=$3, hora=$4 WHERE id=$5', [...valores, req.params.id])
      : await banco.query('INSERT INTO aznom_agenda (tipo, inicio, fim, hora) VALUES ($1, $2, $3, $4)', valores);
    res.sendStatus(resultado.rowCount ? 204 : 404);
  });
  app.post('/api/agenda', autenticar, admin, salvar);
  app.put('/api/agenda/:id(\\d+)', autenticar, admin, salvar);
  app.delete('/api/agenda/:id(\\d+)', autenticar, admin, rota(async (req, res) => {
    const { rowCount } = await banco.query('DELETE FROM aznom_agenda WHERE id=$1', [req.params.id]);
    res.sendStatus(rowCount ? 204 : 404);
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

  require('./galeria')(app, banco, { autenticar, admin, rota });

  app.use('/api', (erro, req, res, next) => {
    if (erro.code === '23505') return res.status(409).json({ mensagem: 'Esse item já está cadastrado.' });
    if (erro.status === 413) return res.status(413).json({ mensagem: 'O arquivo excede o tamanho permitido.' });
    if (erro.status === 400 || erro.status === 415) return res.status(erro.status).json({ mensagem: 'Dados inválidos.' });
    console.error('Erro da API:', erro.message);
    res.status(500).json({ mensagem: 'A operação falhou. Confira o terminal da API.' });
  });
};
