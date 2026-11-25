'use strict';
/* Compara, dia a dia, o que as estruturas antigas (defeitos_hist + defeitos) mostram como "em tratativa" e "fora"
   com o que o banco novo (defeitos_base) mostra. Só lê. Uso:  node scripts/validar-defeitos.js [--neon] */
const fs = require('fs'), path = require('path'), http = require('http');
const RAIZ = path.join(__dirname, '..'), NEON = process.argv.includes('--neon'), PORTA = Number(process.env.PORT) || 3070;
function req(m, p, b, c) { return new Promise((ok, no) => { const d = b ? JSON.stringify(b) : null; const r = http.request({ host: '127.0.0.1', port: PORTA, path: p, method: m, headers: Object.assign({ 'Content-Type': 'application/json' }, c ? { Cookie: c } : {}, d ? { 'Content-Length': Buffer.byteLength(d) } : {}) }, res => { let t = ''; res.on('data', x => t += x); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch (e) { /* */ } ok({ s: res.statusCode, j, c: (res.headers['set-cookie'] || []).map(x => x.split(';')[0]).join('; ') }); }); }); r.on('error', no); if (d) r.write(d); r.end(); }); }
let listar;
async function abrir() {
  if (NEON) {
    fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/).forEach(l => { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); });
    const sql = require('@neondatabase/serverless').neon(process.env.DATABASE_URL);
    listar = async c => (await sql.query('select id, dados from documentos where colecao = $1 order by id', [c])).map(r => ({ id: r.id, dados: r.dados }));
  } else {
    const lg = await req('POST', '/api/login', { usuario: 'admin.teste', senha: 'teste12345' });
    listar = async c => { const out = []; let a = null, i = null; for (let k = 0; k < 500; k++) { const r = await req('GET', '/api/doc?c=' + c + (a ? '&a=' + encodeURIComponent(a) + '&i=' + encodeURIComponent(i) : ''), null, lg.c); if (!r.j || !r.j.docs) break; for (const d of r.j.docs) out.push({ id: d.id, dados: d.dados }); if (!r.j.proximo || !r.j.docs.length) break; const u = r.j.docs[r.j.docs.length - 1]; a = u.atualizado; i = u.id; } return out; };
  }
}
const dIso = n => new Date(Date.UTC(2024, 0, 1) + n * 864e5).toISOString().slice(0, 10);
const dNum = s => Math.round((Date.parse(s + 'T00:00:00Z') - Date.UTC(2024, 0, 1)) / 864e5);
const chave = (id, m, v, it) => [id, m, v ? 1 : 0, it[3], it[4], it[8], it[1], it[13]].join('|'); /* id, mult., válido, prioridade, tipo, distrital, pep, status */
(async () => {
  await abrir();
  const ph = {}; for (const d of await listar('defeitos_hist')) ph[d.id] = JSON.parse(d.dados.j);
  const meta = ph.meta, A = [], IV = [], NV = [];
  for (const id of Object.keys(ph).sort()) { if (id.startsWith('a_')) A.push(...ph[id]); else if (id.startsWith('iv_')) IV.push(...ph[id]); else if (id.startsWith('nv_')) NV.push(...ph[id]); }
  const S = meta.s, fotos = (await listar('defeitos')).filter(f => Array.isArray(f.dados.itens)).map(f => ({ dia: f.id, itens: f.dados.itens.map(x => typeof x === 'string' ? JSON.parse(x) : x), fora: f.dados.fora || [] })).sort((a, b) => a.dia < b.dia ? -1 : 1);
  const itemHist = a => [String(a[0]), S[a[1]], a[2], a[3], S[a[4]], S[a[5]], S[a[6]], S[a[7]], S[a[8]], S[a[9]], S[a[10]], a[11], a[12], S[a[13]]];
  const novos = (await listar('defeitos_base')).map(d => d.dados).filter(d => Array.isArray(d.t));
  const n1 = fotos.length ? dNum(fotos[0].dia) : Infinity;
  /* antigo */
  const antigoAtivos = D => { if (D >= n1) { let s = null; for (const f of fotos) if (dNum(f.dia) <= D) s = f; return s.itens.map(x => chave(String(x[0]), 1, x[14], x)); } return IV.filter(x => x[1] <= D && (x[2] < 0 || x[2] >= D)).map(x => chave(String(A[x[0]][0]), x[4], x[3], itemHist(A[x[0]]))); };
  const antigoFora = D => { const m = {}; if (D >= n1) { let s = null; for (const f of fotos) if (dNum(f.dia) <= D) s = f; for (const id of s.fora) m[id] = 1; } else for (const x of NV) if (x[1] <= D && (x[2] < 0 || x[2] >= D)) m[x[0]] = (m[x[0]] || 0) + 1; return m; };
  /* novo */
  const per = []; const forap = [];
  for (const d of novos) { for (const p of d.t) per.push({ i: dNum(p[0]), f: p[1] == null ? Infinity : dNum(p[1]), id: d.id, m: p[3], v: p[2], it: d.versoes[p[4]] }); for (const p of d.fora) forap.push({ i: dNum(p[0]), f: p[1] == null ? Infinity : dNum(p[1]), id: d.id }); }
  const novoAtivos = D => per.filter(p => p.i <= D && D <= p.f).map(p => chave(p.id, p.m, p.v, p.it));
  const novoFora = D => { const m = {}; for (const p of forap) if (p.i <= D && D <= p.f) m[p.id] = (m[p.id] || 0) + 1; return m; };
  const ini = dNum('2025-01-03'), fim = dNum((fotos.length ? fotos[fotos.length - 1].dia : meta.ult)) + 3;
  let difAtivos = 0, difFora = 0, diasOk = 0, exemplos = [];
  for (let D = ini; D <= fim; D++) {
    const a = antigoAtivos(D).sort(), b = novoAtivos(D).sort();
    let ok = a.length === b.length && a.every((x, i) => x === b[i]);
    if (!ok) { difAtivos++; if (exemplos.length < 4) { const sa = new Set(a), sb = new Set(b); exemplos.push(dIso(D) + ': antigo ' + a.length + ' x novo ' + b.length + ' · só no antigo: ' + a.filter(x => !sb.has(x)).slice(0, 2).join(' ; ') + ' · só no novo: ' + b.filter(x => !sa.has(x)).slice(0, 2).join(' ; ')); } }
    const fa = antigoFora(D), fb = novoFora(D), ka = Object.keys(fa).sort(), kb = Object.keys(fb).sort();
    if (!(ka.length === kb.length && ka.every((x, i) => x === kb[i] && fa[x] === fb[x]))) { difFora++; if (exemplos.length < 6) exemplos.push(dIso(D) + ' FORA: antigo ' + ka.length + ' x novo ' + kb.length); }
    if (ok) diasOk++;
  }
  console.log('Dias comparados: ' + (fim - ini + 1) + ' (' + dIso(ini) + ' a ' + dIso(fim) + ')');
  console.log('Dias com a lista "em tratativa" IDÊNTICA: ' + diasOk + ' · com diferença: ' + difAtivos);
  console.log('Dias com diferença na lista "fora": ' + difFora);
  exemplos.forEach(e => console.log('  ' + e));
  const por = {}; for (const d of novos) por[d.situacao] = (por[d.situacao] || 0) + 1;
  console.log('Situação no banco novo:', JSON.stringify(por), '· total', novos.length);
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
