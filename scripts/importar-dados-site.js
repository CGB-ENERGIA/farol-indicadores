'use strict';
/* npm run importar-dados-site
   Carrega no Neon os arquivos de dados do site (historico*.json, config.json, *_config.json, ups_semclasse.json) que NÃO ficam
   no GitHub (o repositório é público). Rode de novo sempre que atualizar um desses arquivos. Lê os arquivos da subpasta privado/ do projeto. */
const fs = require('fs');
const path = require('path');
const pg = require('../lib/pg');
const OK = /^(config|ader_config|def_config|ini_config|prod_config|ups_config|ups_semclasse|historico(_[a-z]+)?)\.json$/;
(async () => {
  const raiz = path.join(__dirname, '..', 'privado'); // dados que não vão para o GitHub
  const nomes = fs.readdirSync(raiz).filter(n => OK.test(n)).sort();
  if (!nomes.length) { console.log('Nenhum arquivo de dados encontrado em ' + raiz); process.exitCode = 1; return; }
  for (const n of nomes) {
    const dados = JSON.parse(fs.readFileSync(path.join(raiz, n), 'utf8'));
    await pg.q("insert into documentos (colecao, id, dados) values ('arquivos', $1, $2::jsonb) on conflict (colecao, id) do update set dados = excluded.dados, atualizado = clock_timestamp()", [n, JSON.stringify(dados)]);
    console.log('ok  ' + n + '  (' + Math.round(fs.statSync(path.join(raiz, n)).size / 1024) + ' KB)');
  }
  console.log('Pronto: ' + nomes.length + ' arquivo(s) gravado(s) no Neon.');
})().catch(e => { console.error('Erro:', e.message); process.exitCode = 1; });
