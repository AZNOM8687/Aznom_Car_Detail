const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const banco = new Pool();

app.get('/api/servicos', async (req, res) => {
  try {
    const resultado = await banco.query(`
      SELECT id, nome, descricao, imagem_url
      FROM public.servicos
      WHERE ativo = TRUE
      ORDER BY nome
    `);

    res.json(resultado.rows);
  } catch (erro) {
    console.error('Erro ao consultar serviços:', erro.message);
    res.status(500).json({ mensagem: 'Não foi possível carregar os serviços.' });
  }
});

app.listen(3000, '127.0.0.1', () => {
  console.log('API disponível em http://127.0.0.1:3000/api/servicos');
});
