module.exports = function registrarDepoimentos(app, banco, { autenticar, admin, rota }) {
  const caminho = '/api/admin/depoimentos';
  const campos = 'id, autor, servico, texto';

  app.get('/api/depoimentos', rota(async (req, res) => {
    const { rows } = await banco.query(`SELECT ${campos} FROM aznom_depoimentos WHERE publicado ORDER BY id DESC`);
    res.json(rows);
  }));

  app.get(caminho, autenticar, admin, rota(async (req, res) => {
    const { rows } = await banco.query(`SELECT ${campos}, publicado FROM aznom_depoimentos ORDER BY id DESC`);
    res.json(rows);
  }));

  const salvar = rota(async (req, res) => {
    const { publicado, autorizado } = req.body ?? {};
    const dados = [['autor', 80], ['servico', 100], ['texto', 600]].map(([campo, limite]) => {
      const valor = req.body?.[campo];
      return typeof valor === 'string' && valor.trim().length <= limite ? valor.trim() : '';
    });
    if (dados.some(valor => !valor) || typeof publicado !== 'boolean' || (publicado && autorizado !== true)) {
      return res.status(400).json({ mensagem: 'Preencha o depoimento e confirme a autorização antes de publicar.' });
    }
    const valores = [...dados, publicado];
    const { rowCount } = req.params.id
      ? await banco.query('UPDATE aznom_depoimentos SET autor=$1, servico=$2, texto=$3, publicado=$4 WHERE id=$5', [...valores, req.params.id])
      : await banco.query('INSERT INTO aznom_depoimentos (autor, servico, texto, publicado) VALUES ($1, $2, $3, $4)', valores);
    if (!rowCount) return res.sendStatus(404);
    res.sendStatus(204);
  });
  app.post(caminho, autenticar, admin, salvar);
  app.put(caminho + '/:id(\\d+)', autenticar, admin, salvar);
};
