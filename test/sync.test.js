'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sincronizar } = require('../lib/sync');
const { criarMemoria, criarArquivo } = require('../lib/store');
const { planilhaCOI, origemFalsa, item } = require('./helpers');

const L = (rec, data, n = 1) => Array.from({ length: n }, () => ({ rec, data }));

test('importa os arquivos novos e não repete na segunda execução', async () => {
  const origem = origemFalsa([
    item('1', 'COI_2026-11-10.xlsx', planilhaCOI([...L('A', '10/11/2026', 3), ...L('B', '09/11/2026', 2)])),
    item('2', 'leia-me.xlsx', planilhaCOI(L('A', '10/11/2026'))), // nome não reconhecido
    item('3', 'foto.png', Buffer.from('x'))
  ]);
  const store = criarMemoria();
  const r1 = await sincronizar({ origem, store });
  assert.equal(r1.processados, 1); assert.equal(r1.ignorados, 1); assert.equal(r1.dias.novo, 2); assert.equal(r1.linhas, 5);
  assert.equal(origem.chamadasBaixar, 1); // só baixou o COI
  assert.deepEqual(await store.indice(), { COI: { '2026-11-10': 3, '2026-11-09': 2 }, MAN: {}, FIS: {}, OBRAS: {} });

  const r2 = await sincronizar({ origem, store });
  assert.equal(r2.processados, 0); assert.equal(r2.jaProcessados, 2);
  assert.equal(origem.chamadasBaixar, 1); // nada baixado de novo
});

test('arquivo alterado é processado de novo e substitui o dia', async () => {
  const origem = origemFalsa([item('1', 'COI_2026-11-10.xlsx', planilhaCOI(L('A', '10/11/2026', 3)))]);
  const store = criarMemoria();
  await sincronizar({ origem, store });
  origem.troca('1', { etag: 'e2', buffer: planilhaCOI(L('A', '10/11/2026', 5)) }); // relatório do dia reexportado com mais linhas
  const r = await sincronizar({ origem, store });
  assert.equal(r.dias.atualizado, 1);
  assert.equal((await store.indice()).COI['2026-11-10'], 5);
});

test('relatório parcial (menos linhas) não apaga um dia completo', async () => {
  const origem = origemFalsa([item('1', 'COI_2026-11-10.xlsx', planilhaCOI(L('A', '10/11/2026', 5)))]);
  const store = criarMemoria();
  await sincronizar({ origem, store });
  origem.troca('1', { etag: 'e2', buffer: planilhaCOI(L('A', '10/11/2026', 2)) });
  const r = await sincronizar({ origem, store });
  assert.equal(r.dias.ignorado, 1);
  assert.equal((await store.indice()).COI['2026-11-10'], 5);
});

test('um arquivo com erro não derruba os outros e é tentado de novo depois', async () => {
  const origem = origemFalsa([
    item('1', 'COI_ruim.xlsx', null, { falha: 'arquivo corrompido' }),
    item('2', 'MAN_ok.xlsx', planilhaCOI(L('A', '10/11/2026', 2)), { modificado: '2026-11-10T11:00:00Z' })
  ]);
  const store = criarMemoria();
  const r = await sincronizar({ origem, store });
  assert.equal(r.erros.length, 1); assert.match(r.erros[0].erro, /corrompido/);
  assert.equal(r.processados, 1);
  origem.troca('1', { falha: null, buffer: planilhaCOI(L('B', '09/11/2026')) });
  const r2 = await sincronizar({ origem, store });
  assert.equal(r2.processados, 1); assert.equal(r2.erros.length, 0); // o que falhou foi refeito
});

test('planilha sem a coluna Data vira erro claro', async () => {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Foo', 'Bar'], [1, 2]]), 'Page 1');
  const origem = origemFalsa([item('1', 'COI_x.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))]);
  const r = await sincronizar({ origem, store: criarMemoria() });
  assert.match(r.erros[0].erro, /coluna "Data"/);
});

test('simulação (dry) não grava nem baixa nada', async () => {
  const origem = origemFalsa([item('1', 'COI_2026-11-10.xlsx', planilhaCOI(L('A', '10/11/2026')))]);
  const store = criarMemoria();
  const r = await sincronizar({ origem, store, dry: true });
  assert.equal(r.arquivos[0].status, 'pendente'); assert.equal(origem.chamadasBaixar, 0);
  assert.deepEqual((await store.indice()).COI, {});
  assert.equal((await sincronizar({ origem, store })).processados, 1); // e depois ainda importa de verdade
});

test('respeita o limite de tempo e deixa o resto para depois', async () => {
  const itens = [1, 2, 3].map(i => item(String(i), `COI_${i}.xlsx`, planilhaCOI(L('A', '10/11/2026', i)), { modificado: `2026-11-10T0${i}:00:00Z` }));
  const origem = origemFalsa(itens); let t = 0;
  const r = await sincronizar({ origem, store: criarMemoria(), limiteMs: 1000, agora: () => (t += 600) });
  assert.ok(r.restantes > 0 && r.processados < 3, JSON.stringify({ restantes: r.restantes, processados: r.processados }));
});

test('não deixa duas sincronizações ao mesmo tempo', async () => {
  let libera; const trava = new Promise(r => (libera = r));
  const origem = { async listar() { await trava; return []; }, async baixar() {} };
  const a = sincronizar({ origem, store: criarMemoria() });
  const b = await sincronizar({ origem, store: criarMemoria() });
  assert.equal(b.ocupado, true);
  libera(); await a;
});

test('armazenamento em arquivos guarda, reabre e reconstrói o índice', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-'));
  try {
    const origem = origemFalsa([item('1', 'COI_2026-11-10.xlsx', planilhaCOI(L('A', '10/11/2026', 4)))]);
    await sincronizar({ origem, store: criarArquivo(dir) });
    const outro = criarArquivo(dir); // processo novo, lendo do disco
    assert.equal((await outro.indice()).COI['2026-11-10'], 4);
    const dia = await outro.dia('COI', '2026-11-10');
    assert.equal(dia.linhas.length, 4); assert.equal(dia.arquivo, 'COI_2026-11-10.xlsx');
    assert.equal((await sincronizar({ origem, store: outro })).jaProcessados, 1);
    fs.rmSync(path.join(dir, 'indice.json'));
    assert.equal((await criarArquivo(dir).indice()).COI['2026-11-10'], 4); // reconstruído dos arquivos
    assert.equal(await outro.dia('COI', '../../etc/passwd'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
