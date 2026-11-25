'use strict';
/* Refaz o resumo da disponibilidade (coleção "dias", um documento por dia e fonte) lendo as atividades do Banco SIGA guardadas no Neon.
   Usa a regra atual: almoço e indisponibilidade apontados no SIGA (também no FIS), sem contar em dobro.
   Só mexe em documentos que já existem (e cria os dias que faltam, exceto hoje, que ainda está aberto).

   Ver o que seria feito (servidor de teste):   node scripts/recalcular-dias-neon.js
   Gravar no servidor de teste:                 node scripts/recalcular-dias-neon.js --aplicar
   Ver o que seria feito no Neon (real):        node scripts/recalcular-dias-neon.js --neon
   Gravar no Neon (real):                       node scripts/recalcular-dias-neon.js --neon --aplicar
   Antes de gravar no Neon, guarda uma cópia dos documentos que serão trocados em %LOCALAPPDATA%\FarolTeste\backups. */
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), zlib = require('zlib');
const RAIZ = path.join(__dirname, '..');
const NEON = process.argv.includes('--neon'), APLICAR = process.argv.includes('--aplicar');
const PORTA = Number(process.env.PORT) || 3070;
const Disp = require('../calc.js');
const DIR = process.env.FAROL_TESTE_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), 'FarolTeste');
const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const inicio = Date.now();

function req(metodo, caminho, corpo, cookie) {
  return new Promise((ok, no) => {
    const d = corpo ? JSON.stringify(corpo) : null;
    const r = http.request({ host: '127.0.0.1', port: PORTA, path: caminho, method: metodo, headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}, d ? { 'Content-Length': Buffer.byteLength(d) } : {}) }, res => {
      let t = ''; res.on('data', c => t += c); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch (e) { /* */ } ok({ s: res.statusCode, j, c: (res.headers['set-cookie'] || []).map(x => x.split(';')[0]).join('; ') }); });
    });
    r.on('error', no); if (d) r.write(d); r.end();
  });
}
const desc = d => d.z ? zlib.gunzipSync(Buffer.from(d.z, 'base64')).toString('utf8') : d.j;

let doc, lista, grava; /* doc(colecao,id) -> dados|null ; grava(colecao,id,dados) */
async function abrir() {
  if (NEON) {
    fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/).forEach(l => { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); });
    const sql = require('@neondatabase/serverless').neon(process.env.DATABASE_URL);
    doc = async (c, id) => { const r = await sql.query('select dados, atualizado from documentos where colecao=$1 and id=$2', [c, id]); return r[0] ? { dados: r[0].dados, at: new Date(r[0].atualizado).getTime() } : null; };
    lista = async (c, prefixo) => (await sql.query('select id from documentos where colecao=$1 and id like $2 order by id', [c, prefixo + '%'])).map(r => r.id);
    grava = async (c, id, dados) => sql.query('insert into documentos (colecao, id, dados, atualizado) values ($1,$2,$3::jsonb, clock_timestamp()) on conflict (colecao, id) do update set dados = excluded.dados, atualizado = clock_timestamp()', [c, id, JSON.stringify(dados)]);
  } else {
    const lg = await req('POST', '/api/login', { usuario: 'admin.teste', senha: 'teste12345' });
    if (lg.s !== 200) throw new Error('Não consegui entrar no servidor de teste (http://localhost:' + PORTA + ').');
    doc = async (c, id) => { const r = await req('GET', '/api/doc?c=' + c + '&id=' + encodeURIComponent(id), null, lg.c); return r.j && r.j.existe ? { dados: r.j.dados, at: 0 } : null; };
    lista = async () => []; /* não usado no teste */
    grava = async (c, id, dados) => { const r = await req('POST', '/api/doc?c=' + c, { id, dados }, lg.c); if (r.s !== 200) throw new Error('Falha ao gravar ' + c + '/' + id); };
  }
}

(async () => {
  console.log((APLICAR ? 'GRAVANDO' : 'SIMULANDO (nada será gravado)') + ' em ' + (NEON ? 'NEON (banco real)' : 'servidor de teste'));
  await abrir();
  const bi = await doc('config', 'bancoIdx'); if (!bi) throw new Error('Índice do banco (bancoIdx) não encontrado.');
  const idx = JSON.parse(bi.dados.j), itens = [];
  for (const f of ['COI', 'MAN', 'OBRAS', 'FIS']) for (const d of Object.keys(idx[f] || {}).sort()) if (d > '2026-05-31') itens.push([f, d]);
  const backup = {}; let feitos = 0, alterados = 0, criados = 0, iguais = 0, semLinhas = 0, hojeIgnorado = 0, novosDepois = 0;
  for (const [f, d] of itens) {
    const antigo = await doc('dias', d + '_' + f);
    if (!antigo && d >= hoje) { hojeIgnorado++; continue; } /* dia ainda aberto */
    if (antigo && antigo.at && antigo.at > inicio) { novosDepois++; continue; } /* chegou um envio novo enquanto isso */
    let cols = [], rows = [];
    for (let k = 0; k < 20; k++) {
      const x = await doc('banco', f + '_' + d + '_' + k); if (!x) break;
      cols = x.dados.cols || cols; rows = rows.concat(JSON.parse(desc(x.dados))); if (!((x.dados.nk || 1) > k + 1)) break;
    }
    if (!rows.length) { semLinhas++; continue; }
    const hdr = cols.map(c => c === 'Tipo de Atividade (2)' ? 'Tipo de Atividade' : c === 'Tipo de Atividade' ? 'Tipo de Atividade (1)' : c);
    const eq = (Disp.agregarArquivo([hdr].concat(rows), f).dias[d]) || {};
    if (!Object.keys(eq).length) { semLinhas++; continue; }
    feitos++;
    if (antigo && JSON.stringify(antigo.dados.eq) === JSON.stringify(eq)) { iguais++; continue; }
    antigo ? alterados++ : criados++;
    if (antigo) backup[d + '_' + f] = antigo.dados;
    if (APLICAR) await grava('dias', d + '_' + f, { data: d, fonte: f, arquivo: (antigo && antigo.dados.arquivo) || 'Banco SIGA', eq, enviadoEm: (antigo && antigo.dados.enviadoEm) || new Date().toISOString(), recalculadoEm: new Date().toISOString() });
    if (feitos % 100 === 0) console.log('  ' + feitos + '/' + itens.length);
  }
  if (APLICAR && NEON && Object.keys(backup).length) {
    fs.mkdirSync(path.join(DIR, 'backups'), { recursive: true });
    const nome = path.join(DIR, 'backups', 'dias-antes-do-recalculo-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    fs.writeFileSync(nome, JSON.stringify(backup)); console.log('Cópia dos documentos substituídos: ' + nome);
  }
  console.log('\nDias/fonte lidos: ' + itens.length + ' · recalculados: ' + feitos + ' · mudaram: ' + alterados + ' · já estavam iguais: ' + iguais + ' · criados: ' + criados + ' · sem linhas: ' + semLinhas + ' · hoje (aberto): ' + hojeIgnorado + ' · envio novo no meio: ' + novosDepois);
  console.log(APLICAR ? 'Pronto.' : 'Nada foi gravado. Rode de novo com --aplicar para gravar.');
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
