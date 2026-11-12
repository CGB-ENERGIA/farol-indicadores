'use strict';
/* Servidor local de TESTE: banco Postgres em memÃ³ria (PGlite), sem Neon e sem mexer na produÃ§Ã£o.
   Uso (1a vez: npm i --no-save @electric-sql/pglite):  npm run teste   ->  http://localhost:3060
   Login de teste: admin.teste / teste12345 (administrador). Os dados vÃªm de privado/. Ao fechar, tudo some. */
const Module = require('module');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const orig = Module._load;
Module._load = function (req, ...r) {
  if (req === '@neondatabase/serverless') return { neon: () => ({ query: async (t, p) => (await db.query(t, p || [])).rows }) };
  return orig.call(this, req, ...r);
};
process.env.DATABASE_URL = 'postgres://teste';
process.env.SECRET_KEY = process.env.SECRET_KEY || 'chave-de-teste-local';
const auth = require('../lib/auth'), pg = require('../lib/pg');
const { criarServidor } = require('../servidor');
const PORTA = Number(process.env.PORT) || 3060;
(async () => {
  await pg.q("insert into usuarios (usuario,nome,senha_hash,nivel,status) values ('admin.teste','Administrador de Teste',$1,'ADMINISTRADOR','ATIVO')", [auth.hashSenha('teste12345')]);
  criarServidor().listen(PORTA, '127.0.0.1', () => {
    console.log(`Servidor de TESTE em http://localhost:${PORTA}`);
    console.log('Login: admin.teste  /  teste12345   (banco em memÃ³ria; some ao fechar)');
  });
})().catch(e => { console.error(e); process.exit(1); });

