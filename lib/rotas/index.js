'use strict';
/* Todas as rotas /api/* num só lugar (no Vercel é a função api/index.js; no PC, o servidor.js chama o mesmo código).
   Mesmo desenho do gerenciador-equipes: tudo exige login, exceto /api/status, /api/login e /api/sessao. */
const fs = require('fs');
const path = require('path');
const pg = require('../pg');
const auth = require('../auth');
const { json } = require('../http');
const banco = require('./banco');
const sync = require('./sync');

const RAIZ = path.join(__dirname, '..', '..');
const MAX_CORPO = 4 * 1024 * 1024; // o Vercel recusa corpo acima de 4,5 MB
/* arquivos de dados do site servidos só a quem fez login (nada disso fica público) */
const ARQUIVO_OK = /^(config|ader_config|def_config|ini_config|prod_config|ups_config|ups_semclasse|historico(_[a-z]+)?)\.json$/;
const COLECAO_OK = /^[a-z][a-z0-9_]{0,40}$/;
const ID_OK = /^[^/\\]{1,200}$/;

async function lerCorpo(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let txt = typeof req.body === 'string' ? req.body : '';
  if (!txt) {
    const partes = []; let n = 0;
    for await (const p of req) { n += p.length; if (n > MAX_CORPO) throw Object.assign(new Error('Arquivo grande demais para um envio (limite 4 MB).'), { status: 413 }); partes.push(p); }
    txt = Buffer.concat(partes).toString('utf8');
  }
  if (!txt) return {};
  try { return JSON.parse(txt); } catch (e) { throw Object.assign(new Error('Corpo da requisição inválido.'), { status: 400 }); }
}
const erroHttp = (res, status, msg) => json(res, status, { erro: msg });

module.exports = async function rotear(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    const rota = url.pathname.replace(/\/+$/, '') || '/', q = url.searchParams, m = req.method;

    if (rota === '/api/status') {
      let banco_ok = false; try { await pg.q('select 1'); banco_ok = true; } catch (e) { /* sem banco */ }
      return json(res, 200, { ok: true, banco: banco_ok });
    }
    if (rota === '/api/sync') return sync(req, res); // chamado pelo Cron do Vercel, com chave própria
    if (rota === '/api/login' && m === 'POST') { const [s, c] = await auth.login(req, res, await lerCorpo(req)); return json(res, s, c); }
    if (rota === '/api/logout' && m === 'POST') { auth.definirCookie(res, '', true); return json(res, 200, { ok: true }); }

    const u = await auth.usuarioLogado(req);
    if (rota === '/api/sessao') return json(res, 200, { usuario: u ? auth.publico(u) : null, semUsuarios: u ? false : Number((await pg.q('select count(*) as n from usuarios'))[0].n) === 0 });
    if (!u) return erroHttp(res, 401, 'Faça login para continuar.');
    const nivel = auth.NIVEIS[u.nivel] || {};

    if (rota === '/api/banco') { req.sessaoOk = true; return banco(req, res); }

    if (rota === '/api/arquivo' && m === 'GET') {
      const nome = String(q.get('nome') || '');
      if (!ARQUIVO_OK.test(nome)) return erroHttp(res, 404, 'Arquivo não encontrado.');
      /* os dados ficam no Neon (coleção "arquivos"); a cópia em disco só existe no PC, para desenvolvimento */
      res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'private, max-age=300');
      const r = await pg.q("select dados from documentos where colecao = 'arquivos' and id = $1", [nome]);
      if (r[0]) return res.end(JSON.stringify(r[0].dados));
      const f = path.join(RAIZ, 'privado', nome);
      if (!fs.existsSync(f)) { res.setHeader('Cache-Control', 'no-store'); return erroHttp(res, 404, 'Arquivo não encontrado. Rode npm run importar-dados-site.'); }
      return res.end(fs.readFileSync(f));
    }

    if (rota === '/api/doc') {
      const c = String(q.get('c') || ''), id = q.get('id');
      if (!COLECAO_OK.test(c)) return erroHttp(res, 400, 'Coleção inválida.');
      if (m === 'GET') {
        if (id) { const r = await pg.q('select dados from documentos where colecao = $1 and id = $2', [c, id]); return r[0] ? json(res, 200, { existe: true, dados: r[0].dados }) : json(res, 200, { existe: false }); }
        /* lista paginada por cursor (atualizado, id): cada resposta fica abaixo de ~3 MB (o Vercel recusa respostas acima de 4,5 MB) */
        const a = q.get('a'), i = q.get('i');
        const r = a ? await pg.q('select id, dados, atualizado::text as at from documentos where colecao = $1 and (atualizado, id) > ($2::timestamptz, $3) order by atualizado, id limit 300', [c, a, i || ''])
          : await pg.q('select id, dados, atualizado::text as at from documentos where colecao = $1 order by atualizado, id limit 300', [c]);
        const docs = []; let bytes = 0, proximo = false;
        for (const x of r) {
          const t = JSON.stringify(x.dados).length;
          if (docs.length && bytes + t > 3000000) { proximo = true; break; }
          docs.push({ id: x.id, dados: x.dados, atualizado: x.at }); bytes += t;
        }
        if (r.length === 300 && docs.length === 300) proximo = true;
        return json(res, 200, { docs, proximo });
      }
      if (!nivel.editar) return erroHttp(res, 403, 'Seu nível é só de visualização.');
      if (m === 'POST') {
        const b = await lerCorpo(req);
        if (!ID_OK.test(String(b.id || '')) || !b.dados || typeof b.dados !== 'object') return erroHttp(res, 400, 'Documento inválido.');
        await pg.q('insert into documentos (colecao, id, dados, atualizado) values ($1,$2,$3::jsonb, clock_timestamp()) on conflict (colecao, id) do update set dados = excluded.dados, atualizado = clock_timestamp()', [c, String(b.id), JSON.stringify(b.dados)]);
        return json(res, 200, { ok: true });
      }
      if (m === 'DELETE') {
        if (!ID_OK.test(String(id || ''))) return erroHttp(res, 400, 'Documento inválido.');
        await pg.q('delete from documentos where colecao = $1 and id = $2', [c, id]);
        return json(res, 200, { ok: true });
      }
    }

    if (rota === '/api/trocar-senha' && m === 'POST') {
      const b = await lerCorpo(req);
      if (!auth.senhaConfere(String(b.atual || ''), u.senha_hash)) return erroHttp(res, 400, 'A senha atual não confere.');
      const e = auth.validarSenha(b.nova); if (e) return erroHttp(res, 400, e);
      await pg.q('update usuarios set senha_hash = $1 where id = $2', [auth.hashSenha(b.nova), u.id]);
      auth.definirCookie(res, '', true); // a senha mudou: entra de novo
      return json(res, 200, { ok: true });
    }

    if (rota === '/api/usuarios') {
      if (!nivel.usuarios) return erroHttp(res, 403, 'Só o administrador gerencia usuários.');
      if (m === 'GET') return json(res, 200, { niveis: Object.entries(auth.NIVEIS).map(([k, v]) => ({ nivel: k, rotulo: v.rotulo, editar: v.editar })), usuarios: (await pg.q('select * from usuarios order by nome')).map(auth.publico) });
      const b = await lerCorpo(req);
      if (m === 'POST') {
        const usuario = String(b.usuario || '').trim().toLowerCase(), nome = String(b.nome || '').trim();
        if (!/^[a-z0-9._-]{3,40}$/.test(usuario) || !nome || !auth.NIVEIS[b.nivel]) return erroHttp(res, 400, 'Informe usuário (3 a 40 letras minúsculas, números, ponto, hífen ou _), nome e nível.');
        const e = auth.validarSenha(b.senha); if (e) return erroHttp(res, 400, e);
        if ((await pg.q('select 1 from usuarios where lower(usuario) = $1', [usuario])).length) return erroHttp(res, 409, 'Esse usuário já existe.');
        await pg.q('insert into usuarios (usuario, nome, senha_hash, nivel) values ($1,$2,$3,$4)', [usuario, nome, auth.hashSenha(b.senha), b.nivel]);
        return json(res, 200, { ok: true });
      }
      if (m === 'PATCH') {
        const alvo = (await pg.q('select * from usuarios where id = $1', [Number(b.id)]))[0];
        if (!alvo) return erroHttp(res, 404, 'Usuário não encontrado.');
        const nome = b.nome != null ? String(b.nome).trim() : alvo.nome, niv = b.nivel != null ? b.nivel : alvo.nivel, ativo = b.ativo != null ? !!b.ativo : alvo.ativo;
        if (!nome || !auth.NIVEIS[niv]) return erroHttp(res, 400, 'Nome ou nível inválido.');
        if (alvo.id === u.id && (niv !== 'ADMINISTRADOR' || !ativo)) return erroHttp(res, 400, 'Você não pode tirar o próprio acesso de administrador.');
        let hash = alvo.senha_hash;
        if (b.senha) { const e = auth.validarSenha(b.senha); if (e) return erroHttp(res, 400, e); hash = auth.hashSenha(b.senha); }
        await pg.q('update usuarios set nome = $1, nivel = $2, ativo = $3, senha_hash = $4 where id = $5', [nome, niv, ativo, hash, alvo.id]);
        return json(res, 200, { ok: true });
      }
    }
    return erroHttp(res, 404, 'Rota não encontrada.');
  } catch (e) {
    console.error('[api]', e);
    json(res, e.status || (e.pendencias ? 503 : 500), { erro: e.message, pendencias: e.pendencias });
  }
};
