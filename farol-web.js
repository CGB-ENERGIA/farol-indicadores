/* Farol na web (Vercel): login + adaptador que imita claude.use('db' | 'user' | 'downloads').
   O resto do site continua igual: ele pensa que fala com o banco do artefato, mas aqui os dados vão para /api/* (Neon).
   Carregue este arquivo ANTES do script principal do index.html. */
(function () {
  'use strict';
  window.FAROL_WEB = true;
  var API = '/api/', sessao = null, resolver;
  var pronto = new Promise(function (r) { resolver = r; });
  var ARQ = /^(config|ader_config|def_config|ini_config|prod_config|ups_config|ups_semclasse|historico(_[a-z]+)?)\.json$/;

  /* ---------- chamadas à API ---------- */
  function api(caminho, opc) {
    opc = opc || {};
    var init = { method: opc.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opc.body !== undefined) { init.body = JSON.stringify(opc.body); init.headers['Content-Type'] = 'application/json'; }
    return fetch0(API + caminho, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && sessao) { sessao = null; mostrarLogin({ aviso: { tipo: 'pend', titulo: 'Sessão expirada', texto: 'Sua sessão expirou. Entre novamente para continuar.' } }); }
        if (!r.ok) { var e = new Error(j.erro || ('Erro ' + r.status)); e.status = r.status; e.dados = j; e.code = r.status === 403 ? 'permission_denied' : r.status === 400 || r.status === 413 ? 'invalid_argument' : 'unavailable'; throw e; }
        return j;
      });
    });
  }
  var fetch0 = window.fetch.bind(window);
  /* os .json de dados só saem para quem fez login */
  window.fetch = function (u, o) {
    if (typeof u === 'string' && ARQ.test(u)) return pronto.then(function () { return fetch0(API + 'arquivo?nome=' + u, { credentials: 'same-origin' }); });
    return fetch0(u, o);
  };

  /* ---------- banco (imita Firestore) ---------- */
  var colecoes = {};
  function colecao(c) {
    if (colecoes[c]) return colecoes[c];
    var docs = new Map(), cur = null, ouvintes = [], timer = null, carregou = false;
    function snap() {
      var lista = Array.from(docs.entries()).map(function (kv) { return { id: kv[0], exists: true, data: function () { return kv[1]; } }; });
      return { metadata: { fromCache: false }, docs: lista, size: lista.length, forEach: function (f) { lista.forEach(f); } };
    }
    function avisar() { var s = snap(); ouvintes.forEach(function (o) { try { o.ok(s); } catch (e) { console.error(e); } }); }
    function puxar() {
      var mudou = false;
      function pagina() {
        var url = 'doc?c=' + c + (cur ? '&a=' + encodeURIComponent(cur.a) + '&i=' + encodeURIComponent(cur.i) : '');
        return api(url).then(function (r) {
          (r.docs || []).forEach(function (d) { docs.set(d.id, d.dados); mudou = true; cur = { a: d.atualizado, i: d.id }; });
          return r.proximo ? pagina() : null;
        });
      }
      return pagina().then(function () { carregou = true; return mudou; });
    }
    var obj = {
      doc: function (id) {
        id = String(id);
        return {
          id: id,
          get: function () { return api('doc?c=' + c + '&id=' + encodeURIComponent(id)).then(function (r) { return { exists: !!r.existe, id: id, data: function () { return r.dados; } }; }); },
          set: function (d) { return api('doc?c=' + c, { method: 'POST', body: { id: id, dados: d } }).then(function () { docs.set(id, JSON.parse(JSON.stringify(d))); if (carregou) avisar(); }); },
          delete: function () { return api('doc?c=' + c + '&id=' + encodeURIComponent(id), { method: 'DELETE' }).then(function () { docs.delete(id); if (carregou) avisar(); }); }
        };
      },
      onSnapshot: function (ok, erro) {
        ouvintes.push({ ok: ok });
        if (carregou) { ok(snap()); }
        else puxar().then(function () { avisar(); }).catch(function (e) { if (erro) erro(e); });
        if (!timer) timer = setInterval(function () { if (!sessao || document.hidden) return; puxar().then(function (m) { if (m) avisar(); }).catch(function () {}); }, 20000);
        return function () { ouvintes = ouvintes.filter(function (o) { return o.ok !== ok; }); };
      }
    };
    colecoes[c] = obj;
    return obj;
  }

  /* ---------- window.claude ---------- */
  window.claude = {
    use: function (nome) {
      return pronto.then(function () {
        if (nome === 'db') return { collection: colecao };
        if (nome === 'user') return { canEdit: function () { return Promise.resolve(!!sessao.pode_editar); }, nome: sessao.nome, nivel: sessao.nivel };
        if (nome === 'downloads') return {
          save: function (o) {
            return new Promise(function (res) {
              var b = new Blob([o.data], { type: o.type || 'application/octet-stream' }), a = document.createElement('a');
              a.href = URL.createObjectURL(b); a.download = o.filename || 'arquivo'; document.body.appendChild(a); a.click();
              setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); res(); }, 500);
            });
          }
        };
        return null;
      });
    }
  };

  /* ---------- tela de login e barra do usuário ---------- */
  var CSS = '.fw-ov{position:fixed;inset:0;z-index:2000;display:grid;place-items:center;padding:16px;background:linear-gradient(135deg,#711424,#4a0b16);font-family:"Plus Jakarta Sans",Arial,sans-serif}' +
    '.fw-card{background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.35);padding:28px;width:min(380px,100%);display:grid;gap:12px}' +
    '.fw-card h1{margin:0;font-size:22px;font-weight:800;color:#711424;font-style:italic}.fw-card p{margin:0;color:#6b6a6a;font-size:13px}' +
    '.fw-card label{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b6a6a;display:grid;gap:4px}' +
    '.fw-card input,.fw-card select{border:1px solid #dedadb;border-radius:9px;padding:9px 10px;font:inherit;min-height:40px;width:100%;box-sizing:border-box}' +
    '.fw-btn{border:1px solid #dedadb;background:#fff;border-radius:9px;padding:8px 14px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit}.fw-btn:hover{border-color:#711424;color:#711424}' +
    '.fw-btn.pri{background:#711424;border-color:#711424;color:#fff}.fw-btn.pri:hover{background:#4a0b16;color:#fff}.fw-btn:disabled{opacity:.5}' +
    '.fw-err{background:#fbe5e5;color:#c00000;border-radius:9px;padding:8px 12px;font-size:13px}.fw-ok{background:#e3f3dc;color:#2b7a0f;border-radius:9px;padding:8px 12px;font-size:13px}' +
    '.fw-bar{position:fixed;right:12px;bottom:12px;z-index:1500;background:#fff;border:1px solid #dedadb;border-radius:999px;box-shadow:0 4px 16px rgba(0,0,0,.15);padding:6px 8px 6px 14px;display:flex;gap:6px;align-items:center;font:600 12px "Plus Jakarta Sans",Arial,sans-serif;color:#2b2a2a}' +
    '.fw-bar small{color:#6b6a6a;font-weight:600}.fw-bar .fw-btn{padding:4px 10px;font-size:12px;border-radius:999px}' +
    '.fw-wide{width:min(760px,100%)!important;max-height:90vh;overflow:auto}.fw-t{border-collapse:collapse;width:100%;font-size:13px}.fw-t th,.fw-t td{padding:6px 8px;border-top:1px solid #eee;text-align:left}.fw-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;align-items:end}';
  function el(h) { var d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function estilo() { if (document.getElementById('fw-css')) return; var s = document.createElement('style'); s.id = 'fw-css'; s.textContent = CSS; document.head.appendChild(s); }
  function fechar(sel) { var x = document.querySelector(sel); if (x) x.remove(); }

  /* ======================================================================
     TELA DE LOGIN: mesma identidade visual do Gerenciador de Equipes
     (cabeçalho, faixa lateral vinho, cartão com halo e fundo animado "plexus")
     ====================================================================== */
  var ICO = {
    badge: 'M20 7h-5V4c0-1.1-.9-2-2-2h-2c-1.1 0-2 .9-2 2v3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zM9 12c.83 0 1.5.67 1.5 1.5S9.83 15 9 15s-1.5-.67-1.5-1.5S8.17 12 9 12zm3 6H6v-.75c0-1 2-1.5 3-1.5s3 .5 3 1.5V18zm1-9h-2V4h2v5zm5 7.5h-4V15h4v1.5zm0-3h-4V12h4v1.5z',
    key: 'M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z',
    eye: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z',
    eyeoff: 'M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z',
    shield: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z',
    lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z',
    fwd: 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z',
    back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    ok: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
    err: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
    info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
    close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    person: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
    tag: 'M20 10V8h-4V4h-2v4h-4V4H8v4H4v2h4v4H4v2h4v4h2v-4h4v4h2v-4h4v-2h-4v-4h4zm-6 4h-4v-4h4v4z',
    apt: 'M17 11V3H7v4H3v14h8v-4h2v4h8V11h-4zM7 19H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5V9h2v2zm4 4H9v-2h2v2zm0-4H9V9h2v2zm0-4H9V5h2v2zm4 8h-2v-2h2v2zm0-4h-2V9h2v2zm0-4h-2V5h2v2zm4 12h-2v-2h2v2zm0-4h-2v-2h2v2z'
  };
  function svg(n, t) { return '<svg class="fl-i" viewBox="0 0 24 24" width="' + (t || 20) + '" height="' + (t || 20) + '" fill="currentColor" aria-hidden="true"><path d="' + ICO[n] + '"/></svg>'; }

  var LCSS = ':root{--marca:#711424;--marca-clara:#8d2136;--titulo:#4f1723;--fundo:#f2eeef;--tinta:#2d2527;--tinta-fraca:#6d5f63;--linha:rgba(113,20,36,.16);--positivo:#1b6b45;--negativo:#b3261e;--sombra:0 1px 3px rgba(65,32,38,.1),0 6px 14px rgba(65,32,38,.1),0 16px 36px rgba(65,32,38,.12)}' +
    '.fl-tela{position:fixed;inset:0;z-index:2000;overflow:auto;background:var(--fundo);color:var(--tinta);font-family:Inter,"Segoe UI",sans-serif;display:flex;flex-direction:column}' +
    '.fl-cab{display:flex;align-items:center;gap:12px;min-height:50px;padding:4px 16px;background:rgba(255,255,255,.85);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--linha);position:relative;z-index:3}' +
    '.fl-cab img{height:34px;width:auto}.fl-cab-t{font-weight:800;font-size:1.05rem;letter-spacing:-.01em;color:var(--titulo);line-height:1.2}.fl-cab-s{font-weight:500;font-size:.7rem;letter-spacing:.02em;color:var(--tinta-fraca);text-transform:uppercase}.fl-cab-m{flex:1;min-width:0}' +
    '.fl-selo{display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:rgba(27,107,69,.1);color:var(--positivo);font-size:.7rem;font-weight:600;border:1px solid rgba(27,107,69,.2)}.fl-selo i{width:7px;height:7px;border-radius:50%;background:currentColor;animation:fl-p 2s ease-in-out infinite}' +
    '.fl-selo.off{background:rgba(179,38,30,.1);color:var(--negativo);border-color:rgba(179,38,30,.2)}.fl-selo.off i{animation:none}@keyframes fl-p{0%,100%{opacity:1}50%{opacity:.35}}' +
    '.fl-grid{flex:1;display:grid;grid-template-columns:1fr;grid-template-rows:auto 1fr;min-height:0}@media(min-width:900px){.fl-grid{grid-template-columns:minmax(340px,38%) 1fr;grid-template-rows:1fr}}' +
    '.fl-faixa{position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;gap:32px;padding:40px 44px;background:linear-gradient(160deg,#4e0b17 0%,#711424 50%,#a8304a 100%);color:#fff}' +
    '.fl-marca{position:absolute;right:-22%;bottom:-14%;width:78%;aspect-ratio:1;background:url(icons/logo-fundo.png) center/contain no-repeat;filter:brightness(0) invert(1);opacity:.07;pointer-events:none}' +
    '.fl-logo{position:relative;width:168px;max-width:60%;height:auto}.fl-msg{position:relative;display:flex;flex-direction:column;gap:18px}' +
    '.fl-rod{position:relative;font-size:.72rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.6)}' +
    '.fl-sel{display:inline-flex;align-items:center;gap:8px;width:fit-content;padding:6px 14px;border-radius:999px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.28);color:#fff;font-weight:600;font-size:.75rem}' +
    '.fl-hero{font-weight:800;font-size:clamp(2.6rem,4.2vw,3.8rem);line-height:1.12;letter-spacing:-.01em;color:#fff;margin:0}.fl-hero span{white-space:nowrap;color:#ffd6e0}' +
    '.fl-tx{font-size:.95rem;line-height:1.6;color:rgba(255,255,255,.78);max-width:36ch;margin:0}' +
    '@media(max-width:899px){.fl-faixa{padding:18px 20px;gap:0}.fl-msg,.fl-rod{display:none}.fl-logo{width:112px}.fl-marca{width:40%;right:-6%;bottom:-60%}}' +
    '.fl-area{position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;padding:24px 16px;min-height:0}.fl-cv{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0}' +
    '.fl-cont{position:relative;z-index:1;width:100%;max-width:420px;padding:24px 0}.fl-halo{position:relative;width:100%;max-width:399px;margin:0 auto}' +
    '.fl-halo:before{content:"";position:absolute;inset:-34px;z-index:0;background:radial-gradient(closest-side,rgba(213,77,110,.3),rgba(150,27,56,.12) 55%,transparent 75%);filter:blur(26px);pointer-events:none}' +
    '.fl-cartao{position:relative;z-index:1;width:100%;overflow:hidden;box-sizing:border-box;background:rgba(255,255,255,.88);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(0,0,0,.12);border-radius:4px;box-shadow:0 30px 60px -15px rgba(37,4,13,.45),0 12px 24px -8px rgba(37,4,13,.3)}' +
    '.fl-faixat{position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,var(--marca) 0%,var(--marca-clara) 50%,#e57c94 100%)}.fl-sec{padding:16px}.fl-sec.topo{text-align:center;padding-bottom:0;padding-top:20px}' +
    '.fl-sec.topo img{height:56px;width:auto;margin-bottom:8px}.fl-h6{font-size:1.25rem;font-weight:700;line-height:2rem;letter-spacing:.0125em;color:var(--titulo)}.fl-cap{font-size:.75rem;color:#757575;line-height:1.25rem;letter-spacing:.03333em}' +
    '.fl-campo{position:relative;margin-bottom:16px}div.fl-campo input,div.fl-campo select{width:100%;box-sizing:border-box;height:40px;border:1px solid rgba(0,0,0,.24);border-radius:4px;padding:0 12px 0 40px;font:inherit;font-size:1rem;color:var(--tinta);background:transparent;outline:0;transition:border-color .15s}' +
    '.fl-campo input.sem-ico{padding-left:12px}.fl-campo input:hover{border-color:rgba(0,0,0,.87)}.fl-campo input:focus{border:2px solid var(--marca);padding-left:39px}.fl-campo input.sem-ico:focus{padding-left:11px}' +
    '.fl-campo label{position:absolute;left:40px;top:10px;font-size:1rem;color:rgba(0,0,0,.6);pointer-events:none;transition:all .15s;background:transparent;padding:0 4px;margin-left:-4px}' +
    '.fl-campo input.sem-ico~label{left:12px}.fl-campo input:focus~label,.fl-campo input:not(:placeholder-shown)~label{top:-8px;font-size:.75rem;background:#fff;color:rgba(0,0,0,.6)}.fl-campo input:focus~label{color:var(--marca)}' +
    '.fl-campo .pre{position:absolute;left:10px;top:10px;color:rgba(0,0,0,.54);display:flex}.fl-campo .pos{position:absolute;right:8px;top:8px;color:rgba(0,0,0,.54);cursor:pointer;display:flex;background:0;border:0;padding:0}' +
    '.fl-campo .aj{font-size:.75rem;color:#757575;margin:3px 0 0 12px;line-height:1.2}' +
    '.fl-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:36px;padding:4px 16px;border:0;border-radius:4px;background:var(--marca);color:#fff;font:inherit;font-weight:700;font-size:.875rem;letter-spacing:.0892857em;text-transform:uppercase;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,.2),0 2px 2px rgba(0,0,0,.14),0 3px 1px -2px rgba(0,0,0,.12)}' +
    '.fl-btn:hover:not(:disabled){background:#5d0f1d}.fl-btn:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}.fl-btn.plano{background:transparent;color:var(--marca);box-shadow:none}.fl-btn.plano:hover:not(:disabled){background:rgba(113,20,36,.08)}' +
    '.fl-link{font-size:.75rem;font-weight:600;color:var(--marca-clara);text-decoration:none;cursor:pointer;background:0;border:0;padding:0;font-family:inherit}.fl-link:hover{text-decoration:underline}.fl-dir{text-align:right;margin:-4px 0 16px}' +
    '.fl-primeiro{margin-top:18px;padding-top:14px;border-top:1px solid rgba(0,0,0,.12);text-align:center;font-size:.8125rem;color:var(--tinta-fraca);line-height:1.5}.fl-primeiro .fl-link{font-size:.8125rem}' +
    '.fl-aviso{display:flex;align-items:flex-start;gap:12px;padding:14px;border-radius:12px;margin-bottom:16px;font-size:.9rem;line-height:1.4}.fl-aviso b{display:block;font-size:1.05rem;margin-bottom:2px}' +
    '.fl-aviso.erro{background:rgba(179,38,30,.08);border:1px solid rgba(179,38,30,.35);color:var(--negativo)}.fl-aviso.pend{background:#fff3e0;border:1px solid #ffcc80;color:#a15c00}.fl-aviso.ok{background:rgba(27,107,69,.08);border:1px solid rgba(27,107,69,.3);color:var(--positivo)}.fl-aviso svg{flex:none}' +
    '.fl-tst{position:fixed;top:64px;right:16px;z-index:3000;display:flex;flex-direction:column;gap:10px;max-width:min(92vw,420px)}' +
    '.fl-t{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:12px;background:rgba(255,255,255,.92);backdrop-filter:blur(10px);box-shadow:var(--sombra);border:1px solid var(--linha);font-size:.95rem;font-weight:600;color:var(--tinta);animation:fl-in .25s ease}.fl-t span{flex:1}.fl-t.sucesso{border-color:rgba(27,107,69,.3);color:var(--positivo)}.fl-t.erro{border-color:rgba(179,38,30,.3);color:var(--negativo)}.fl-t button{background:0;border:0;color:inherit;cursor:pointer;display:flex;padding:2px}' +
    '@keyframes fl-in{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}';

  function estiloLogin() {
    if (document.getElementById('fl-css')) return;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'; document.head.appendChild(l);
    var s = document.createElement('style'); s.id = 'fl-css'; s.textContent = LCSS; document.head.appendChild(s);
  }

  /* ---------- fundo animado (rede de pontos + losangos), igual ao gerenciador ---------- */
  function fundoAnimado(area, canvas) {
    var ctx = canvas.getContext('2d'), F = 2.5, N = Math.round(220 + Math.random() * 140), D = 140 + Math.random() * 60, REF = 1366 * 768;
    var pts = [], parts = [], t = 0, rodando = true, raf = null;
    var tiles = [[-1, -1, '#8E1834'], [0, -1, '#6B1025'], [1, -1, '#7D132C'], [-1, 0, '#9F1C3C'], [1, 0, '#7D132C'], [-1, 1, '#8E1834'], [0, 1, '#5D0C1E'], [1, 1, '#6B1025']];
    function ponto(w, h, dest) { var a = Math.random() * Math.PI * 2, v = dest ? .12 + Math.random() * .1 : .06 + Math.random() * .14; return { x: Math.random() * w, y: Math.random() * h, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: dest ? 2.6 + Math.random() : 1.3 + Math.random(), p: Math.random() * 6.283, d: dest }; }
    function medir() {
      var w = Math.round(area.clientWidth || innerWidth), h = Math.round(area.clientHeight || innerHeight);
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w; canvas.height = h;
      var q = Math.max(40, Math.round(N * Math.min(1, w * h / REF)));
      pts = []; for (var i = 0; i < q; i++) pts.push(ponto(w, h, i % 7 === 0));
      parts = []; for (var k = 0; k < 26; k++) parts.push({ x: Math.random() * w, y: Math.random() * h, e: Math.random() * .16 + .06, v: Math.random() * .5 + .2, o: Math.random() * .25 + .08, p: Math.random() * 3.14 });
    }
    function losango(cx, cy, e, o, rot) {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.globalAlpha = o; var tam = 24 * e, esp = 26 * e;
      tiles.forEach(function (l) { ctx.fillStyle = l[2]; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(l[0] * esp - tam / 2, l[1] * esp - tam / 2, tam, tam, 2 * e); else ctx.rect(l[0] * esp - tam / 2, l[1] * esp - tam / 2, tam, tam); ctx.fill(); });
      ctx.restore();
    }
    function quadro() {
      if (!rodando) return; var w = canvas.width, h = canvas.height; t += .008 * F; ctx.clearRect(0, 0, w, h);
      pts.forEach(function (p) { p.x += p.vx * F; p.y += p.vy * F; p.p += .02 * F; if (p.x < 0 || p.x > w) p.vx *= -1; if (p.y < 0 || p.y > h) p.vy *= -1; p.x = Math.min(Math.max(p.x, 0), w); p.y = Math.min(Math.max(p.y, 0), h); });
      for (var i = 0; i < pts.length; i++) for (var j = i + 1; j < pts.length; j++) {
        var a = pts[i], b = pts[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d < D) { ctx.strokeStyle = 'rgba(213,77,110,' + ((1 - d / D) * .45).toFixed(3) + ')'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      }
      pts.forEach(function (p) {
        var cor = p.d ? '255,214,224' : '229,124,148', op = p.d ? .7 + Math.sin(p.p) * .25 : .35 + Math.sin(p.p) * .15;
        ctx.save(); ctx.shadowColor = 'rgba(' + cor + ',.9)'; ctx.shadowBlur = p.d ? 8 : 3; ctx.fillStyle = 'rgba(' + cor + ',' + Math.max(.15, op).toFixed(3) + ')'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill(); ctx.restore();
      });
      parts.forEach(function (p, i) {
        var ang = -.55 + Math.sin(t + i) * .15; p.x += Math.cos(ang) * p.v * F; p.y += Math.sin(ang) * p.v * F; p.p += .02 * F;
        if (p.x > w + 120 || p.y > h + 120 || p.x < -120 || p.y < -120) { p.x = Math.random() * w * .8 - 100; p.y = -80; }
        losango(p.x, p.y, p.e, Math.max(.02, p.o + Math.sin(p.p) * .04), ang + Math.PI / 4);
      });
      raf = requestAnimationFrame(quadro);
    }
    function vis() { if (document.hidden) { rodando = false; if (raf) cancelAnimationFrame(raf); } else if (!rodando) { rodando = true; raf = requestAnimationFrame(quadro); } }
    medir(); addEventListener('resize', medir); document.addEventListener('visibilitychange', vis); raf = requestAnimationFrame(quadro);
    return function parar() { rodando = false; if (raf) cancelAnimationFrame(raf); removeEventListener('resize', medir); document.removeEventListener('visibilitychange', vis); };
  }

  var pararFundo = null;
  function fecharLogin() { if (pararFundo) { pararFundo(); pararFundo = null; } fechar('#fw-login'); }

  function mostrarLogin(opc) {
    opc = opc || {}; estilo(); estiloLogin(); fechar('.fw-bar'); fecharLogin();
    var modo = 'login', bloqueado = '', semUsuarios = !!opc.semUsuarios, aviso = opc.aviso || null, mostrarSenha = false;
    var tela = el('<div class="fl-tela" id="fw-login"><header class="fl-cab"><img src="icons/logo-login.png" alt="CGB Energia"><div class="fl-cab-m"><div class="fl-cab-t">Central de Indicadores</div><div class="fl-cab-s">CGB Energia</div></div>' +
      '<div class="fl-selo" id="fl-st"><i></i><span>Verificando…</span></div></header><div class="fl-grid">' +
      '<aside class="fl-faixa"><div class="fl-marca"></div><img class="fl-logo" src="icons/logo-cabecalho.png" alt="CGB Energia"><div class="fl-msg"><div class="fl-sel">' + svg('shield', 16) + 'Acesso restrito às equipes autorizadas</div>' +
      '<h1 class="fl-hero">Central de<br><span>Indicadores</span></h1><p class="fl-tx">Acompanhe disponibilidade, UPS, aderência e demais indicadores da operação em um só lugar.</p></div><div class="fl-rod">CGB Energia</div></aside>' +
      '<section class="fl-area"><canvas class="fl-cv"></canvas><div class="fl-cont"><div class="fl-halo"><div class="fl-cartao"><div class="fl-faixat"></div><div id="fl-corpo"></div></div></div></div></section></div><div class="fl-tst"></div></div>');
    document.body.appendChild(tela);
    pararFundo = fundoAnimado(tela.querySelector('.fl-area'), tela.querySelector('.fl-cv'));
    fetch0(API + 'status').then(function (r) { return r.ok; }, function () { return false; }).then(function (ok) { var s = tela.querySelector('#fl-st'); s.classList.toggle('off', !ok); s.querySelector('span').textContent = ok ? 'Sistema online' : 'Sem conexão'; });

    function toast(txt, tipo) {
      var d = el('<div class="fl-t ' + (tipo || '') + '">' + svg(tipo === 'sucesso' ? 'ok' : tipo === 'erro' ? 'err' : 'info', 24) + '<span>' + esc(txt) + '</span><button aria-label="Fechar">' + svg('close', 18) + '</button></div>');
      tela.querySelector('.fl-tst').appendChild(d); var rm = function () { d.remove(); }; d.querySelector('button').onclick = rm; setTimeout(rm, tipo === 'erro' ? 6000 : 4000);
    }
    function campo(id, rotulo, icone, extra) {
      extra = extra || {};
      return '<div class="fl-campo"><span class="pre">' + svg(icone) + '</span><input id="' + id + '" placeholder=" " ' + (extra.attr || '') + '><label for="' + id + '">' + rotulo + '</label>' + (extra.olho ? '<button type="button" class="pos" data-olho aria-label="Mostrar ou ocultar a senha">' + svg(mostrarSenha ? 'eyeoff' : 'eye') + '</button>' : '') + (extra.aj ? '<div class="aj">' + extra.aj + '</div>' : '') + '</div>';
    }
    var corpo = tela.querySelector('#fl-corpo');
    function render() {
      var h = '';
      if (modo === 'login') {
        h = '<div class="fl-sec topo"><img src="icons/logo-login.png" alt="CGB Energia"><div class="fl-h6">Entrar no sistema</div><div class="fl-cap">Entre com o seu usuário para continuar</div></div><div class="fl-sec">' +
          (semUsuarios ? '<div class="fl-aviso erro">' + svg('err', 24) + '<div>Ainda não há usuários. Crie o administrador no computador com <b style="display:inline">npm run criar-admin</b> (veja o DEPLOY.md).</div></div>' : '') +
          (aviso ? '<div class="fl-aviso ' + aviso.tipo + '">' + svg(aviso.tipo === 'ok' ? 'ok' : aviso.tipo === 'pend' ? 'info' : 'lock', 28) + '<div><b>' + esc(aviso.titulo) + '</b>' + esc(aviso.texto) + '</div></div>' : '') +
          '<form id="fl-form" novalidate>' + campo('fl-u', 'Usuário', 'badge', { attr: 'autocomplete="username" autofocus' }) + campo('fl-s', 'Senha', 'key', { attr: 'autocomplete="current-password" type="' + (mostrarSenha ? 'text' : 'password') + '"', olho: 1 }) +
          '<div class="fl-dir"><button type="button" class="fl-link" data-ir="recuperar">Esqueceu a senha?</button></div><button class="fl-btn" type="submit" id="fl-ent" disabled>Login ' + svg('fwd', 18) + '</button></form>' +
          '<div class="fl-primeiro">Primeiro acesso?<br><button type="button" class="fl-link" data-ir="cadastro">Solicite seu cadastro aqui</button></div></div>';
      } else if (modo === 'recuperar') {
        h = '<div class="fl-sec topo"><img src="icons/logo-login.png" alt="CGB Energia"><div class="fl-h6">Recuperar acesso</div><div class="fl-cap">Veja como redefinir sua senha</div></div><div class="fl-sec"><p style="font-size:.875rem;color:#616161;line-height:1.5;margin:0 0 16px">Ainda não existe redefinição automática por e-mail neste sistema. Procure o Administrador da Central de Indicadores para redefinir a sua senha.</p><button class="fl-btn plano" data-ir="login">' + svg('back', 18) + 'Voltar para o login</button></div>';
      } else {
        h = '<div class="fl-sec topo"><img src="icons/logo-login.png" alt="CGB Energia"><div class="fl-h6">Primeiro acesso</div><div class="fl-cap">Preencha seus dados. Um administrador vai aprovar o seu acesso.</div></div><div class="fl-sec">' +
          '<form id="fl-cad" novalidate>' + campo('fc-n', 'Nome completo', 'person', { attr: 'autocomplete="name"' }) + campo('fc-m', 'Matrícula', 'tag', { attr: 'inputmode="numeric" maxlength="10" autocomplete="off"' }) + campo('fc-set', 'Setor', 'apt', { attr: 'autocomplete="organization-title"' }) +
          campo('fc-u', 'Usuário', 'badge', { attr: 'autocomplete="username" maxlength="40" autocapitalize="none" spellcheck="false"', aj: 'Use o formato do seu e-mail corporativo (antes do @), exemplo: <b>joao.silva</b>' }) +
          campo('fc-s', 'Crie uma senha (mínimo 8 caracteres)', 'key', { attr: 'autocomplete="new-password" type="' + (mostrarSenha ? 'text' : 'password') + '"', olho: 1 }) + campo('fc-s2', 'Repita a senha', 'key', { attr: 'autocomplete="new-password" type="' + (mostrarSenha ? 'text' : 'password') + '"' }) +
          '<button class="fl-btn" type="submit" id="fc-env">Enviar cadastro ' + svg('fwd', 18) + '</button></form><div style="margin-top:12px"><button class="fl-btn plano" data-ir="login">' + svg('back', 18) + 'Voltar para o login</button></div></div>';
      }
      corpo.innerHTML = h; ligar();
    }
    function ir(m, av) { modo = m; aviso = av || null; render(); }
    function ligar() {
      corpo.querySelectorAll('[data-ir]').forEach(function (b) { b.onclick = function () { ir(b.getAttribute('data-ir')); }; });
      corpo.querySelectorAll('[data-olho]').forEach(function (b) { b.onclick = function () { mostrarSenha = !mostrarSenha; corpo.querySelectorAll('input[autocomplete$="password"]').forEach(function (i) { i.type = mostrarSenha ? 'text' : 'password'; }); b.innerHTML = svg(mostrarSenha ? 'eyeoff' : 'eye'); }; });
      var f = corpo.querySelector('#fl-form');
      if (f) {
        var u = f.querySelector('#fl-u'), s = f.querySelector('#fl-s'), b = f.querySelector('#fl-ent');
        var hab = function () { b.disabled = !u.value.trim() || !s.value; }; u.oninput = s.oninput = hab; setTimeout(function () { u.focus(); hab(); }, 50);
        f.onsubmit = function (ev) {
          ev.preventDefault(); if (b.disabled) return; b.disabled = true;
          api('login', { method: 'POST', body: { usuario: u.value, senha: s.value } }).then(function (r) { sessao = r.usuario; fecharLogin(); toastGlobal('Login efetuado com sucesso.'); barra(); resolver(); })
            .catch(function (e) {
              if (e.status === 429) { aviso = { tipo: 'erro', titulo: 'Acesso bloqueado', texto: 'Foram muitas tentativas com a senha errada para este usuário. Fale com o Administrador do sistema para liberar o seu acesso, ou aguarde 15 minutos e tente novamente.' }; var uv = u.value; render(); corpo.querySelector('#fl-u').value = uv; }
              else if (e.status === 403) { aviso = { tipo: e.dados && e.dados.status === 'PENDENTE' ? 'pend' : 'erro', titulo: e.dados && e.dados.status === 'PENDENTE' ? 'Aguardando aprovação' : 'Acesso não liberado', texto: e.message }; var uv2 = u.value; render(); corpo.querySelector('#fl-u').value = uv2; }
              else { toast(e.message || 'Não foi possível entrar.', 'erro'); s.value = ''; hab(); }
            });
        };
      }
      var c = corpo.querySelector('#fl-cad');
      if (c) {
        var m = c.querySelector('#fc-m'), n = c.querySelector('#fc-n'), u2 = c.querySelector('#fc-u'), tocouU = false;
        function sugestao(nome) {
          var p = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter(function (x) { return x && ['da', 'de', 'do', 'das', 'dos', 'e'].indexOf(x) < 0; });
          return p.length >= 2 ? p[0] + '.' + p[p.length - 1] : '';
        }
        m.oninput = function () { m.value = m.value.replace(/\D/g, ''); };
        n.oninput = function () { if (!tocouU) u2.value = sugestao(n.value); };
        u2.oninput = function () { tocouU = true; u2.value = u2.value.toLowerCase().replace(/[^a-z0-9.-]/g, ''); };
        c.onsubmit = function (ev) {
          ev.preventDefault();
          var d = { nome: c.querySelector('#fc-n').value, matricula: m.value, setor: c.querySelector('#fc-set').value, usuario: u2.value, senha: c.querySelector('#fc-s').value };
          if (d.senha !== c.querySelector('#fc-s2').value) return toast('As senhas não são iguais.', 'erro');
          var b = c.querySelector('#fc-env'); b.disabled = true;
          api('primeiro-acesso', { method: 'POST', body: d }).then(function (r) { ir('login', { tipo: 'ok', titulo: 'Cadastro enviado!', texto: r.mensagem }); toast('Cadastro enviado para aprovação.', 'sucesso'); })
            .catch(function (e) { toast(e.message || 'Não foi possível enviar o cadastro.', 'erro'); b.disabled = false; });
        };
      }
    }
    function toastGlobal(txt) { estiloLogin(); var box = document.querySelector('.fl-tst') || document.body.appendChild(el('<div class="fl-tst"></div>')); var d = el('<div class="fl-t sucesso">' + svg('ok', 24) + '<span>' + esc(txt) + '</span></div>'); box.appendChild(d); setTimeout(function () { d.remove(); }, 3500); }
    render();
  }

  window.FAROL_API = function (rota, opc) { return api(rota, opc); };
  function barra() {
    estilo(); estiloLogin(); fechar('.fw-bar');
    window.FAROL_CONTA = {
      sessao: sessao,
      usuarios: function () { paginaUsuarios(); },
      senha: painelSenha,
      sair: function () { api('logout', { method: 'POST' }).finally(function () { location.reload(); }); }
    };
    if (sessao.gerencia_usuarios) { atualizarBadge(); setInterval(function () { if (sessao && !document.hidden) atualizarBadge(); }, 60000); }
  }
  function atualizarBadge(n) {
    function pinta(v) { ['fw-bdg', 'fw-bdg2'].forEach(function (id) { var x = document.getElementById(id); if (!x) return; x.textContent = v; x.hidden = !v; }); }
    if (n != null) return pinta(n);
    api('sessao').then(function (r) { pinta(r.pendentes || 0); }).catch(function () {});
  }

  function modal(html) {
    fechar('#fw-modal');
    var o = el('<div class="fw-ov" id="fw-modal" style="background:rgba(37,30,32,.55)"><div class="fw-card fw-wide">' + html + '<button class="fw-btn" data-fechar>Fechar</button></div></div>');
    o.onclick = function (ev) { if (ev.target === o || ev.target.hasAttribute('data-fechar')) o.remove(); };
    document.body.appendChild(o); return o;
  }
  function painelSenha() {
    var o = modal('<h1>Trocar minha senha</h1><label>Senha atual<input type="password" name="a"></label><label>Nova senha (mínimo 8 caracteres)<input type="password" name="n"></label><div class="fw-err" id="fw-e" hidden></div><button class="fw-btn pri" data-ok>Salvar</button>');
    o.querySelector('[data-ok]').onclick = function () {
      api('trocar-senha', { method: 'POST', body: { atual: o.querySelector('[name=a]').value, nova: o.querySelector('[name=n]').value } })
        .then(function () { o.remove(); sessao = null; mostrarLogin({ aviso: { tipo: 'ok', titulo: 'Senha alterada', texto: 'Entre de novo com a nova senha.' } }); })
        .catch(function (e) { var x = o.querySelector('#fw-e'); x.textContent = e.message; x.hidden = false; });
    };
  }

  /* ======================================================================
     PÁGINA DE USUÁRIOS: aprovação de cadastros, edição e exclusão (só administrador)
     ====================================================================== */
  var PCSS = '.fp{position:fixed;inset:0;z-index:1800;overflow:auto;background:#f2eeef;color:#2d2527;font-family:Inter,"Segoe UI",sans-serif}' +
    '.fp-top{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:12px;padding:10px 20px;background:linear-gradient(135deg,#711424,#4a0b16);color:#fff}.fp-top h1{margin:0;font-size:1.15rem;font-weight:800;flex:1}' +
    '.fp-top button{border:1px solid rgba(255,255,255,.4);background:rgba(255,255,255,.12);color:#fff;border-radius:8px;padding:7px 14px;font:inherit;font-weight:700;font-size:.8125rem;cursor:pointer}.fp-top button:hover{background:rgba(255,255,255,.24)}' +
    '.fp-c{max-width:1180px;margin:0 auto;padding:20px 16px 60px;display:grid;gap:16px}.fp-abas{display:flex;gap:8px;flex-wrap:wrap;align-items:center}' +
    '.fp-aba{border:1px solid #dedadb;background:#fff;border-radius:999px;padding:8px 16px;font:inherit;font-weight:700;font-size:.8125rem;cursor:pointer;color:#6b6a6a}.fp-aba[aria-selected=true]{background:#711424;border-color:#711424;color:#fff}' +
    '.fp-n{display:inline-block;min-width:20px;padding:0 6px;margin-left:6px;border-radius:999px;background:#c8102e;color:#fff;font-size:.7rem;text-align:center}.fp-aba[aria-selected=true] .fp-n{background:#fff;color:#711424}' +
    '.fp-card{background:#fff;border:1px solid #dedadb;border-radius:14px;box-shadow:0 1px 3px rgba(65,32,38,.08);padding:16px;overflow:auto}.fp-card h2{margin:0 0 4px;font-size:1rem;font-weight:800;color:#4f1723}.fp-sub{margin:0 0 12px;font-size:.8125rem;color:#6b6a6a}' +
    '.fp-t{border-collapse:collapse;width:100%;font-size:.8125rem}.fp-t th{text-align:left;padding:8px 10px;font-size:.7rem;letter-spacing:.06em;text-transform:uppercase;color:#6b6a6a;white-space:nowrap;border-bottom:2px solid #eee}.fp-t td{padding:9px 10px;border-top:1px solid #f0eced;vertical-align:middle}' +
    '.fp-t select,.fp-in{border:1px solid #cfc9cb;border-radius:8px;padding:6px 8px;font:inherit;background:#fff;min-height:34px;box-sizing:border-box}.fp-ac{display:flex;gap:6px;flex-wrap:wrap}' +
    '.fp-b{border:1px solid #dedadb;background:#fff;border-radius:8px;padding:6px 12px;font:inherit;font-weight:700;font-size:.8125rem;cursor:pointer;color:#2d2527}.fp-b:hover{border-color:#711424;color:#711424}.fp-b.ok{background:#1b6b45;border-color:#1b6b45;color:#fff}.fp-b.ok:hover{background:#14543a;color:#fff}' +
    '.fp-b.pri{background:#711424;border-color:#711424;color:#fff}.fp-b.pri:hover{background:#4a0b16;color:#fff}.fp-b.del{color:#b3261e;border-color:#f0b9b9}.fp-b.del:hover{background:#fbe5e5;border-color:#b3261e;color:#b3261e}.fp-b:disabled{opacity:.5;cursor:not-allowed}' +
    '.fp-st{display:inline-block;padding:2px 10px;border-radius:999px;font-size:.7rem;font-weight:800;white-space:nowrap}.fp-st.ATIVO{background:#e3f4df;color:#1f7a25}.fp-st.PENDENTE{background:#fff1d6;color:#9a6200}.fp-st.RECUSADO{background:#fde1e3;color:#b3122a}.fp-st.INATIVO{background:#eee;color:#666}' +
    '.fp-vazio{padding:28px;text-align:center;color:#6b6a6a;border:1px dashed #dedadb;border-radius:12px}.fp-erro{background:#fbe5e5;color:#b3261e;border-radius:9px;padding:8px 12px;font-size:.8125rem}' +
    '.fp-mod{position:fixed;inset:0;z-index:1900;display:grid;place-items:center;padding:16px;background:rgba(37,30,32,.55)}.fp-m{background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.35);padding:22px;width:min(520px,100%);max-height:92vh;overflow:auto;display:grid;gap:12px}.fp-m h2{margin:0;font-size:1.1rem;font-weight:800;color:#4f1723}' +
    '.fp-m label{display:grid;gap:4px;font-size:.7rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b6a6a}.fp-m .fp-in{width:100%;font-size:.9rem;text-transform:none;letter-spacing:0;font-weight:500;color:#2d2527}.fp-lin{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:520px){.fp-lin{grid-template-columns:1fr}}' +
    '.fw-bdg{display:inline-block;min-width:18px;padding:0 5px;margin-left:4px;border-radius:999px;background:#c8102e;color:#fff;font-size:.68rem;line-height:18px;text-align:center}' +
    '.fp-t input.fp-in{padding:5px 8px;min-width:140px;font-size:.8125rem}.fp-t input.fp-sug{background:#fff6dc;border-color:#e0b64a;font-style:italic}';
  function dataBR(s) { if (!s) return '—'; var d = new Date(s); return isNaN(d) ? '—' : d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  function rotuloSituacao(u) { return u.status === 'PENDENTE' ? 'PENDENTE' : u.status === 'RECUSADO' ? 'RECUSADO' : u.ativo ? 'ATIVO' : 'INATIVO'; }
  var TXT_SIT = { ATIVO: 'Ativo', PENDENTE: 'Pendente', RECUSADO: 'Recusado', INATIVO: 'Desativado' };

  function paginaUsuarios(abaInicial) {
    estilo(); estiloLogin(); if (!document.getElementById('fp-css')) { var s = document.createElement('style'); s.id = 'fp-css'; s.textContent = PCSS; document.head.appendChild(s); }
    fechar('#fp-pag');
    var pag = el('<div class="fp" id="fp-pag"><div class="fp-top"><h1>Usuários</h1><button data-novo>+ Novo usuário</button><button data-voltar>Voltar ao painel</button></div><div class="fp-c"><div class="fp-abas" id="fp-abas"></div><div id="fp-msg"></div><div id="fp-corpo">Carregando…</div></div></div>');
    document.body.appendChild(pag);
    var aba = abaInicial || 'pend', dados = null, filtro = '', sit = '', niveis = [];
    var msg = pag.querySelector('#fp-msg'), corpo = pag.querySelector('#fp-corpo');
    function aviso(t) { msg.innerHTML = t ? '<div class="fp-erro">' + esc(t) + '</div>' : ''; }
    pag.querySelector('[data-voltar]').onclick = function () { pag.remove(); atualizarBadge(); };
    pag.querySelector('[data-novo]').onclick = function () { formUsuario(null); };

    function carregar() {
      return api('usuarios').then(function (r) {
        niveis = r.niveis; dados = r.usuarios; atualizarBadge(dados.filter(function (u) { return u.status === 'PENDENTE'; }).length); desenhar();
      }).catch(function (e) { corpo.innerHTML = ''; aviso(e.message); });
    }

    /* ---------- aba Equipes: lista das equipes ativas + gerente/coordenador/supervisor (importa a planilha de alocações) ---------- */
    var EQ = null, eqBusca = '', eqBase = '', eqSup = '', eqTipo = '', eqSem = false, eqSujo = false;
    function filtrarEq() { return Object.keys(EQ.itens).sort().filter(function (p) { var e = EQ.itens[p], q = eqBusca.toLowerCase(); return (!q || [p, e.b, e.t, e.ger, e.coo, e.sup].join(' ').toLowerCase().indexOf(q) >= 0) && (!eqBase || e.b === eqBase) && (!eqTipo || e.t === eqTipo) && (!eqSup || e.sup === eqSup) && (!eqSem || !e.ger || !e.coo || !e.sup); }); }
    function semAcento(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim(); }
    function carregarEq() { return api('doc?c=hierarquia&id=equipes').then(function (r) { EQ = r.existe && r.dados && r.dados.itens ? r.dados : { itens: {} }; eqSujo = false; }); }
    function salvarEq() {
      EQ.em = new Date().toISOString();
      return api('doc?c=hierarquia', { method: 'POST', body: { id: 'equipes', dados: EQ } }).then(function () { eqSujo = false; });
    }
    function lerPlanilhaEquipes(buf) {
      if (typeof XLSX === 'undefined') throw new Error('Leitor de planilhas indisponível. Recarregue a página.');
      var wb = XLSX.read(buf, { type: 'array' });
      var nome = wb.SheetNames.filter(function (n) { return /aloca/i.test(n); })[0] || wb.SheetNames[0];
      var linhas = XLSX.utils.sheet_to_json(wb.Sheets[nome], { defval: '' });
      if (!linhas.length) throw new Error('A planilha está vazia.');
      var mapa = {}; Object.keys(linhas[0]).forEach(function (k) { mapa[semAcento(k)] = k; });
      if (!mapa.PREFIXO) throw new Error('Não achei a coluna PREFIXO. Use a planilha de equipes do Gerenciador de Equipes (colunas BASE, PREFIXO, TIPO EQUIPE, SUPERVISOR, COORDENADOR).');
      var g = function (r, c) { return mapa[c] ? String(r[mapa[c]] == null ? '' : r[mapa[c]]).trim() : ''; };
      var eqs = {}, ignorados = 0;
      linhas.forEach(function (r) {
        var p = g(r, 'PREFIXO').toUpperCase().replace(/\s+/g, '');
        if (!/^[A-Z]{2}-[A-Z0-9]{2,5}-[A-Z0-9]+$/.test(p)) { if (p) ignorados++; return; }
        var e = eqs[p] || (eqs[p] = { b: g(r, 'BASE'), t: g(r, 'TIPO EQUIPE'), s: g(r, 'SETOR'), n: 0, ger: '', coo: '', sup: '' });
        if (mapa.CHAPA) { if (g(r, 'CHAPA')) { e.n++; (e.ch = e.ch || []).push(g(r, 'CHAPA')); } } else { /* planilha de equipes: uma coluna com a quantidade por função */ ['ENCARREGADO', 'ELETRICISTA', 'MOTORISTA', 'AUXILIAR DE ELETRICISTA', 'PODADOR', 'PEDREIROS'].forEach(function (c) { e.n += Number(g(r, c)) || 0; }); }
        ['GERENTE:ger', 'COORDENADOR:coo', 'SUPERVISOR:sup'].forEach(function (x) { var c = x.split(':'); var v = g(r, c[0]); if (v && !e[c[1]]) e[c[1]] = v; });
      });
      var ativas = {}; Object.keys(eqs).forEach(function (p) { if (eqs[p].n > 0) ativas[p] = eqs[p]; });
      /* sugestão pela aba Ativos: só quando há uma única pessoa possível na base e no tipo da equipe */
      var sugeridos = 0;
      if (wb.Sheets['Ativos']) {
        var at = XLSX.utils.sheet_to_json(wb.Sheets['Ativos'], { defval: '' }), am = {}; if (at.length) Object.keys(at[0]).forEach(function (k) { am[semAcento(k)] = k; });
        var ga = function (r, c) { return am[c] ? String(r[am[c]] == null ? '' : r[am[c]]).trim() : ''; };
        var pes = at.filter(function (r) { return /^ATIVO|^FERIAS/.test(semAcento(ga(r, 'SITUACAO'))) || !ga(r, 'SITUACAO'); }).map(function (r) { return { n: ga(r, 'NOME'), c: ga(r, 'CHAPA'), g: ga(r, 'GRPCCUSTO'), f: semAcento(ga(r, 'FUNCAO')), b: semAcento(ga(r, 'SECAO')), t: semAcento(ga(r, 'TIPO_CCUSTO')) }; });
        var apoio = /PLANEJ|QUALIDADE|SEG |LOGIST|FROTA|ADMINIST|ALMOX/;
        var sups = pes.filter(function (x) { return /^SUPERVISOR/.test(x.f) && !apoio.test(x.f); }), coos = pes.filter(function (x) { return /^COORDENADOR/.test(x.f) && !apoio.test(x.f); }), gers = pes.filter(function (x) { return /^GERENTE/.test(x.f); });
        var unico = function (lista, b, t) {
          var m = lista.filter(function (x) { return x.b === semAcento(b) && x.t && (semAcento(t).indexOf(x.t) >= 0 || x.t.indexOf(semAcento(t)) >= 0); });
          var nomes = m.map(function (x) { return x.n; }).filter(function (n, i, a) { return a.indexOf(n) === i; }); return nomes.length === 1 ? nomes[0] : '';
        };
        var chG = {}; pes.forEach(function (x) { if (x.c) chG[x.c] = x.g; });
        /* gerente: o do contrato (grupo de custo) onde a maioria da equipe está lotada */
        var gerDe = function (e) {
          var c = {}; (e.ch || []).forEach(function (h) { var g = chG[h]; if (g) c[g] = (c[g] || 0) + 1; });
          var top = Object.keys(c).sort(function (a, b) { return c[b] - c[a]; })[0]; if (!top) return '';
          var m = gers.filter(function (x) { return x.g === top; }); return m.length === 1 ? m[0].n : '';
        };
        Object.keys(ativas).forEach(function (p) {
          var e = ativas[p]; e.sug = [];
          if (!e.sup) { var v = unico(sups, e.b, e.t); if (v) { e.sup = v; e.sug.push('sup'); sugeridos++; } }
          if (!e.coo) { var v2 = unico(coos, e.b, e.t); if (v2) { e.coo = v2; e.sug.push('coo'); sugeridos++; } }
          if (!e.ger) { var v3 = gerDe(e); if (v3) { e.ger = v3; e.sug.push('ger'); sugeridos++; } }
        });
      }
      Object.keys(ativas).forEach(function (p) { delete ativas[p].ch; });
      return { ativas: ativas, ignorados: ignorados, sugeridos: sugeridos, aba: nome };
    }
    function importarEquipes(arq) {
      aviso('');
      var fr = new FileReader();
      fr.onload = function () {
        var r; try { r = lerPlanilhaEquipes(new Uint8Array(fr.result)); } catch (e) { return aviso(e.message); }
        var antes = (EQ && EQ.itens) || {}, novos = {}, removidas = 0;
        Object.keys(r.ativas).forEach(function (p) {
          var n = r.ativas[p], a = antes[p] || {};
          n.sug = n.sug || []; ['ger', 'coo', 'sup'].forEach(function (k) { var sg = n.sug.indexOf(k) >= 0; if (a[k] && (!n[k] || sg)) { n[k] = a[k]; n.sug = n.sug.filter(function (x) { return x !== k; }); if ((a.sug || []).indexOf(k) >= 0) n.sug.push(k); } });
          novos[p] = n;
        });
        Object.keys(antes).forEach(function (p) { if (!novos[p]) removidas++; });
        EQ = { itens: novos, arquivo: arq.name }; var sem = Object.keys(novos).filter(function (p) { return !novos[p].sup || !novos[p].coo || !novos[p].ger; }).length;
        salvarEq().then(function () {
          msg.innerHTML = '<div class="fp-erro" style="background:#e6f4ea;color:#1e6b34">' + Object.keys(novos).length + ' equipes ativas importadas de “' + esc(arq.name) + '”' + (r.sugeridos ? ' · ' + r.sugeridos + ' preenchimentos sugeridos pela aba Ativos (em amarelo, confira)' : '') + ' · ' + sem + ' equipe(s) ainda sem gerente, coordenador ou supervisor' + (removidas ? ' · ' + removidas + ' equipe(s) fora da planilha foram retiradas da lista' : '') + (r.ignorados ? ' · ' + r.ignorados + ' linha(s) sem prefixo de equipe ignoradas' : '') + '.</div>';
          desenhar();
        }).catch(function (e) { aviso(e.message); });
      };
      fr.readAsArrayBuffer(arq);
    }
    function baixarEquipes() {
      var L = [['PREFIXO', 'BASE', 'TIPO EQUIPE', 'GERENTE', 'COORDENADOR', 'SUPERVISOR']];
      Object.keys(EQ.itens).sort().forEach(function (p) { var e = EQ.itens[p]; L.push([p, e.b, e.t, e.ger, e.coo, e.sup]); });
      var ws = XLSX.utils.aoa_to_sheet(L); ws['!cols'] = [16, 18, 20, 26, 26, 26].map(function (w) { return { wch: w }; });
      var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Equipes'); XLSX.writeFile(wb, 'Equipes - hierarquia.xlsx');
    }
    function desenharEquipes() {
      var todas = Object.keys(EQ.itens).sort(), bases = todas.map(function (p) { return EQ.itens[p].b; }).filter(function (b, i, a) { return b && a.indexOf(b) === i; }).sort();
      var lista = filtrarEq(), uni = function (k) { return todas.map(function (p) { return EQ.itens[p][k]; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; }).sort(); }, tipos = uni('t'), sups = uni('sup');
      var nomes = function (k) { return Object.keys(EQ.itens).map(function (p) { return EQ.itens[p][k]; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; }).sort(); };
      var dl = function (id, k) { return '<datalist id="' + id + '">' + nomes(k).map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>'; };
      var campo = function (p, k) { var e = EQ.itens[p]; return '<input class="fp-in' + ((e.sug || []).indexOf(k) >= 0 ? ' fp-sug' : '') + '" list="dl-' + k + '" data-p="' + esc(p) + '" data-k="' + k + '" value="' + esc(e[k] || '') + '"' + ((e.sug || []).indexOf(k) >= 0 ? ' title="Sugerido pela aba Ativos da planilha. Confira."' : '') + '>'; };
      var h = '<div class="fp-card"><h2>Equipes ativas</h2><p class="fp-sub">Importe a planilha de equipes do Gerenciador de Equipes: ela traz as equipes ativas (prefixo, base, tipo) com <b>SUPERVISOR</b> e <b>COORDENADOR</b>. Se tiver também uma coluna <b>GERENTE</b>, ela é lida; senão informe o gerente aqui (dá para aplicar a várias equipes de uma vez). Só entram equipes com pessoas alocadas. Esses nomes viram filtros em todos os indicadores por prefixo.</p>' +
        '<div class="fp-ac" style="margin-bottom:12px"><label class="fp-b pri" style="cursor:pointer">Importar planilha (.xlsx)<input type="file" id="eq-arq" accept=".xlsx,.xls" hidden></label>' + (todas.length ? '<button class="fp-b" data-baixar>Baixar lista em Excel</button>' : '') + '</div>';
      if (!todas.length) { corpo.innerHTML = h + '<div class="fp-vazio">Nenhuma equipe importada ainda.</div></div>'; return ligarEq(); }
      h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center"><input class="fp-in" id="eq-q" placeholder="Buscar prefixo, base, tipo ou nome" style="flex:1;min-width:220px" value="' + esc(eqBusca) + '"><select class="fp-in" id="eq-b"><option value="">Todas as bases</option>' + bases.map(function (b) { return '<option' + (b === eqBase ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') + '</select><select class="fp-in" id="eq-t"><option value="">Todos os tipos de equipe</option>' + tipos.map(function (b) { return '<option' + (b === eqTipo ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') + '</select><select class="fp-in" id="eq-p"><option value="">Todos os supervisores</option>' + sups.map(function (b) { return '<option' + (b === eqSup ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') + '</select><label style="display:flex;gap:6px;align-items:center;font-size:.8125rem"><input type="checkbox" id="eq-s"' + (eqSem ? ' checked' : '') + '> só as incompletas</label></div>' +
        '<div class="fp-card" style="background:#faf6f7;margin-bottom:10px;padding:10px 12px"><b style="font-size:.8125rem">Aplicar às ' + lista.length + ' equipes listadas:</b><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px"><input class="fp-in" list="dl-ger" id="eq-mg" placeholder="Gerente"><input class="fp-in" list="dl-coo" id="eq-mc" placeholder="Coordenador"><input class="fp-in" list="dl-sup" id="eq-ms" placeholder="Supervisor"><button class="fp-b" data-lote>Aplicar</button></div></div>' +
        '<div style="overflow:auto"><table class="fp-t"><tr><th>Prefixo</th><th>Base</th><th>Tipo</th><th>Pessoas</th><th>Gerente</th><th>Coordenador</th><th>Supervisor</th></tr>' +
        lista.map(function (p) { var e = EQ.itens[p]; return '<tr><td><b>' + esc(p) + '</b></td><td>' + esc(e.b) + '</td><td>' + esc(e.t) + '</td><td>' + e.n + '</td><td>' + campo(p, 'ger') + '</td><td>' + campo(p, 'coo') + '</td><td>' + campo(p, 'sup') + '</td></tr>'; }).join('') + '</table></div>' +
        dl('dl-ger', 'ger') + dl('dl-coo', 'coo') + dl('dl-sup', 'sup') +
        '<div class="fp-ac" style="margin-top:12px;position:sticky;bottom:0"><button class="fp-b pri" data-salvar' + (eqSujo ? '' : ' disabled') + '>Salvar alterações</button><span class="fp-sub" style="margin:0">' + todas.length + ' equipes · ' + (eqSujo ? 'há alterações não salvas' : 'tudo salvo') + (EQ.arquivo ? ' · origem: ' + esc(EQ.arquivo) : '') + '</span></div></div>';
      corpo.innerHTML = h; ligarEq();
    }
    function ligarEq() {
      var arq = corpo.querySelector('#eq-arq'); if (arq) arq.onchange = function () { if (arq.files[0]) importarEquipes(arq.files[0]); };
      var bx = corpo.querySelector('[data-baixar]'); if (bx) bx.onclick = baixarEquipes;
      var q = corpo.querySelector('#eq-q'); if (!q) return;
      q.oninput = function () { eqBusca = q.value; var p = q.selectionStart; desenharEquipes(); var n = corpo.querySelector('#eq-q'); n.focus(); n.setSelectionRange(p, p); };
      corpo.querySelector('#eq-b').onchange = function (e) { eqBase = e.target.value; desenharEquipes(); };
      corpo.querySelector('#eq-t').onchange = function (e) { eqTipo = e.target.value; desenharEquipes(); };
      corpo.querySelector('#eq-p').onchange = function (e) { eqSup = e.target.value; desenharEquipes(); };
      corpo.querySelector('#eq-s').onchange = function (e) { eqSem = e.target.checked; desenharEquipes(); };
      var marca = function () { eqSujo = true; var b = corpo.querySelector('[data-salvar]'); if (b) b.disabled = false; };
      corpo.querySelectorAll('input[data-k]').forEach(function (i) { i.onchange = function () { var e = EQ.itens[i.getAttribute('data-p')], k = i.getAttribute('data-k'); e[k] = i.value.trim(); e.sug = (e.sug || []).filter(function (x) { return x !== k; }); i.classList.remove('fp-sug'); marca(); }; });
      corpo.querySelector('[data-lote]').onclick = function () {
        var v = { ger: corpo.querySelector('#eq-mg').value.trim(), coo: corpo.querySelector('#eq-mc').value.trim(), sup: corpo.querySelector('#eq-ms').value.trim() };
        if (!v.ger && !v.coo && !v.sup) return aviso('Preencha ao menos um dos nomes para aplicar.');
        var alvo = filtrarEq();
        if (!confirm('Aplicar esses nomes às ' + alvo.length + ' equipes listadas?')) return;
        alvo.forEach(function (p) { var e = EQ.itens[p]; ['ger', 'coo', 'sup'].forEach(function (k) { if (v[k]) { e[k] = v[k]; e.sug = (e.sug || []).filter(function (x) { return x !== k; }); } }); });
        eqSujo = true; aviso(''); desenharEquipes();
      };
      corpo.querySelector('[data-salvar]').onclick = function (ev) { ev.target.disabled = true; salvarEq().then(function () { aviso(''); desenharEquipes(); }).catch(function (e) { aviso(e.message); ev.target.disabled = false; }); };
    }
    function optNiveis(sel) { return niveis.map(function (n) { return '<option value="' + n.nivel + '"' + (n.nivel === sel ? ' selected' : '') + '>' + esc(n.rotulo) + (n.editar ? ' (edita)' : ' (só visualiza)') + '</option>'; }).join(''); }

    function desenhar() {
      var pend = dados.filter(function (u) { return u.status === 'PENDENTE'; }), rec = dados.filter(function (u) { return u.status === 'RECUSADO'; });
      pag.querySelector('#fp-abas').innerHTML = '<button class="fp-aba" aria-selected="' + (aba === 'pend') + '" data-aba="pend">Aguardando aprovação' + (pend.length ? '<span class="fp-n">' + pend.length + '</span>' : '') + '</button><button class="fp-aba" aria-selected="' + (aba === 'todos') + '" data-aba="todos">Todos os usuários <span class="fp-n" style="background:#8a7f82">' + dados.length + '</span></button><button class="fp-aba" aria-selected="' + (aba === 'equipes') + '" data-aba="equipes">Equipes</button>';
      pag.querySelectorAll('[data-aba]').forEach(function (b) { b.onclick = function () { aba = b.getAttribute('data-aba'); aviso(''); desenhar(); }; });
      if (aba === 'pend') {
        var h = '<div class="fp-card"><h2>Cadastros aguardando aprovação</h2><p class="fp-sub">Escolha o nível de acesso e aprove. Só depois disso a pessoa consegue ver os indicadores com o usuário e a senha que cadastrou.</p>';
        h += pend.length ? '<table class="fp-t"><tr><th>Nome</th><th>Matrícula</th><th>Usuário</th><th>Setor</th><th>Solicitado em</th><th>Nível</th><th></th></tr>' + pend.map(function (u) {
          return '<tr><td><b>' + esc(u.nome) + '</b></td><td>' + esc(u.matricula) + '</td><td>' + esc(u.usuario) + '</td><td>' + esc(u.setor) + '</td><td>' + dataBR(u.criado_em) + '</td><td><select data-niv="' + u.id + '">' + optNiveis('SUPERVISOR') + '</select></td><td><div class="fp-ac"><button class="fp-b ok" data-apr="' + u.id + '">Aprovar</button><button class="fp-b del" data-rec="' + u.id + '">Recusar</button></div></td></tr>';
        }).join('') + '</table>' : '<div class="fp-vazio">Nenhum cadastro aguardando aprovação.</div>';
        h += '</div>';
        if (rec.length) h += '<div class="fp-card"><h2>Recusados</h2><p class="fp-sub">Cadastros que você recusou. Dá para aprovar depois ou excluir.</p><table class="fp-t"><tr><th>Nome</th><th>Matrícula</th><th>Usuário</th><th>Setor</th><th>Nível</th><th></th></tr>' + rec.map(function (u) {
          return '<tr><td>' + esc(u.nome) + '</td><td>' + esc(u.matricula) + '</td><td>' + esc(u.usuario) + '</td><td>' + esc(u.setor) + '</td><td><select data-niv="' + u.id + '">' + optNiveis('SUPERVISOR') + '</select></td><td><div class="fp-ac"><button class="fp-b ok" data-apr="' + u.id + '">Aprovar</button><button class="fp-b del" data-exc="' + u.id + '">Excluir</button></div></td></tr>';
        }).join('') + '</table></div>';
        corpo.innerHTML = h;
      } else if (aba === 'equipes') {
        if (EQ === null) { corpo.innerHTML = 'Carregando…'; carregarEq().then(desenhar).catch(function (e) { aviso(e.message); }); return; }
        desenharEquipes(); return;
      } else {
        var lista = dados.filter(function (u) { var q = filtro.toLowerCase(); return (!q || [u.nome, u.usuario, u.matricula, u.setor].join(' ').toLowerCase().indexOf(q) >= 0) && (!sit || rotuloSituacao(u) === sit); });
        corpo.innerHTML = '<div class="fp-card"><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><input class="fp-in" id="fp-q" placeholder="Buscar por nome, usuário, matrícula ou setor" style="flex:1;min-width:220px" value="' + esc(filtro) + '"><select class="fp-in" id="fp-sit"><option value="">Todas as situações</option>' + Object.keys(TXT_SIT).map(function (k) { return '<option value="' + k + '"' + (sit === k ? ' selected' : '') + '>' + TXT_SIT[k] + '</option>'; }).join('') + '</select></div>' +
          (lista.length ? '<table class="fp-t"><tr><th>Nome</th><th>Usuário</th><th>Matrícula</th><th>Setor</th><th>Nível</th><th>Situação</th><th>Último acesso</th><th></th></tr>' + lista.map(function (u) {
            var s = rotuloSituacao(u);
            return '<tr><td><b>' + esc(u.nome) + '</b></td><td>' + esc(u.usuario) + '</td><td>' + esc(u.matricula || '—') + '</td><td>' + esc(u.setor || '—') + '</td><td>' + esc(u.nivel_rotulo) + '</td><td><span class="fp-st ' + s + '">' + TXT_SIT[s] + '</span></td><td>' + dataBR(u.ultimo_acesso) + '</td><td><div class="fp-ac"><button class="fp-b" data-ed="' + u.id + '">Editar</button><button class="fp-b del" data-exc="' + u.id + '"' + (u.id === sessao.id ? ' disabled title="Você não pode excluir a si mesmo"' : '') + '>Excluir</button></div></td></tr>';
          }).join('') + '</table>' : '<div class="fp-vazio">Nenhum usuário encontrado.</div>') + '</div>';
        var q = corpo.querySelector('#fp-q'); q.oninput = function () { filtro = q.value; var p = q.selectionStart; desenhar(); var n = corpo.querySelector('#fp-q'); n.focus(); n.setSelectionRange(p, p); };
        corpo.querySelector('#fp-sit').onchange = function (e) { sit = e.target.value; desenhar(); };
      }
      ligar();
    }
    var porId = function (id) { return dados.filter(function (u) { return u.id === Number(id); })[0]; };
    function decidir(id, acao, niv) {
      aviso(''); return api('aprovacoes', { method: 'POST', body: { id: Number(id), acao: acao, nivel: niv } }).then(carregar).catch(function (e) { aviso(e.message); });
    }
    function ligar() {
      corpo.querySelectorAll('[data-apr]').forEach(function (b) { b.onclick = function () { var id = b.getAttribute('data-apr'), sel = corpo.querySelector('[data-niv="' + id + '"]'); b.disabled = true; decidir(id, 'aprovar', sel.value); }; });
      corpo.querySelectorAll('[data-rec]').forEach(function (b) { b.onclick = function () { var u = porId(b.getAttribute('data-rec')); if (confirm('Recusar o cadastro de ' + u.nome + '?')) { b.disabled = true; decidir(u.id, 'recusar'); } }; });
      corpo.querySelectorAll('[data-ed]').forEach(function (b) { b.onclick = function () { formUsuario(porId(b.getAttribute('data-ed'))); }; });
      corpo.querySelectorAll('[data-exc]').forEach(function (b) { b.onclick = function () { excluir(porId(b.getAttribute('data-exc'))); }; });
    }
    function excluir(u) {
      var m = el('<div class="fp-mod"><div class="fp-m"><h2>Excluir usuário</h2><p style="margin:0;font-size:.9rem;line-height:1.5">Excluir <b>' + esc(u.nome) + '</b> (' + esc(u.usuario) + ')? A pessoa perde o acesso e o cadastro é apagado. <b>Não dá para desfazer.</b></p><div class="fp-erro" id="fp-e" hidden></div><div class="fp-ac"><button class="fp-b del" data-sim>Excluir definitivamente</button><button class="fp-b" data-nao>Cancelar</button></div></div></div>');
      document.body.appendChild(m); m.querySelector('[data-nao]').onclick = function () { m.remove(); };
      m.querySelector('[data-sim]').onclick = function () { api('usuarios?id=' + u.id, { method: 'DELETE' }).then(function () { m.remove(); return carregar(); }).catch(function (e) { var x = m.querySelector('#fp-e'); x.textContent = e.message; x.hidden = false; }); };
    }
    function formUsuario(u) {
      var novo = !u;
      var m = el('<div class="fp-mod"><form class="fp-m"><h2>' + (novo ? 'Novo usuário' : 'Editar usuário') + '</h2>' +
        '<label>Nome completo<input class="fp-in" name="nome" value="' + esc(u ? u.nome : '') + '"></label><div class="fp-lin"><label>Usuário<input class="fp-in" name="usuario" value="' + esc(u ? u.usuario : '') + '"' + (novo ? '' : ' disabled') + '></label><label>Matrícula<input class="fp-in" name="matricula" value="' + esc(u && u.matricula || '') + '"></label></div>' +
        '<div class="fp-lin"><label>Setor<input class="fp-in" name="setor" value="' + esc(u && u.setor || '') + '"></label><label>Nível de acesso<select class="fp-in" name="nivel">' + optNiveis(u ? u.nivel : 'SUPERVISOR') + '</select></label></div>' +
        (novo ? '' : '<label>Situação<select class="fp-in" name="ativo"><option value="1"' + (u.ativo ? ' selected' : '') + '>Ativo</option><option value="0"' + (!u.ativo ? ' selected' : '') + '>Desativado (sem acesso)</option></select></label>') +
        '<label>' + (novo ? 'Senha (mínimo 8 caracteres)' : 'Nova senha (deixe em branco para manter)') + '<input class="fp-in" name="senha" type="password" autocomplete="new-password"></label><div class="fp-erro" id="fp-e" hidden></div><div class="fp-ac"><button class="fp-b pri" type="submit">Salvar</button><button class="fp-b" type="button" data-nao>Cancelar</button></div></form></div>');
      document.body.appendChild(m); m.querySelector('[data-nao]').onclick = function () { m.remove(); };
      m.querySelector('form').onsubmit = function (ev) {
        ev.preventDefault(); var f = ev.target, v = function (n) { return f.elements[n] ? f.elements[n].value : undefined; };
        var corpoReq = { nome: v('nome'), matricula: v('matricula'), setor: v('setor'), nivel: v('nivel'), senha: v('senha') };
        if (novo) corpoReq.usuario = v('usuario'); else { corpoReq.id = u.id; corpoReq.ativo = v('ativo') === '1'; }
        api('usuarios', { method: novo ? 'POST' : 'PATCH', body: corpoReq }).then(function () { m.remove(); return carregar(); }).catch(function (e) { var x = m.querySelector('#fp-e'); x.textContent = e.message; x.hidden = false; });
      };
    }
    carregar();
  }

  /* ---------- início: já existe sessão? ---------- */
  function iniciar() {
    api('sessao').then(function (r) {
      if (r.usuario) { sessao = r.usuario; barra(); resolver(); } else mostrarLogin({ semUsuarios: r.semUsuarios });
    }).catch(function (e) { mostrarLogin({ aviso: { tipo: 'erro', titulo: 'Servidor indisponível', texto: e.message } }); });
  }
  if (document.body) iniciar(); else document.addEventListener('DOMContentLoaded', iniciar);
})();
