const express = require('express');
const { formatoValido } = require('./imagens');
const { telefoneValido } = require('./operacao');

const pedidosCliente = '/api/conta/orcamentos';
const caminhoAtendimentos = '/api/conta/atendimentos';
const lerPedido = express.json({ limit: '5mb', inflate: false });

function enviarImagem(res, imagem) {
  if (!imagem) return res.sendStatus(404);
  res.set('X-Content-Type-Options', 'nosniff').type(imagem.formato).send(Buffer.from(imagem.dados));
}

module.exports = function registrarExperienciaCliente(app, banco, { autenticar, admin, rota, limitar }) {
  app.post(pedidosCliente, autenticar, limitar, lerPedido, rota(async (req, res) => {
    const { cliente, telefone, veiculo, servico, horario = '', fotos = [] } = req.body ?? {};
    const campos = [cliente, veiculo, servico].map(valor => typeof valor === 'string' ? valor.trim() : '');
    const whatsapp = telefoneValido(telefone);
    if (!whatsapp || campos.some(valor => !valor || valor.length > 100) ||
        typeof horario !== 'string' || horario.length > 120 || !Array.isArray(fotos) || fotos.length > 3) {
      return res.status(400).json({ mensagem: 'Confira o nome, WhatsApp com DDD, veículo, serviço e quantidade de fotos.' });
    }
    const imagens = [];
    for (const foto of fotos) {
      const dados = typeof foto?.dados === 'string' ? Buffer.from(foto.dados, 'base64') : null;
      if (!dados || dados.length > 1048576 || !formatoValido(dados, foto.formato)) {
        return res.status(400).json({ mensagem: 'Envie até três imagens JPG, PNG ou WebP de até 1 MB cada.' });
      }
      imagens.push(dados);
    }
    const [nome, modelo, nomeServico] = campos;
    await banco.query(`
      WITH pedido AS (
        INSERT INTO aznom_orcamentos (cliente, telefone, veiculo, servico, conta_id, horario_preferido)
        VALUES ($1,$2,$3,$4,$5,NULLIF($6,'')) RETURNING id
      )
      INSERT INTO aznom_fotos_orcamento (orcamento_id,posicao,formato,dados)
      SELECT pedido.id, foto.posicao::integer, foto.formato, foto.dados
      FROM pedido CROSS JOIN unnest($7::text[], $8::bytea[]) WITH ORDINALITY AS foto(formato,dados,posicao)
    `, [nome, whatsapp, modelo, nomeServico, req.conta.id, horario.trim(), fotos.map(foto => foto.formato), imagens]);
    res.sendStatus(204);
  }));

  app.get('/api/admin/orcamentos/:id(\\d{1,10})/fotos/:posicao([123])', autenticar, admin, rota(async (req, res) => {
    const { rows: [imagem] } = await banco.query(
      'SELECT formato,dados FROM aznom_fotos_orcamento WHERE orcamento_id::bigint=$1 AND posicao=$2',
      [req.params.id, req.params.posicao],
    );
    enviarImagem(res, imagem);
  }));

  app.get(caminhoAtendimentos, autenticar, rota(async (req, res) => {
    const { rows } = await banco.query(`
      SELECT a.id, a.veiculo, a.servico, a.status, a.andamento, a.data::text,
        left(a.hora::text,5) AS hora, a.cuidados, a.servicos_realizados,
        a.retorno_sugerido::text,
        to_char(a.previsao_entrega, 'YYYY-MM-DD"T"HH24:MI') AS previsao_entrega,
        to_char(a.entregue_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI') AS entregue_em,
        coalesce((SELECT jsonb_agg(f.etapa ORDER BY f.etapa) FROM aznom_fotos_veiculo f
          WHERE f.atendimento_id=a.id AND (a.status='concluido' OR (a.status='confirmado' AND a.andamento='pronto'))), '[]') AS fotos
      FROM aznom_atendimentos a WHERE a.conta_id=$1
      ORDER BY (a.status='confirmado') DESC, a.data DESC, a.hora DESC, a.id DESC
    `, [req.conta.id]);
    res.json(rows);
  }));

  app.get(caminhoAtendimentos + '/:id(\\d{1,10})/fotos/:etapa(antes|depois)', autenticar, rota(async (req, res) => {
    const { rows: [imagem] } = await banco.query(`
      SELECT f.formato,f.dados FROM aznom_fotos_veiculo f JOIN aznom_atendimentos a ON a.id=f.atendimento_id
      WHERE a.id::bigint=$1 AND f.etapa=$2 AND a.conta_id=$3 AND (a.status='concluido' OR (a.status='confirmado' AND a.andamento='pronto'))
    `, [req.params.id, req.params.etapa, req.conta.id]);
    enviarImagem(res, imagem);
  }));
};
