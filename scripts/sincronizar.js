'use strict';
/* npm run sync            -> lê o OneDrive e grava no banco, uma vez
   npm run sync -- --dry   -> só lista o que seria importado */
const contexto = require('../lib/contexto');
const { sincronizar } = require('../lib/sync');

(async () => {
  try {
    const { cfg, origem, store } = contexto.obter();
    const dry = process.argv.includes('--dry');
    const r = await sincronizar({ origem, store, limiteMs: 30 * 60 * 1000, inicio: cfg.bancoInicio, filtro: cfg.filtroArquivo, dry, log: m => console.log('  ' + m) });
    console.log(`\n${dry ? 'SIMULAÇÃO — nada foi gravado.\n' : ''}Arquivos na pasta: ${r.listados} · candidatos: ${r.candidatos} · já lidos: ${r.jaProcessados} · importados: ${r.processados} · ignorados: ${r.ignorados}`);
    console.log(`Dias: ${r.dias.novo} novos, ${r.dias.atualizado} atualizados, ${r.dias.ignorado} mantidos · linhas: ${r.linhas} · ${r.duracaoMs} ms`);
    for (const a of r.arquivos) console.log(' -', a.nome, '→', a.status, a.fonte ? '(' + a.fonte + ')' : '', a.erro || a.motivo || '');
    if (r.erros.length) { console.log('\nERROS:'); r.erros.forEach(e => console.log(' -', e.nome || '', e.erro)); process.exitCode = 1; }
  } catch (e) { console.error('Erro:', e.message); process.exitCode = 1; }
})();
