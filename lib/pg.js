'use strict';
/* Conexão única com o Neon + criação das tabelas na primeira chamada (db/schema.sql). */
const fs = require('fs');
const path = require('path');
let sql = null, pronto = null;

function conexao() {
  if (sql) return sql;
  const url = process.env.DATABASE_URL;
  if (!url) { const e = new Error('Variável DATABASE_URL não configurada.'); e.pendencias = ['DATABASE_URL']; throw e; }
  sql = require('@neondatabase/serverless').neon(url);
  return sql;
}
async function garante() {
  const s = conexao();
  pronto = pronto || (async () => {
    const comandos = ['schema.sql', 'schema-web.sql'].map(f => fs.readFileSync(path.join(__dirname, '..', 'db', f), 'utf8')).join(';').split(';')
      .map(c => c.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').trim()).filter(Boolean);
    for (const c of comandos) await s.query(c);
  })();
  await pronto;
}
async function q(texto, params = []) { await garante(); return conexao().query(texto, params); }
module.exports = { q };
