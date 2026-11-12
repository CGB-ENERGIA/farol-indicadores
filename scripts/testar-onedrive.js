'use strict';
/* npm run testar-onedrive
   Confere, passo a passo, se a conexão com o OneDrive está certa. Não grava nada e não mostra segredos. */
const config = require('../lib/config');
const { criarGraph } = require('../lib/graph');
const { criarFonteLocal } = require('../lib/fonteLocal');
const { fonteDoNome, ehConsolidado, EXTENSOES } = require('../lib/banco');

const ok = m => console.log('  OK   ' + m), falha = m => { console.log('  FALHA ' + m); process.exitCode = 1; };

(async () => {
  const cfg = config.ler();
  console.log(`\nModo: ${cfg.modo}`);
  const pend = config.pendencias(cfg);
  if (pend.length) { falha('Falta preencher no .env: ' + pend.join(', ')); return; }
  ok('Variáveis preenchidas');

  const origem = cfg.modo === 'graph' ? criarGraph(cfg) : criarFonteLocal(cfg.pastaLocal);
  try {
    if (cfg.modo === 'graph') { await origem.token(); ok('Login do aplicativo no Microsoft Entra'); }
    const d = await origem.diagnostico();
    ok(`OneDrive encontrado: ${d.nome || ''} (${d.tipo})${d.url ? ' · ' + d.url : ''}`);
  } catch (e) { falha(e.message); return; }

  let itens;
  try { itens = await origem.listar(); }
  catch (e) { falha('Não consegui listar a pasta: ' + e.message); return; }
  ok(`Pasta lida: ${itens.length} arquivo(s)`);

  const filtro = String(cfg.filtroArquivo || '').trim().toLowerCase();
  const rel = itens.filter(a => EXTENSOES.test(a.nome) && !/^~\$/.test(a.nome) && (!filtro || String(a.caminho || a.nome).toLowerCase().includes(filtro)));
  if (filtro) ok(`Filtro ONEDRIVE_ARQUIVO="${cfg.filtroArquivo}": ${rel.length} de ${itens.length} arquivo(s) serão considerados`);
  const porFonte = {};
  for (const a of rel) { const f = ehConsolidado(a.nome) ? 'CONSOLIDADO (várias abas, leitura em fluxo)' : fonteDoNome(a.nome) || 'NÃO RECONHECIDO'; (porFonte[f] = porFonte[f] || []).push(a); }
  for (const [f, l] of Object.entries(porFonte)) console.log(`       ${f}: ${l.length} arquivo(s)${f === 'NÃO RECONHECIDO' ? ' → ' + l.slice(0, 3).map(x => x.nome).join(', ') : ''}`);
  if (!Object.keys(porFonte).filter(f => f !== 'NÃO RECONHECIDO').length) console.log('       Nenhum relatório COI/MAN/FIS/OBRAS na pasta ainda. O nome do arquivo precisa conter COI, MAN, FIS ou OBRAS.');

  if (cfg.modo === 'graph' && rel[0] && !ehConsolidado(rel[0].nome)) {
    try { const b = await origem.baixar(rel[0]); ok(`Download de teste: "${rel[0].nome}" (${b.length} bytes)`); }
    catch (e) { falha('Download de teste: ' + e.message); }
  }
  console.log(process.exitCode ? '\nCorrija os itens com FALHA e rode de novo.\n' : '\nTudo certo. Rode "npm run sync -- --dry" para ver o que seria importado.\n');
})();
