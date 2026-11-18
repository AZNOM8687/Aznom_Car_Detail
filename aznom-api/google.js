const { createHash, randomBytes } = require('node:crypto');

module.exports = function registrarGoogle(app, banco, iniciarSessao) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  const habilitado = GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI;
  const caminho = '/api/auth/google';
  const callback = caminho + '/callback';
  const conta = '/?tela=conta';
  const cookie = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: callback,
  };
  const urlErro = motivo => conta + '&google=' + motivo;
  const aleatorio = () => randomBytes(32).toString('base64url');

  app.get(caminho, (req, res) => {
    if (!habilitado) return res.redirect(urlErro('indisponivel'));
    const state = aleatorio();
    const verifier = aleatorio();
    res.cookie('aznom_google', state + '.' + verifier, { ...cookie, maxAge: 600000 });
    const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    google.search = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email',
      prompt: 'select_account',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    res.redirect(google.toString());
  });

  app.get(callback, async (req, res) => {
    res.set('Referrer-Policy', 'no-referrer');
    res.clearCookie('aznom_google', cookie);
    const fluxo = req.headers.cookie?.match(/(?:^|;\s*)aznom_google=([\w-]{43})\.([\w-]{43})(?:;|$)/);
    if (!habilitado || !fluxo || fluxo[1] !== req.query.state) return res.redirect(urlErro('falha'));
    if (req.query.error === 'access_denied') return res.redirect(urlErro('cancelado'));
    if (typeof req.query.code !== 'string' || !req.query.code) return res.redirect(urlErro('falha'));

    try {
      const token = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        body: new URLSearchParams({
          code: req.query.code,
          code_verifier: fluxo[2],
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: GOOGLE_REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
      });
      if (!token.ok) throw new Error('A troca do código OAuth falhou.');
      const { access_token } = await token.json();
      if (typeof access_token !== 'string' || !access_token) throw new Error('Token ausente.');
      const perfil = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: 'Bearer ' + access_token },
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
      if (!perfil.ok) throw new Error('A consulta da identidade Google falhou.');
      const { sub, email, email_verified } = await perfil.json();
      if (typeof sub !== 'string' || !sub || sub.length > 255 || email_verified !== true
          || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.redirect(urlErro('falha'));
      }

      const { rows } = await banco.query(`
        INSERT INTO aznom_contas (email, google_sub)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        RETURNING id
      `, [email.toLowerCase(), sub]);
      const contaGoogle = rows[0] ?? (await banco.query(
        'SELECT id FROM aznom_contas WHERE google_sub = $1', [sub],
      )).rows[0];
      if (!contaGoogle) return res.redirect(urlErro('conta-existente'));

      await iniciarSessao(req, res, contaGoogle.id);
      res.redirect(conta);
    } catch (erro) {
      console.error('Falha no login com Google:', erro.code ?? erro.name);
      res.redirect(urlErro('falha'));
    }
  });
};
