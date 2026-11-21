module.exports = function registrarConteudoCurso(app, banco, { autenticar, admin, rota }) {
  const rotaCurso = handler => rota(async (req, res) => {
    try {
      await handler(req, res);
    } catch (erro) {
      if (erro.code !== '42P01') throw erro;
      res.status(503).json({ mensagem: 'Execute aznom-api/conteudo-curso.sql no banco da API para habilitar o editor.' });
    }
  });

  app.get('/api/conteudo-curso', rotaCurso(async (req, res) => {
    const { rows } = await banco.query('SELECT conteudo FROM aznom_conteudo_curso WHERE id = 1');
    res.json(rows[0]?.conteudo ?? null);
  }));

  app.put('/api/admin/conteudo-curso', autenticar, admin, rotaCurso(async (req, res) => {
    const { titulo, descricao, topicos, chamada } = req.body ?? {};
    const textoValido = (texto, limite) =>
      typeof texto === 'string' && texto.trim().length > 0 && texto.trim().length <= limite;
    if (!textoValido(titulo, 120) || !textoValido(descricao, 1500) || !textoValido(chamada, 120) ||
        !Array.isArray(topicos) || topicos.length < 1 || topicos.length > 12 ||
        !topicos.every(texto => textoValido(texto, 180))) {
      return res.status(400).json({ mensagem: 'Preencha todos os campos e informe de 1 a 12 tópicos de até 180 caracteres.' });
    }

    const conteudo = {
      titulo: titulo.trim(), descricao: descricao.trim(), chamada: chamada.trim(),
      topicos: topicos.map(texto => texto.trim()),
    };
    await banco.query(`
      INSERT INTO aznom_conteudo_curso (id, conteudo) VALUES (1, $1)
      ON CONFLICT (id) DO UPDATE SET conteudo = EXCLUDED.conteudo
    `, [conteudo]);
    res.json(conteudo);
  }));
};
