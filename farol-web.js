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
        if (r.status === 401 && sessao) { sessao = null; mostrarLogin(); }
        if (!r.ok) { var e = new Error(j.erro || ('Erro ' + r.status)); e.status = r.status; e.code = r.status === 403 ? 'permission_denied' : r.status === 400 || r.status === 413 ? 'invalid_argument' : 'unavailable'; throw e; }
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

  function mostrarLogin(aviso, semUsuarios) {
    estilo(); fechar('.fw-bar'); fechar('#fw-login');
    var o = el('<div class="fw-ov" id="fw-login"><form class="fw-card"><h1>Central de Indicadores</h1><p>Entre com seu usuário e senha.</p>' +
      (semUsuarios ? '<div class="fw-err">Ainda não há usuários. Crie o administrador no computador com <b>npm run criar-admin</b> (veja o DEPLOY.md).</div>' : '') +
      (aviso ? '<div class="fw-ok">' + esc(aviso) + '</div>' : '') +
      '<label>Usuário<input name="u" autocomplete="username" autofocus></label><label>Senha<input name="s" type="password" autocomplete="current-password"></label>' +
      '<div class="fw-err" id="fw-e" hidden></div><button class="fw-btn pri" type="submit">Entrar</button></form></div>');
    document.body.appendChild(o);
    o.querySelector('form').onsubmit = function (ev) {
      ev.preventDefault();
      var b = o.querySelector('button'), e = o.querySelector('#fw-e'); b.disabled = true; e.hidden = true;
      api('login', { method: 'POST', body: { usuario: o.querySelector('[name=u]').value, senha: o.querySelector('[name=s]').value } })
        .then(function (r) { sessao = r.usuario; o.remove(); barra(); resolver(); })
        .catch(function (er) { e.textContent = er.message; e.hidden = false; b.disabled = false; });
    };
  }

  function barra() {
    estilo(); fechar('.fw-bar');
    var b = el('<div class="fw-bar"><span>' + esc(sessao.nome) + ' <small>· ' + esc(sessao.nivel_rotulo) + (sessao.pode_editar ? '' : ' · só visualização') + '</small></span>' +
      (sessao.gerencia_usuarios ? '<button class="fw-btn" data-a="usu">Usuários</button>' : '') + '<button class="fw-btn" data-a="senha">Senha</button><button class="fw-btn" data-a="sair">Sair</button></div>');
    document.body.appendChild(b);
    b.onclick = function (ev) {
      var a = ev.target.getAttribute && ev.target.getAttribute('data-a');
      if (a === 'sair') api('logout', { method: 'POST' }).finally(function () { location.reload(); });
      if (a === 'senha') painelSenha();
      if (a === 'usu') painelUsuarios();
    };
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
        .then(function () { o.remove(); sessao = null; mostrarLogin('Senha alterada. Entre de novo.'); })
        .catch(function (e) { var x = o.querySelector('#fw-e'); x.textContent = e.message; x.hidden = false; });
    };
  }
  function painelUsuarios() {
    var o = modal('<h1>Usuários</h1><div id="fw-lista">Carregando…</div>');
    function lista() {
      api('usuarios').then(function (r) {
        var opts = r.niveis.map(function (n) { return '<option value="' + n.nivel + '">' + esc(n.rotulo) + (n.editar ? ' (edita)' : ' (visualiza)') + '</option>'; }).join('');
        o.querySelector('#fw-lista').innerHTML = '<table class="fw-t"><tr><th>Usuário</th><th>Nome</th><th>Nível</th><th>Situação</th><th></th></tr>' +
          r.usuarios.map(function (u) { return '<tr><td>' + esc(u.usuario) + '</td><td>' + esc(u.nome) + '</td><td>' + esc(u.nivel_rotulo) + '</td><td>' + (u.ativo ? 'Ativo' : 'Inativo') + '</td><td>' +
            '<button class="fw-btn" data-id="' + u.id + '" data-a="nivel">Nível</button> <button class="fw-btn" data-id="' + u.id + '" data-a="senha">Senha</button> <button class="fw-btn" data-id="' + u.id + '" data-a="ativo" data-v="' + (u.ativo ? 0 : 1) + '">' + (u.ativo ? 'Desativar' : 'Ativar') + '</button></td></tr>'; }).join('') +
          '</table><h1 style="font-size:16px;margin-top:10px">Novo usuário</h1><div class="fw-row"><label>Usuário<input name="u"></label><label>Nome<input name="n"></label><label>Nível<select name="v">' + opts + '</select></label><label>Senha (mín. 8)<input name="s" type="password"></label></div>' +
          '<div class="fw-err" id="fw-e" hidden></div><button class="fw-btn pri" data-novo>Criar usuário</button>';
        var mapa = {}; r.usuarios.forEach(function (u) { mapa[u.id] = u; });
        o.querySelector('#fw-lista').onclick = function (ev) {
          var t = ev.target, a = t.getAttribute('data-a'), id = Number(t.getAttribute('data-id')), x = o.querySelector('#fw-e');
          function patch(corpo) { corpo.id = id; api('usuarios', { method: 'PATCH', body: corpo }).then(lista).catch(function (e) { x.textContent = e.message; x.hidden = false; }); }
          if (a === 'ativo') patch({ ativo: t.getAttribute('data-v') === '1' });
          if (a === 'senha') { var s = prompt('Nova senha para ' + mapa[id].usuario + ' (mínimo 8 caracteres):'); if (s) patch({ senha: s }); }
          if (a === 'nivel') { var n = prompt('Nível de ' + mapa[id].usuario + ': ' + r.niveis.map(function (z) { return z.nivel; }).join(', '), mapa[id].nivel); if (n) patch({ nivel: n.trim().toUpperCase() }); }
          if (t.hasAttribute('data-novo')) {
            api('usuarios', { method: 'POST', body: { usuario: o.querySelector('[name=u]').value, nome: o.querySelector('[name=n]').value, nivel: o.querySelector('[name=v]').value, senha: o.querySelector('[name=s]').value } })
              .then(lista).catch(function (e) { x.textContent = e.message; x.hidden = false; });
          }
        };
      }).catch(function (e) { o.querySelector('#fw-lista').textContent = e.message; });
    }
    lista();
  }

  /* ---------- início: já existe sessão? ---------- */
  function iniciar() {
    api('sessao').then(function (r) {
      if (r.usuario) { sessao = r.usuario; barra(); resolver(); } else mostrarLogin(null, r.semUsuarios);
    }).catch(function (e) { mostrarLogin(); var x = document.querySelector('#fw-e'); if (x) { x.textContent = 'Servidor indisponível: ' + e.message; x.hidden = false; } });
  }
  if (document.body) iniciar(); else document.addEventListener('DOMContentLoaded', iniciar);
})();
