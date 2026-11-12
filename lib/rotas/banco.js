'use strict';
/* Leitura do banco SIGA guardado:
   GET /api/banco?acao=status                          -> resumo (dias por fonte, última sincronização)
   GET /api/banco?acao=indice                          -> { COI: {"2026-11-10": 640, …}, MAN: …, FIS: …, OBRAS: … }
   GET /api/banco?acao=dia&fonte=COI&data=2026-11-10   -> { cols, linhas, … } do dia
   GET /api/banco?acao=arquivos                        -> arquivos já lidos do OneDrive */
const contexto = require('../contexto');
const { json, autorizado, consulta } = require('../http');

module.exports = async (req, res) => {
  try {
    const { cfg, store } = contexto.obter();
    if (!req.sessaoOk && !autorizado(req, cfg)) return json(res, 401, { erro: 'Não autorizado.' });
    const q = consulta(req), acao = q.get('acao') || 'status';
    if (acao === 'indice') return json(res, 200, await store.indice());
    if (acao === 'arquivos') return json(res, 200, await store.arquivos(Number(q.get('limite')) || 50));
    if (acao === 'dia') {
      const d = await store.dia(String(q.get('fonte') || '').toUpperCase(), String(q.get('data') || ''));
      return d ? json(res, 200, d) : json(res, 404, { erro: 'Dia não encontrado.' });
    }
    if (acao === 'status') {
      const idx = await store.indice();
      const fontes = Object.fromEntries(Object.entries(idx).map(([f, v]) => { const ds = Object.keys(v).sort(); return [f, { dias: ds.length, linhas: ds.reduce((s, d) => s + v[d], 0), primeiro: ds[0] || null, ultimo: ds[ds.length - 1] || null }]; }));
      const ult = await store.ultimaExecucao();
      return json(res, 200, { armazenamento: store.tipo, origem: cfg.modo, fontes, ultimaSincronizacao: ult ? { inicio: ult.inicio, duracaoMs: ult.duracaoMs, processados: ult.processados, erros: (ult.erros || []).length } : null });
    }
    json(res, 400, { erro: 'Ação inválida. Use status, indice, dia ou arquivos.' });
  } catch (e) {
    json(res, e.pendencias ? 503 : 500, { erro: e.message, pendencias: e.pendencias });
  }
};
