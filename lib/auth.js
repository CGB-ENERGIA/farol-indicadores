'use strict';
/* Login e sessão, no mesmo modelo do gerenciador-equipes:
   - senha guardada só como hash (scrypt); sessão em cookie HttpOnly assinado com SECRET_KEY;
   - trocar a senha derruba as sessões abertas (marca da senha dentro do cookie);
   - limite de falhas de login por usuário e por IP, guardado no banco. */
const crypto = require('crypto');
const pg = require('./pg');

const NIVEIS = {
  ADMINISTRADOR: { rotulo: 'Administrador', editar: true, usuarios: true },
  GERENTE: { rotulo: 'Gerente', editar: false, usuarios: false },
  COORDENADOR: { rotulo: 'Coordenador', editar: false, usuarios: false },
  SUPERVISOR: { rotulo: 'Supervisor', editar: false, usuarios: false }
};
const SENHA_MINIMA = 8, COOKIE = 'farol_sessao', VALIDADE_S = 60 * 60 * 12;
const LIMITE_FALHAS = 5, JANELA_MIN = 15;

function segredo() {
  const s = process.env.SECRET_KEY;
  if (s) return s;
  if (process.env.VERCEL) throw Object.assign(new Error('SECRET_KEY não configurada.'), { pendencias: ['SECRET_KEY'] });
  return 'chave-local-apenas-para-testes';
}

const SCRYPT = { N: 16384, r: 8, p: 1 };
function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  return 'scrypt$' + sal.toString('hex') + '$' + crypto.scryptSync(senha, sal, 64, SCRYPT).toString('hex');
}
function senhaConfere(senha, guardado) {
  const [t, sal, h] = String(guardado || '').split('$');
  if (t !== 'scrypt' || !sal || !h) return false;
  const novo = crypto.scryptSync(senha, Buffer.from(sal, 'hex'), 64, SCRYPT), velho = Buffer.from(h, 'hex');
  return novo.length === velho.length && crypto.timingSafeEqual(novo, velho);
}
const validarSenha = s => (!s || String(s).length < SENHA_MINIMA) ? 'A senha precisa de pelo menos ' + SENHA_MINIMA + ' caracteres.' : null;
const marcaSenha = h => crypto.createHash('sha256').update(h || '').digest('hex').slice(0, 16);

const assinar = txt => crypto.createHmac('sha256', segredo()).update(txt).digest('base64url');
function criarToken(u) {
  const corpo = Buffer.from(JSON.stringify({ i: u.id, m: marcaSenha(u.senha_hash), e: Math.floor(Date.now() / 1000) + VALIDADE_S })).toString('base64url');
  return corpo + '.' + assinar(corpo);
}
function lerToken(t) {
  const [corpo, ass] = String(t || '').split('.');
  if (!corpo || !ass) return null;
  const esperado = assinar(corpo);
  if (esperado.length !== ass.length || !crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(ass))) return null;
  try { const d = JSON.parse(Buffer.from(corpo, 'base64url').toString()); return d.e > Date.now() / 1000 ? d : null; } catch (e) { return null; }
}
function cookies(req) {
  const o = {};
  for (const c of String(req.headers.cookie || '').split(';')) { const i = c.indexOf('='); if (i > 0) o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); }
  return o;
}
function definirCookie(res, token, apagar) {
  const seguro = process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', COOKIE + '=' + (apagar ? '' : encodeURIComponent(token)) + '; Path=/; HttpOnly; SameSite=Lax' + seguro + '; Max-Age=' + (apagar ? 0 : VALIDADE_S));
}
const publico = u => ({
  id: u.id, usuario: u.usuario, nome: u.nome, nivel: u.nivel,
  nivel_rotulo: (NIVEIS[u.nivel] || {}).rotulo || u.nivel,
  pode_editar: !!(NIVEIS[u.nivel] || {}).editar, gerencia_usuarios: !!(NIVEIS[u.nivel] || {}).usuarios,
  ativo: u.ativo, ultimo_acesso: u.ultimo_acesso
});

async function usuarioLogado(req) {
  const t = lerToken(cookies(req)[COOKIE]);
  if (!t) return null;
  const r = await pg.q('select * from usuarios where id = $1 and ativo = true', [t.i]);
  return r[0] && marcaSenha(r[0].senha_hash) === t.m ? r[0] : null;
}
const ipDe = req => String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
async function travado(chave, ip) {
  const r = await pg.q("select count(*) filter (where chave = $1) as u, count(*) filter (where ip = $2) as i from tentativas_login where quando > now() - ($3 || ' minutes')::interval", [chave, ip, String(JANELA_MIN)]);
  return Number(r[0].u) >= LIMITE_FALHAS || Number(r[0].i) >= LIMITE_FALHAS * 4;
}

/* devolve [status, corpo] */
async function login(req, res, corpo) {
  const usuario = String(corpo.usuario || '').trim().toLowerCase(), senha = String(corpo.senha || ''), ip = ipDe(req);
  if (!usuario || !senha) return [400, { erro: 'Informe usuário e senha.' }];
  if (await travado(usuario, ip)) return [429, { erro: 'Muitas tentativas. Aguarde ' + JANELA_MIN + ' minutos e tente de novo.' }];
  const r = await pg.q('select * from usuarios where lower(usuario) = $1 and ativo = true', [usuario]);
  if (!r[0] || !senhaConfere(senha, r[0].senha_hash)) {
    await pg.q('insert into tentativas_login (chave, ip) values ($1,$2)', [usuario, ip]);
    return [401, { erro: 'Usuário ou senha incorretos.' }];
  }
  await pg.q('delete from tentativas_login where chave = $1', [usuario]);
  await pg.q('update usuarios set ultimo_acesso = now() where id = $1', [r[0].id]);
  definirCookie(res, criarToken(r[0]));
  return [200, { usuario: publico(r[0]) }];
}

module.exports = { NIVEIS, SENHA_MINIMA, hashSenha, senhaConfere, validarSenha, usuarioLogado, definirCookie, publico, login };
