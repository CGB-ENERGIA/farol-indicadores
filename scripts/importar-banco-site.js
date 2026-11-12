'use strict';
/* npm run importar-banco-site -- banco2026_parte1de5.json … banco2026_parte5de5.json
   Carrega o Banco SIGA já exportado (as mesmas 5 partes do botão "Importar banco inicial") direto na tabela
   "documentos" do Neon, coleção "banco" + o índice. Dias que já existem não são sobrescritos (use --substituir para trocar). */
const fs = require('fs');
const pg = require('../lib/pg');
(async () => {
  const args = process.argv.slice(2), subst = args.includes('--substituir'), arqs = args.filter(a => !a.startsWith('--'));
  if (!arqs.length) { console.log('Informe os arquivos: npm run importar-banco-site -- banco2026_parte1de5.json …'); process.exitCode = 1; return; }
  const existente = await pg.q("select dados from documentos where colecao = 'config' and id = 'bancoIdx'");
  const idx = existente[0] ? JSON.parse(existente[0].dados.j) : { COI: {}, MAN: {}, FIS: {}, OBRAS: {} };
  let gravados = 0, ignorados = 0;
  for (const f of arqs) {
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    const novos = new Set();
    for (const x of d.docs) {
      if (!subst && (idx[x.fonte] || {})[x.data]) { ignorados++; continue; }
      const { id, ...resto } = x;
      await pg.q("insert into documentos (colecao, id, dados) values ('banco', $1, $2::jsonb) on conflict (colecao, id) do update set dados = excluded.dados, atualizado = clock_timestamp()", [id || (x.fonte + '_' + x.data + '_' + x.k), JSON.stringify(resto)]);
      novos.add(x.fonte + '|' + x.data); gravados++;
    }
    for (const fonte of Object.keys(d.idx || {})) for (const dia in d.idx[fonte]) if (subst || novos.has(fonte + '|' + dia)) (idx[fonte] = idx[fonte] || {})[dia] = d.idx[fonte][dia];
    console.log(f + ': ok (' + gravados + ' documentos até agora)');
  }
  await pg.q("insert into documentos (colecao, id, dados) values ('config', 'bancoIdx', $1::jsonb) on conflict (colecao, id) do update set dados = excluded.dados, atualizado = clock_timestamp()", [JSON.stringify({ j: JSON.stringify(idx), editadoEm: new Date().toISOString() })]);
  console.log('Pronto: ' + gravados + ' documentos gravados, ' + ignorados + ' ignorados (dias que já existiam).');
})().catch(e => { console.error('Erro:', e.message); process.exitCode = 1; });
