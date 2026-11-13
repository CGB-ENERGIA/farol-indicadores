'use strict';
/* Base única e compartilhada das páginas "Gestão de Contingência" e "Farol de Prazos".
   Os dados são o relatório de atividades do SIGA (aba "Page 1" do BI): a planilha vem com ~117 colunas, mas só entram as da lista COLUNAS.
   - validar(): checa tudo ANTES de tocar na base (nada é importado pela metade).
   - substituir(): troca a base num único comando SQL (atômico): a última importação concluída prevalece. */
const pg = require('./pg');

/* tipos: texto | numero | coord | data | datahora | hora | prefixo. Colunas da planilha fora desta lista são ignoradas. */
const COLUNAS = [
  { nome: 'RECURSO', obrigatoria: true, tipo: 'prefixo' },
  { nome: 'STATUS DA ATIVIDADE', obrigatoria: true, tipo: 'texto' },
  { nome: 'TIPO DE ATIVIDADE2', obrigatoria: true, tipo: 'texto' },
  { nome: 'ORDEM DE SERVIÇO', obrigatoria: true, vazioOk: true, tipo: 'texto' },
  { nome: 'DATA LIMITE', obrigatoria: true, vazioOk: true, tipo: 'datahora' },
  { nome: 'CIDADE', obrigatoria: true, vazioOk: true, tipo: 'texto' },
  { nome: 'DATA', tipo: 'data' },
  { nome: 'BAIRRO', tipo: 'texto' },
  { nome: 'INÍCIO', tipo: 'hora' },
  { nome: 'FIM', tipo: 'hora' },
  { nome: 'NÚMERO DA NOTA', tipo: 'texto' },
  { nome: 'NÚMERO DE CLIENTES INTERROMPIDOS', tipo: 'numero' },
  { nome: 'TIPO DE SERVIÇO DETALHADO', tipo: 'texto' },
  { nome: 'STATUS DA ATIVIDADE$', tipo: 'texto' },
  { nome: 'LATITUDE', tipo: 'coord' },
  { nome: 'LONGITUDE', tipo: 'coord' },
];
const MAX_LINHAS = 50000;
const MAX_COLUNAS = 400;
const MAX_PROBLEMAS = 100;
const EXTENSOES = /\.(xlsx|xls)$/i;

const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[_\s]+/g, ' ').trim();
const vazio = v => v === null || v === undefined || String(v).trim() === '';
const pad = n => String(n).padStart(2, '0');

function dataParts(s) {
  s = String(s).trim();
  let r = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/), a, m, d, h = 0, mi = 0, se = 0;
  if (r) { a = +r[1]; m = +r[2]; d = +r[3]; h = +(r[4] || 0); mi = +(r[5] || 0); se = +(r[6] || 0); }
  else if ((r = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)(?:[T ]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/))) { d = +r[1]; m = +r[2]; a = +r[3]; if (a < 100) a += 2000; h = +(r[4] || 0); mi = +(r[5] || 0); se = +(r[6] || 0); }
  else return null;
  const t = new Date(Date.UTC(a, m - 1, d));
  if (t.getUTCFullYear() !== a || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d || a < 2000 || a > 2100 || h > 23 || mi > 59 || se > 59) return null;
  return { a, m, d, h, mi, se };
}
const dataIso = v => { const p = dataParts(v); return p ? p.a + '-' + pad(p.m) + '-' + pad(p.d) : null; };
const dataHora = v => { const p = dataParts(v); return p ? p.a + '-' + pad(p.m) + '-' + pad(p.d) + ' ' + pad(p.h) + ':' + pad(p.mi) + ':' + pad(p.se) : null; };
function horaTxt(v) { const r = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/); if (!r || +r[1] > 23 || +r[2] > 59) return null; return pad(+r[1]) + ':' + r[2]; }
function numero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\s/g, '');
  const t = s.replace(/\.(?=\d{3}(\D|$))/g, '');
  if (!/^-?\d+([.,]\d+)?$/.test(t)) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
/* o SIGA exporta a coordenada como inteiro (−550435 = −5,50435): se vier assim, divide por 100 mil */
function coord(v) { const n = numero(v); if (n === null) return null; const c = Math.abs(n) > 180 ? n / 100000 : n; return Math.abs(c) > 180 ? null : c; }

const ORIENT = {
  prefixo: 'use o prefixo da equipe, como MA-PDT-C001M.',
  data: 'use uma data válida (dd/mm/aaaa ou aaaa-mm-dd).',
  datahora: 'use data e hora válidas, como 05/11/2026 18:00:00.',
  hora: 'use o formato HH:MM.',
  numero: 'use apenas número, como 12 ou 12,5.',
  coord: 'use a coordenada em graus, como -5.50435.',
};

/* corpo = { arquivo, cab:[nomes], linhas:[[valores]], nums:[nº da linha na planilha] } → { ok, problemas, total, dados }.
   Só as colunas de COLUNAS são lidas; cabeçalhos de outras colunas não são conferidos. */
function validar(corpo) {
  const problemas = []; let total = 0;
  const add = (tipo, mensagem, extra) => { total++; if (problemas.length < MAX_PROBLEMAS) problemas.push(Object.assign({ tipo, mensagem }, extra || {})); };
  const falha = () => ({ ok: false, problemas, total });

  if (!corpo || typeof corpo !== 'object') { add('Arquivo', 'Nenhum dado foi recebido.', { orientacao: 'Selecione a planilha de novo.' }); return falha(); }
  const arquivo = String(corpo.arquivo || '').trim();
  if (!arquivo || arquivo.length > 200) { add('Arquivo', 'Nome do arquivo ausente ou longo demais.', { orientacao: 'Renomeie o arquivo e tente de novo.' }); return falha(); }
  if (!EXTENSOES.test(arquivo)) { add('Arquivo', 'Extensão incompatível: use uma planilha .xlsx ou .xls.', { orientacao: 'Salve a planilha como Excel (.xlsx).' }); return falha(); }
  if (!Array.isArray(corpo.cab) || !Array.isArray(corpo.linhas) || !Array.isArray(corpo.nums) || corpo.nums.length !== corpo.linhas.length) { add('Estrutura', 'Estrutura interna da planilha inválida.', { orientacao: 'Abra a planilha no Excel, salve de novo e tente outra vez.' }); return falha(); }
  if (!corpo.cab.length) { add('Estrutura', 'A planilha não tem linha de cabeçalho.', { orientacao: 'A primeira linha deve ter o nome das colunas.' }); return falha(); }
  if (!corpo.linhas.length) { add('Arquivo', 'A planilha não tem nenhum registro (só o cabeçalho ou vazia).', { orientacao: 'Preencha ao menos uma linha de dados.' }); return falha(); }
  if (corpo.linhas.length > MAX_LINHAS) { add('Arquivo', 'Planilha com mais de ' + MAX_LINHAS + ' linhas.', { orientacao: 'Divida o arquivo ou remova linhas desnecessárias.' }); return falha(); }
  if (corpo.cab.length > MAX_COLUNAS) { add('Estrutura', 'Planilha com colunas demais.', { orientacao: 'Remova as colunas que não fazem parte do relatório.' }); return falha(); }

  /* cabeçalho: só as colunas conhecidas contam; repetidas e ausentes são recusadas */
  const cab = corpo.cab.map(c => String(c == null ? '' : c).trim());
  const conhecidas = new Map(COLUNAS.map(c => [norm(c.nome), c]));
  const idx = {};
  cab.forEach((c, i) => {
    const n = norm(c); if (!conhecidas.has(n)) return;
    if (idx[n] !== undefined) add('Cabeçalho', 'Coluna ' + c + ' repetida no cabeçalho.', { coluna: c, orientacao: 'Deixe só uma coluna com esse nome.' });
    else idx[n] = i;
  });
  for (const col of COLUNAS) if (col.obrigatoria && idx[norm(col.nome)] === undefined) add('Coluna ausente', 'Coluna ' + col.nome + ' não encontrada.', { coluna: col.nome, orientacao: 'Confira se o nome do cabeçalho está igual a ' + col.nome + '.' });
  if (total) return falha();

  const usadas = COLUNAS.filter(c => idx[norm(c.nome)] !== undefined);
  const saidaCab = usadas.map(c => c.nome);
  const vistos = new Map(), saida = [];
  for (let k = 0; k < corpo.linhas.length; k++) {
    const lin = corpo.nums[k], v = corpo.linhas[k];
    if (!Array.isArray(v)) { add('Registro', 'Linha ' + lin + ' com formato inválido.', { linha: lin }); continue; }
    const out = [];
    let branca = true;
    for (const c of usadas) {
      let x = v[idx[norm(c.nome)]]; if (x === undefined) x = null;
      if (typeof x === 'string') x = x.trim();
      if (x !== null && typeof x === 'object') x = null;
      if (vazio(x)) { x = null; }
      else { branca = false; if (typeof x === 'string' && x.length > 500) { add('Conteúdo', 'Texto longo demais (mais de 500 caracteres).', { coluna: c.nome, linha: lin, orientacao: 'Reduza o texto da célula.' }); x = null; } }
      if (x === null) { out.push(null); continue; }
      let n = null;
      if (c.tipo === 'prefixo') { n = String(x).trim().split(/\s+/)[0].toUpperCase(); /* o SIGA põe um emoji depois do prefixo (ex.: MA-BDC-H001M 🛵): fica só o prefixo */ if (!/^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]+$/.test(n)) n = null; }
      else if (c.tipo === 'data') n = dataIso(x);
      else if (c.tipo === 'datahora') n = dataHora(x);
      else if (c.tipo === 'hora') n = horaTxt(x);
      else if (c.tipo === 'numero') n = numero(x);
      else if (c.tipo === 'coord') n = coord(x);
      else n = String(x);
      if (n === null) { add('Valor inválido', c.nome + ' em formato inválido (' + String(x).slice(0, 40) + ').', { coluna: c.nome, linha: lin, orientacao: ORIENT[c.tipo] }); out.push(null); }
      else out.push(n);
    }
    if (branca) continue; // linha em branco no meio da planilha: ignorada
    usadas.forEach((c, i) => { if (c.obrigatoria && !c.vazioOk && out[i] === null && !problemas.some(p => p.linha === lin && p.coluna === c.nome)) add('Campo obrigatório', 'Campo obrigatório não preenchido.', { coluna: c.nome, linha: lin, orientacao: 'Preencha a coluna ' + c.nome + ' ou remova a linha.' }); });
    const chave = JSON.stringify(out);
    if (vistos.has(chave)) add('Registro duplicado', 'Linha igual à linha ' + vistos.get(chave) + '.', { linha: lin, orientacao: 'Remova a linha repetida.' });
    else { vistos.set(chave, lin); saida.push(out); }
  }
  if (!saida.length && !total) add('Arquivo', 'A planilha não tem nenhum registro preenchido.', { orientacao: 'Preencha ao menos uma linha de dados.' });
  if (total) return falha();
  return { ok: true, problemas: [], total: 0, dados: { arquivo, cab: saidaCab, linhas: saida } };
}

const META = 'versao, arquivo, usuario, nome, importado_em, total';
async function meta() {
  const r = await pg.q('select ' + META + ' from contingencia_base where id = 1');
  return r[0] ? Object.assign({ existe: true }, r[0], { versao: Number(r[0].versao) }) : { existe: false };
}
async function ler() {
  const r = await pg.q('select ' + META + ', cab, linhas from contingencia_base where id = 1');
  return r[0] ? Object.assign({ existe: true }, r[0], { versao: Number(r[0].versao) }) : { existe: false };
}
/* um único INSERT ... ON CONFLICT: ou a base nova entra inteira ou nada muda. Quem terminar por último fica. */
async function substituir(dados, usuario) {
  const r = await pg.q(
    'insert into contingencia_base (id, versao, arquivo, usuario, nome, importado_em, cab, linhas, total) values (1, 1, $1, $2, $3, now(), $4::jsonb, $5::jsonb, $6) ' +
    'on conflict (id) do update set versao = contingencia_base.versao + 1, arquivo = excluded.arquivo, usuario = excluded.usuario, nome = excluded.nome, importado_em = now(), cab = excluded.cab, linhas = excluded.linhas, total = excluded.total ' +
    'returning ' + META,
    [dados.arquivo, usuario.usuario, usuario.nome, JSON.stringify(dados.cab), JSON.stringify(dados.linhas), dados.linhas.length]);
  return Object.assign({ existe: true }, r[0], { versao: Number(r[0].versao) });
}
const esquema = () => COLUNAS.map(c => ({ nome: c.nome, obrigatoria: !!c.obrigatoria, tipo: c.tipo }));

module.exports = { validar, meta, ler, substituir, esquema, COLUNAS };
