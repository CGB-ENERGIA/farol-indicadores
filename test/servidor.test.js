'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { planilhaCOI } = require('./helpers');

function pedir(porta, caminho, headers = {}) {
  return new Promise((ok, no) => http.get({ host: '127.0.0.1', port: porta, path: caminho, headers }, r => {
    const p = []; r.on('data', c => p.push(c)); r.on('end', () => ok({ status: r.statusCode, tipo: r.headers['content-type'], corpo: Buffer.concat(p).toString('utf8') }));
  }).on('error', no));
}

async function subir(env) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-srv-'));
  const entrada = path.join(raiz, 'entrada'); fs.mkdirSync(entrada);
  fs.writeFileSync(path.join(entrada, 'COI_2026-11-10.xlsx'), planilhaCOI([{ rec: 'A', data: '10/11/2026' }, { rec: 'A', data: '10/11/2026' }]));
  fs.writeFileSync(path.join(raiz, 'index.html'), '<title>Teste</title>');
  fs.writeFileSync(path.join(raiz, 'config.json'), '{"a":"ç"}');
  fs.writeFileSync(path.join(raiz, '.env'), 'SEGREDO=1');
  fs.writeFileSync(path.join(raiz, 'banco2026_parte1de5.json'), '{}');
  fs.writeFileSync(path.join(raiz, 'package.json'), '{}');
  Object.assign(process.env, { ONEDRIVE_MODO: 'local', ONEDRIVE_PASTA_LOCAL: entrada, DADOS_DIR: path.join(raiz, 'dados'), DATABASE_URL: '', VERCEL: '', SYNC_SECRET: '', CRON_SECRET: '' }, env);
  require('../lib/contexto').reiniciar();
  const { criarServidor } = require('../servidor');
  const srv = criarServidor(raiz);
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { porta: srv.address().port, fechar: () => { srv.close(); fs.rmSync(raiz, { recursive: true, force: true }); } };
}

test('serve o site em UTF-8 e bloqueia código, segredos e dados', async () => {
  const s = await subir({});
  try {
    const home = await pedir(s.porta, '/');
    assert.equal(home.status, 200); assert.match(home.tipo, /text\/html; charset=utf-8/);
    assert.match((await pedir(s.porta, '/config.json')).corpo, /ç/);
    for (const p of ['/.env', '/banco2026_parte1de5.json', '/package.json', '/lib/config.js', '/dados/arquivos.json', '/../servidor.js', '/%2e%2e/servidor.js', '/servidor.js'])
      assert.equal((await pedir(s.porta, p)).status, 404, p);
  } finally { s.fechar(); }
});

test('API local: sincroniza, mostra o status e entrega o dia', async () => {
  const s = await subir({});
  try {
    const sync = JSON.parse((await pedir(s.porta, '/api/sync')).corpo);
    assert.equal(sync.processados, 1); assert.equal(sync.dias.novo, 1);
    const st = JSON.parse((await pedir(s.porta, '/api/banco?acao=status')).corpo);
    assert.equal(st.armazenamento, 'arquivo'); assert.equal(st.fontes.COI.dias, 1); assert.equal(st.fontes.COI.linhas, 2);
    const dia = JSON.parse((await pedir(s.porta, '/api/banco?acao=dia&fonte=COI&data=2026-11-10')).corpo);
    assert.equal(dia.linhas.length, 2);
    assert.equal((await pedir(s.porta, '/api/banco?acao=dia&fonte=COI&data=2026-01-01')).status, 404);
    assert.equal((await pedir(s.porta, '/api/banco?acao=xyz')).status, 400);
  } finally { s.fechar(); }
});

test('com chave configurada, exige a chave (Bearer ou x-sync-key)', async () => {
  const s = await subir({ SYNC_SECRET: 'chave-forte-123' });
  try {
    assert.equal((await pedir(s.porta, '/api/sync')).status, 401);
    assert.equal((await pedir(s.porta, '/api/banco', { authorization: 'Bearer errada' })).status, 401);
    assert.equal((await pedir(s.porta, '/api/banco', { authorization: 'Bearer chave-forte-123' })).status, 200);
    assert.equal((await pedir(s.porta, '/api/banco', { 'x-sync-key': 'chave-forte-123' })).status, 200);
  } finally { s.fechar(); }
});

test('no Vercel, sem chave configurada, nada é liberado', async () => {
  const s = await subir({ VERCEL: '1', DATABASE_URL: 'postgres://x', ONEDRIVE_MODO: 'graph', AZURE_TENANT_ID: 't', AZURE_CLIENT_ID: 'c', AZURE_CLIENT_SECRET: 's', ONEDRIVE_USUARIO: 'a@b.c' });
  try {
    const r = await pedir(s.porta, '/api/banco');
    assert.equal(r.status, 401);
  } finally { s.fechar(); delete process.env.VERCEL; process.env.DATABASE_URL = ''; }
});

test('configuração incompleta explica o que falta, sem expor valores', async () => {
  const s = await subir({ ONEDRIVE_MODO: 'graph', AZURE_TENANT_ID: '', AZURE_CLIENT_ID: 'abc', AZURE_CLIENT_SECRET: '', ONEDRIVE_USUARIO: '' });
  try {
    const r = await pedir(s.porta, '/api/sync');
    assert.equal(r.status, 503);
    const j = JSON.parse(r.corpo);
    assert.match(j.erro, /AZURE_TENANT_ID/); assert.match(j.erro, /AZURE_CLIENT_SECRET/); assert.doesNotMatch(r.corpo, /abc/);
  } finally { s.fechar(); }
});
