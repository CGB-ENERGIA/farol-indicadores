'use strict';
/* Build do Vercel: monta a pasta "public" só com o código do site (HTML/JS).
   Os arquivos de DADOS (historico*.json, config…) NÃO vão para lá: saem pela API, só para quem fez login. */
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..'), destino = path.join(raiz, 'public');
const ARQUIVOS = ['index.html', 'farol-web.js', 'calc.js', 'ups.js', 'ups_ui.js'];
const PASTAS = ['icons']; // logos da tela de login
fs.rmSync(destino, { recursive: true, force: true });
fs.mkdirSync(destino, { recursive: true });
for (const a of ARQUIVOS) {
  if (!fs.existsSync(path.join(raiz, a))) { console.error('Falta o arquivo ' + a); process.exit(1); }
  fs.copyFileSync(path.join(raiz, a), path.join(destino, a));
}
for (const p of PASTAS) fs.cpSync(path.join(raiz, p), path.join(destino, p), { recursive: true });
console.log('public/ montada com ' + ARQUIVOS.length + ' arquivos e a pasta icons.');
