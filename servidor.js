'use strict';
/* Servidor local: mostra o site e a API (mesmas rotas do Vercel), com o banco no Neon (DATABASE_URL).
   Uso:  npm start   ->  http://localhost:3000
   Serve só arquivos soltos da raiz (index.html e os .json do site). Código, dados e segredos não são servidos. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const rotear = require('./lib/rotas');
const RAIZ = __dirname;

const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const DADOS_PRIV = /^(config|ader_config|def_config|ini_config|prod_config|ups_config)\.json$/;
const BLOQUEADOS = /^(package(-lock)?\.json|vercel\.json|\.env.*|banco2026.*|\.gitignore|\.vercelignore)$/i;

function estatico(raiz, req, res) {
  let nome;
  try { nome = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.statusCode = 400; return res.end('Pedido inválido'); }
  if (nome === '/') nome = '/index.html';
  const parte = nome.slice(1);
  const emIcons = /^icons\/[A-Za-z0-9._-]+$/.test(parte); // logos e favicon da tela de login
  if (!parte || (parte.includes('/') && !emIcons) || parte.includes('\\') || BLOQUEADOS.test(parte) || !MIME[path.extname(parte).toLowerCase()]) { res.statusCode = 404; return res.end('Não encontrado'); }
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

function criarServidor(raiz = RAIZ) {
  return http.createServer((req, res) => {
    const rota = new URL(req.url, 'http://x').pathname;
    if (rota.startsWith('/api/')) return rotear(req, res); // login + documentos, como no Vercel
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end('Método não permitido'); }
    estatico(raiz, req, res);
  });
}

if (require.main === module) {
  const porta = Number(process.env.PORT) || 3000, host = process.env.HOST || '127.0.0.1';
  criarServidor().listen(porta, host, () => {
    console.log(`Central de Indicadores rodando em http://localhost:${porta}`);
    console.log(`Banco: ${process.env.DATABASE_URL ? 'Postgres (Neon)' : 'DATABASE_URL não configurada'}`);
  });
}

module.exports = { criarServidor };
