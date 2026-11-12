'use strict';
/* Servidor local: mostra o site e roda a conexão com o OneDrive.
   Uso:  npm start   ->  http://localhost:3000
   Serve só arquivos soltos da raiz (index.html e os .json do site). Código, dados e segredos não são servidos. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const contexto = require('./lib/contexto');
const { sincronizar } = require('./lib/sync');
const apiSync = require('./lib/rotas/sync');
const apiBanco = require('./lib/rotas/banco');
const rotear = require('./lib/rotas');

const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const DADOS_PRIV = /^(config|ader_config|def_config|ini_config|prod_config|ups_config|ups_semclasse|historico(_[a-z]+)?)\.json$/;
const BLOQUEADOS = /^(package(-lock)?\.json|vercel\.json|\.env.*|banco2026.*|\.gitignore|\.vercelignore)$/i;

function estatico(raiz, req, res) {
  let nome;
  try { nome = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.statusCode = 400; return res.end('Pedido inválido'); }
  if (nome === '/') nome = '/index.html';
  const parte = nome.slice(1);
  if (!parte || parte.includes('/') || parte.includes('\\') || BLOQUEADOS.test(parte) || !MIME[path.extname(parte).toLowerCase()]) { res.statusCode = 404; return res.end('Não encontrado'); }
  /* dados que não vão para o GitHub ficam em privado/ (só no PC): se existir lá, serve de lá */
  const priv = path.join(raiz, 'privado', parte);
  const arq = DADOS_PRIV.test(parte) && fs.existsSync(priv) ? priv : path.join(raiz, parte);
  fs.readFile(arq, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end('Não encontrado'); }
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[path.extname(parte).toLowerCase()]);
    res.setHeader('Cache-Control', 'no-cache');
    res.end(buf);
  });
}

function criarServidor(raiz = config.RAIZ) {
  return http.createServer((req, res) => {
    const rota = new URL(req.url, 'http://x').pathname;
    if (process.env.DATABASE_URL && rota.startsWith('/api/')) return rotear(req, res); // modo web: login + documentos (como no Vercel)
    if (rota === '/api/sync') return apiSync(req, res);
    if (rota === '/api/banco') return apiBanco(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end('Método não permitido'); }
    estatico(raiz, req, res);
  });
}

async function rodarSync(motivo) {
  try {
    const { cfg, origem, store } = contexto.obter();
    const r = await sincronizar({ origem, store, limiteMs: 10 * 60 * 1000, inicio: cfg.bancoInicio, filtro: cfg.filtroArquivo, log: m => console.log('  [sync]', m) });
    if (r.ocupado) return console.log('[sync]', r.mensagem);
    console.log(`[sync] ${motivo}: ${r.listados} arquivo(s) na pasta, ${r.processados} importado(s), ${r.jaProcessados} já lido(s), ${r.ignorados} ignorado(s); dias novos ${r.dias.novo}, atualizados ${r.dias.atualizado}${r.erros.length ? ', ERROS: ' + r.erros.map(e => (e.nome ? e.nome + ': ' : '') + e.erro).join(' | ') : ''}`);
  } catch (e) { console.log('[sync] não executou:', e.message); }
}

if (require.main === module) {
  const cfg = config.ler();
  const host = process.env.HOST || '127.0.0.1';
  criarServidor().listen(cfg.porta, host, () => {
    console.log(`Central de Indicadores rodando em http://localhost:${cfg.porta}`);
    const pend = config.pendencias(cfg);
    console.log(`OneDrive: modo "${cfg.modo}" ${pend.length ? '— falta configurar: ' + pend.join(', ') + ' (copie .env.example para .env)' : '— configurado'}`);
    console.log(`Banco: ${cfg.databaseUrl ? 'Postgres (Neon)' : 'arquivos em ' + cfg.dadosDir}`);
    if (!pend.length) {
      if (cfg.aoIniciar) rodarSync('ao iniciar');
      if (cfg.intervaloMin > 0) { setInterval(() => rodarSync('agendada'), cfg.intervaloMin * 60 * 1000); console.log(`Sincronização automática a cada ${cfg.intervaloMin} min.`); }
    }
  });
}

module.exports = { criarServidor };
