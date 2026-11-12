'use strict';
/* Lê a pasta do OneDrive que já está sincronizada neste PC (sem Azure). Mesma interface do graph.js. */
const fs = require('fs');
const path = require('path');

function criarFonteLocal(pasta, profundidadePadrao = 2) {
  async function listar(dir = pasta, profundidade = profundidadePadrao, base = pasta) {
    let ents;
    try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch (e) { throw new Error('Não consegui abrir a pasta "' + dir + '": ' + (e.code === 'ENOENT' ? 'ela não existe.' : e.message)); }
    const itens = [];
    for (const e of ents) {
      const cam = path.join(dir, e.name);
      if (e.isDirectory()) { if (profundidade > 0) itens.push(...await listar(cam, profundidade - 1, base)); continue; }
      if (!e.isFile()) continue;
      const st = await fs.promises.stat(cam);
      const rel = path.relative(base, cam).split(path.sep).join('/');
      itens.push({ id: rel, nome: e.name, tamanho: st.size, etag: st.mtimeMs + '-' + st.size, modificado: st.mtime.toISOString(), caminho: rel, _abs: cam });
    }
    return itens;
  }
  async function baixar(item) { return fs.promises.readFile(item._abs || path.join(pasta, item.caminho)); }
  async function diagnostico() { await fs.promises.access(pasta); return { driveId: null, tipo: 'pasta local', nome: path.basename(pasta), url: pasta }; }
  return { listar, baixar, diagnostico };
}

module.exports = { criarFonteLocal };
