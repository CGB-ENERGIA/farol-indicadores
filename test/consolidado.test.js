'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { abrirXlsx, serialParaTexto, colunaParaIndice } = require('../lib/xlsxStream');
const { importarConsolidado, nomesNormalizados } = require('../lib/consolidado');
const { sincronizar } = require('../lib/sync');
const { criarMemoria } = require('../lib/store');
const { ehConsolidado, fonteDoNome } = require('../lib/banco');
const { xlsxConsolidado, serial, planilhaCOI } = require('./helpers');

const CAB = ['Recurso', 'Data', 'Mês', 'Status da Atividade', 'Cidade', 'Início', 'Fim', 'Data Limite', 'Duração', 'Tempo de Deslocamento', 'Tipo de Atividade', 'Tipo de Atividade.1', 'Ordem de Serviço', 'ID da Atividade', 'Observação'];
const lin = (rec, iso, id, obs = '') => [rec, { data: serial(iso) }, iso.slice(0, 7), 'concluído', 'BACABAL', '08:00', '09:00', null, '01:00', '00:10', 'Normal', 'Obras', 'OS' + id, 1000 + id, obs];

function tmp(nome, buf) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-xl-')); const f = path.join(d, nome); fs.writeFileSync(f, buf); return { f, limpa: () => fs.rmSync(d, { recursive: true, force: true }) }; }

test('colunas e datas do Excel', () => {
  assert.equal(colunaParaIndice('A'), 0); assert.equal(colunaParaIndice('Z'), 25); assert.equal(colunaParaIndice('AA'), 26); assert.equal(colunaParaIndice('DH'), 111);
  assert.equal(serialParaTexto(46336), '10/11/2026'); assert.equal(serialParaTexto(46336.5), '10/11/2026 12:00');
});

test('lê abas, texto embutido, células vazias, entidades XML e linha vazia', async () => {
  const buf = xlsxConsolidado({ RESUMO: [['x']], COI: [CAB, lin('MA-A', '2026-11-10', 1, 'A & B <ok> "q"'), [null], lin('MA-B', '2026-11-09', 2)] });
  const { f, limpa } = tmp('a.xlsx', buf); const x = abrirXlsx(f);
  try {
    assert.deepEqual(await x.abas(), ['RESUMO', 'COI']);
    const linhas = []; await x.lerAba('COI', l => { linhas.push(l); });
    assert.equal(linhas.length, 3); // cabeçalho + 2 (a linha vazia é ignorada)
    assert.equal(linhas[0][0], 'Recurso');
    assert.equal(linhas[1][1], '10/11/2026'); // data do Excel -> texto
    assert.equal(linhas[1][7], undefined); // célula omitida
    assert.equal(linhas[1][13], 1001); // número continua número
    assert.equal(linhas[1][14], 'A & B <ok> "q"'); // entidades decodificadas
    await assert.rejects(x.lerAba('NAOEXISTE', () => {}), /não encontrada/);
  } finally { x.fechar(); limpa(); }
});

test('arquivo grande atravessa vários blocos de leitura sem perder nem cortar linhas', async () => {
  const N = 40000, linhas = [CAB]; for (let i = 1; i <= N; i++) linhas.push(lin('MA-' + i, '2026-11-10', i, 'obs ' + 'x'.repeat(40)));
  const { f, limpa } = tmp('g.xlsx', xlsxConsolidado({ COI: linhas }));
  const x = abrirXlsx(f);
  try {
    let n = 0, ult = null, ok = true;
    await x.lerAba('COI', (l, k) => { if (k > 1) { n++; ult = l; if (l[0] !== 'MA-' + n || l[13] !== 1000 + n) ok = false; } });
    assert.equal(n, N); assert.ok(ok, 'alguma linha veio cortada ou fora de ordem'); assert.equal(ult[0], 'MA-' + N);
    assert.ok(fs.statSync(f).size > 0);
  } finally { x.fechar(); limpa(); }
});

test('a leitura para quando o chamador devolve false', async () => {
  const { f, limpa } = tmp('p.xlsx', xlsxConsolidado({ COI: [CAB, lin('A', '2026-11-10', 1), lin('B', '2026-11-10', 2), lin('C', '2026-11-10', 3)] }));
  const x = abrirXlsx(f);
  try { let n = 0; await x.lerAba('COI', () => { n++; return n < 2 ? true : false; }); assert.equal(n, 2); } finally { x.fechar(); limpa(); }
});

test('também lê planilhas comuns (textos compartilhados), como as geradas pelo Excel', async () => {
  const { f, limpa } = tmp('c.xlsx', planilhaCOI([{ rec: 'MA-X', data: '10/11/2026' }])); const x = abrirXlsx(f);
  try { const l = []; await x.lerAba('Page 1', r => { l.push(r); }); assert.equal(l[0][0], 'Recurso'); assert.equal(l[1][0], 'MA-X'); } finally { x.fechar(); limpa(); }
});

test('arquivo que não é xlsx dá erro claro', () => {
  const { f, limpa } = tmp('ruim.xlsx', Buffer.from('isto não é um zip'));
  try { assert.throws(() => abrirXlsx(f), /zip/); } finally { limpa(); }
});

test('colunas numeradas do consolidado voltam ao nome repetido do SIGA', () => {
  assert.deepEqual(nomesNormalizados(['Tipo de Atividade', 'Tipo de Atividade.1', 'Quant', 'Quant.1', 'Versão.2']), ['Tipo de Atividade', 'Tipo de Atividade', 'Quant', 'Quant', 'Versão.2']);
});

test('importa o consolidado: abas viram fontes, colunas do Banco SIGA, data no formato do site', async () => {
  const buf = xlsxConsolidado({
    RESUMO: [['resumo']],
    MAN: [CAB, lin('MA-M', '2026-11-10', 1)],
    COI: [CAB, lin('MA-A', '2026-11-10', 1, 'A & B'), lin('MA-B', '2026-11-10', 2), lin('MA-C', '2026-11-09', 3), lin('MA-D', '2025-12-31', 4)]
  });
  const { f, limpa } = tmp('BANCOS 2026 - MAN COI OBRAS FIS.xlsx', buf); const store = criarMemoria();
  try {
    const r = await importarConsolidado({ caminho: f, store, inicio: '2026-01-01' });
    assert.deepEqual(r.erros, []);
    assert.equal(r.abas.OBRAS.ausente, true); assert.equal(r.abas.COI.foraPeriodo, 1);
    assert.deepEqual((await store.indice()).COI, { '2026-11-10': 2, '2026-11-09': 1 });
    const dia = await store.dia('COI', '2026-11-10');
    assert.ok(!dia.cols.includes('Data Limite') && dia.cols.includes('Tipo de Atividade (2)'));
    assert.equal(dia.linhas[0][dia.cols.indexOf('Data')], '10/11/26 12:00 AM'); // mesmo formato do banco do site
    assert.equal(dia.linhas[0][dia.cols.indexOf('Tipo de Atividade (2)')], 'Obras');
    assert.equal(dia.linhas[0][dia.cols.indexOf('Observação')], 'A & B');
    assert.equal(dia.linhas[0][dia.cols.indexOf('ID da Atividade')], '1001');
  } finally { limpa(); }
});

test('dias fora de ordem e gravação em blocos pequenos reúnem todas as linhas do dia', async () => {
  const linhas = [CAB]; let id = 0;
  for (let i = 0; i < 12; i++) linhas.push(lin('MA-' + i, i % 2 ? '2026-11-10' : '2026-11-09', ++id)); // dias intercalados
  const { f, limpa } = tmp('b.xlsx', xlsxConsolidado({ COI: linhas })); const store = criarMemoria();
  try {
    await importarConsolidado({ caminho: f, store, limiteBloco: 3 }); // descarrega a cada 3 linhas
    const idx = await store.indice();
    assert.deepEqual(idx.COI, { '2026-11-09': 6, '2026-11-10': 6 });
    const d10 = await store.dia('COI', '2026-11-10'), iId = d10.cols.indexOf('ID da Atividade');
    const ids = d10.linhas.map(l => l[iId]);
    assert.equal(new Set(ids).size, 6); // nenhuma linha duplicada nem perdida
  } finally { limpa(); }
});

test('o consolidado substitui dias existentes, mesmo com menos linhas (é a fonte da verdade)', async () => {
  const store = criarMemoria();
  await store.gravarDia({ fonte: 'COI', data: '2026-11-10', cols: ['Recurso'], linhas: [['x'], ['y'], ['z'], ['w']] });
  const { f, limpa } = tmp('b.xlsx', xlsxConsolidado({ COI: [CAB, lin('A', '2026-11-10', 1), lin('B', '2026-11-10', 2)] }));
  try {
    const r = await importarConsolidado({ caminho: f, store });
    assert.equal(r.dias.atualizado, 1); assert.equal((await store.indice()).COI['2026-11-10'], 2);
    const r2 = await importarConsolidado({ caminho: f, store, forcar: false }); // sem forçar, igual não troca para menos
    assert.ok(r2.dias.atualizado + r2.dias.ignorado === 1);
  } finally { limpa(); }
});

test('aba sem a coluna Data vira erro só daquela aba', async () => {
  const { f, limpa } = tmp('b.xlsx', xlsxConsolidado({ MAN: [['Foo', 'Bar'], ['1', '2']], COI: [CAB, lin('A', '2026-11-10', 1)] }));
  try {
    const r = await importarConsolidado({ caminho: f, store: criarMemoria() });
    assert.match(r.abas.MAN.erro, /Data/); assert.equal(r.abas.COI.linhasGravadas, 1); assert.equal(r.erros.length, 1);
  } finally { limpa(); }
});

test('reconhece o nome do consolidado e não o confunde com um relatório diário', () => {
  assert.equal(ehConsolidado('BANCOS 2026 - MAN COI OBRAS FIS.xlsx'), true);
  assert.equal(ehConsolidado('COI_2026-11-10.xlsx'), false);
  assert.equal(ehConsolidado('Atividades-Centro MA-FIS_01_06_26.xlsx'), false);
  assert.equal(fonteDoNome('BANCOS 2026 - MAN COI OBRAS FIS.xlsx'), null);
  assert.equal(fonteDoNome('BANCOS 2025 - COI.xlsx'), 'COI');
});

test('sincronização: lê o consolidado em fluxo, respeita o filtro e não repete', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sync-'));
  try {
    fs.writeFileSync(path.join(d, 'BANCOS 2026 - MAN COI OBRAS FIS.xlsx'), xlsxConsolidado({ COI: [CAB, lin('A', '2026-11-10', 1), lin('B', '2026-11-10', 2)], MAN: [CAB, lin('M', '2026-11-10', 3)] }));
    fs.mkdirSync(path.join(d, '2025')); fs.writeFileSync(path.join(d, '2025', 'BANCOS 2025 - COI.xlsx'), xlsxConsolidado({ COI: [CAB, lin('Z', '2025-05-05', 9)] }));
    const { criarFonteLocal } = require('../lib/fonteLocal');
    const origem = criarFonteLocal(d, 2), store = criarMemoria();
    const r = await sincronizar({ origem, store, filtro: 'BANCOS 2026' });
    assert.equal(r.candidatos, 1); assert.equal(r.processados, 1); assert.deepEqual(r.erros, []);
    assert.equal(r.linhas, 3); assert.deepEqual(Object.keys((await store.indice()).COI), ['2026-11-10']);
    assert.equal((await sincronizar({ origem, store, filtro: 'BANCOS 2026' })).jaProcessados, 1);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('sincronização: origem sem arquivo local (Graph) explica a limitação do consolidado', async () => {
  const origem = { async listar() { return [{ id: '1', nome: 'BANCOS 2026 - MAN COI OBRAS FIS.xlsx', tamanho: 9e7, etag: 'e', modificado: '2026-11-11T10:00:00Z', caminho: 'x' }]; }, async baixar() { throw new Error('não deveria baixar'); } };
  const r = await sincronizar({ origem, store: criarMemoria() });
  assert.match(r.erros[0].erro, /modo local/);
});
