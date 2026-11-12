'use strict';
/* Banco SIGA (COI, MAN, FIS, OBRAS): mesmas colunas e regras do site (index.html, "Banco SIGA"). */
const XLSX = require('xlsx');
const Disp = require('../calc.js'); // parseData e fonteDoArquivo: a mesma regra do site

const BANCO_COLS = {
  COI: ['Recurso', 'Data', 'Status da Atividade', 'Cidade', 'Bairro', 'Início', 'Fim', 'Duração', 'Tempo de Deslocamento', 'Tipo de Atividade', 'Tipo de Atividade#2', 'Ordem de Serviço', 'Tipo de Natureza - Text', 'Tipo de Causa - Text', 'SubTipo de Causa - Text', 'Tipo de Conclusão Executada', 'Tipo de Conclusão Não Executada', 'Número da Conta', 'ID da Atividade', 'Número Ocorrência', 'Número da Nota', 'Code', 'Grupo Code', 'Endereço', 'Observação', 'Tipo de Indisponibilidade'],
  MAN: ['Recurso', 'Data', 'Status da Atividade', 'Cidade', 'Início', 'Fim', 'Duração', 'Tempo de Deslocamento', 'Tipo de Atividade', 'Tipo de Atividade#2', 'Ordem de Serviço', 'Número da Conta', 'ID da Atividade', 'Número da Nota', 'Observação'],
  OBRAS: ['Recurso', 'Data', 'Status da Atividade', 'Cidade', 'Início', 'Fim', 'Duração', 'Tempo de Deslocamento', 'Tipo de Atividade', 'Tipo de Atividade#2', 'ID da Atividade', 'Número da Nota', 'Tipo de Indisponibilidade', 'Observação'],
  FIS: ['Recurso', 'Data', 'Status da Atividade', 'Nome', 'Endereço', 'Cidade', 'Bairro', 'Localidade', 'Início', 'Fim', 'Duração', 'Tempo de Deslocamento', 'Tipo de Atividade', 'Tipo de Atividade#2', 'Ordem de Serviço', 'Número da Conta', 'Habilidade de Trabalho', 'Área de Trabalho', 'Code', 'Grupo Code', 'Instalação', 'Número da Nota', 'Irregularidade Encontrada', 'Medidor', 'Medidor Instalado', 'Observação', 'ID da Atividade', 'Unidade']
};
const FONTES = Object.keys(BANCO_COLS);
const EXTENSOES = /\.(xlsx|xlsm|xls|csv)$/i;

/* Planilha com várias abas de relatório (ex.: "BANCOS 2026 - MAN COI OBRAS FIS.xlsx"): o nome cita 2 ou mais relatórios */
function ehConsolidado(nome) {
  if (/^~\$/.test(nome) || !EXTENSOES.test(nome)) return false;
  const n = nome.toUpperCase();
  return new Set([...n.matchAll(/(?<![A-Z])(COI|MAN|OBRAS|FIS)(?![A-Z])/g)].map(m => m[1])).size >= 2;
}

/* "COI_2026-11-10.xlsx" -> "COI"; null quando o nome não indica um relatório do banco */
function fonteDoNome(nome) {
  if (/^~\$/.test(nome) || !EXTENSOES.test(nome) || ehConsolidado(nome)) return null;
  const f = Disp.fonteDoArquivo(nome); // regra do site: COI, MA-MAN_, MA-OBRAS_, MA-FIS_ …
  if (BANCO_COLS[f]) return f;
  const n = nome.toUpperCase().replace(EXTENSOES, '');
  if (n.includes('CONSOLIDADO')) return null;
  const m = n.match(/(?<![A-Z])(COI|MAN|OBRAS|FIS)(?![A-Z])/); // também aceita "MAN_2026-11-10.xlsx"
  return m ? m[1] : null;
}

function lerPlanilha(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', codepage: 65001 });
  const ws = wb.Sheets['Page 1'] || wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('A planilha não tem nenhuma aba.');
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
}

/* Linhas da planilha -> { cols, dias: { 'AAAA-MM-DD': [[valores…]] } }  (nulo se faltar a coluna Data) */
function bancoDeLinhas(rows, fonte, inicio = '2026-01-01') {
  const lista = BANCO_COLS[fonte];
  if (!lista || !rows || !rows.length) return null;
  const h = rows[0].map(x => String(x == null ? '' : x).trim());
  const idx = [], cols = [];
  for (const c of lista) {
    const seg = c.endsWith('#2'), nome = seg ? c.slice(0, -2) : c;
    let i = h.indexOf(nome);
    if (seg && i >= 0) i = h.indexOf(nome, i + 1);
    if (i >= 0) { idx.push(i); cols.push(seg ? nome + ' (2)' : nome); }
  }
  const iD = cols.indexOf('Data');
  if (iD < 0) return null;
  const dias = {};
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; if (!row) continue;
    const d = Disp.parseData(row[idx[iD]]);
    if (!d || d < inicio) continue;
    (dias[d] = dias[d] || []).push(idx.map(i => { const v = row[i]; return v == null ? '' : String(v).trim(); }));
  }
  return { cols, dias };
}

module.exports = { BANCO_COLS, FONTES, EXTENSOES, ehConsolidado, fonteDoNome, lerPlanilha, bancoDeLinhas };
