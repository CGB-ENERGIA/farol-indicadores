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

-- Primeiro acesso: o usuário pede o cadastro (fica PENDENTE) e o administrador aprova ou recusa.
-- Quem já existia fica ATIVO. Usuário no formato CGB + matrícula (ex.: CGB12345).
alter table usuarios add column if not exists matricula text;
alter table usuarios add column if not exists setor text;
alter table usuarios add column if not exists status text not null default 'ATIVO';
alter table usuarios add column if not exists decidido_por text;
alter table usuarios add column if not exists decidido_em timestamptz;

-- Gestão de Contingência: uma única linha (id 1) com a base vigente, trocada por inteiro a cada importação válida.
-- Guarda só a última importação (quem, quando, arquivo), sem histórico.
create table if not exists contingencia_base (
  id            int         primary key,
  versao        bigint      not null default 1,
  arquivo       text        not null,
  usuario       text        not null,
  nome          text,
  importado_em  timestamptz not null default now(),
  cab           jsonb       not null,
  linhas        jsonb       not null,
  total         int         not null
);
