-- Banco SIGA (COI, MAN, FIS, OBRAS): uma linha por fonte e dia, com as atividades em JSON.
-- Rodar uma vez no Neon (SQL Editor) ou deixar o sistema criar sozinho na primeira execução.
create table if not exists banco_dias (
  fonte       text        not null,
  data        date        not null,
  cols        jsonb       not null,
  linhas      jsonb       not null,
  n           integer     not null,
  arquivo     text,
  enviado_em  timestamptz not null default now(),
  primary key (fonte, data)
);

-- Controle dos arquivos já lidos no OneDrive (o mesmo arquivo só é processado de novo se mudar)
create table if not exists arquivos_onedrive (
  id            text primary key,
  nome          text,
  etag          text,
  tamanho       bigint,
  modificado    timestamptz,
  status        text,
  detalhe       jsonb,
  processado_em timestamptz not null default now()
);

-- Histórico das execuções da sincronização
create table if not exists sync_execucoes (
  id      bigserial primary key,
  inicio  timestamptz not null,
  fim     timestamptz,
  resumo  jsonb
);
