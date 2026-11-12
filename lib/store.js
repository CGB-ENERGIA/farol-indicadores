'use strict';
/* Onde o banco SIGA fica guardado. Três opções com a mesma interface:
   - arquivo  : pasta "dados" no PC (modo local, sem instalar nada)
   - postgres : Neon (Vercel)
   - memoria  : testes
   Regra de gravação de um dia: só substitui se o arquivo novo tiver o mesmo número de linhas ou mais
   (relatório parcial, com menos linhas, não apaga um dia completo). */
const fs = require('fs');
const path = require('path');
const { FONTES } = require('./banco');

const vazioIdx = () => Object.fromEntries(FONTES.map(f => [f, {}]));
/* forcar = true: o arquivo é a fonte da verdade (consolidado) e substitui o dia mesmo com menos linhas */
const decide = (novoN, antigoN, forcar = false) => (antigoN == null ? 'novo' : (forcar || novoN >= antigoN) ? 'atualizado' : 'ignorado');

/* ---------- memória ---------- */
function criarMemoria() {
  const dias = new Map(), arqs = new Map(), execs = [];
  return {
    tipo: 'memoria',
    async arquivo(id) { return arqs.get(id) || null; },
    async registrarArquivo(r) { arqs.set(r.id, { ...r, processadoEm: new Date().toISOString() }); },
    async gravarDia(d) {
      const k = d.fonte + '|' + d.data, a = dias.get(k);
      const res = decide(d.linhas.length, a && a.n, d.forcar);
      if (res !== 'ignorado') dias.set(k, { fonte: d.fonte, data: d.data, cols: d.cols, linhas: d.linhas, n: d.linhas.length, arquivo: d.arquivo || null, enviadoEm: new Date().toISOString() });
      return res;
    },
    async indice() { const o = vazioIdx(); for (const v of dias.values()) o[v.fonte][v.data] = v.n; return o; },
    async dia(fonte, data) { return dias.get(fonte + '|' + data) || null; },
    async arquivos(limite = 50) { return [...arqs.values()].sort((a, b) => (a.processadoEm < b.processadoEm ? 1 : -1)).slice(0, limite); },
    async registrarExecucao(r) { execs.push(r); },
    async ultimaExecucao() { return execs[execs.length - 1] || null; }
  };
}

/* ---------- arquivos no PC ---------- */
function criarArquivo(dir) {
  const bancoDir = path.join(dir, 'banco');
  const fArqs = path.join(dir, 'arquivos.json'), fIdx = path.join(dir, 'indice.json'), fExec = path.join(dir, 'execucoes.json');
  const gravaAtomico = async (f, obj) => { await fs.promises.mkdir(path.dirname(f), { recursive: true }); const tmp = f + '.tmp'; await fs.promises.writeFile(tmp, JSON.stringify(obj)); await fs.promises.rename(tmp, f); };
  const le = async (f, padrao) => { try { return JSON.parse(await fs.promises.readFile(f, 'utf8')); } catch (e) { return padrao; } };
  let idx = null, arqs = null;
  const carregaIdx = async () => {
    if (idx) return idx;
    idx = await le(fIdx, null);
    if (!idx) { // reconstrói a partir dos arquivos de dia
      idx = vazioIdx();
      for (const f of FONTES) {
        let nomes = []; try { nomes = await fs.promises.readdir(path.join(bancoDir, f)); } catch (e) { /* ainda não existe */ }
        for (const n of nomes) if (n.endsWith('.json')) { const j = await le(path.join(bancoDir, f, n), null); if (j) idx[f][j.data] = j.n; }
      }
    }
    for (const f of FONTES) idx[f] = idx[f] || {};
    return idx;
  };
  const carregaArqs = async () => (arqs = arqs || await le(fArqs, {}));
  return {
    tipo: 'arquivo',
    async arquivo(id) { return (await carregaArqs())[id] || null; },
    async registrarArquivo(r) { const a = await carregaArqs(); a[r.id] = { ...r, processadoEm: new Date().toISOString() }; await gravaAtomico(fArqs, a); },
    async gravarDia(d) {
      const ix = await carregaIdx(), res = decide(d.linhas.length, ix[d.fonte][d.data], d.forcar);
      if (res === 'ignorado') return res;
      await gravaAtomico(path.join(bancoDir, d.fonte, d.data + '.json'), { fonte: d.fonte, data: d.data, cols: d.cols, linhas: d.linhas, n: d.linhas.length, arquivo: d.arquivo || null, enviadoEm: new Date().toISOString() });
      ix[d.fonte][d.data] = d.linhas.length; await gravaAtomico(fIdx, ix);
      return res;
    },
    async indice() { return JSON.parse(JSON.stringify(await carregaIdx())); },
    async dia(fonte, data) { if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !FONTES.includes(fonte)) return null; return le(path.join(bancoDir, fonte, data + '.json'), null); },
    async arquivos(limite = 50) { return Object.values(await carregaArqs()).sort((a, b) => (a.processadoEm < b.processadoEm ? 1 : -1)).slice(0, limite); },
    async registrarExecucao(r) { const l = await le(fExec, []); l.push(r); await gravaAtomico(fExec, l.slice(-50)); },
    async ultimaExecucao() { const l = await le(fExec, []); return l[l.length - 1] || null; }
  };
}

/* ---------- Postgres (Neon) ---------- */
function criarPostgres(url, deps = {}) {
  const sql = deps.sql || require('@neondatabase/serverless').neon(url);
  const q = (texto, params = []) => sql.query(texto, params);
  let pronto = null;
  const garante = () => (pronto = pronto || (async () => {
    const comandos = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8').split(';')
      .map(c => c.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').trim()).filter(Boolean);
    for (const c of comandos) await q(c);
  })());
  return {
    tipo: 'postgres',
    async arquivo(id) { await garante(); const r = await q('select id, nome, etag, tamanho, modificado, status, detalhe, processado_em from arquivos_onedrive where id = $1', [id]); return r[0] ? { id: r[0].id, nome: r[0].nome, etag: r[0].etag, status: r[0].status, detalhe: r[0].detalhe } : null; },
    async registrarArquivo(r) {
      await garante();
      await q(`insert into arquivos_onedrive (id, nome, etag, tamanho, modificado, status, detalhe, processado_em) values ($1,$2,$3,$4,$5,$6,$7::jsonb, now())
               on conflict (id) do update set nome=excluded.nome, etag=excluded.etag, tamanho=excluded.tamanho, modificado=excluded.modificado, status=excluded.status, detalhe=excluded.detalhe, processado_em=now()`,
        [r.id, r.nome || null, r.etag || null, r.tamanho || null, r.modificado || null, r.status, JSON.stringify(r.detalhe || null)]);
    },
    async gravarDia(d) {
      await garante();
      const r = await q(`insert into banco_dias (fonte, data, cols, linhas, n, arquivo, enviado_em) values ($1,$2,$3::jsonb,$4::jsonb,$5,$6, now())
                         on conflict (fonte, data) do update set cols=excluded.cols, linhas=excluded.linhas, n=excluded.n, arquivo=excluded.arquivo, enviado_em=now()
                         where $7::boolean or excluded.n >= banco_dias.n
                         returning (xmax = 0) as novo`,
        [d.fonte, d.data, JSON.stringify(d.cols), JSON.stringify(d.linhas), d.linhas.length, d.arquivo || null, !!d.forcar]);
      return !r.length ? 'ignorado' : r[0].novo ? 'novo' : 'atualizado';
    },
    async indice() { await garante(); const o = vazioIdx(); for (const r of await q("select fonte, to_char(data,'YYYY-MM-DD') as data, n from banco_dias")) { (o[r.fonte] = o[r.fonte] || {})[r.data] = r.n; } return o; },
    async dia(fonte, data) {
      await garante(); if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
      const r = await q("select fonte, to_char(data,'YYYY-MM-DD') as data, cols, linhas, n, arquivo, enviado_em from banco_dias where fonte=$1 and data=$2", [fonte, data]);
      return r[0] ? { fonte: r[0].fonte, data: r[0].data, cols: r[0].cols, linhas: r[0].linhas, n: r[0].n, arquivo: r[0].arquivo, enviadoEm: r[0].enviado_em } : null;
    },
    async arquivos(limite = 50) { await garante(); return (await q('select id, nome, etag, tamanho, modificado, status, detalhe, processado_em from arquivos_onedrive order by processado_em desc limit $1', [limite])).map(r => ({ id: r.id, nome: r.nome, status: r.status, detalhe: r.detalhe, processadoEm: r.processado_em, modificado: r.modificado })); },
    async registrarExecucao(r) { await garante(); await q('insert into sync_execucoes (inicio, fim, resumo) values ($1,$2,$3::jsonb)', [r.inicio, r.fim, JSON.stringify(r)]); },
    async ultimaExecucao() { await garante(); const r = await q('select resumo from sync_execucoes order by id desc limit 1'); return r[0] ? r[0].resumo : null; }
  };
}

function criarStore(cfg, deps = {}) {
  if (cfg.databaseUrl) return criarPostgres(cfg.databaseUrl, deps);
  if (cfg.naVercel) throw new Error('No Vercel é obrigatório informar DATABASE_URL (Neon).');
  return criarArquivo(cfg.dadosDir);
}

module.exports = { criarStore, criarMemoria, criarArquivo, criarPostgres, decide };
