'use strict';
/* Monta, uma vez, a origem (Graph ou pasta local) e o armazenamento a partir da configuração. */
const config = require('./config');
const { criarGraph } = require('./graph');
const { criarFonteLocal } = require('./fonteLocal');
const { criarStore } = require('./store');

let ctx = null;
function obter(env = process.env, forcar = false) {
  if (ctx && !forcar) return ctx;
  const cfg = config.ler(env);
  const pend = config.pendencias(cfg);
  if (pend.length) { const e = new Error('Configuração incompleta. Falta preencher: ' + pend.join(', ') + '.'); e.pendencias = pend; throw e; }
  const origem = cfg.modo === 'graph' ? criarGraph(cfg) : criarFonteLocal(cfg.pastaLocal, cfg.profundidade);
  ctx = { cfg, origem, store: criarStore(cfg) };
  return ctx;
}
const reiniciar = () => { ctx = null; };

module.exports = { obter, reiniciar };
