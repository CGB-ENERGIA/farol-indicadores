'use strict';
/* Pequenos utilitários que funcionam igual no servidor local (node:http) e nas funções do Vercel. */
const crypto = require('crypto');

function json(res, status, obj) {
  const corpo = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(corpo);
}

const iguais = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/* Aceita "Authorization: Bearer <chave>" (é o que o Cron do Vercel envia) ou "x-sync-key: <chave>".
   Sem chave configurada, só aceita chamadas feitas no próprio PC (nunca no Vercel). */
function autorizado(req, cfg) {
  if (cfg.segredo) {
    const h = String(req.headers['authorization'] || '');
    const dado = h.startsWith('Bearer ') ? h.slice(7) : String(req.headers['x-sync-key'] || '');
    return !!dado && iguais(dado, cfg.segredo);
  }
  if (cfg.naVercel) return false;
  const ip = (req.socket && req.socket.remoteAddress) || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

const consulta = req => new URL(req.url, 'http://localhost').searchParams;

module.exports = { json, autorizado, consulta };
