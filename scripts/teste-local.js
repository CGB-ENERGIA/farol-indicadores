'use strict';
/* Servidor local de TESTE com banco que PERSISTE (PGlite em disco), com uma cópia dos dados reais.
   Os ajustes feitos aqui (ex.: períodos das equipes em Cadastros) ficam salvos entre uma execução e outra e
   depois são aplicados no banco real com scripts/aplicar-cadastro-teste.js.

   Primeira vez (copia os dados do Neon, só leitura):   node scripts/teste-local.js --copiar
   Depois:                                              node scripts/teste-local.js
   Refazer a cópia (apaga os ajustes feitos aqui):      node scripts/teste-local.js --copiar --refazer
   Abre em http://localhost:3070  ·  login: admin.teste / teste12345
   Os dados ficam em %LOCALAPPDATA%\FarolTeste (fora do repositório e do OneDrive). Nada daqui vai para o GitHub. */
const fs = require('fs'), path = require('path'), os = require('os'), Module = require('module');
const RAIZ = path.join(__dirname, '..');
const DIR = process.env.FAROL_TESTE_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), 'FarolTeste');
const PGDIR = path.join(DIR, 'pgdata'), BASE = path.join(DIR, 'baseline.json');
const PORTA = Number(process.env.PORT) || 3070;
const COPIAR = process.argv.includes('--copiar'), REFAZER = process.argv.includes('--refazer');
const CONFIG_IDS = ['prefixos', 'feriados', 'feriadosMun', 'folgas', 'estruturas', 'listas', 'aderRegras', 'metas', 'naoCgb'];

function carregarEnv() {
  try { fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/).forEach(l => { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); }); } catch (e) { /* sem .env */ }
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  if (REFAZER) { fs.rmSync(PGDIR, { recursive: true, force: true }); fs.rmSync(BASE, { force: true }); }
  const jaTem = fs.existsSync(path.join(PGDIR, 'PG_VERSION'));
  if (!jaTem && !COPIAR) { console.error('Ainda não há cópia dos dados. Rode uma vez:  node scripts/teste-local.js --copiar'); process.exit(1); }
  if (jaTem && COPIAR) { console.error('Já existe uma cópia em ' + DIR + '. Para refazer (apaga os ajustes feitos no teste), use:  --copiar --refazer'); process.exit(1); }

  /* conexão real ao Neon: só para ler, e só na cópia */
  let real = null;
  if (!jaTem) {
    carregarEnv();
    if (!process.env.DATABASE_URL) { console.error('DATABASE_URL não encontrada no .env.'); process.exit(1); }
    real = require('@neondatabase/serverless').neon(process.env.DATABASE_URL);
  }

  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite(PGDIR);
  const orig = Module._load;
  Module._load = function (req, ...r) {
    if (req === '@neondatabase/serverless') return { neon: () => ({ query: async (t, p) => (await db.query(t, p || [])).rows }) };
    return orig.call(this, req, ...r);
  };
  process.env.DATABASE_URL = 'postgres://teste';
  process.env.SECRET_KEY = process.env.SECRET_KEY || 'chave-de-teste-local';
  const auth = require('../lib/auth'), pg = require('../lib/pg');
  const { criarServidor } = require('../servidor');

  if (!jaTem) {
    await pg.q("insert into usuarios (usuario,nome,senha_hash,nivel,status) values ('admin.teste','Administrador de Teste',$1,'ADMINISTRADOR','ATIVO')", [auth.hashSenha('teste12345')]);
    const tira = async sql => real.query(sql);
    const docs = [].concat(
      await tira("select colecao,id,dados from documentos where colecao <> 'banco'"),
      await tira("select colecao,id,dados from documentos where colecao = 'banco' and dados->>'fonte' = 'COI' and dados->>'data' >= '2026-10-01'"),
      await tira("select colecao,id,dados from documentos where colecao = 'banco' and dados->>'fonte' in ('MAN','OBRAS','FIS') and dados->>'data' >= '2026-11-01'"));
    const base = {};
    for (const d of docs) {
      await pg.q('insert into documentos (colecao,id,dados) values ($1,$2,$3::jsonb) on conflict do nothing', [d.colecao, d.id, JSON.stringify(d.dados)]);
      if (d.colecao === 'config' && CONFIG_IDS.includes(d.id)) base[d.id] = (d.dados && d.dados.itens) || {};
    }
    fs.writeFileSync(BASE, JSON.stringify({ copiadoEm: new Date().toISOString(), itens: base }));
    console.log('Cópia feita: ' + docs.length + ' documentos. Ponto de partida guardado para comparar depois.');
  }

  criarServidor().listen(PORTA, '127.0.0.1', () => {
    console.log('Servidor de TESTE (dados persistentes) em http://localhost:' + PORTA);
    console.log('Login: admin.teste  /  teste12345');
    console.log('Dados em: ' + DIR);
  });
})().catch(e => { console.error(e); process.exit(1); });
