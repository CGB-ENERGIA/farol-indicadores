'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarGraph, codificaCaminho } = require('../lib/graph');

const resp = (status, corpo, headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: k => headers[k.toLowerCase()] },
  json: async () => corpo,
  arrayBuffer: async () => Uint8Array.from(Buffer.isBuffer(corpo) ? corpo : Buffer.from(JSON.stringify(corpo))).buffer
});
const cfg = { tenant: 't-1', clientId: 'cid', secret: 'sec', usuario: 'ana@empresa.com.br', pasta: 'SETOR/SIGA Entrada' };

function montar(rotas) {
  const chamadas = [];
  const fetch = async (url, op = {}) => {
    chamadas.push({ url, op });
    const r = rotas(url, op, chamadas);
    if (!r) throw new Error('rota não prevista: ' + url);
    return r;
  };
  return { chamadas, g: criarGraph(cfg, { fetch, esperar: async () => {}, agora: () => 1e12 }) };
}

test('autentica com client credentials e usa o token nas chamadas', async () => {
  const { chamadas, g } = montar(url => url.includes('oauth2/v2.0/token') ? resp(200, { access_token: 'TK', expires_in: 3600 }) : resp(200, { value: [] }));
  await g.listar();
  const t = chamadas[0];
  assert.match(t.url, /login\.microsoftonline\.com\/t-1\/oauth2\/v2\.0\/token/);
  assert.match(String(t.op.body), /grant_type=client_credentials/);
  assert.match(String(t.op.body), /scope=https%3A%2F%2Fgraph\.microsoft\.com%2F\.default/);
  assert.equal(chamadas[1].op.headers.Authorization, 'Bearer TK');
  assert.match(chamadas[1].url, /\/users\/ana%40empresa\.com\.br\/drive\/root:\/SETOR\/SIGA%20Entrada:\/children/);
});

test('o token é reaproveitado entre chamadas', async () => {
  const { chamadas, g } = montar(url => url.includes('oauth2') ? resp(200, { access_token: 'TK', expires_in: 3600 }) : resp(200, { value: [] }));
  await g.listar(); await g.listar();
  assert.equal(chamadas.filter(c => c.url.includes('oauth2')).length, 1);
});

test('lista com paginação e entra em subpastas', async () => {
  const { g } = montar(url => {
    if (url.includes('oauth2')) return resp(200, { access_token: 'TK', expires_in: 3600 });
    if (url.includes('page=2')) return resp(200, { value: [{ id: '3', name: 'MAN_b.xlsx', file: {}, size: 5, eTag: 'x3', lastModifiedDateTime: '2026-11-10T08:00:00Z' }] });
    if (url.includes('Sub')) return resp(200, { value: [{ id: '4', name: 'FIS_c.xlsx', file: {}, size: 7, eTag: 'x4' }] });
    return resp(200, { value: [{ id: '1', name: 'COI_a.xlsx', file: {}, size: 9, eTag: 'x1', lastModifiedDateTime: '2026-11-10T07:00:00Z' }, { id: '2', name: 'Sub', folder: {} }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next?page=2' });
  });
  const it = await g.listar();
  assert.deepEqual(it.map(i => i.nome).sort(), ['COI_a.xlsx', 'FIS_c.xlsx', 'MAN_b.xlsx']);
  assert.equal(it.find(i => i.nome === 'COI_a.xlsx').etag, 'x1');
  assert.equal(it.find(i => i.nome === 'FIS_c.xlsx').caminho, 'SETOR/SIGA Entrada/Sub/FIS_c.xlsx');
});

test('tenta de novo em limite de uso (429) e erro temporário', async () => {
  let n = 0;
  const { g } = montar(url => {
    if (url.includes('oauth2')) return resp(200, { access_token: 'TK', expires_in: 3600 });
    n++; return n === 1 ? resp(429, {}, { 'retry-after': '1' }) : n === 2 ? resp(503, {}) : resp(200, { value: [] });
  });
  assert.deepEqual(await g.listar(), []);
  assert.equal(n, 3);
});

test('renova o token quando vem 401', async () => {
  let tokens = 0, n = 0;
  const { g } = montar(url => {
    if (url.includes('oauth2')) { tokens++; return resp(200, { access_token: 'TK' + tokens, expires_in: 3600 }); }
    n++; return n === 1 ? resp(401, {}) : resp(200, { value: [] });
  });
  await g.listar(); assert.equal(tokens, 2);
});

test('erros têm mensagem clara (sem permissão e pasta inexistente)', async () => {
  const base = u => u.includes('oauth2') ? resp(200, { access_token: 'TK', expires_in: 3600 }) : null;
  await assert.rejects(montar(u => base(u) || resp(403, { error: { message: 'Access denied' } })).g.listar(), /403.*permissão/s);
  await assert.rejects(montar(u => base(u) || resp(404, { error: { message: 'Item not found' } })).g.listar(), /404.*ONEDRIVE_PASTA/s);
});

test('falha de login mostra o motivo e não vaza o segredo', async () => {
  const { g } = montar(() => resp(401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' }));
  await assert.rejects(g.listar(), e => /AADSTS7000215/.test(e.message) && !/sec\b/.test(e.message.replace('secret', '')));
});

test('baixa o conteúdo do arquivo', async () => {
  const { chamadas, g } = montar(url => url.includes('oauth2') ? resp(200, { access_token: 'TK', expires_in: 3600 }) : resp(200, Buffer.from('conteudo')));
  const b = await g.baixar({ id: 'ABC!1' });
  assert.equal(b.toString(), 'conteudo');
  assert.match(chamadas[1].url, /\/items\/ABC!1\/content$/);
});

test('codifica caminhos com espaço e acento', () => {
  assert.equal(codificaCaminho('SETOR DE MEDIÇÃO/SIGA'), 'SETOR%20DE%20MEDI%C3%87%C3%83O/SIGA');
});

/* ---------- acesso restrito a uma pasta (ONEDRIVE_PASTA_ID) ---------- */
const cfgPasta = { tenant: 't-1', clientId: 'cid', secret: 'sec', driveId: 'b!drive', pastaId: 'PASTA1', pasta: '' };
function montarPasta(rotas) {
  const chamadas = [];
  const fetch = async (url, op = {}) => { chamadas.push(url); const r = rotas(url); if (!r) throw new Error('rota não prevista: ' + url); return r; };
  return { chamadas, g: criarGraph(cfgPasta, { fetch, esperar: async () => {}, agora: () => 1e12 }) };
}

test('com ONEDRIVE_PASTA_ID lista pelo ID da pasta e entra nas subpastas pelo ID (nunca pela raiz)', async () => {
  const { chamadas, g } = montarPasta(url => {
    if (url.includes('oauth2')) return resp(200, { access_token: 'TK', expires_in: 3600 });
    if (url.includes('/items/SUB1/children')) return resp(200, { value: [{ id: 'f2', name: 'FIS_b.xlsx', file: {}, size: 2, eTag: 'x2' }] });
    if (url.includes('/items/PASTA1/children')) return resp(200, { value: [{ id: 'f1', name: 'COI_a.xlsx', file: {}, size: 1, eTag: 'x1' }, { id: 'SUB1', name: '04.2026', folder: {} }] });
    return null;
  });
  const it = await g.listar();
  assert.deepEqual(it.map(i => i.nome).sort(), ['COI_a.xlsx', 'FIS_b.xlsx']);
  assert.equal(it.find(i => i.nome === 'FIS_b.xlsx').caminho, '04.2026/FIS_b.xlsx');
  const graph = chamadas.filter(u => !u.includes('oauth2'));
  assert.ok(graph.every(u => /\/drives\/b!drive\/items\/(PASTA1|SUB1)\/children/.test(decodeURIComponent(u))), 'só pode consultar a pasta liberada');
  assert.ok(!graph.some(u => u.includes('/root')), 'não pode tocar na raiz do drive');
});

test('diagnóstico com pasta restrita consulta só a pasta e recusa ID que não é pasta', async () => {
  const ok = montarPasta(u => u.includes('oauth2') ? resp(200, { access_token: 'TK', expires_in: 3600 }) : resp(200, { id: 'PASTA1', name: 'SETOR DE MEDIÇÃO', webUrl: 'https://x/y', folder: { childCount: 12 } }));
  const d = await ok.g.diagnostico();
  assert.equal(d.nome, 'SETOR DE MEDIÇÃO'); assert.match(d.tipo, /restrito.*12/);
  assert.ok(!ok.chamadas.some(u => /\/drives\/b!drive\?/.test(decodeURIComponent(u))), 'não pode consultar o drive inteiro');
  const arq = montarPasta(u => u.includes('oauth2') ? resp(200, { access_token: 'TK', expires_in: 3600 }) : resp(200, { id: 'X', name: 'a.xlsx', file: {} }));
  await assert.rejects(arq.g.diagnostico(), /não é uma pasta/);
});

test('configuração: ONEDRIVE_PASTA_ID exige ONEDRIVE_DRIVE_ID', () => {
  const { ler, pendencias } = require('../lib/config');
  const base = { ONEDRIVE_MODO: 'graph', AZURE_TENANT_ID: 't', AZURE_CLIENT_ID: 'c', AZURE_CLIENT_SECRET: 's', ONEDRIVE_USUARIO: 'a@b.c' };
  assert.deepEqual(pendencias(ler({ ...base, ONEDRIVE_PASTA_ID: 'P' })), ['ONEDRIVE_DRIVE_ID (obrigatório junto com ONEDRIVE_PASTA_ID)']);
  assert.deepEqual(pendencias(ler({ ...base, ONEDRIVE_PASTA_ID: 'P', ONEDRIVE_DRIVE_ID: 'D' })), []);
});
