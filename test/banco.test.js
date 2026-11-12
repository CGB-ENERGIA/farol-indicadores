'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fonteDoNome, lerPlanilha, bancoDeLinhas, BANCO_COLS } = require('../lib/banco');
const { planilhaCOI } = require('./helpers');

test('reconhece o relatório pelo nome do arquivo', () => {
  assert.equal(fonteDoNome('COI_2026-11-10.xlsx'), 'COI');
  assert.equal(fonteDoNome('MA-MAN_2026-11-10.xlsx'), 'MAN');
  assert.equal(fonteDoNome('MA-OBRAS-10112026.xlsx'), 'OBRAS');
  assert.equal(fonteDoNome('MA-FIS_dia.xlsx'), 'FIS');
  assert.equal(fonteDoNome('CONSOLIDADO COI.xlsx'), null);
  assert.equal(fonteDoNome('foto.png'), null);
  assert.equal(fonteDoNome('~$COI_2026.xlsx'), null); // arquivo temporário do Excel
  assert.equal(fonteDoNome('relatorio.xlsx'), null);
  assert.equal(fonteDoNome('MAN_2026-11-10.xlsx'), 'MAN'); // sem o prefixo MA-
  assert.equal(fonteDoNome('Relatorio FIS 10-11.xlsx'), 'FIS');
  assert.equal(fonteDoNome('Mantas.xlsx'), null); // não confunde com palavra maior
});

test('lê a planilha e separa por dia, com as colunas do site', () => {
  const buf = planilhaCOI([
    { rec: 'MA-BCB-E001M', data: '10/11/2026' }, { rec: 'MA-BCB-E001M', data: '10/11/2026' },
    { rec: 'MA-ITM-E001M', data: '09/11/2026' }, { rec: 'MA-ITM-E001M', data: '31/12/2025' }
  ]);
  const b = bancoDeLinhas(lerPlanilha(buf), 'COI', '2026-01-01');
  assert.deepEqual(Object.keys(b.dias).sort(), ['2026-11-09', '2026-11-10']); // 31/12/2025 fica de fora (antes do início)
  assert.equal(b.dias['2026-11-10'].length, 2);
  assert.ok(!b.cols.includes('Data Limite') && b.cols.includes('Tipo de Atividade (2)'));
  const iRec = b.cols.indexOf('Recurso');
  assert.equal(b.dias['2026-11-09'][0][iRec], 'MA-ITM-E001M');
});

test('aceita datas como número do Excel', () => {
  const rows = [['Recurso', 'Data', 'Status da Atividade'], ['MA-X-1', 46336, 'concluído']]; // 46336 = 10/11/2026
  const b = bancoDeLinhas(rows, 'MAN', '2026-01-01');
  assert.deepEqual(Object.keys(b.dias), ['2026-11-10']);
});

test('arquivo sem a coluna Data é recusado', () => {
  assert.equal(bancoDeLinhas([['Recurso', 'Status'], ['A', 'x']], 'COI'), null);
  assert.equal(bancoDeLinhas([], 'COI'), null);
});

test('as quatro fontes têm a coluna Recurso e não têm Data Limite', () => {
  for (const f of Object.keys(BANCO_COLS)) assert.ok(!BANCO_COLS[f].includes('Data Limite') && BANCO_COLS[f].includes('Recurso'), f);
});
