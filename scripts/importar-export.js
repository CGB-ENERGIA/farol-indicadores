'use strict';
/* npm run importar-export -- banco2026_v2_parte1de5.json banco2026_v2_parte2de5.json ...
   Importa para o banco (arquivos locais ou Neon) a exportação do Banco SIGA feita pelo site (pacotes {idx, docs}). */
const fs = require('fs');
const zlib = require('zlib');
const contexto = require('../lib/contexto');

(async () => {
  const arquivos = process.argv.slice(2);
  if (!arquivos.length) { console.log('Informe os arquivos: npm run importar-export -- banco2026_v2_parte1de5.json …'); process.exitCode = 1; return; }
  const { store } = contexto.obter();
  const grupos = new Map(); // fonte|data -> { cols, chunks:[[k, linhas]], arquivo }
  for (const f of arquivos) {
    console.log('Lendo', f);
    const pk = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const x of pk.docs || []) {
      if (!x.fonte || !x.data) continue;
      const linhas = JSON.parse(x.z ? zlib.gunzipSync(Buffer.from(x.z, 'base64')).toString('utf8') : (x.j || '[]'));
      const k = x.fonte + '|' + x.data, g = grupos.get(k) || { fonte: x.fonte, data: x.data, cols: x.cols, chunks: [], arquivo: x.arquivo };
      g.chunks.push([x.k || 0, linhas]); grupos.set(k, g);
    }
  }
  const cont = { novo: 0, atualizado: 0, ignorado: 0 }; let linhas = 0;
  for (const g of grupos.values()) {
    const todas = g.chunks.sort((a, b) => a[0] - b[0]).flatMap(c => c[1]);
    cont[await store.gravarDia({ fonte: g.fonte, data: g.data, cols: g.cols, linhas: todas, arquivo: g.arquivo })]++; linhas += todas.length;
  }
  console.log(`Pronto: ${grupos.size} dia(s) (${linhas} linhas) → ${cont.novo} novos, ${cont.atualizado} atualizados, ${cont.ignorado} mantidos.`);
})().catch(e => { console.error('Erro:', e.message); process.exitCode = 1; });
