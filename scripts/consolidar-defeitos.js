'use strict';
/* Consolida os defeitos num ÚNICO banco ("defeitos_base": um documento por defeito, só da CGB).
   Junta: (1) histórico do site (defeitos_hist: defeitos, intervalos em tratativa e "fora"), (2) fotos diárias (defeitos),
   (3) base do Power BI (DEFEITOS.002.xlsm, aba BASE_DE_DADOS) e (4) relatório do SISCO (FiscalizaçãoDefeitos.xlsx).
   Regras do Power BI: "em aberto" = Contestação Parceira ou Tratamento de Defeitos (SITUAÇÃO = TRATATIVA, sem data fim);
   qualquer outro status é PÓS-TRATATIVA e não aparece como pendente. CGB = PARCEIRO CGB ou CGB ENERGIA LTDA e
   IDSTATUSFISCAL diferente de "Devolvido de Campo". Não apaga nada: as estruturas antigas continuam até a validação.

   Ver o que seria feito no servidor de teste:   node scripts/consolidar-defeitos.js
   Gravar no servidor de teste:                  node scripts/consolidar-defeitos.js --aplicar
   Mesmo no Neon (real):                         node scripts/consolidar-defeitos.js --neon [--aplicar]
   Arquivos: --pbi="caminho\DEFEITOS.002.xlsm"  --sisco="caminho\FiscalizaçãoDefeitos.xlsx" (padrão: pasta POWER BI do setor). */
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const XLSX = require('xlsx');
const RAIZ = path.join(__dirname, '..');
const NEON = process.argv.includes('--neon'), APLICAR = process.argv.includes('--aplicar');
const PORTA = Number(process.env.PORT) || 3070;
const arg = n => { const a = process.argv.find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : null; };
const PASTA_PBI = path.join(RAIZ, '..', '..', '..', 'POWER BI', '12. Tratativa de Defeitos', 'BANCO DE DADOS');
const ARQ_PBI = arg('pbi') || path.join(PASTA_PBI, 'DEFEITOS.002.xlsm');
const ARQ_SISCO = arg('sisco') || path.join(PASTA_PBI, 'BASE SISCO', 'FiscalizaçãoDefeitos.xlsx');
const DATA_SISCO = arg('data-sisco') || '2026-11-13';
const COLECAO = 'defeitos_base';
const agora = new Date().toISOString();

/* ---------- utilidades ---------- */
const nk = s => String(s == null ? '' : s).trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const dIso = n => new Date(Date.UTC(2024, 0, 1) + n * 864e5).toISOString().slice(0, 10);
const somaDia = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
function iso(v) { /* serial do Excel, Date, "dd/mm/aaaa" ou "aaaa-mm-dd..." -> "aaaa-mm-dd" ou null */
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 20000 ? new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5).toISOString().slice(0, 10) : null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim(); let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : null;
}
const txt = v => v == null ? '' : (typeof v === 'number' && Number.isInteger(v) ? String(v) : String(v).trim());
const CGB = new Set(['CGB', 'CGB ENERGIA LTDA']);
const ehCgb = (parceiro, statusFiscal) => CGB.has(nk(parceiro)) && nk(statusFiscal) !== 'DEVOLVIDO DE CAMPO';

/* classificação pelas regras do Power BI */
const ABERTO = new Set(['CONTESTACAO PARCEIRA', 'TRATAMENTO DE DEFEITOS']);
const VALIDACAO = new Set(['FISCALIZADORA', 'JUIZADO', 'CORRIGIR', 'JUSTIFICAR', 'VALIDACAO DE CORRECAO', 'EM JULGAMENTO']);
const RESOLVIDO = new Set(['CAPITALIZADO', 'CAPITALIZACAO', 'FINALIZADO', 'DEFEITO INVALIDO/CANCELADO/REJEITADO']);
function classifica(status) {
  const s = nk(status);
  if (ABERTO.has(s) || s === 'TRATAMENTO DE DEFEITO') return s === 'TRATAMENTO DE DEFEITO' ? ['EM ABERTO', 'TRATAMENTO DE DEFEITO (grafia antiga)'] : ['EM ABERTO', ''];
  if (VALIDACAO.has(s)) return ['EM VALIDAÇÃO', ''];
  if (RESOLVIDO.has(s)) return ['RESOLVIDO', s === 'DEFEITO INVALIDO/CANCELADO/REJEITADO' ? 'INVÁLIDO/CANCELADO/REJEITADO' : 'CAPITALIZADO'];
  return [s ? 'PENDENTE DE CLASSIFICAÇÃO' : 'PÓS-TRATATIVA (STATUS FINAL NÃO INFORMADO)', ''];
}

/* ---------- origem dos dados já no Neon ---------- */
function req(metodo, caminho, corpo, cookie) {
  return new Promise((ok, no) => {
    const d = corpo ? JSON.stringify(corpo) : null;
    const r = http.request({ host: '127.0.0.1', port: PORTA, path: caminho, method: metodo, headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}, d ? { 'Content-Length': Buffer.byteLength(d) } : {}) }, res => {
      let t = ''; res.on('data', c => t += c); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch (e) { /* */ } ok({ s: res.statusCode, j, c: (res.headers['set-cookie'] || []).map(x => x.split(';')[0]).join('; ') }); });
    });
    r.on('error', no); if (d) r.write(d); r.end();
  });
}
let listar, grava;
async function abrir() {
  if (NEON) {
    fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/).forEach(l => { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); });
    const sql = require('@neondatabase/serverless').neon(process.env.DATABASE_URL);
    listar = async c => (await sql.query('select id, dados from documentos where colecao = $1 order by id', [c])).map(r => ({ id: r.id, dados: r.dados }));
    grava = async (c, id, dados) => sql.query('insert into documentos (colecao, id, dados, atualizado) values ($1,$2,$3::jsonb, clock_timestamp()) on conflict (colecao, id) do update set dados = excluded.dados, atualizado = clock_timestamp()', [c, id, JSON.stringify(dados)]);
  } else {
    const lg = await req('POST', '/api/login', { usuario: 'admin.teste', senha: 'teste12345' });
    if (lg.s !== 200) throw new Error('Não consegui entrar no servidor de teste (http://localhost:' + PORTA + ').');
    listar = async c => { const out = []; let a = null, i = null; for (let k = 0; k < 500; k++) { const r = await req('GET', '/api/doc?c=' + c + (a ? '&a=' + encodeURIComponent(a) + '&i=' + encodeURIComponent(i) : ''), null, lg.c); if (!r.j || !r.j.docs) break; for (const d of r.j.docs) out.push({ id: d.id, dados: d.dados }); if (!r.j.proximo || !r.j.docs.length) break; const u = r.j.docs[r.j.docs.length - 1]; a = u.atualizado; i = u.id; } return out; };
    grava = async (c, id, dados) => { const r = await req('POST', '/api/doc?c=' + c, { id, dados }, lg.c); if (r.s !== 200) throw new Error('Falha ao gravar ' + c + '/' + id + ' (' + r.s + ')'); };
  }
}
function lerPlanilha(arq, aba, linhaCab) {
  const tmp = path.join(os.tmpdir(), 'def_' + Date.now() + path.extname(arq)); fs.copyFileSync(arq, tmp); /* cópia: o Excel pode estar com o arquivo aberto */
  try {
    const wb = XLSX.readFile(tmp, { sheets: aba ? [aba] : undefined, cellDates: false });
    const ws = wb.Sheets[aba || wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const hi = linhaCab != null ? linhaCab : rows.findIndex(r => r && r.some(x => String(x || '').trim() === 'DEFEITO_ID'));
    const H = rows[hi].map(x => String(x == null ? '' : x).trim());
    return { H, rows: rows.slice(hi + 1).filter(r => r && r.some(x => x != null && x !== '')) };
  } finally { try { fs.unlinkSync(tmp); } catch (e) { /* */ } }
}
const objLinha = (H, r) => { const o = {}; H.forEach((h, i) => { if (h && r[i] != null && r[i] !== '') o[h] = (typeof r[i] === 'number' && /^DATA|^ANALISE_DATA/.test(h)) ? (iso(r[i]) || r[i]) : r[i]; }); return o; };

(async () => {
  console.log((APLICAR ? 'GRAVANDO' : 'SIMULANDO (nada será gravado)') + ' em ' + (NEON ? 'NEON (banco real)' : 'servidor de teste'));
  await abrir();

  /* 1) histórico do site */
  const ph = {}; for (const d of await listar('defeitos_hist')) ph[d.id] = JSON.parse(d.dados.j);
  const meta = ph.meta, A = [], IV = [], NV = [];
  for (const id of Object.keys(ph).sort()) { if (id.startsWith('a_')) A.push(...ph[id]); else if (id.startsWith('iv_')) IV.push(...ph[id]); else if (id.startsWith('nv_')) NV.push(...ph[id]); }
  const S = meta.s;
  const versaoDe = a => [String(a[0]), S[a[1]], a[2], a[3], S[a[4]], S[a[5]], S[a[6]], S[a[7]], S[a[8]], S[a[9]], S[a[10]], a[11] == null ? null : dIso(a[11]), a[12] == null ? null : dIso(a[12]), S[a[13]]];
  const D = {}; /* id -> documento em construção */
  const doc = id => D[id] || (D[id] = { id, versoes: [], vkey: {}, t: [], fora: [], timeline: [], origem: new Set(), pbi: null, sisco: null });
  const ver = (d, item) => { const k = JSON.stringify(item); if (d.vkey[k] == null) { d.vkey[k] = d.versoes.length; d.versoes.push(item); } return d.vkey[k]; };
  for (const x of IV) {
    const a = A[x[0]], d = doc(String(a[0])); d.origem.add('HISTORICO_SITE');
    d.t.push([dIso(x[1]), x[2] < 0 ? null : dIso(x[2]), x[3], x[4], ver(d, versaoDe(a))]);
  }
  for (const x of NV) { const d = doc(String(x[0])); d.origem.add('HISTORICO_SITE'); d.fora.push([dIso(x[1]), x[2] < 0 ? null : dIso(x[2])]); }
  const ultHist = meta.ult; /* último dia coberto pelo histórico */

  /* 2) fotos diárias -> intervalos (a foto vale até o dia anterior à próxima foto; igual ao carregamento atual do site) */
  const fotos = (await listar('defeitos')).filter(f => Array.isArray(f.dados.itens)).map(f => ({ dia: f.id, itens: f.dados.itens.map(x => typeof x === 'string' ? JSON.parse(x) : x), fora: (f.dados.fora || []).map(String), linhas: f.dados.linhas })).sort((a, b) => a.dia < b.dia ? -1 : 1);
  const dia1 = fotos.length ? fotos[0].dia : null, ultFoto = fotos.length ? fotos[fotos.length - 1] : null;
  const fimAntes = dia1 ? somaDia(dia1, -1) : null;
  if (fotos.length) {
    /* fecha, na véspera da 1ª foto, os períodos que o histórico deixou abertos (o site passa a olhar só as fotos) */
    for (const d of Object.values(D)) { for (const p of d.t) if (p[1] == null) p.push('abertoHist'); for (const p of d.fora) if (p[1] == null) p.push('abertoHist'); }
    const presenca = {}, presFora = {};
    fotos.forEach((f, i) => {
      const cont = {}; for (const it of f.itens) { const id = String(it[0]); (cont[id] = cont[id] || []).push(it); }
      for (const id in cont) { const itens = cont[id]; const it = itens[0], dd = doc(id), vi = ver(dd, it.slice(0, 14).concat([it[14], it[15] || ''])); (presenca[id] = presenca[id] || []).push({ i, m: itens.length, v: it[14], it, vi }); }
      for (const id of new Set(f.fora)) (presFora[id] = presFora[id] || []).push(i);
    });
    const fechaOuMescla = (arr, i0) => arr; /* marcador de intenção (ver abaixo) */
    for (const id in presenca) {
      const d = doc(id); d.origem.add('FOTO_DIARIA'); const run = presenca[id];
      let k = 0;
      while (k < run.length) {
        let j = k; while (j + 1 < run.length && run[j + 1].i === run[j].i + 1 && run[j + 1].v === run[k].v && run[j + 1].m === run[k].m && run[j + 1].vi === run[k].vi) j++;
        const ini = fotos[run[k].i].dia, ultimo = run[j].i, fim = ultimo === fotos.length - 1 ? null : somaDia(fotos[ultimo + 1].dia, -1);
        d.t.push([ini, fim, run[k].v, run[k].m, run[k].vi, 'foto']); k = j + 1;
      }
    }
    for (const id in presFora) {
      const d = doc(id); d.origem.add('FOTO_DIARIA'); const run = presFora[id]; let k = 0;
      while (k < run.length) { let j = k; while (j + 1 < run.length && run[j + 1] === run[j] + 1) j++; d.fora.push([fotos[run[k]].dia, run[j] === fotos.length - 1 ? null : somaDia(fotos[run[j] + 1].dia, -1), 'foto']); k = j + 1; }
    }
    /* períodos "abertos" vindos do histórico: se o defeito continua na 1ª foto com os mesmos valores, o período segue (une); senão termina na véspera */
    for (const d of Object.values(D)) {
      const abHist = d.t.filter(p => p[5] === 'abertoHist'), fotosT = d.t.filter(p => p[5] === 'foto' && p[0] === dia1);
      for (const p of abHist) {
        const igual = fotosT.find(q => q[2] === p[2] && q[3] === p[3] && JSON.stringify(d.versoes[q[4]].slice(0, 14)) === JSON.stringify(d.versoes[p[4]].slice(0, 14)));
        if (igual && igual !== p) { p[1] = igual[1]; p[5] = 'hist+foto'; d.t.splice(d.t.indexOf(igual), 1); } else { p[1] = fimAntes; p[5] = 'hist'; }
      }
      const abF = d.fora.filter(p => p[2] === 'abertoHist'), fotosF = d.fora.filter(p => p[2] === 'foto' && p[0] === dia1);
      for (const p of abF) { const q = fotosF[0]; if (q) { p[1] = q[1]; p[2] = 'hist+foto'; d.fora.splice(d.fora.indexOf(q), 1); } else { p[1] = fimAntes; p[2] = 'hist'; } }
    }
  }

  /* 3) base do Power BI */
  const pbi = lerPlanilha(ARQ_PBI, 'BASE_DE_DADOS', 1);
  const ixp = {}; pbi.H.forEach((h, i) => { if (h) ixp[h] = i; });
  const colSit = pbi.H.find(h => nk(h).startsWith('SITUA') && !nk(h).includes('CORRECAO'));
  let pbiIds = new Set(), pbiNovos = 0, pbiForaCgb = 0;
  const ultPbi = {};
  for (const r of pbi.rows) {
    const id = txt(r[ixp.DEFEITO_ID]); if (!id) continue; pbiIds.add(id);
    const dIni = iso(r[ixp.DATA_INI]);
    if (!ultPbi[id] || (dIni && (!ultPbi[id].ini || dIni >= ultPbi[id].ini))) ultPbi[id] = { ini: dIni, r };
  }
  const idsHist = new Set(Object.keys(D));
  const pbiPorId = {}; for (const r of pbi.rows) { const id = txt(r[ixp.DEFEITO_ID]); if (id) (pbiPorId[id] = pbiPorId[id] || []).push(r); }
  for (const id of pbiIds) {
    const linhas = pbiPorId[id], u = ultPbi[id].r;
    const cgb = ehCgb(u[ixp.PARCEIRA], u[ixp.IDSTATUSFISCAL]);
    if (!idsHist.has(id)) { if (!cgb) { pbiForaCgb++; continue; } pbiNovos++; }
    const d = doc(id); d.origem.add('PBI_DEFEITOS_002');
    d.pbi = objLinha(pbi.H, u);
    for (const r of linhas) d.timeline.push({ ini: iso(r[ixp.DATA_INI]), fim: iso(r[ixp.DATA_FIM]), status: txt(r[ixp.STATUS_DEFEITO]), situacao: txt(r[ixp[colSit]]), fonte: 'PBI' });
  }

  /* 4) relatório do SISCO (só CGB) */
  let siscoCgb = 0, siscoOutras = 0, siscoDevolvido = 0;
  if (fs.existsSync(ARQ_SISCO)) {
    const sc = lerPlanilha(ARQ_SISCO, 'Relatório de Defeitos', null), ixs = {}; sc.H.forEach((h, i) => { if (h) ixs[h] = i; });
    for (const r of sc.rows) {
      const id = txt(r[ixs.DEFEITO_ID]); if (!id) continue;
      if (!CGB.has(nk(r[ixs.PARCEIRO]))) { siscoOutras++; continue; }
      if (nk(r[ixs.IDSTATUSFISCAL]) === 'DEVOLVIDO DE CAMPO') { siscoDevolvido++; continue; }
      siscoCgb++; const d = doc(id); d.origem.add('SISCO_' + DATA_SISCO);
      d.sisco = objLinha(sc.H, r); d.siscoData = DATA_SISCO;
    }
  } else console.log('Aviso: relatório do SISCO não encontrado em ' + ARQ_SISCO);

  /* 5) situação atual (Power BI): foto mais recente > SISCO > Power BI > histórico */
  const noItensUlt = {}; if (ultFoto) { for (const it of ultFoto.itens) noItensUlt[String(it[0])] = it; }
  const noForaUlt = new Set(ultFoto ? ultFoto.fora : []);
  const R = {};
  const conta = k => { R[k] = (R[k] || 0) + 1; };
  const docs = [];
  for (const d of Object.values(D)) {
    /* quem não é CGB não entra (defeitos só do histórico já são CGB por construção) */
    const base = d.sisco || d.pbi;
    if (base && !d.versoes.length && !ehCgb(base.PARCEIRO || base.PARCEIRA, base.IDSTATUSFISCAL)) continue;
    let status = '', fonteSit = '';
    if (noItensUlt[d.id]) { status = noItensUlt[d.id][13]; fonteSit = 'foto ' + ultFoto.dia; }
    else if (d.sisco && !noForaUlt.size) { status = d.sisco.STATUS_DEFEITO; fonteSit = 'SISCO ' + d.siscoData; }
    else if (d.sisco) { status = d.sisco.STATUS_DEFEITO; fonteSit = 'SISCO ' + d.siscoData; }
    else if (d.pbi) { status = d.pbi.STATUS_DEFEITO; fonteSit = 'Power BI'; }
    /* se hoje está na foto, é aberto; se o histórico mostra período em aberto sem estar na foto, ver abaixo */
    let [sit, motivo] = classifica(status);
    const temAberto = d.t.some(p => p[1] == null);
    if (noItensUlt[d.id]) { sit = 'EM ABERTO'; motivo = ''; }
    else if (temAberto && !fotos.length) { sit = 'EM ABERTO'; }
    else if (sit === 'EM ABERTO' && !noItensUlt[d.id] && fotos.length) { /* status aberto na fonte, mas não está na foto mais recente: a foto manda (o defeito saiu da tratativa depois) */ sit = 'PÓS-TRATATIVA (STATUS FINAL NÃO INFORMADO)'; motivo = 'saiu da tratativa depois de ' + (d.sisco ? d.siscoData : d.pbi ? 'Power BI' : 'histórico'); }
    const fins = d.t.filter(p => p[1]).map(p => p[1]).sort(), inis = d.t.map(p => p[0]).concat(d.timeline.map(l => l.ini).filter(Boolean)).sort();
    d.status_atual = txt(status) || null; d.situacao = sit; d.motivo = motivo; d.fonte_situacao = fonteSit || 'histórico do site';
    d.data_aparicao = inis[0] || null;
    d.data_saida_tratativa = (sit !== 'EM ABERTO' && fins.length) ? fins[fins.length - 1] : null;
    d.data_resolucao = (sit === 'RESOLVIDO' ? ((d.pbi && d.pbi.DATA_RESOLVIDO) || (d.sisco && d.sisco.DATA_LIBERACAO) || null) : null);
    d.confirmado = !!(d.sisco || d.pbi || noItensUlt[d.id]);
    conta(sit);
    docs.push(d);
  }

  /* 6) gravação */
  const saida = d => {
    const o = { id: d.id, cgb: true, situacao: d.situacao, motivo: d.motivo || '', status_atual: d.status_atual, fonte_situacao: d.fonte_situacao, confirmado: d.confirmado,
      data_aparicao: d.data_aparicao, data_saida_tratativa: d.data_saida_tratativa, data_resolucao: d.data_resolucao,
      origem_registro: [...d.origem].join(','), versoes: d.versoes, t: d.t.map(p => p.slice(0, 5)), fora: d.fora.map(p => p.slice(0, 2)),
      timeline: d.timeline.sort((a, b) => (a.ini || '') < (b.ini || '') ? -1 : 1), atualizado: agora };
    if (d.pbi) o.pbi = d.pbi; if (d.sisco) { o.sisco = d.sisco; o.sisco_data = d.siscoData; }
    return o;
  };
  console.log('\nDefeitos da CGB consolidados: ' + docs.length);
  for (const k of Object.keys(R).sort()) console.log('  ' + k.padEnd(48) + R[k]);
  console.log('Fontes: histórico do site ' + idsHist.size + ' IDs · Power BI ' + pbiIds.size + ' IDs (' + pbiNovos + ' novos só no Power BI, ' + pbiForaCgb + ' fora da CGB descartados) · SISCO ' + DATA_SISCO + ': ' + siscoCgb + ' CGB (' + siscoOutras + ' de outras empresas e ' + siscoDevolvido + ' devolvidos ignorados) · fotos ' + fotos.length);
  const tam = docs.reduce((s, d) => s + JSON.stringify(saida(d)).length, 0);
  console.log('Tamanho estimado: ' + (tam / 1048576).toFixed(1) + ' MB em ' + docs.length + ' documentos');
  if (!APLICAR) { console.log('\nNada foi gravado. Rode com --aplicar para gravar em ' + (NEON ? 'NEON' : 'teste') + '.'); return; }
  let n = 0; for (const d of docs) { await grava(COLECAO, 'D' + d.id, saida(d)); if (++n % 500 === 0) console.log('  ' + n + '/' + docs.length); }
  await grava(COLECAO, 'META', { ult: ultFoto ? ultFoto.dia : meta.ult, total: docs.length, consolidado_em: agora });
  console.log('Pronto: ' + n + ' defeitos gravados em ' + COLECAO + '.');
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
