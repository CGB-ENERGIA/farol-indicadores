'use strict';
/* npm run migrar-historico -- [--aplicar]
   Gera, a partir das linhas do banco no Neon (coleção "banco"), o resumo da Disponibilidade por equipe e dia
   (coleção "dias", documento {data}_{fonte}) para os dias que ainda não têm resumo. Substitui o historico.json.
   Usa a regra atual (início = 1º checklist do dia). Nunca sobrescreve um dia que já existe.
   Sem --aplicar só mostra o que faria e compara com o historico.json do Neon. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const raiz = path.join(__dirname, '..');
try { fs.readFileSync(path.join(raiz, '.env'), 'utf8').split(/\r?\n/).forEach(l => { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); }); } catch (e) { /* variáveis já definidas */ }
const pg = require('../lib/pg');
const Disp = require('../calc.js');
const APLICAR = process.argv.includes('--aplicar');
const INICIO = '2026-05-31'; // a disponibilidade começa em 01/06

(async () => {
  const jaTem = new Set((await pg.q("select id from documentos where colecao = 'dias'")).map(r => r.id));
  const hist = (await pg.q("select dados from documentos where colecao = 'arquivos' and id = 'historico.json'"))[0];
  const H = hist ? hist.dados : { dias: {} };
  const fontes = ['COI', 'MAN', 'OBRAS', 'FIS'];
  const dias = (await pg.q("select distinct dados->>'fonte' as f, dados->>'data' as d from documentos where colecao = 'banco' order by 2, 1"))
    .filter(r => fontes.includes(r.f) && r.d > INICIO);
  console.log('Dias de banco acima de 31/05: ' + dias.length + ' (fonte+dia) · já com resumo em "dias": ' + jaTem.size);
  let gerar = 0, gravados = 0, ign = 0, vazios = 0; const agg = {}; // por dia: junção das fontes (para comparar)
  for (const { f, d } of dias) {
    const id = d + '_' + f;
    if (jaTem.has(id)) { ign++; continue; }
    const docs = await pg.q("select dados from documentos where colecao = 'banco' and dados->>'fonte' = $1 and dados->>'data' = $2 order by (dados->>'k')::int", [f, d]);
    let cols = [], rows = [];
    for (const x of docs) { const v = x.dados; cols = v.cols || cols; try { rows = rows.concat(JSON.parse(v.z ? zlib.gunzipSync(Buffer.from(v.z, 'base64')).toString() : v.j)); } catch (e) { /* linha ruim */ } }
    if (!rows.length) { vazios++; continue; }
    const hdr = cols.map(c => c === 'Tipo de Atividade (2)' ? 'Tipo de Atividade' : c === 'Tipo de Atividade' ? 'Tipo de Atividade (1)' : c);
    let r; try { r = Disp.agregarArquivo([hdr].concat(rows), f); } catch (e) { vazios++; continue; }
    const eq = r.dias[d]; if (!eq || !Object.keys(eq).length) { vazios++; continue; }
    gerar++;
    const junto = agg[d] || (agg[d] = {}); for (const rec in eq) junto[rec] = Disp.juntar(junto[rec], eq[rec]);
    if (APLICAR) {
      await pg.q("insert into documentos (colecao, id, dados) values ('dias', $1, $2::jsonb) on conflict (colecao, id) do nothing",
        [id, JSON.stringify({ data: d, fonte: f, arquivo: 'Banco SIGA', eq, enviadoEm: new Date().toISOString() })]);
      gravados++;
    }
  }
  /* comparação com o historico.json (só nos dias que o histórico tem) */
  let comp = 0, difIni = 0, difFim = 0, semHist = 0;
  for (const d in agg) { const h = H.dias[d]; if (!h) { semHist++; continue; } for (const rec in agg[d]) { const a = agg[d][rec], b = h[rec]; if (!b) continue; comp++; const ini = a[5] != null ? a[5] : a[0]; if (ini !== b[0]) difIni++; const fa = a[2] != null ? a[2] : a[1], fb = b[2] != null ? b[2] : b[1]; if (Math.abs((fa || 0) - (fb || 0)) > 1) difFim++; } }
  console.log('Resumos ' + (APLICAR ? 'gravados: ' + gravados : 'que seriam gerados: ' + gerar) + ' · já existiam: ' + ign + ' · sem linhas: ' + vazios);
  console.log('Comparação com historico.json: ' + comp + ' equipe-dias · início diferente: ' + difIni + ' (regra do checklist) · fim diferente: ' + difFim + ' · dias fora do histórico: ' + semHist);
  if (!APLICAR) console.log('Nada foi gravado. Rode com --aplicar para gravar.');
})().catch(e => { console.error('Erro:', e.message); process.exitCode = 1; });
