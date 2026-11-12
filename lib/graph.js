'use strict';
/* Conexão com o OneDrive / SharePoint pela Microsoft Graph API (autenticação de aplicativo, sem login de pessoa). */
const BASE = 'https://graph.microsoft.com/v1.0';
const enc = encodeURIComponent;
const codificaCaminho = p => p.split('/').filter(Boolean).map(enc).join('/');

function criarGraph(cfg, deps = {}) {
  const f = deps.fetch || globalThis.fetch;
  const agora = deps.agora || Date.now;
  const esperar = deps.esperar || (ms => new Promise(r => setTimeout(r, ms)));
  let tk = null, expira = 0;

  async function token() {
    if (tk && agora() < expira - 60000) return tk;
    const corpo = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
    const r = await f(`https://login.microsoftonline.com/${enc(cfg.tenant)}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: corpo });
    let j = {}; try { j = await r.json(); } catch (e) { /* resposta sem JSON */ }
    if (!r.ok || !j.access_token) throw new Error('Não foi possível autenticar no Microsoft Entra: ' + (j.error_description || j.error || ('HTTP ' + r.status)).toString().split('\r')[0]);
    tk = j.access_token; expira = agora() + (Number(j.expires_in) || 3600) * 1000;
    return tk;
  }

  function raiz() {
    if (cfg.driveId) return `/drives/${enc(cfg.driveId)}`;
    if (cfg.usuario) return `/users/${enc(cfg.usuario)}/drive`;
    if (cfg.siteId) return `/sites/${enc(cfg.siteId)}/drive`;
    throw new Error('Informe ONEDRIVE_DRIVE_ID, ONEDRIVE_USUARIO ou SHAREPOINT_SITE_ID.');
  }

  /* GET com renovação do token (401) e espera/repetição em limite de uso (429) e erro temporário (5xx) */
  async function pedir(url, { bruto = false } = {}) {
    let ultimo = null;
    for (let t = 0; t < 5; t++) {
      const r = await f(url.startsWith('http') ? url : BASE + url, { headers: { Authorization: 'Bearer ' + await token() } });
      if (r.status === 401 && t === 0) { tk = null; continue; }
      if (r.status === 429 || r.status >= 500) {
        const ra = Number(r.headers.get && r.headers.get('retry-after'));
        ultimo = 'HTTP ' + r.status;
        await esperar((ra > 0 ? ra : Math.pow(2, t)) * 1000);
        continue;
      }
      if (!r.ok) {
        let msg = ''; try { msg = (await r.json()).error.message; } catch (e) { /* sem corpo */ }
        const dica = r.status === 403 ? ' (o aplicativo não tem permissão nesta pasta: veja README-ONEDRIVE.md, passo das permissões)' : r.status === 404 ? ' (pasta ou OneDrive não encontrado: confira ONEDRIVE_PASTA e o ID/e-mail)' : '';
        throw new Error(`Microsoft Graph respondeu ${r.status}: ${msg || 'sem detalhe'}${dica}`);
      }
      return bruto ? r : r.json();
    }
    throw new Error('Microsoft Graph indisponível após várias tentativas (' + ultimo + ').');
  }

  /* Arquivos da pasta (e subpastas até a profundidade dada) */
  /* Com ONEDRIVE_PASTA_ID a pasta é localizada pelo ID (necessário quando o app só tem acesso àquela pasta: não consegue andar pela raiz) */
  async function listar(pasta = cfg.pasta, profundidade = cfg.profundidade === undefined ? 2 : cfg.profundidade, itemId = cfg.pastaId) {
    const itens = [];
    const sel = '?$top=200&$select=id,name,size,eTag,lastModifiedDateTime,file,folder';
    let url = itemId ? `${raiz()}/items/${enc(itemId)}/children${sel}` : pasta ? `${raiz()}/root:/${codificaCaminho(pasta)}:/children${sel}` : `${raiz()}/root/children${sel}`;
    while (url) {
      const j = await pedir(url);
      for (const it of j.value || []) {
        const caminho = (pasta ? pasta + '/' : '') + it.name;
        if (it.folder) { if (profundidade > 0) itens.push(...await listar(caminho, profundidade - 1, itemId ? it.id : undefined)); }
        else if (it.file) itens.push({ id: it.id, nome: it.name, tamanho: it.size || 0, etag: it.eTag || String(it.lastModifiedDateTime || ''), modificado: it.lastModifiedDateTime || null, caminho });
      }
      url = j['@odata.nextLink'] || null;
    }
    return itens;
  }

  async function baixar(item) {
    const r = await pedir(`${raiz()}/items/${enc(item.id)}/content`, { bruto: true });
    return Buffer.from(await r.arrayBuffer());
  }

  /* Usado pelo script de teste: confirma login, acha o OneDrive e a pasta */
  async function diagnostico() {
    await token();
    if (cfg.pastaId) { // acesso restrito à pasta: não dá para consultar o drive inteiro, só a pasta
      const pasta = await pedir(`${raiz()}/items/${enc(cfg.pastaId)}?$select=id,name,webUrl,folder`);
      if (!pasta.folder) throw new Error('O ID informado em ONEDRIVE_PASTA_ID não é uma pasta.');
      return { driveId: cfg.driveId, tipo: 'pasta com acesso restrito (' + pasta.folder.childCount + ' itens)', nome: pasta.name, url: pasta.webUrl };
    }
    const drive = await pedir(`${raiz()}?$select=id,name,driveType,webUrl`);
    return { driveId: drive.id, tipo: drive.driveType, nome: drive.name, url: drive.webUrl };
  }

  return { token, listar, baixar, diagnostico, _raiz: raiz };
}

module.exports = { criarGraph, codificaCaminho };
