const { formatos, lerImagem, formatoValido } = require('./imagens');

module.exports = function registrarGaleria(app, banco, { autenticar, admin, rota }) {
  const fotos = '/api/galeria';
  const item = fotos + '/:id(\\d{1,10})';

  app.get(fotos, rota(async (req, res) => {
    const { rows } = await banco.query('SELECT id, legenda FROM public.aznom_fotos ORDER BY id DESC');
    res.json(rows);
  }));

  app.get(item, rota(async (req, res) => {
    const { rows: [foto] } = await banco.query(
      'SELECT formato, dados FROM public.aznom_fotos WHERE id::bigint = $1',
      [req.params.id],
    );
    if (!foto) return res.sendStatus(404);
    res.set('X-Content-Type-Options', 'nosniff').type(foto.formato).send(Buffer.from(foto.dados));
  }));

  const salvarFoto = rota(async (req, res) => {
    const legenda = typeof req.query.legenda === 'string' ? req.query.legenda.trim() : '';
    const formato = req.is(formatos);

    if (!legenda || legenda.length > 100 || !formatoValido(req.body, formato)) {
      return res.status(400).json({ mensagem: 'Envie uma foto JPG, PNG ou WebP e uma legenda de até 100 caracteres.' });
    }
    if (req.params.id) {
      const { rowCount } = await banco.query(
        'UPDATE public.aznom_fotos SET legenda=$1, formato=$2, dados=$3 WHERE id::bigint=$4',
        [legenda, formato, req.body, req.params.id],
      );
      return res.sendStatus(rowCount ? 204 : 404);
    }
    await banco.query(
      'INSERT INTO public.aznom_fotos (legenda, formato, dados) VALUES ($1, $2, $3)',
      [legenda, formato, req.body],
    );
    res.status(201).json({ mensagem: 'Foto publicada.' });
  });
  app.post(fotos, autenticar, admin, lerImagem, salvarFoto);
  app.put(item, autenticar, admin, lerImagem, salvarFoto);

  app.patch(item, autenticar, admin, rota(async (req, res) => {
    const legenda = typeof req.body?.legenda === 'string' ? req.body.legenda.trim() : '';
    if (!legenda || legenda.length > 100) {
      return res.status(400).json({ mensagem: 'Informe uma legenda de até 100 caracteres.' });
    }
    const { rowCount } = await banco.query(
      'UPDATE public.aznom_fotos SET legenda=$1 WHERE id::bigint=$2',
      [legenda, req.params.id],
    );
    res.sendStatus(rowCount ? 204 : 404);
  }));

  app.delete(item, autenticar, admin, rota(async (req, res) => {
    const { rowCount } = await banco.query('DELETE FROM public.aznom_fotos WHERE id::bigint = $1', [req.params.id]);
    res.sendStatus(rowCount ? 204 : 404);
  }));
};
