'use strict';
/* Regras do banco DEFEITOS (situação pelas regras do Power BI, períodos e reabertura). Carrega as funções direto do index.html. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const ini = html.indexOf('const DEF_VALID=');
const fim = html.indexOf('async function defBaseAtualiza');
assert.ok(ini > 0 && fim > ini, 'não achei as funções do banco DEFEITOS no index.html');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(html.slice(ini, fim) + '\nthis.defClassifica=defClassifica;this.defAplica=defAplica;this.defDia=defDia;', ctx);
/* o código roda em outro contexto do vm: devolve cópias comuns para a comparação funcionar */
const copia = f => (...a) => { const r = f(...a); return r == null ? r : JSON.parse(JSON.stringify(r)); };
const defClassifica = copia(ctx.defClassifica), defAplica = copia(ctx.defAplica);

const item = (id, st, extra) => [id, 'MA-2601001DIS1.3.0001', 'DIS', 'P2', 'Estrutura', 'Descrição', 'Recomendação', 'BACABAL', 'BACABAL', '4401', 'ES01', '2026-10-01', '2026-12-01', st, 1, ''].map((v, i) => (extra && extra[i] != null) ? extra[i] : v);
const lin = (id, st, valido = true, emTrat = false) => ({ id, st, valido, sisco: { DEFEITO_ID: id, STATUS_DEFEITO: st, PARCEIRO: 'CGB' }, item: emTrat ? item(id, st) : null });

test('classificação pelas regras do Power BI', () => {
  assert.deepStrictEqual(defClassifica('CONTESTAÇÃO PARCEIRA'), ['EM ABERTO', '']);
  assert.deepStrictEqual(defClassifica('Tratamento de Defeitos'), ['EM ABERTO', '']);
  for (const s of ['CORRIGIR', 'JUIZADO', 'FISCALIZADORA', 'JUSTIFICAR', 'Validação de Correção']) assert.strictEqual(defClassifica(s)[0], 'EM VALIDAÇÃO', s);
  assert.deepStrictEqual(defClassifica('CAPITALIZADO'), ['RESOLVIDO', 'CAPITALIZADO']);
  assert.deepStrictEqual(defClassifica('DEFEITO INVÁLIDO/CANCELADO/REJEITADO'), ['RESOLVIDO', 'INVÁLIDO/CANCELADO/REJEITADO']);
  assert.strictEqual(defClassifica('STATUS NOVO QUALQUER')[0], 'PENDENTE DE CLASSIFICAÇÃO');
});

test('defeito novo em tratativa nasce em aberto com período aberto', () => {
  const d = defAplica(null, lin('100', 'CONTESTAÇÃO PARCEIRA', true, true), '2026-11-10');
  assert.strictEqual(d.situacao, 'EM ABERTO');
  assert.deepStrictEqual(d.t.map(p => [p[0], p[1]]), [['2026-11-10', null]]);
  assert.strictEqual(d.data_aparicao, '2026-11-10');
});

test('mesmo relatório de novo não altera nada', () => {
  const d1 = defAplica(null, lin('100', 'CONTESTAÇÃO PARCEIRA', true, true), '2026-11-10');
  assert.strictEqual(defAplica(d1, lin('100', 'CONTESTAÇÃO PARCEIRA', true, true), '2026-11-10'), null);
  assert.strictEqual(defAplica(d1, lin('100', 'CONTESTAÇÃO PARCEIRA', true, true), '2026-11-11'), null); /* continua em aberto, nada a gravar */
});

test('ciclo completo: aberto → em validação → recusado (reabre) → resolvido', () => {
  let d = defAplica(null, lin('200', 'CONTESTAÇÃO PARCEIRA', true, true), '2026-10-02');
  d = defAplica(d, lin('200', 'JUIZADO', true, false), '2026-10-08'); /* tratado, aguardando validação: sai do pendente */
  assert.strictEqual(d.situacao, 'EM VALIDAÇÃO');
  assert.deepStrictEqual(d.t.map(p => [p[0], p[1]]), [['2026-10-02', '2026-10-07']]);
  assert.deepStrictEqual(d.fora.map(p => [p[0], p[1]]), [['2026-10-08', null]]);
  d = defAplica(d, lin('200', 'CONTESTAÇÃO PARCEIRA', true, true), '2026-10-09'); /* recusado: volta a aparecer */
  assert.strictEqual(d.situacao, 'EM ABERTO');
  assert.deepStrictEqual(d.t.map(p => [p[0], p[1]]), [['2026-10-02', '2026-10-07'], ['2026-10-09', null]]);
  assert.deepStrictEqual(d.fora.map(p => [p[0], p[1]]), [['2026-10-08', '2026-10-08']]);
  d = defAplica(d, lin('200', 'CAPITALIZADO', true, false), '2026-10-10');
  assert.strictEqual(d.situacao, 'RESOLVIDO');
  assert.strictEqual(d.motivo, 'CAPITALIZADO');
  assert.strictEqual(d.data_saida_tratativa, '2026-10-09');
  assert.deepStrictEqual(d.t.map(p => [p[0], p[1]]), [['2026-10-02', '2026-10-07'], ['2026-10-09', '2026-10-09']]);
  assert.deepStrictEqual(d.timeline.map(l => l.status), ['CONTESTAÇÃO PARCEIRA', 'JUIZADO', 'CONTESTAÇÃO PARCEIRA', 'CAPITALIZADO']);
});

test('inválido/cancelado conta como resolvido e não cria período', () => {
  const d = defAplica(null, lin('300', 'DEFEITO INVÁLIDO/CANCELADO/REJEITADO', false, false), '2026-11-12');
  assert.strictEqual(d.situacao, 'RESOLVIDO');
  assert.strictEqual(d.motivo, 'INVÁLIDO/CANCELADO/REJEITADO');
  assert.strictEqual(d.t.length, 0);
  assert.strictEqual(d.fora.length, 0);
});

test('reenviar no mesmo dia com dado alterado corrige o período, sem criar período invertido', () => {
  const d1 = defAplica(null, lin('400', 'CONTESTAÇÃO PARCEIRA', true, true), '2026-11-20');
  const x2 = lin('400', 'TRATAMENTO DE DEFEITOS', true, true);
  const d2 = defAplica(d1, x2, '2026-11-20');
  assert.strictEqual(d2.t.length, 1);
  assert.strictEqual(d2.t[0][1], null);
  assert.strictEqual(d2.versoes[d2.t[0][4]][13], 'TRATAMENTO DE DEFEITOS');
  for (const p of d2.t) assert.ok(p[1] == null || p[0] <= p[1], 'período com fim antes do início');
});

test('nunca fica mais de um período aberto', () => {
  let d = defAplica(null, lin('500', 'CONTESTAÇÃO PARCEIRA', true, true), '2026-11-01');
  d = defAplica(d, lin('500', 'CORRIGIR', true, false), '2026-11-03');
  d = defAplica(d, lin('500', 'TRATAMENTO DE DEFEITOS', true, true), '2026-11-05');
  assert.strictEqual(d.t.filter(p => p[1] == null).length, 1);
  assert.strictEqual(d.fora.filter(p => p[1] == null).length, 0);
});
