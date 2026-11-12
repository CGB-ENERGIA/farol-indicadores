# Deploy do Farol na Vercel (mesmo modelo do gerenciador-equipes-2)

O sistema roda na Vercel, com o banco Postgres na Neon, login por usuário e senha e permissões por nível.
O repositório é **público** (como o `gerenciador-equipes` e o `Medidas-Disciplinares`), por isso **nenhum dado** fica nele: os dados vivem só no Neon.

## Como está dividido

- **Site** (`public/`, gerado por `npm run build`): só código (`index.html`, `farol-web.js`, `calc.js`, `ups.js`, `ups_ui.js`). Quem não fez login vê só a tela de login.
- **API** (`/api/*`): uma função só, `api/index.js`, que chama `lib/rotas/index.js`. O `vercel.json` manda todo `/api/*` para ela.
- **Dados do site** (`historico*.json`, `config.json`, `*_config.json`, `ups_semclasse.json`): ficam na subpasta `privado/`, que **não vai para o GitHub** (está no `.gitignore`). Ficam na tabela `documentos` do Neon (coleção `arquivos`) e saem por `/api/arquivo`, só para quem fez login.
- **Banco** (Neon): `documentos` (dados do site, dias enviados, Banco SIGA), `usuarios` e `tentativas_login`. As tabelas são criadas sozinhas na primeira chamada da API.
- **Login**: cookie `HttpOnly` assinado com `SECRET_KEY`, senha só como hash (scrypt), trocar a senha derruba as sessões abertas, bloqueio de 15 min após 5 erros.
- **Níveis**: Administrador (envia relatórios, altera cadastros, gerencia usuários), Gerente, Coordenador e Supervisor (só visualizam).

## Por que o repositório é público
O Vercel só faz deploy de repositório **privado** se o autor do commit tiver conta Vercel ligada ao GitHub e for membro do time. Em repositório público essa checagem não trava (foi o que bloqueou o primeiro deploy do Farol). Como o código não tem dado nem segredo, o público é seguro.
**Regra:** nunca commitar `.env`, nada de `privado/`, planilhas nem `banco2026*.json`. O `.gitignore` já bloqueia, e o `git status` antes do commit confirma.

## Passo a passo

### 1. Neon (banco)
1. Em neon.tech, crie um projeto na região **sa-east-1** (São Paulo).
2. Em **Connect**, marque **Pooled connection** (endereço com `-pooler`) e copie a string `postgresql://...`. Ela é a `DATABASE_URL`. Nunca cole em chat nem em arquivo versionado.

### 2. GitHub (repositório público, sem dados)
1. Na conta `CGB-ENERGIA` (a mesma ligada ao Vercel `cgb1`), crie `farol-indicadores`: **Public**, sem README, sem .gitignore, sem license. Adicione `igcarvalh0` em **Settings > Collaborators** com permissão **Write**.
2. Na pasta do projeto (PowerShell), com histórico limpo:

```powershell
git init -b main
git add .
git status --short
```

3. A lista **não pode** ter: `.env`, `node_modules/`, `historico*.json`, `config.json`, `*_config.json`, `ups_semclasse.json`, `banco2026_*.json`, `.xlsx`, `dados/`, `_versoes_anteriores_*`.

```powershell
git commit -m "Farol de Indicadores: versão web com login (Vercel + Neon)"
git remote add origin https://github.com/CGB-ENERGIA/farol-indicadores.git
git push -u origin main
```

> Se o repositório já teve dados em algum commit antigo, **apague o repositório no GitHub e crie de novo** (o GitHub guarda commits antigos acessíveis pelo código do commit mesmo depois de reescrever a história).

### 3. Vercel
1. Em vercel.com, time **cgb1** > **Add New > Project** > escolha `CGB-ENERGIA/farol-indicadores` > **Import**.
2. **Framework Preset: Other**. O `vercel.json` já traz build (`node scripts/montar-public.js`), saída (`public`) e região (`gru1`).
3. **Environment Variables** (Production, Preview e Development):
   - `DATABASE_URL`: a string do Neon.
   - `SECRET_KEY`: gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Precisa ser **fixa**: trocar derruba todos os logins.
4. **Deploy**. Abra `https://<projeto>.vercel.app/api/status`: deve responder `{"ok":true,"banco":true}`.

### 4. Carregar dados e criar o administrador (na própria pasta do projeto)
Tudo que não pode ser compartilhado fica na subpasta **`privado/`** (dados do site, `banco2026_*.json`, notas internas). Ela está no `.gitignore` e no `.vercelignore`: não vai para o GitHub nem para o Vercel. A pasta principal continua sendo a do OneDrive.

Na pasta do projeto, crie um `.env` (também ignorado pelo Git) com a mesma `DATABASE_URL` e `SECRET_KEY` do Vercel e rode:

```powershell
npm install
npm run importar-dados-site
npm run criar-admin -- igor "Igor Carvalho" "uma-senha-forte-com-8-ou-mais"
npm run importar-banco-site -- banco2026_parte1de5.json banco2026_parte2de5.json banco2026_parte3de5.json banco2026_parte4de5.json banco2026_parte5de5.json
```

- `importar-dados-site`: grava no Neon os arquivos de `privado/` (histórico e configurações). **Rode de novo sempre que atualizar um deles.**
- `criar-admin`: cria o administrador (ou redefine a senha dele).
- `importar-banco-site`: carrega o Banco SIGA já exportado (procura os arquivos em `privado/`). Dias que já existem não são sobrescritos (`--substituir` troca todos).

O `npm install` instala poucos pacotes (`@neondatabase/serverless` e `xlsx`), então o `node_modules` é pequeno e pode ficar na pasta do OneDrive.

Abra a URL do Vercel e entre com esse administrador.

### 5. Primeiro acesso dos demais usuários
1. Na tela de login, a pessoa clica em **Solicite seu cadastro aqui** e preenche **nome completo, matrícula, setor, usuário e senha**.
2. O **usuário** segue o **formato do e-mail corporativo, antes do @** (exemplo: `joao.silva`). O campo é sugerido sozinho a partir do nome (primeiro e último nome, sem acento) e pode ser ajustado.
3. O cadastro fica **pendente**: ela não vê nenhum indicador, e se tentar entrar recebe "aguardando aprovação".
4. O administrador abre **Usuários** (botão no canto inferior direito, com o número de pendentes), escolhe o **nível de acesso** e clica em **Aprovar** (ou **Recusar**).
5. Só depois disso a pessoa entra com o usuário e a senha que cadastrou.

A página **Usuários** também tem a aba **Todos os usuários** (buscar, **Editar** nome, matrícula, setor, nível, situação e senha, e **Excluir**) e o botão **+ Novo usuário**. Limites de segurança: 5 pedidos de cadastro por hora por computador, bloqueio de 15 min após 5 senhas erradas, o administrador não pode excluir nem rebaixar a si mesmo e o último administrador ativo não pode ser excluído.

## Atualizações depois do primeiro deploy
- **Código** (`index.html`, `farol-web.js`, `lib/`…): `git push` na `main` gera deploy novo.
- **Dados** (`privado/historico*.json`, configs): rode `npm run importar-dados-site`. Não precisa de deploy.
- **Dia a dia do SIGA**: aba **Atualizar com o SIGA** do site, como antes. Reenviar um dia substitui o dia inteiro.

## O que fica pendente
- **Leitura automática do OneDrive** (Graph/Azure): depende da TI aprovar o app. Quando sair, adicione em `vercel.json` `"crons": [{ "path": "/api/sync", "schedule": "0 9 * * *" }]` e as variáveis `AZURE_*`, `ONEDRIVE_*` e `SYNC_SECRET`. Veja `README-ONEDRIVE.md`.
- **Dados que estavam só no artefato** (dias já enviados): não migram sozinhos. Reenvie na aba Atualizar.
- **Tamanho de envio**: a Vercel limita o corpo de uma requisição/resposta a 4,5 MB. O maior arquivo de dados hoje (`historico_ups.json`) tem 3 MB.

## Se algo der errado
- **"Deployment blocked… does not have a Vercel account linked"**: repositório privado. Use repositório público (sem dados) ou coloque o autor do commit como membro do time.
- **`/api/status` com `"banco":false`**: `DATABASE_URL` faltando ou errada no Vercel.
- **Tela de login diz "Ainda não há usuários"**: rode o `criar-admin`.
- **"SECRET_KEY não configurada"**: variável faltando no Vercel; depois de criar, faça **Redeploy**.
- **Site abre sem dados / `/api/arquivo` 404**: rode `npm run importar-dados-site`.
- **`index.lock` ou `main.lock` no Git**: processo do Git parado ou o OneDrive sincronizando a pasta `.git`; encerre o `git.exe` parado e apague o arquivo `.lock`.
