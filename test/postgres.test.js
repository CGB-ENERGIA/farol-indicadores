'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarPostgres } = require('../lib/store');

function sqlFalso(respostas = []) {
  const chamadas = [];
  return { chamadas, query: async (texto, params) => { chamadas.push({ texto: texto.replace(/\s+/g, ' ').trim(), params }); const r = respostas.shift(); return r === undefined ? [] : r; } };
}

test('cria as três tabelas na primeira chamada (e só uma vez)', async () => {
  const sql = sqlFalso(); const s = criarPostgres('x', { sql });
  await s.indice(); await s.indice();
  const ddl = sql.chamadas.filter(c => /^create table/i.test(c.texto));
  assert.deepEqual(ddl.map(c => c.texto.match(/create table if not exists (\w+)/i)[1]), ['banco_dias', 'arquivos_onedrive', 'sync_execucoes']);
});

test('gravarDia usa upsert que só substitui com linhas iguais ou mais, e traduz o resultado', async () => {
  const d = { fonte: 'COI', data: '2026-11-10', cols: ['Recurso'], linhas: [['A'], ['B']], arquivo: 'COI.xlsx' };
  const sql = sqlFalso([[], [], [], [{ novo: true }], [{ novo: false }], []]); // 3 DDL, depois 3 gravações
  const s = criarPostgres('x', { sql });
  assert.equal(await s.gravarDia(d), 'novo');
  assert.equal(await s.gravarDia(d), 'atualizado');
  assert.equal(await s.gravarDia(d), 'ignorado');
  const up = sql.chamadas.find(c => /insert into banco_dias/i.test(c.texto));
  assert.match(up.texto, /on conflict \(fonte, data\) do update/i);
  assert.match(up.texto, /where \$7::boolean or excluded\.n >= banco_dias\.n/i);
  assert.equal(up.params[6], false); // sem forçar
  assert.deepEqual(up.params.slice(0, 2), ['COI', '2026-11-10']);
  assert.equal(up.params[4], 2); // n
  assert.deepEqual(JSON.parse(up.params[3]), [['A'], ['B']]);
});

test('índice agrupa por fonte e dia; dia inválido não consulta o banco', async () => {
  const sql = sqlFalso([[], [], [], [{ fonte: 'COI', data: '2026-11-10', n: 7 }, { fonte: 'MAN', data: '2026-11-09', n: 3 }]]);
  const s = criarPostgres('x', { sql });
  assert.deepEqual(await s.indice(), { COI: { '2026-11-10': 7 }, MAN: { '2026-11-09': 3 }, FIS: {}, OBRAS: {} });
  const antes = sql.chamadas.length;
  assert.equal(await s.dia('COI', "2026-11-10'; drop table banco_dias;--"), null);
  assert.equal(sql.chamadas.length, antes);
});

test('consultas usam parâmetros, nunca texto concatenado', async () => {
  const sql = sqlFalso(); const s = criarPostgres('x', { sql });
  await s.arquivo("1'; drop table arquivos_onedrive;--"); await s.dia('COI', '2026-11-10');
  for (const c of sql.chamadas.filter(c => /^(select|insert)/i.test(c.texto))) assert.doesNotMatch(c.texto, /drop table|2026-11-10'/i);
});
