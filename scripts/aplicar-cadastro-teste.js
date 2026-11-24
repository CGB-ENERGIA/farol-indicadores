'use strict';
/* Leva para o banco REAL (Neon) os ajustes de cadastro feitos no servidor de teste persistente.
   Só entram as chaves que mudaram em relação à cópia original (equipes, feriados, estruturas…); o resto do banco real,
   inclusive o que outras pessoas tenham cadastrado depois da cópia, fica como está.

   Ver o que seria feito (não grava nada):   node scripts/aplicar-cadastro-teste.js
   Gravar de verdade:                        node scripts/aplicar-cadastro-teste.js --aplicar
   Antes de gravar, guarda uma cópia dos documentos que serão alterados em %LOCALAPPDATA%\FarolTeste\backups.
   O servidor de teste precisa estar ligado (http://localhost:3070). */
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const RAIZ = path.join(__dirname, '..');
const DIR = process.env.FAROL_TESTE_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), 'FarolTeste');
const PORTA = Number(process.env.PORT) || 3070;
const APLICAR = process.argv.includes('--aplicar');
const IDS = ['prefixos', 'feriados', 'feriadosMun', 'folgas', 'estruturas', 'listas', 'aderRegras', 'metas', 'naoCgb'];
const COM_NULO = new Set(['prefixos', 'feriados', 'folgas', 'estruturas', 'naoCgb']); /* nesses, "null" marca item removido */

fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/).forEach(l => { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); });

function req(metodo, caminho, corpo, cookie) {
  return new Promise((ok, no) => {
    const dados = corpo ? JSON.stringify(corpo) : null;
    const r = http.request({ host: '127.0.0.1', port: PORTA, path: caminho, method: metodo, headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}, dados ? { 'Content-Length': Buffer.byteLength(dados) } : {}) }, res => {
      let t = ''; res.on('data', c => t += c); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch (e) { /* */ } ok({ status: res.statusCode, json: j, cookie: (res.headers['set-cookie'] || []).map(x => x.split(';')[0]).join('; ') }); });
    });
    r.on('error', no); if (dados) r.write(dados); r.end();
  });
}
const igual = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);

(async () => {
  let base;
  try { base = JSON.parse(fs.readFileSync(path.join(DIR, 'baseline.json'), 'utf8')).itens; } catch (e) { console.error('Não achei o ponto de partida em ' + DIR + '. Rode antes o servidor de teste com --copiar.'); process.exit(1); }
  const lg = await req('POST', '/api/login', { usuario: 'admin.teste', senha: 'teste12345' }).catch(() => null);
  if (!lg || lg.status !== 200) { console.error('Não consegui entrar no servidor de teste em http://localhost:' + PORTA + '. Ele está ligado?'); process.exit(1); }
  const neon = require('@neondatabase/serverless').neon(process.env.DATABASE_URL);
  const plano = [], backup = {};
  for (const id of IDS) {
    const r = await req('GET', '/api/doc?c=config&id=' + id, null, lg.cookie);
    const T = (r.json && r.json.existe && r.json.dados && r.json.dados.itens) || {}, B = base[id] || {};
    const mudou = [...new Set([...Object.keys(T), ...Object.keys(B)])].filter(k => !igual(T[k], B[k]));
    if (!mudou.length) continue;
    const atual = await neon.query("select dados from documentos where colecao = 'config' and id = $1", [id]);
    const dadosAtual = (atual[0] && atual[0].dados) || {}, M = Object.assign({}, dadosAtual.itens || {});
    for (const k of mudou) { if (T[k] === undefined) { if (COM_NULO.has(id)) M[k] = null; else delete M[k]; } else M[k] = T[k]; }
    backup[id] = dadosAtual;
    plano.push({ id, chaves: mudou, novo: Object.assign({}, dadosAtual, { itens: M, editadoEm: new Date().toISOString() }) });
  }
  if (!plano.length) { console.log('Nada a aplicar: o teste está igual à cópia original.'); return; }
  console.log(APLICAR ? 'APLICANDO no banco real:' : 'Simulação (nada será gravado). Seriam alterados:');
  for (const p of plano) console.log('  · ' + p.id + ': ' + p.chaves.length + ' item(ns)  ' + p.chaves.slice(0, 12).join(', ') + (p.chaves.length > 12 ? ' …' : ''));
  if (!APLICAR) { console.log('\nPara gravar: node scripts/aplicar-cadastro-teste.js --aplicar'); return; }
  fs.mkdirSync(path.join(DIR, 'backups'), { recursive: true });
  const arq = path.join(DIR, 'backups', 'antes-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(arq, JSON.stringify(backup));
  for (const p of plano) await neon.query("insert into documentos (colecao,id,dados,atualizado) values ('config',$1,$2::jsonb,clock_timestamp()) on conflict (colecao,id) do update set dados = excluded.dados, atualizado = clock_timestamp()", [p.id, JSON.stringify(p.novo)]);
  console.log('\nGravado. Cópia do que havia antes: ' + arq);
})().catch(e => { console.error(e); process.exit(1); });
