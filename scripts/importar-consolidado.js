'use strict';
/* npm run importar-consolidado -- "C:\...\BANCOS 2026 - MAN COI OBRAS FIS.xlsx" [--abas=MAN,COI] [--sem-substituir]
   Lê a planilha consolidada (uma aba por relatório) em fluxo e grava no banco.
   Por padrão o consolidado SUBSTITUI os dias que já existem (ele é a fonte da verdade). */
const fs = require('fs');
const contexto = require('../lib/contexto');
const { importarConsolidado } = require('../lib/consolidado');

(async () => {
  const args = process.argv.slice(2);
  const caminho = args.find(a => !a.startsWith('--'));
  if (!caminho) { console.log('Informe o arquivo: npm run importar-consolidado -- "C:\\...\\BANCOS 2026 - MAN COI OBRAS FIS.xlsx"'); process.exitCode = 1; return; }
  if (!fs.existsSync(caminho)) { console.log('Arquivo não encontrado: ' + caminho); process.exitCode = 1; return; }
  const abasArg = (args.find(a => a.startsWith('--abas=')) || '').slice(7);
  const { cfg, store } = contexto.obter({ ...process.env, ONEDRIVE_MODO: 'local', ONEDRIVE_PASTA_LOCAL: process.env.ONEDRIVE_PASTA_LOCAL || 'x' });
  const t0 = Date.now();
  const r = await importarConsolidado({
    caminho, store, inicio: cfg.bancoInicio, forcar: !args.includes('--sem-substituir'),
    abas: abasArg ? abasArg.split(',').map(s => s.trim().toUpperCase()) : undefined,
    modificado: fs.statSync(caminho).mtime.toISOString(), log: m => console.log(m)
  });
  console.log('\nResumo:');
  for (const [f, a] of Object.entries(r.abas)) console.log(' -', f, a.ausente ? 'aba não encontrada' : a.erro ? 'ERRO: ' + a.erro : `${a.linhasGravadas.toLocaleString('pt-BR')} linhas em ${a.dias.novo + a.dias.atualizado + a.dias.ignorado} dias (${a.dias.novo} novos, ${a.dias.atualizado} atualizados) · fora do período: ${a.foraPeriodo} · sem data: ${a.semData}`);
  console.log(`Total: ${r.linhas.toLocaleString('pt-BR')} linhas · ${Math.round((Date.now() - t0) / 1000)} s · pico de memória ${Math.round(process.resourceUsage().maxRSS / 1024)} MB`);
  if (r.erros.length) process.exitCode = 1;
})().catch(e => { console.error('Erro:', e.message); process.exitCode = 1; });
