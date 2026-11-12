'use strict';
/* Lê as variáveis de ambiente (.env no PC, "Environment Variables" no Vercel). Nada de segredo fica no código. */
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');

function ler(e = process.env) {
  const modo = (e.ONEDRIVE_MODO || (e.AZURE_CLIENT_ID ? 'graph' : 'local')).toLowerCase();
  const dados = e.DADOS_DIR || 'dados';
  return {
    raiz: RAIZ,
    modo,
    pastaLocal: e.ONEDRIVE_PASTA_LOCAL || '',
    tenant: e.AZURE_TENANT_ID || '',
    clientId: e.AZURE_CLIENT_ID || '',
    secret: e.AZURE_CLIENT_SECRET || '',
    driveId: e.ONEDRIVE_DRIVE_ID || '',
    usuario: e.ONEDRIVE_USUARIO || '',
    siteId: e.SHAREPOINT_SITE_ID || '',
    pastaId: e.ONEDRIVE_PASTA_ID || '',
    filtroArquivo: e.ONEDRIVE_ARQUIVO || '',
    profundidade: e.ONEDRIVE_PROFUNDIDADE === undefined || e.ONEDRIVE_PROFUNDIDADE === '' ? 2 : Math.max(0, Number(e.ONEDRIVE_PROFUNDIDADE) || 0),
    pasta: (e.ONEDRIVE_PASTA || '').replace(/^[\\/]+|[\\/]+$/g, '').replace(/\\/g, '/'),
    databaseUrl: e.DATABASE_URL || '',
    dadosDir: path.isAbsolute(dados) ? dados : path.join(RAIZ, dados),
    segredo: e.SYNC_SECRET || e.CRON_SECRET || '',
    intervaloMin: Number(e.SYNC_INTERVALO_MIN) || 0,
    aoIniciar: e.SYNC_AO_INICIAR === '1' || e.SYNC_AO_INICIAR === 'true',
    limiteMs: Number(e.SYNC_LIMITE_MS) || 50000,
    bancoInicio: e.BANCO_INICIO || '2026-01-01',
    porta: Number(e.PORT) || 3000,
    naVercel: !!e.VERCEL
  };
}

/* Lista o que falta preencher para o modo escolhido (mensagens para o usuário, sem expor valores) */
function pendencias(cfg) {
  const p = [];
  if (cfg.modo === 'graph') {
    if (!cfg.tenant) p.push('AZURE_TENANT_ID');
    if (!cfg.clientId) p.push('AZURE_CLIENT_ID');
    if (!cfg.secret) p.push('AZURE_CLIENT_SECRET');
    if (!cfg.driveId && !cfg.usuario && !cfg.siteId) p.push('ONEDRIVE_DRIVE_ID ou ONEDRIVE_USUARIO ou SHAREPOINT_SITE_ID');
    if (cfg.pastaId && !cfg.driveId) p.push('ONEDRIVE_DRIVE_ID (obrigatório junto com ONEDRIVE_PASTA_ID)');
    if (cfg.naVercel && !cfg.databaseUrl) p.push('DATABASE_URL');
  } else if (cfg.modo === 'local') {
    if (!cfg.pastaLocal) p.push('ONEDRIVE_PASTA_LOCAL');
    if (cfg.naVercel) p.push('ONEDRIVE_MODO=graph (o modo local não existe no Vercel)');
  } else p.push('ONEDRIVE_MODO deve ser "graph" ou "local"');
  return p;
}

module.exports = { ler, pendencias, RAIZ };
