'use strict';
/* GET/POST /api/sync        -> lê o OneDrive e grava no banco
   GET/POST /api/sync?dry=1  -> só mostra o que seria importado, sem gravar */
const contexto = require('../contexto');
const { sincronizar } = require('../sync');
const { json, autorizado, consulta } = require('../http');

module.exports = async (req, res) => {
  try {
    const { cfg, origem, store } = contexto.obter();
    if (!autorizado(req, cfg)) return json(res, 401, { erro: 'Não autorizado.' });
    const dry = ['1', 'true'].includes(consulta(req).get('dry'));
    const r = await sincronizar({ origem, store, limiteMs: cfg.limiteMs, inicio: cfg.bancoInicio, filtro: cfg.filtroArquivo, dry, log: m => console.log('[sync]', m) });
    json(res, r.ocupado ? 409 : 200, r);
  } catch (e) {
    json(res, e.pendencias ? 503 : 500, { erro: e.message, pendencias: e.pendencias });
  }
};
