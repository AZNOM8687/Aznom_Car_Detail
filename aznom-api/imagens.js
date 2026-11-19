const express = require('express');

const formatos = ['image/jpeg', 'image/png', 'image/webp'];
const lerImagem = express.raw({ type: formatos, limit: '3mb', inflate: false });

function formatoValido(dados, formato) {
  if (!Buffer.isBuffer(dados) || dados.length < 12) return false;
  if (formato === 'image/jpeg') return dados.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (formato === 'image/png') return dados.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  return formato === 'image/webp' && dados.toString('ascii', 0, 4) === 'RIFF'
    && dados.toString('ascii', 8, 12) === 'WEBP';
}

module.exports = { formatos, lerImagem, formatoValido };
