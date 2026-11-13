'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validar } = require('../lib/contingencia');

const CAB = ['Recurso', 'Status da Atividade', 'Tipo de Atividade2', 'Ordem de Serviço', 'Data Limite', 'Cidade', 'Obs (ignorada)', 'Latitude'];
const base = () => ({
  arquivo: 'atividades.xlsx',
  cab: CAB.slice(),
  linhas: [
    ['MA-PDT-C001M', 'pendente', 'SUSPFORN - Corte', '1117328938', '05/11/2026 18:00:00', 'BARRA DO CORDA', 'x', '-5.50435'],
    ['ma-bdc-e001m', 'concluído', 'RELIGABT - Religação', 1117328971, '2026-11-06 23:59', 'DOM PEDRO', null, -550435],
  ],
  nums: [2, 3],
});

test('planilha válida entra, normalizada, só com as colunas conhecidas', () => {
  const r = validar(base());
  assert.equal(r.ok, true, JSON.stringify(r.problemas));
  assert.deepEqual(r.dados.cab, ['RECURSO', 'STATUS DA ATIVIDADE', 'TIPO DE ATIVIDADE2', 'ORDEM DE SERVIÇO', 'DATA LIMITE', 'CIDADE', 'LATITUDE']);
  assert.deepEqual(r.dados.linhas[1], ['MA-BDC-E001M', 'concluído', 'RELIGABT - Religação', '1117328971', '2026-11-06 23:59:00', 'DOM PEDRO', -5.50435]);
});

test('colunas obrigatórias ausentes são todas listadas', () => {
  const b = base(); b.cab = ['Recurso', 'Outra']; b.linhas = [['MA-PDT-C001M', 'a']]; b.nums = [2];
  const r = validar(b);
  assert.equal(r.ok, false);
  assert.deepEqual(r.problemas.map(p => p.coluna).sort(), ['CIDADE', 'DATA LIMITE', 'ORDEM DE SERVIÇO', 'STATUS DA ATIVIDADE', 'TIPO DE ATIVIDADE2']);
});

test('cabeçalho repetido (de coluna conhecida) é recusado; repetido de coluna ignorada não', () => {
  const b = base(); b.cab = CAB.concat(['CIDADE']); b.linhas = b.linhas.map(l => l.concat(['x'])); 
  assert.equal(validar(b).problemas[0].tipo, 'Cabeçalho');
  const c = base(); c.cab = CAB.concat(['Obs (ignorada)']); c.linhas = c.linhas.map(l => l.concat(['y']));
  assert.equal(validar(c).ok, true);
});

test('data limite inválida e campo obrigatório vazio trazem linha e coluna', () => {
  const b = base(); b.linhas[0][4] = '31/02/2026 10:00'; b.linhas[1][0] = null; b.nums = [35, 82];
  const r = validar(b);
  assert.equal(r.ok, false);
  const a = r.problemas.find(p => p.linha === 35), c = r.problemas.find(p => p.linha === 82);
  assert.equal(a.coluna, 'DATA LIMITE'); assert.match(a.mensagem, /formato inválido/);
  assert.equal(c.coluna, 'RECURSO'); assert.match(c.mensagem, /obrigatório/);
});

test('recurso fora do padrão é recusado', () => {
  const b = base(); b.linhas[0][0] = 'CARREGAMENTO';
  assert.equal(validar(b).ok, false);
});

test('registros repetidos são recusados', () => {
  const b = base(); b.linhas[1] = b.linhas[0].slice(); b.nums = [2, 3];
  const r = validar(b);
  assert.equal(r.ok, false);
  assert.equal(r.problemas[0].tipo, 'Registro duplicado'); assert.equal(r.problemas[0].linha, 3);
});

test('arquivo vazio, só cabeçalho, extensão errada, estrutura inválida', () => {
  assert.equal(validar(null).ok, false);
  const so = base(); so.linhas = []; so.nums = [];
  assert.match(validar(so).problemas[0].mensagem, /nenhum registro/);
  const ext = base(); ext.arquivo = 'dados.csv';
  assert.match(validar(ext).problemas[0].mensagem, /Extensão/);
  const em = base(); em.linhas = [[null, null, null, null, null, null, null, null]]; em.nums = [2];
  assert.equal(validar(em).ok, false);
  const est = base(); est.nums = [2];
  assert.equal(validar(est).ok, false);
});

test('limita a lista de problemas mas informa o total', () => {
  const b = base(); b.linhas = Array.from({ length: 300 }, (_, i) => ['MA-PDT-C001M', 'pendente', 'X', '1', 'ontem', 'Y' + i, null, null]); b.nums = b.linhas.map((_, i) => i + 2);
  const r = validar(b);
  assert.equal(r.problemas.length, 100);
  assert.ok(r.total >= 300);
});

test('datas dd/mm/aaaa, dd/mm/aa e com hora são lidas certo', () => {
  const b = { arquivo: 'a.xlsx', cab: ['Recurso', 'Status da Atividade', 'Tipo de Atividade2', 'Ordem de Serviço', 'Data Limite', 'Cidade', 'Data'],
    linhas: [['MA-PDT-C001M', 'p', 'T', '1', '11/11/2026', 'X', '05/11/26'], ['MA-PDT-C002M', 'p', 'T', '2', '05/11/2026 18:00:00', 'X', '2026-11-05']], nums: [2, 3] };
  const r = validar(b);
  assert.equal(r.ok, true);
  assert.equal(r.dados.linhas[0][4], '2026-11-11 00:00:00');
  assert.equal(r.dados.linhas[0][6], '2026-11-05');
  assert.equal(r.dados.linhas[1][4], '2026-11-05 18:00:00');
});

test('prefixo com emoji do SIGA (MA-BDC-H001M 🛵) vira só o prefixo', () => {
  const b = { arquivo: 'a.xlsx', cab: ['Recurso', 'Status da Atividade', 'Tipo de Atividade2', 'Ordem de Serviço', 'Data Limite', 'Cidade'], linhas: [['MA-BDC-H001M 🛵', 'p', 'T', '1', '05/11/2026 10:00', 'X']], nums: [2] };
  const r = validar(b);
  assert.equal(r.ok, true);
  assert.equal(r.dados.linhas[0][0], 'MA-BDC-H001M');
});

test('ordem, data limite e cidade vazias são aceitas (atividades sem prazo, como MISTEC)', () => {
  const b = base(); b.linhas[0][3] = null; b.linhas[0][4] = null; b.linhas[0][5] = null;
  const r = validar(b);
  assert.equal(r.ok, true, JSON.stringify(r.problemas));
  assert.equal(r.dados.linhas[0][4], null);
});
