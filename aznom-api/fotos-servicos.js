const { formatos, lerImagem, formatoValido } = require('./imagens');

const prefixoPublico = '/api/servicos/';
const prefixoAdmin = '/api/admin/servicos/';

function colunaFoto(administracao = false) {
  const prefixo = administracao ? prefixoAdmin : prefixoPublico;
  return `CASE WHEN imagem_url LIKE 'data:image/%'
    THEN '${prefixo}' || id || '/foto' ELSE imagem_url END AS imagem_url`;
}

function registrarFotosServicos(app, banco, { autenticar, admin, rota }) {
  const item = ':id(\\d{1,10})/foto';
  const publica = prefixoPublico + item;
  const privada = prefixoAdmin + item;

  function enviarFoto(privada) {
    return rota(async (req, res) => {
      const { rows: [servico] } = await banco.query(
        `SELECT imagem_url FROM public.servicos
         WHERE id::bigint=$1 AND imagem_url LIKE 'data:image/%' ${privada ? '' : 'AND ativo=TRUE'}`,
        [req.params.id],
      );
      const foto = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(servico?.imagem_url || '');
      if (!foto) return res.sendStatus(404);
      const dados = Buffer.from(foto[2], 'base64');
      if (!formatoValido(dados, foto[1])) return res.sendStatus(404);
      res.set('X-Content-Type-Options', 'nosniff').type(foto[1]).send(dados);
    });
  }

  app.get(publica, enviarFoto(false));
  app.get(privada, autenticar, admin, enviarFoto(true));
  app.put(privada, autenticar, admin, lerImagem, rota(async (req, res) => {
    const formato = req.is(formatos);
    if (!formatoValido(req.body, formato)) {
      return res.status(400).json({ mensagem: 'Envie uma imagem JPG, PNG ou WebP de até 3 MB.' });
    }
    const imagem = `data:${formato};base64,${req.body.toString('base64')}`;
    const { rowCount } = await banco.query(
      'UPDATE public.servicos SET imagem_url=$1 WHERE id::bigint=$2',
      [imagem, req.params.id],
    );
    res.sendStatus(rowCount ? 204 : 404);
  }));

  app.delete(privada, autenticar, admin, rota(async (req, res) => {
    const { rowCount } = await banco.query(
      'UPDATE public.servicos SET imagem_url=NULL WHERE id::bigint=$1',
      [req.params.id],
    );
    res.sendStatus(rowCount ? 204 : 404);
  }));
}

module.exports = { colunaFoto, registrarFotosServicos };
