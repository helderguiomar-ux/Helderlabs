# PROMPT ÚNICO — Antigravity
## Confirmar o Resend, publicar em online + desktop, e selar a versão canónica de 12/09/2026

**Projeto:** `C:\Users\helde\Desktop\Dev\helderlabs-erp`
**Branch:** `master`
**Versão a produzir:** **1.4.0** · tag `v1.4.0` · **versão canónica de 12/09/2026**
**Estado de partida:** alterações do Claude já escritas no disco, **por commitar**

---

## REGRAS QUE NÃO SE NEGOCEIAM

1. **HTTP 200 não é prova de entrega.** Um email só conta como entregue quando o
   Resend disser `delivered` para esse `id`. Nada de "o envio devolveu sucesso".
2. **Um email para o `helderguiomar@gmail.com` não prova nada.** O remetente
   partilhado do Resend entrega sempre ao dono da conta, com ou sem domínio
   verificado. **A prova exige um endereço que NÃO seja o do Hélder.**
3. **Não inventes. Não assumas.** Se uma etapa depender de acesso que não tens,
   escreve que não a fizeste e porquê. Não a declares concluída.
4. **Nenhuma operação destrutiva** na base de dados de produção. Nada de `DROP`,
   `TRUNCATE`, `DELETE` massivo, `migrate reset`, `db push` destrutivo.
5. **Nunca `git reset --hard`, `checkout` que descarte, `clean` ou rebase
   destrutivo** sobre trabalho não commitado.
6. **O deploy para produção só acontece com autorização explícita do Hélder.**
7. **Se um passo falhar, PARA.** Reporta e espera. Não contornes.

---

## PASSO 0 — Ponto de partida verificado (não é suposição)

Estado do Resend confirmado na API viva em 12/09/2026:

| | |
|:--|:--|
| Domínio | `helderlabs.eu` (`2102dbd0-0460-447c-ba36-88ad089f8cfe`) |
| **Estado** | **`not_started`** — nenhum registo DNS publicado |
| Região | `eu-west-1` (entrega por Amazon SES) |
| Histórico | 11 emails, todos para o dono da conta, por `onboarding@resend.dev` |

**Conclusão de partida: o Resend NÃO está a confirmar nada.** Este prompt existe
para mudar isso e depois provar que mudou.

Confirma tu próprio antes de avançar:

```bash
curl -s -H "Authorization: Bearer $RESEND_API_KEY" \
  https://api.resend.com/domains/2102dbd0-0460-447c-ba36-88ad089f8cfe
```

Regista o `status` que te aparece. Se já vier `verified`, salta o Passo 3 e diz
que já estava.

---

## PASSO 1 — Subir a versão para 1.4.0

Alterar em `backend/src/version.ts`:

```ts
export const APP_VERSION = '1.4.0';
```

**`MINIMUM_CLIENT_VERSION` fica em `1.2.0`.** Não mexas. Razão: tudo o que esta
versão acrescenta é aditivo (dois endpoints novos de plataforma, nenhuma
alteração de contrato). Subir trancaria à porta o cliente desktop que o Hélder
tem a correr.

Acompanhar nos dois `package.json` (raiz e `backend/`): `"version": "1.4.0"`.

Atualizar o comentário abaixo de `MINIMUM_CLIENT_VERSION` para dizer 1.4.0 em
vez de 1.3.0, mantendo a explicação.

---

## PASSO 2 — Validação local (antes de commitar seja o que for)

```bash
cd backend
npx prisma generate
npm run typecheck      # 0 erros
npm run lint           # 0 erros
npm test               # 169 + 18 = 187 esperados
```

**Se `tests/platform/email-service.test.ts` falhar: NÃO alteres o teste para ele
passar.** Esses 18 testes descrevem comportamento pretendido. Reporta a mensagem
literal da falha e para.

> O Claude correu `tsc` num ambiente onde o Prisma não gera o cliente. Os nomes
> de campos do Prisma **não estão validados por tipos** do lado dele. Se algo
> rebentar em `ApplicationController.ts` a propósito de `emailVerifiedAt`, é aí.

**Portão:** se qualquer um destes não estiver verde, para aqui.

---

## PASSO 3 — Publicar o DNS na OVH

Precisas de três credenciais que podes não ter:
`OVH_APPLICATION_KEY`, `OVH_APPLICATION_SECRET`, `OVH_CONSUMER_KEY`.

**Se não as tiveres: PARA e diz ao Hélder que precisa de as gerar em**
`https://eu.api.ovh.com/createToken/?GET=/domain/zone/helderlabs.eu/*&POST=/domain/zone/helderlabs.eu/*&PUT=/domain/zone/helderlabs.eu/*&DELETE=/domain/zone/helderlabs.eu/*`

Com as credenciais:

```bash
cd backend
node scripts/ovh-configure-dns.mjs
```

O script cria exatamente isto — e os valores vêm da API do Resend, não estão
escritos à mão:

```
TXT  resend._domainkey  p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDm4h/ZDagl...
TXT  send               v=spf1 include:amazonses.com ~all
MX   send               feedback-smtp.eu-west-1.amazonses.com   (prio 10)
TXT  _dmarc             v=DMARC1; p=none; rua=mailto:helderguiomar@gmail.com
```

**Três coisas que tens de confirmar no output:**

1. O SPF foi criado em **`send`**, não na raiz. O script aborta se fosse à raiz.
2. O **MX foi criado**. A versão anterior do script nunca o criava.
3. A linha `[INFO] SPF da raiz mantido inalterado: ...` — o SPF da raiz é o email
   normal do domínio e **não pode ser tocado**.

Depois, confirma na zona:

```bash
nslookup -type=TXT send.helderlabs.eu
nslookup -type=MX  send.helderlabs.eu
nslookup -type=TXT resend._domainkey.helderlabs.eu
```

A propagação pode demorar. Se ainda não resolver, espera e repete — **não
avances a fingir que resolveu**.

---

## PASSO 4 — Fazer o Resend verificar

```bash
curl -s -X POST -H "Authorization: Bearer $RESEND_API_KEY" \
  https://api.resend.com/domains/2102dbd0-0460-447c-ba36-88ad089f8cfe/verify
```

E depois consultar até o estado mudar:

```bash
curl -s -H "Authorization: Bearer $RESEND_API_KEY" \
  https://api.resend.com/domains/2102dbd0-0460-447c-ba36-88ad089f8cfe
```

**Portão:** só avanças quando o domínio disser **`verified`** e os três registos
disserem `verified` individualmente. `pending` não serve. `not_started` não
serve.

Se ficar em `failed`, lê qual dos três falhou e corrige esse registo. Não
tentes contornar.

---

## PASSO 5 — PROVA DE ENTREGA EXTERNA (o portão que interessa)

Este é o passo que distingue "parece funcionar" de "funciona".

1. Põe no ambiente: `RESEND_FROM_EMAIL=noreply@helderlabs.eu` e
   `RESEND_FROM_NAME="HelderLabs ERP"`.
2. **Garante que `RESEND_ALLOW_SANDBOX_FALLBACK` NÃO está a `true`.** Se estiver,
   o envio pode sair pelo remetente partilhado e a prova não vale nada.
3. Envia **um email real para um endereço que NÃO seja `helderguiomar@gmail.com`**
   — pede um ao Hélder se não tiveres.
4. Guarda o `id` devolvido.
5. **Confirma o estado desse email no Resend:**

```bash
curl -s -H "Authorization: Bearer $RESEND_API_KEY" \
  https://api.resend.com/emails/<ID_DEVOLVIDO>
```

**Portão:** o campo `last_event` tem de dizer **`delivered`**. Não `sent`.
Não `queued`. E o `from` tem de ser `noreply@helderlabs.eu`, não
`onboarding@resend.dev`.

6. Confirma também que o resultado do `EmailService` **não** veio marcado com
   `SENT_VIA_SANDBOX_SENDER`. Se veio, o domínio não está a ser usado e a prova
   não conta.

**Se não conseguires este passo, escreve `EXTERNAL EMAIL DELIVERY: NOT CONFIRMED`
e para. Não inventes que foi feito.**

---

## PASSO 6 — Commit e tag

Só depois de 2, 4 e 5 verdes.

```bash
git status                 # confirma o que vai entrar
git add -A
git commit -F -            # mensagem abaixo
git tag -a v1.4.0 -m "v1.4.0 — versão canónica de 12/09/2026"
git rev-parse HEAD         # GUARDA ESTA SHA. É a SHA canónica.
git push origin master --follow-tags
```

Mensagem de commit:

```
feat(email): Resend como servico transacional central da plataforma (v1.4.0)

- EmailService: retentativas com idempotencia, escape de dados externos,
  parte text/plain, pt-PT e ingles, 10 tipos de email
- corrige: falha de auditoria fazia o email ser reenviado tres vezes
- corrige: validade do OTP no texto (15 min -> 24 h, o valor real)
- recurso para onboarding@resend.dev passa a opt-in explicito e assinalado
- GET /api/platform/email/health e /email/logs
- guarda requireVerifiedEmail (implementada, desligada)
- emailVerifiedAt passa de account_requests para o utilizador na aprovacao
- corrige script de DNS: SPF/MX no subdominio send, MX criado
- DNS de helderlabs.eu publicado e dominio verificado no Resend
- 18 testes novos (187 no total)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016UusE2VdM5uiRUGqXLhU1v
```

---

## PASSO 7 — Publicar online

**Pede autorização explícita ao Hélder antes deste passo.**

Deploy para produção (Vercel, `https://helderlabs.eu`). Sem migrações: esta
versão **não altera o `schema.prisma`** e **não traz migração nova**. A base de
dados não precisa de ser tocada.

Verificações obrigatórias em produção:

```bash
curl -s https://helderlabs.eu/api/version
```

1. `version` = **`1.4.0`**
2. `minimumClientVersion` = **`1.2.0`**
3. `commit` (ou SHA equivalente) = **a SHA que guardaste no Passo 6**

E os dois endpoints novos, autenticado como super-admin:

```bash
curl -s -H "Authorization: Bearer <TOKEN_SUPER_ADMIN>" \
  https://helderlabs.eu/api/platform/email/health
```

4. `healthy: true` e `config.apiKeyConfigured: true`
5. `config.from` = `HelderLabs ERP <noreply@helderlabs.eu>`
6. **A chave da API NÃO aparece na resposta** — nem um fragmento. Verifica.
7. `problems` — lê o que lá estiver e reporta

```bash
curl -s -H "Authorization: Bearer <TOKEN_SUPER_ADMIN>" \
  https://helderlabs.eu/api/platform/email/logs?limit=10
```

8. Aparece o envio do Passo 5, com `action: email.sent`

9. **Retrocompatibilidade:** um pedido com
   `X-HelderLabs-Client-Version: 1.2.0` tem de receber **200**, não 426.

---

## PASSO 8 — Publicar no desktop e provar a paridade

Esta é a parte que o Hélder pediu explicitamente: **a mesma versão nos dois
sítios**, não duas versões parecidas.

Recorda a arquitetura oficial:

```
DESKTOP LOCAL ──┐
                ├──► API ONLINE ──► PostgreSQL ONLINE
WEB ────────────┘
```

O cliente desktop **não** é um build separado: é `local-client/server.mjs` a
servir os mesmos ficheiros de `backend/public/`, a falar com a **mesma API
online**. Atualiza-se por `git pull`, não por deploy.

**No computador do Hélder:**

```bash
cd C:\Users\helde\Desktop\Dev\helderlabs-erp
git pull
git rev-parse HEAD
```

**Portão de canonicidade — as três SHA têm de ser a MESMA:**

| Onde | Como obter | Tem de dar |
|:--|:--|:--|
| Git (tag) | `git rev-list -n 1 v1.4.0` | SHA canónica |
| Produção | `curl https://helderlabs.eu/api/version` → campo do commit | SHA canónica |
| Desktop | `git rev-parse HEAD` na pasta do Hélder | SHA canónica |

**Se as três não coincidirem, a versão canónica não existe.** Reporta qual
diverge e para.

Depois, com o cliente local a correr:

```bash
node local-client/server.mjs      # ou o atalho / launch.vbs
```

10. Abrir `http://localhost:3400` e confirmar que carrega
11. `http://localhost:3400/assets/js/config.js` aponta para a **API online**
    (`https://helderlabs.eu`), **não** para `localhost`
12. Fazer login e abrir o **HCCALL no telemóvel ou no browser** — as vendas que
    aparecem são as da base de dados **online**, as mesmas que aparecem na web
13. Nenhum erro de consola
14. **Confirmar que não existe base de dados local em lado nenhum**: nenhum
    SQLite, nenhum ficheiro de dados, nenhum IndexedDB como fonte, nenhum
    fallback para `localhost` na API

**Portão:** se o cliente desktop estiver a servir conteúdo diferente do da web,
ou a falar com outra API, a versão não é canónica.

---

## PASSO 9 — Selar a versão canónica de 12/09/2026

Atualizar, na raiz do repositório:

**`PROJECT_STATE.md`** — no bloco `ESTADO ATUAL`:

```
| Versão do código      | 1.4.0 · commit <SHA> |
| Versão em produção    | 1.4.0 · commit <SHA> |
| Versão no desktop     | 1.4.0 · commit <SHA> |
| MINIMUM_CLIENT_VERSION| 1.2.0 |
| Tag                   | v1.4.0 — VERSÃO CANÓNICA DE 12/09/2026 |
| Domínio Resend        | helderlabs.eu · verified |
| Entrega externa       | confirmada · <email de destino> · <id> · delivered |
```

E riscar da lista de bloqueadores o **"DNS do Resend por publicar"**, deixando
os que continuam abertos (password do super-administrador; prazo de 24h do OTP).

Acrescentar uma sessão nova com o que correu, o que falhou e o que ficou.

**`CHANGELOG.md`** — entrada `## [1.4.0] — 2026-09-12` com as alterações.

**`ESTADO.md`** — atualizar a versão para 1.4.0.

**Declaração a escrever, textualmente, no `PROJECT_STATE.md`:**

> **Versão canónica de 12/09/2026: `v1.4.0`, commit `<SHA>`.**
> É esta a versão que corre em produção e no cliente desktop. Qualquer cópia
> anterior — local, em pasta separada, ou num agente — deixa de ser referência.

---

## PASSO 10 — Relatório obrigatório

Devolve isto preenchido com **valores reais**, nunca com "OK" genérico:

```
PASSO 1 — versão                    [ ] APP_VERSION: ______
PASSO 2 — typecheck                 [ ] erros: ______
PASSO 2 — lint                      [ ] erros: ______
PASSO 2 — testes                    [ ] ______ / ______ verdes
PASSO 3 — DNS publicado             [ ] SPF em "send": ___  MX criado: ___  raiz intacta: ___
PASSO 4 — domínio Resend            [ ] estado: ____________
PASSO 5 — entrega externa           [ ] destino: __________  id: __________  last_event: __________
PASSO 5 — remetente usado           [ ] ____________________ (tem de ser @helderlabs.eu)
PASSO 6 — commit + tag              [ ] SHA: ____________________
PASSO 7 — produção /api/version     [ ] version: ______  SHA coincide: ___
PASSO 7 — /email/health             [ ] healthy: ___  chave exposta: ___ (tem de ser NÃO)
PASSO 7 — cliente 1.2.0             [ ] recebe 200: ___
PASSO 8 — SHA git / prod / desktop  [ ] coincidem: ___
PASSO 8 — desktop usa API online    [ ] ___
PASSO 8 — sem BD local              [ ] ___
PASSO 9 — documentação selada       [ ] ___
```

### BLOCO FINAL — escreve exatamente neste formato

```
RESEND DOMAIN VERIFICATION:   VERIFIED / NOT VERIFIED
DNS RECORDS PUBLISHED:        YES / NO
EXTERNAL EMAIL DELIVERY:      CONFIRMED / NOT CONFIRMED
  └─ destinatário: ____  id: ____  last_event: ____

ONLINE DEPLOY:                DONE / NOT DONE   · SHA: ______
DESKTOP UPDATED:              DONE / NOT DONE   · SHA: ______
SHA PARITY (git/prod/desktop):MATCH / MISMATCH

CANONICAL VERSION 12/09/2026: SEALED / NOT SEALED
  └─ v1.4.0 · commit ______

OVERALL:                      READY / NOT READY
```

**Não escrevas `READY` enquanto `EXTERNAL EMAIL DELIVERY` não for `CONFIRMED`
com um destinatário que não seja o Hélder.** Um domínio verificado sem um email
entregue a terceiros continua a ser uma suposição.

**Não escrevas `SEALED` enquanto as três SHA não coincidirem.**

Se ficares bloqueado num passo, diz em qual, porquê, e o que precisas do Hélder.
