'use strict';
/* Migra o histórico que estava em arquivos JSON (privado/historico_*.json, ups_semclasse.json) para documentos do Neon,
   SEM perder nada: cada dia vira um documento na mesma coleção dos dias enviados pelo site (ups, ader, prod, mix) e os históricos que
   têm outra forma (início das atividades, TME/TMD, defeitos, trafos) ganham coleções próprias (inicio_hist, tm_hist, defeitos_hist, trafo_hist).
   Dia que já tem documento no destino NÃO é tocado (o enviado pelo site vale mais que o histórico).

   Ver o que seria feito (não grava nada), no servidor de teste:   node scripts/migrar-historico-neon.js
   Gravar no servidor de teste (http://localhost:3070):             node scripts/migrar-historico-neon.js --aplicar
   Ver o que seria feito no Neon (banco real):                      node scripts/migrar-historico-neon.js --neon
   Gravar no Neon (banco real):                                     node scripts/migrar-historico-neon.js --neon --aplicar
   Pode rodar mais de uma vez: só grava o que ainda não existe (as coleções *_hist são regravadas por inteiro). */
const fs = require('fs'), path = require('path'), http = require('http');
const RAIZ = path.join(__dirname, '..'), PRIV = path.join(RAIZ, 'privado');
const NEON = process.argv.includes('--neon'), APLICAR = process.argv.includes('--aplicar');
const PORTA = Number(process.env.PORT) || 3070;
const agora = new Date().toISOString();
const ler = nome => JSON.parse(fs.readFileSync(path.join(PRIV, nome), 'utf8'));
const ROTULO = 'Histórico (migrado do JSON)';

/* ---------- destino ---------- */
let existe, grava, fecha = async () => {};
function req(metodo, caminho, corpo, cookie) {
  return new Promise((ok, no) => {
    const d = corpo ? JSON.stringify(corpo) : null;
    const r = http.request({ host: '127.0.0.1', port: PORTA, path: caminho, method: metodo, headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}, d ? { 'Content-Length': Buffer.byteLength(d) } : {}) }, res => {
      let t = ''; res.on('data', c => t += c); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch (e) { /* */ } ok({ s: res.statusCode, j, c: (res.headers['set-cookie'] || []).map(x => x.split(';')[0]).join('; ') }); });
    });
    r.on('error', no); if (d) r.write(d); r.end();
  });
}
async function abrirDestino() {
  if (NEON) {
    fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/).forEach(l => { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); });
    const sql = require('@neondatabase/serverless').neon(process.env.DATABASE_URL);
    const ids = {};
    for (const c of ['ups', 'ader', 'prod', 'mix']) ids[c] = new Set((await sql.query('select id from documentos where colecao = $1', [c])).map(r => r.id));
    existe = async (c, id) => ids[c] ? ids[c].has(id) : false;
    grava = async (c, id, dados, soSeNovo) => sql.query(soSeNovo
      ? 'insert into documentos (colecao, id, dados, atualizado) values ($1,$2,$3::jsonb, clock_timestamp()) on conflict (colecao, id) do nothing'
      : 'insert into documentos (colecao, id, dados, atualizado) values ($1,$2,$3::jsonb, clock_timestamp()) on conflict (colecao, id) do update set dados = excluded.dados, atualizado = clock_timestamp()', [c, id, JSON.stringify(dados)]);
  } else {
    const lg = await req('POST', '/api/login', { usuario: 'admin.teste', senha: 'teste12345' });
    if (lg.s !== 200) throw new Error('Não consegui entrar no servidor de teste (http://localhost:' + PORTA + '). Ele está ligado?');
    existe = async (c, id) => { const r = await req('GET', '/api/doc?c=' + c + '&id=' + encodeURIComponent(id), null, lg.c); return !!(r.j && r.j.existe); };
    grava = async (c, id, dados) => { const r = await req('POST', '/api/doc?c=' + c, { id, dados }, lg.c); if (r.s !== 200) throw new Error('Falha ao gravar ' + c + '/' + id + ' (' + r.s + ')'); };
  }
}

const plano = {}; /* coleção -> {novos, jaExistiam} */
const conta = (c, k) => { (plano[c] = plano[c] || { novos: 0, jaExistiam: 0 })[k]++; };
async function dia(colecao, id, dados) { /* só grava se ainda não existe */
  if (await existe(colecao, id)) { conta(colecao, 'jaExistiam'); return; }
  conta(colecao, 'novos'); if (APLICAR) await grava(colecao, id, dados, true);
}
async function sempre(colecao, id, dados) { conta(colecao, 'novos'); if (APLICAR) await grava(colecao, id, dados, false); }
const pedacos = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

(async () => {
  console.log((APLICAR ? 'GRAVANDO' : 'SIMULANDO (nada será gravado)') + ' em ' + (NEON ? 'NEON (banco real)' : 'servidor de teste'));
  await abrirDestino();

  /* UPS: dia -> ups/{data} */
  const hu = ler('historico_ups.json');
  for (const d of Object.keys(hu.dias).sort()) await dia('ups', d, { data: d, fonte: 'COI', arquivo: ROTULO, eq: hu.dias[d], sc: [], enviadoEm: agora });
  /* Aderência: dia -> ader/{data} */
  const ha = ler('historico_ader.json');
  for (const d of Object.keys(ha.dias).sort()) await dia('ader', d, { data: d, arquivo: ROTULO, eq: ha.dias[d], enviadoEm: agora });
  /* Produção: dia -> prod/{data} */
  const hp = ler('historico_prod.json');
  for (const d of Object.keys(hp.dias).sort()) await dia('prod', d, { data: d, arquivo: ROTULO, eq: JSON.stringify(hp.dias[d]), ultFim: '', enviadoEm: agora });
  /* Mix: os índices viram nomes de equipe (mesma forma dos dias enviados pelo site) */
  const hm = ler('historico_mix.json');
  const nomes = x => { const r = {}; for (const i in x || {}) r[hm.recs[+i]] = x[i]; return r; };
  for (const d of Object.keys(hm.dias).sort()) { const o = hm.dias[d]; await dia('mix', d, { data: d, arquivo: ROTULO, j: JSON.stringify({ n: nomes(o.n), m: nomes(o.m), c: nomes(o.c), b: nomes(o.b) }), enviadoEm: agora }); }

  /* Início das atividades: resultado já calculado de cada dia */
  const hi = ler('historico_inicio.json');
  await sempre('inicio_hist', 'meta', { fonte: hi.fonte, dias: Object.keys(hi.dias).length, atualizado: agora });
  for (const d of Object.keys(hi.dias).sort()) await sempre('inicio_hist', d, { data: d, j: JSON.stringify(hi.dias[d]) });

  /* TME/TMD: tabelas de apoio + um documento por mês */
  const ht = ler('historico_tm.json');
  await sempre('tm_hist', 'meta', { j: JSON.stringify({ recs: ht.recs, bases: ht.bases, acts: ht.acts, subs: ht.subs, nd: ht.nd, ult: ht.ult, fonte: ht.fonte }), atualizado: agora });
  for (const m of Object.keys(ht.m).sort()) await sempre('tm_hist', 'm_' + m, { mes: m, j: JSON.stringify(ht.m[m]) });

  /* Defeitos: dicionário de textos, defeitos, intervalos em tratativa e entradas */
  const hd = ler('historico_defeitos.json');
  await sempre('defeitos_hist', 'meta', { j: JSON.stringify({ d0: hd.d0, ult: hd.ult, s: hd.s }), atualizado: agora });
  for (const [nome, arr, n] of [['a', hd.a, 800], ['iv', hd.iv, 2000], ['nv', hd.nv || [], 2000]])
    for (const [i, p] of pedacos(arr, n).entries()) await sempre('defeitos_hist', nome + '_' + String(i).padStart(3, '0'), { n: p.length, j: JSON.stringify(p) });

  /* Trafos reincidentes */
  const hf = ler('historico_trafo.json');
  await sempre('trafo_hist', 'meta', { j: JSON.stringify({ arquivo: hf.arquivo, ult: hf.ult }), atualizado: agora });
  for (const [nome, arr, n] of [['notas', hf.notas, 400], ['acoes', hf.acoes, 40]])
    for (const [i, p] of pedacos(arr, n).entries()) await sempre('trafo_hist', nome + '_' + String(i).padStart(3, '0'), { n: p.length, j: JSON.stringify(p) });

  /* Serviços sem classificação da UPS (Estudo UPS até 17/10) */
  await sempre('config', 'upsSemClasse', { j: JSON.stringify(ler('ups_semclasse.json')), editadoEm: agora });

  console.log('\nResultado por coleção:');
  for (const c of Object.keys(plano)) console.log('  ' + c.padEnd(14) + ' novos: ' + String(plano[c].novos).padStart(5) + (plano[c].jaExistiam ? '   já existiam (não tocados): ' + plano[c].jaExistiam : ''));
  console.log(APLICAR ? '\nPronto.' : '\nNada foi gravado. Rode de novo com --aplicar para gravar.');
  await fecha();
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
