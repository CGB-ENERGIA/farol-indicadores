'use strict';
/* Importa a planilha consolidada "BANCOS 2026 - MAN COI OBRAS FIS.xlsx": uma aba por relatório (MAN, COI, OBRAS, FIS),
   até 112 colunas e centenas de milhares de linhas. Lê em fluxo (lib/xlsxStream.js) e grava só as colunas do Banco SIGA. */
const path = require('path');
const { abrirXlsx } = require('./xlsxStream');
const { BANCO_COLS, FONTES } = require('./banco');
const Disp = require('../calc.js');

const LIMITE_BLOCO = 60000; // linhas na memória antes de gravar
/* No consolidado a coluna Data vem como data do Excel (10/11/2026); o banco do site guarda como o SIGA exporta (10/11/26 12:00 AM). */
const dataComoSiga = v => { const m = /^(\d{2}\/\d{2}\/)\d{2}(\d{2})$/.exec(v); return m ? m[1] + m[2] + ' 12:00 AM' : v; };

/* O consolidado numera colunas repetidas ("Tipo de Atividade.1"); o Banco SIGA espera o nome repetido. */
function nomesNormalizados(cab) {
  const vistos = new Set();
  return Array.from(cab, x => {
    const n = String(x == null ? '' : x).trim();
    const m = /^(.*)\.\d+$/.exec(n);
    if (m && vistos.has(m[1])) return m[1];
    vistos.add(n);
    return n;
  });
}

/* Posição de cada coluna do Banco SIGA no cabeçalho da aba (mesma lógica de bancoDeLinhas) */
function mapearColunas(cabecalho, fonte) {
  const h = nomesNormalizados(cabecalho), idx = [], cols = [];
  for (const c of BANCO_COLS[fonte]) {
    const seg = c.endsWith('#2'), nome = seg ? c.slice(0, -2) : c;
    let i = h.indexOf(nome);
    if (seg && i >= 0) i = h.indexOf(nome, i + 1);
    if (i >= 0) { idx.push(i); cols.push(seg ? nome + ' (2)' : nome); }
  }
  return { idx, cols, iData: cols.indexOf('Data') };
}

async function importarConsolidado({ caminho, store, inicio = '2026-01-01', abas = FONTES, arquivo = path.basename(caminho), modificado = null, forcar = true, limiteBloco = LIMITE_BLOCO, log = () => {} }) {
  const x = abrirXlsx(caminho);
  const res = { arquivo, abas: {}, dias: { novo: 0, atualizado: 0, ignorado: 0 }, linhas: 0, erros: [] };
  try {
    const existentes = await x.abas();
    for (const fonte of abas) {
      if (!existentes.includes(fonte)) { res.abas[fonte] = { ausente: true }; continue; }
      try {
        log('Lendo a aba ' + fonte + '…');
        let mapa = null, lidas = 0, semData = 0, foraPeriodo = 0, noBuffer = 0, linhas = 0;
        const dias = {}, jaGravado = new Set(), cont = { novo: 0, atualizado: 0, ignorado: 0 };
        const pool = new Map(); // reaproveita textos repetidos (status, cidade, tipo…): reduz muito a memória
        /* Textos cortados de um pedaço grande do XML "seguram" o pedaço inteiro na memória (V8); copiar evita isso. */
        const copia = t => (t.length >= 13 ? (' ' + t).slice(1) : t);
        const interna = t => { if (t.length > 48) return copia(t); const j = pool.get(t); if (j !== undefined) return j; const c = copia(t); if (pool.size < 1500000) pool.set(c, c); return c; };
        /* Grava em blocos para a memória ficar baixa. Um dia que aparece em mais de um bloco é reunido com o que já foi gravado. */
        const descarrega = async () => {
          for (const d of Object.keys(dias)) {
            let l = dias[d], forc = forcar;
            if (jaGravado.has(d)) { const ex = await store.dia(fonte, d); if (ex) { l = ex.linhas.concat(l); forc = true; } }
            const r = await store.gravarDia({ fonte, data: d, cols: mapa.cols, linhas: l, arquivo, modificado, forcar: forc });
            if (!jaGravado.has(d)) { cont[r]++; res.dias[r]++; jaGravado.add(d); }
            delete dias[d];
          }
          noBuffer = 0;
        };
        const colData = () => mapa.iData;
        await x.lerAba(fonte, async (row, n) => {
          if (n === 1) {
            mapa = mapearColunas(row, fonte);
            if (mapa.iData < 0) throw new Error('A aba ' + fonte + ' não tem a coluna "Data".');
            return;
          }
          lidas++;
          if (lidas % 100000 === 0) log('  ' + fonte + ': ' + lidas.toLocaleString('pt-BR') + ' linhas lidas…');
          const d = Disp.parseData(row[mapa.idx[mapa.iData]]);
          if (!d) { semData++; return; }
          if (d < inicio) { foraPeriodo++; return; }
          const vals = new Array(mapa.idx.length);
          for (let k = 0; k < mapa.idx.length; k++) { const v = row[mapa.idx[k]]; vals[k] = v == null ? '' : interna(String(v).trim()); }
          vals[colData()] = dataComoSiga(vals[colData()]);
          (dias[d] = dias[d] || []).push(vals);
          linhas++;
          if (++noBuffer >= limiteBloco) await descarrega();
        });
        await descarrega();
        pool.clear();
        const lista = [...jaGravado];
        res.linhas += linhas;
        res.abas[fonte] = { linhasLidas: lidas, linhasGravadas: linhas, dias: cont, semData, foraPeriodo };
        log('  ' + fonte + ': ' + lista.length + ' dia(s), ' + linhas.toLocaleString('pt-BR') + ' linhas.');
      } catch (e) {
        res.erros.push({ aba: fonte, erro: e.message });
        res.abas[fonte] = { erro: e.message };
      }
    }
  } finally { x.fechar(); }
  return res;
}

module.exports = { importarConsolidado, nomesNormalizados, mapearColunas };
