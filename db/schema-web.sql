-- Tabelas do modo web (login + documentos do site). Criadas sozinhas na primeira chamada da API.

-- Documentos do site (dias, ups, inicio, config, banco…): substitui o banco do artefato.
create table if not exists documentos (
  colecao     text        not null,
  id          text        not null,
  dados       jsonb       not null,
  atualizado  timestamptz not null default now(),
  primary key (colecao, id)
);

-- Usuários do sistema (a senha nunca é guardada: só o hash scrypt).
create table if not exists usuarios (
  id             serial primary key,
  usuario        text        not null unique,
  nome           text        not null,
  senha_hash     text        not null,
  nivel          text        not null,
  ativo          boolean     not null default true,
  criado_em      timestamptz not null default now(),
  ultimo_acesso  timestamptz
);

-- Falhas de login (limite contra força bruta). No Vercel cada requisição pode cair numa instância nova, por isso fica no banco.
create table if not exists tentativas_login (
  id     bigserial primary key,
  chave  text        not null,
  ip     text,
  quando timestamptz not null default now()
);
create index if not exists ix_tentativas_login_chave on tentativas_login (chave, quando);
