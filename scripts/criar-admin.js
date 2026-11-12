'use strict';
/* npm run criar-admin -- usuario "Nome Completo" "senha-com-8-ou-mais"
   Cria (ou redefine a senha de) um administrador direto no banco da DATABASE_URL. Equivale ao
   "python -m database.criar_usuario_administrador" do gerenciador-equipes. */
const pg = require('../lib/pg');
const auth = require('../lib/auth');
(async () => {
  const [usuario, nome, senha] = process.argv.slice(2);
  if (!usuario || !nome || !senha) { console.log('Uso: npm run criar-admin -- usuario "Nome Completo" "senha"'); process.exitCode = 1; return; }
  const erro = auth.validarSenha(senha);
  if (erro) { console.log(erro); process.exitCode = 1; return; }
  const u = usuario.trim().toLowerCase();
  await pg.q("insert into usuarios (usuario, nome, senha_hash, nivel) values ($1,$2,$3,'ADMINISTRADOR') on conflict (usuario) do update set nome = excluded.nome, senha_hash = excluded.senha_hash, nivel = 'ADMINISTRADOR', ativo = true", [u, nome.trim(), auth.hashSenha(senha)]);
  console.log('Administrador "' + u + '" pronto. Entre no site com ele.');
})().catch(e => { console.error('Erro:', e.message); process.exitCode = 1; });
