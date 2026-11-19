const path = require('node:path');
const express = require('express');
const { Pool } = require('pg');
const { colunaFoto } = require('./fotos-servicos');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const banco = new Pool();
app.disable('x-powered-by');
app.use(express.json({ limit: '8kb' }));

app.get('/api/servicos', async (req, res) => {
  try {
    const resultado = await banco.query(`
      SELECT id, nome, descricao, ${colunaFoto()}
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

require('./agenda')(app, banco);
app.use('/api', (req, res) => res.status(404).json({ mensagem: 'Rota não encontrada.' }));

const web = path.join(__dirname, '../aznom-web/dist/aznom-web/browser');
app.use(express.static(web));

const porta = Number(process.env.PORT || 3000);

app.listen(porta, '0.0.0.0', () => {
  console.log(`API iniciada na porta ${porta}`);
});
