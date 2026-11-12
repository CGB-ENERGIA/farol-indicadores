# Conexão com o OneDrive (Banco SIGA)

O sistema lê os relatórios do SIGA (COI, MAN, FIS e OBRAS) de uma **pasta do OneDrive**, processa com as mesmas regras do site e grava no banco. Só arquivos **novos ou alterados** são lidos.

```
OneDrive (pasta "Entrada")  →  servidor local (agora)  →  banco: arquivos em "dados/"
                            →  Vercel (depois)         →  banco: Neon Postgres
```

## 1. Rodar no seu computador

Precisa do **Node.js 20 ou mais novo** (já instalado nesta máquina).

> **Atenção ao OneDrive:** `npm install` cria a pasta `node_modules` com milhares de arquivos, e o OneDrive vai tentar sincronizar todos. Prefira rodar o projeto numa cópia **fora** do OneDrive (por exemplo `C:\dev\farol`) ou pause a sincronização enquanto instala.

```bash
npm install
copy .env.example .env      # depois edite o .env (passo 2 ou 3)
npm run testar-onedrive     # confere a conexão, passo a passo
npm run sync -- --dry       # mostra o que seria importado, sem gravar
npm run sync                # importa de verdade, uma vez
npm start                   # site em http://localhost:3000 + sincronização automática
```

Com `npm start`, o servidor sincroniza ao iniciar e depois a cada `SYNC_INTERVALO_MIN` minutos (30 por padrão).

**Nomes dos arquivos:** precisam conter `COI`, `MAN`, `FIS` ou `OBRAS` (ex.: `COI_2026-11-11.xlsx`, `MA-MAN_2026-11-11.xlsx`). Outros nomes são ignorados. Se o mesmo dia for exportado de novo com **o mesmo número de linhas ou mais**, ele substitui o anterior; com menos linhas, o dia completo é mantido.

**Carregar o histórico já exportado** (1.012 dias de 2026, arquivos `banco2026_v2_parte*`):

```bash
npm run importar-export -- banco2026_v2_parte1de5.json banco2026_v2_parte2de5.json banco2026_v2_parte3de5.json banco2026_v2_parte4de5.json banco2026_v2_parte5de5.json
```

## 1b. Planilha consolidada (`BANCOS 2026 - MAN COI OBRAS FIS.xlsx`)

É a fonte configurada para este projeto: uma planilha com uma aba por relatório (**MAN, COI, OBRAS, FIS**), até 112 colunas e centenas de milhares de linhas (a aba COI sozinha tem ~1,2 GB de XML por dentro). O sistema lê em **fluxo**, sem carregar o arquivo na memória, e usa só as colunas do Banco SIGA.

```
ONEDRIVE_MODO=local
ONEDRIVE_PASTA_LOCAL=C:\Users\Micro\OneDrive - CGB ENERGIA LTDA\SETOR DE MEDIÇÃO\Projetos\Backup de siga
ONEDRIVE_ARQUIVO=BANCOS 2026
ONEDRIVE_PROFUNDIDADE=1
DADOS_DIR=C:\dev\farol-dados
```

- `ONEDRIVE_ARQUIVO=BANCOS 2026` evita ler o `BANCOS 2025 - COI.xlsx` da subpasta `2025`.
- **Primeira importação:** cerca de 40 segundos e ~400 MB de memória para as 4 abas (1.012 dias, 745.914 linhas). Rode `npm run sync`, ou só `npm start`, que sincroniza ao iniciar.
- **Quando a planilha é gerada de novo** (data de modificação ou tamanho diferentes), ela é lida inteira outra vez. O consolidado **substitui** os dias que já estão no banco, porque é a fonte da verdade (uma linha por atividade, sem duplicidades).
- A coluna `Data` é gravada no mesmo formato do banco do site (`10/11/26 12:00 AM`), e `Tipo de Atividade.1` volta a ser a segunda `Tipo de Atividade`.
- Para importar só uma aba ou sem substituir: `npm run importar-consolidado -- "C:\...\BANCOS 2026 - MAN COI OBRAS FIS.xlsx" --abas=COI --sem-substituir`.
- **No Vercel** o consolidado ainda não é lido: o Vercel não tem a pasta do PC e limita memória e tempo. Para isso o ideal é o processo que gera o consolidado também salvar os relatórios **por dia** numa pasta do OneDrive (seção 1) ou subir o banco já importado para o Neon (`importar-consolidado` com `DATABASE_URL` preenchida).

## 2. Opção A: ler a pasta do OneDrive já sincronizada no PC (mais simples, sem Azure)

No `.env`:

```
ONEDRIVE_MODO=local
ONEDRIVE_PASTA_LOCAL=C:\Users\Micro\OneDrive - CGB ENERGIA LTDA\SETOR DE MEDIÇÃO\SIGA\Entrada
```

Funciona só neste computador, com o OneDrive aberto. Não funciona no Vercel.

## 3. Opção B: Microsoft Graph API (funciona local e no Vercel)

Esta parte é feita por você, ou por um administrador do Microsoft 365 da CGB.

1. Acesse <https://entra.microsoft.com> → **Identidade → Aplicativos → Registros de aplicativos → Novo registro**.
   - Nome: `Farol-OneDrive-Sync`. Tipos de conta: **somente este diretório**. Registrar.
2. Na página do app, copie **ID do aplicativo (cliente)** → `AZURE_CLIENT_ID` e **ID do diretório (locatário)** → `AZURE_TENANT_ID`.
3. **Certificados e segredos → Novo segredo do cliente**. Copie o **Valor** (aparece uma única vez) → `AZURE_CLIENT_SECRET`.
4. **Permissões de API → Adicionar → Microsoft Graph → Permissões de aplicativo**:
   - **recomendada:** `Files.SelectedOperations.Selected` (só a pasta liberada; veja "Acesso restrito a UMA pasta" abaixo);
   - mais simples, porém ampla: `Files.Read.All` (lê arquivos do tenant inteiro; é o que o administrador mais costuma estranhar);
   - mais restrita (recomendada): `Sites.Selected` e depois liberar só o site/pasta desejado (veja abaixo).
   - Clique em **Conceder consentimento do administrador** (precisa de um administrador).
5. Diga onde estão os arquivos, no `.env`, com **uma** destas formas:
   - `ONEDRIVE_USUARIO=nome@empresa.com.br` (OneDrive pessoal da empresa dessa conta);
   - `ONEDRIVE_DRIVE_ID=…` (para achar: no Graph Explorer, `GET /users/nome@empresa.com.br/drive`);
   - `SHAREPOINT_SITE_ID=…` (biblioteca de um site do SharePoint).
   - `ONEDRIVE_PASTA=SETOR DE MEDIÇÃO/SIGA/Entrada` (caminho dentro desse OneDrive, sem barra no início).
6. Rode `npm run testar-onedrive`. Cada linha mostra OK ou FALHA com o motivo (login, permissão, pasta não encontrada).

**Para restringir a um único site com `Sites.Selected`:** um administrador chama, no Graph Explorer, `POST /sites/{id-do-site}/permissions` com o corpo `{"roles":["read"],"grantedToIdentities":[{"application":{"id":"<AZURE_CLIENT_ID>","displayName":"Farol-OneDrive-Sync"}}]}`. Isso é mais fácil se os relatórios ficarem numa biblioteca de um **site do SharePoint** (ex.: "Setor de Medição"), e não no OneDrive pessoal de alguém.

### Acesso restrito a UMA pasta (recomendado)

Com `Files.Read.All` o aplicativo leria todos os arquivos do tenant. Para limitar à pasta `SETOR DE MEDIÇÃO` e às subpastas dela, use a permissão **`Files.SelectedOperations.Selected`** (tipo *aplicativo*), em que o administrador concede o app a **uma pasta específica**. Nada fora dela fica acessível.

1. No registro do aplicativo, em **Permissões de API**, **remova `Files.Read.All`** e adicione **Microsoft Graph → Permissões de aplicativo → `Files.SelectedOperations.Selected`**. Um administrador clica em **Conceder consentimento**. Essa permissão sozinha não dá acesso a nenhum arquivo.
2. Um administrador (ou o dono da pasta) descobre os IDs no [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer), entrando com a conta da empresa:
   `GET https://graph.microsoft.com/v1.0/me/drive/root:/SETOR DE MEDIÇÃO`
   Na resposta, anote **`id`** (ID da pasta) e **`parentReference.driveId`** (ID do drive).
3. Ainda no Graph Explorer, conceda o app à pasta, somente leitura (troque `{driveId}`, `{idDaPasta}` e o ID do aplicativo):
   `POST https://graph.microsoft.com/v1.0/drives/{driveId}/items/{idDaPasta}/permissions`
   ```json
   { "roles": ["read"], "grantedToIdentities": [ { "application": { "id": "<AZURE_CLIENT_ID>", "displayName": "Farol-OneDrive-Sync" } } ] }
   ```
   Para fazer isso, quem executa precisa ter controle sobre a pasta. Confira os detalhes na documentação da Microsoft, "Overview of selected permissions in OneDrive and SharePoint".
4. No `.env`:
   ```
   ONEDRIVE_DRIVE_ID=<driveId do passo 2>
   ONEDRIVE_PASTA_ID=<id da pasta do passo 2>
   ```
   (deixe `ONEDRIVE_USUARIO` e `ONEDRIVE_PASTA` vazios) e rode `npm run testar-onedrive`. Para ler uma subpasta específica, use o filtro `ONEDRIVE_ARQUIVO`.
5. **Confirme o limite:** o teste deve listar os arquivos da pasta e das subpastas. Tentar ler qualquer arquivo fora dela deve dar erro 403.

Se a TI não puder usar `Files.SelectedOperations.Selected`, a alternativa é **`Sites.Selected`**: limita a **um site/biblioteca** do SharePoint (mais amplo que uma pasta), e funciona se os relatórios ficarem numa biblioteca própria.

## 4. Segurança

- O `.env` guarda o segredo do Azure e **nunca** vai para o GitHub (já está no `.gitignore`). Se o segredo vazar, apague-o no Azure e gere outro.
- Defina `SYNC_SECRET` (qualquer texto longo e aleatório) para proteger `/api/sync` e `/api/banco`. Sem ele, o servidor local só atende chamadas feitas no próprio computador.
- O servidor local só escuta em `127.0.0.1` (não aparece para outros computadores da rede).
- O site só entrega `index.html` e os `.json` do site. Código, `dados/`, `.env` e `banco2026*` nunca são entregues (testado).
- O segredo do Azure é guardado como **segredo de aplicativo**: dá acesso de leitura só ao que você liberou no passo 4.

## 5. Quando for para o Vercel

1. **Neon** (região `sa-east-1`): crie o banco e copie a string de conexão → `DATABASE_URL`. As tabelas são criadas sozinhas na primeira execução (ou rode `db/schema.sql`).
2. **Vercel → Settings → Environment Variables:** `ONEDRIVE_MODO=graph`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `ONEDRIVE_USUARIO` (ou `ONEDRIVE_DRIVE_ID` / `SHAREPOINT_SITE_ID`), `ONEDRIVE_PASTA`, `DATABASE_URL` e `CRON_SECRET` (o Cron do Vercel envia essa chave sozinho).
3. `vercel.json` já agenda `/api/sync` **uma vez por dia às 09:00 UTC** (06:00 em Brasília), o limite do plano gratuito. Em plano pago dá para trocar por uma frequência maior.
4. Para trazer o histórico para o Neon: com `DATABASE_URL` preenchida no `.env`, rode `npm run importar-export -- banco2026_v2_parte*.json`.
5. **GitHub:** não envie `banco2026*.json`, `dados/` nem o `.env` (o `.gitignore` já bloqueia). Se o repositório for público, também não envie arquivos `historico_*.json` e `*_config.json` com dados reais da operação.

## 6. O que cada arquivo faz

| Arquivo | Função |
|---|---|
| `servidor.js` | site local + API + sincronização agendada |
| `api/sync.js`, `api/banco.js` | endpoints (iguais no local e no Vercel) |
| `lib/graph.js` | conexão com o OneDrive pela Microsoft Graph |
| `lib/fonteLocal.js` | lê a pasta do OneDrive sincronizada no PC |
| `lib/banco.js` | colunas e regras do Banco SIGA (as mesmas do site) |
| `lib/sync.js` | decide o que importar e grava no banco |
| `lib/store.js` | guarda os dados: arquivos locais ou Postgres |
| `scripts/` | `testar-onedrive`, `sincronizar`, `importar-export`, `importar-consolidado` |
| `lib/xlsxStream.js`, `lib/consolidado.js` | leitura em fluxo de planilhas gigantes e importação do consolidado |
| `test/` | `npm test` (46 testes) |

## 7. Endpoints

- `GET /api/banco?acao=status`: resumo (dias por fonte, última sincronização)
- `GET /api/banco?acao=indice`: dias e quantidade de linhas por fonte
- `GET /api/banco?acao=dia&fonte=COI&data=2026-11-10`: atividades do dia
- `GET /api/sync` (ou `?dry=1` para só simular): lê o OneDrive e importa

Com `SYNC_SECRET` definido, envie `Authorization: Bearer <chave>` (ou o cabeçalho `x-sync-key`).
