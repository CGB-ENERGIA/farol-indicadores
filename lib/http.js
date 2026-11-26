'use strict';
/* Resposta JSON igual no servidor local (node:http) e nas funções do Vercel. */
function json(res, status, obj) {
  const corpo = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(corpo);
}

module.exports = { json };
