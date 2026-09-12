# Prompt para o Antigravity — validação e commit da infraestrutura de email

**Projeto:** `C:\Users\helde\Desktop\Dev\helderlabs-erp`
**Origem:** alterações escritas pelo Claude, já no teu disco, **por commitar**
**Versão:** 1.3.0 (sem bump — nada aqui muda o contrato da API)

---

## 0. Antes de tudo: houve trabalho teu preservado e trabalho teu alterado

Estiveste a escrever no repositório ao mesmo tempo. As versões do disco foram
lidas antes de qualquer escrita e a escrita usou guarda de data de modificação.
Três pontos que te dizem respeito:

1. **`users.emailVerifiedAt` + `emailVerificationToken` + `emailVerificationExpiresAt`
   são teus e ficaram.** O Claude tinha preparado uma migração concorrente e
   apagou-a — a tua é melhor.
2. **`sendUserVerificationLinkEmail` é teu e ficou**, com a mesma assinatura.
   Passou a usar o invólucro comum, com `esc()` no nome e `safeUrl()` na URL.
3. **O recurso para `onboarding@resend.dev` foi alterado.** Estava silencioso.
   Passou a opt-in explícito (`RESEND_ALLOW_SANDBOX_FALLBACK`), desligado por
   omissão, ignorado em produção, e o resultado vem marcado
   `SENT_VIA_SANDBOX_SENDER`. **Não o voltes a pôr silencioso.** Razão: esse
   remetente só entrega ao dono da conta Resend, portanto não resolve nada para
   um utilizador real — só esconde que o domínio continua por verificar.

---

## 1. Ficheiros alterados

```
backend/src/modules/platform/services/EmailService.ts            reescrito (merge)
backend/src/modules/platform/controllers/ApplicationController.ts 1 alteração
backend/src/modules/platform/routes/platform.routes.ts            2 endpoints novos
backend/src/plugins/requireVerifiedEmail.ts                       NOVO (desligado)
backend/tests/platform/email-service.test.ts                      NOVO (18 testes)
backend/scripts/ovh-configure-dns.mjs                             corrigido
backend/.env.example                                              documentado
PROJECT_STATE.md                                                  atualizado
```

**Nenhuma migração nova. Nenhuma alteração ao `schema.prisma`.**
A base de dados de produção **não** precisa de ser tocada por este trabalho.

---

## 2. O que tens de correr

```bash
cd backend
npx prisma generate
npm run typecheck      # tem de dar 0 erros
npm run lint           # tem de dar 0 erros
npm test               # 169 + 18 = 187 testes esperados, todos verdes
```

> O Claude correu `tsc` num ambiente onde o Prisma **não** consegue gerar o
> cliente. Os nomes de campos do Prisma **não estão validados por tipos** do lado
> dele. Se `npx prisma generate && npm run typecheck` acusar algo em
> `ApplicationController.ts` relacionado com `emailVerifiedAt`, é aí.

Se `npm test` acusar falhas em `tests/platform/email-service.test.ts`:
**não alteres o teste para ele passar.** Reporta a falha exata. Esses testes
descrevem comportamento pretendido, não estado atual.

---

## 3. O que NÃO deves fazer

- ❌ **Não faças deploy** sem autorização explícita do Hélder.
- ❌ **Não declares o email pronto.** `helderlabs.eu` está em `not_started` no
  Resend. Sem DNS publicado não há entrega externa possível.
- ❌ **Não voltes a pôr o recurso de remetente silencioso.**
- ❌ **Não ligues `ENFORCE_EMAIL_VERIFICATION`.** A guarda está implementada e
  desligada de propósito; ligá-la fecha a porta a contas legítimas antigas.
- ❌ **Não encurtes o prazo do OTP.** São 24 horas no código e o email já diz a
  verdade. Encurtar é decisão do Hélder.
- ❌ **Não corras nada destrutivo** contra a base de dados de produção.

---

## 4. Se tiveres acesso às credenciais da OVH

Só neste caso, e só se o Hélder autorizar:

```bash
export RESEND_API_KEY=...
export OVH_APPLICATION_KEY=...
export OVH_APPLICATION_SECRET=...
export OVH_CONSUMER_KEY=...
node backend/scripts/ovh-configure-dns.mjs
```

O script cria, no domínio `helderlabs.eu`:

```
TXT  resend._domainkey  <DKIM vindo da API do Resend>
TXT  send               v=spf1 include:amazonses.com ~all
MX   send               feedback-smtp.eu-west-1.amazonses.com   (prio 10)
TXT  _dmarc             v=DMARC1; p=none; rua=mailto:helderguiomar@gmail.com
```

**O SPF da raiz não é tocado** — é o email normal do domínio. O script aborta se
o SPF ou o MX do Resend fossem parar à raiz.

Depois disto, e só depois: verificar o domínio no Resend e **enviar um email
real para um endereço que não seja o do Hélder**. Uma resposta HTTP 200 não é
prova de entrega.

---

## 5. Commit sugerido (só depois de tudo verde)

```
feat(email): Resend como serviço transacional central da plataforma

- EmailService: retentativas com idempotência, escape de dados externos,
  parte text/plain, pt-PT e inglês, 10 tipos de email
- corrige: falha de auditoria fazia o email ser reenviado três vezes
- corrige: validade do OTP no texto (15 min -> 24 h, o valor real)
- recurso para onboarding@resend.dev passa a opt-in explícito e assinalado
- GET /api/platform/email/health e /email/logs
- guarda requireVerifiedEmail (implementada, desligada)
- emailVerifiedAt passa de account_requests para o utilizador na aprovacao
- corrige script de DNS: SPF/MX no subdominio send, MX criado
- 18 testes novos

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016UusE2VdM5uiRUGqXLhU1v
```

---

## 6. Relatório que tens de devolver

1. Resultado exato de `typecheck`, `lint` e `test` (números, não "tudo verde")
2. Qualquer teste que tenha falhado, com a mensagem literal
3. Se correste o script de DNS: o output completo
4. Se o domínio ficou `verified` ou não
5. **Se enviaste um email real para um endereço externo e se ele chegou**
6. O que não conseguiste fazer e porquê

**Se não conseguires confirmar entrega externa, escreve
`EXTERNAL EMAIL DELIVERY: NOT CONFIRMED`. Não inventes.**
