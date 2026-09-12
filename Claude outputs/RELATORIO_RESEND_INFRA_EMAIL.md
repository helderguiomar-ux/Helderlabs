# Resend como infraestrutura central de email — HelderLabs ERP

**Data:** 12/09/2026 · **Agente:** Claude · **Domínio:** helderlabs.eu
**Âmbito:** plataforma inteira (Plataforma, Auth, CRM, 2SellMais, Finanças, HCCALL)

> Aviso de leitura: tudo o que está neste relatório foi **verificado**. Onde não
> consegui verificar, digo que não consegui e porquê. Nada aqui é assumido.

---

## 0. O que encontrei antes de tocar em nada

O `EmailService` já era o ponto único de contacto com o Resend — isso estava
bem e não foi refeito. O que estava mal era outra coisa: **o serviço mentia por
omissão em três sítios diferentes**, e cada uma dessas mentiras explicava um
sintoma que já tinhas visto.

---

## 1. Estado real da conta Resend (dados vivos, não do código)

| | |
|:--|:--|
| Domínio | `helderlabs.eu` |
| ID | `2102dbd0-0460-447c-ba36-88ad089f8cfe` |
| **Estado** | **`not_started`** — nenhum registo DNS foi publicado |
| Região | `eu-west-1` (envia por Amazon SES) |
| Envio / Receção | ativado / desativado |
| Criado em | 04/08/2026 |

### Registos que o Resend exige — valores EXATOS desta conta

```
TXT   resend._domainkey   p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDm4h/ZDaglIhKbPlrZBh71wyY4ra9l
                          dOg5q86y5ldvAqwokJ7s8ivCtTWkRJYGQ5cQVHlU+HrQFsBVeFFn/QCaTxmzIpau7t1c
                          zZxFiOe6HhXkHBHnFzVXyKpZWy1GYRCsv39V+21e9KOlB4NJbXFvDU4G1o2Enscyt7xN
                          GS90TQIDAQAB

TXT   send                v=spf1 include:amazonses.com ~all
MX    send                feedback-smtp.eu-west-1.amazonses.com     (prioridade 10)
```

**Confirmo o que tinhas avisado:** o SPF **não** é `include:resend.com`. É
`include:amazonses.com`, porque na região `eu-west-1` o Resend entrega por
Amazon SES. Quem copiasse o exemplo genérico da internet punha o valor errado.

E há um segundo detalhe que se perde com facilidade: **o SPF e o MX vivem no
subdomínio `send`, não na raiz.** Não se toca no SPF da raiz — isso é o email
normal do domínio.

### Histórico de envio

11 emails desde sempre, todos a 23/08/2026, **todos para `helderguiomar@gmail.com`**,
todos com remetente `HelderLabs ERP <onboarding@resend.dev>`.

11 entregues · 0 devolvidos · 0 queixas · 0 falhados. Reputação limpa —
mas limpa porque nunca saiu nada para o mundo real.

`onboarding@resend.dev` é o remetente partilhado do Resend e **só entrega ao
dono da conta**. Na prática, o sistema nunca enviou um email a ninguém que não
sejas tu.

---

## 2. Colisão com o Antigravity — e o que fiz com ela

O Antigravity estava a escrever no repositório **durante** este trabalho
(`app.ts` às 19:36, `schema.prisma` às 19:20, `EmailService.ts` às 19:12).
Fui buscar as versões do teu disco antes de escrever seja o que for, e comparei.

**Três decisões:**

### 2.1 Descartei trabalho meu que era pior do que o dele

Eu tinha preparado `users.emailVerifiedAt` + migração. O Antigravity já tinha
acrescentado `emailVerifiedAt`, `emailVerificationToken` e
`emailVerificationExpiresAt` ao `User`, com um fluxo de validação por ligação.
**É melhor do que a minha versão** — a minha era só uma bandeira, a dele é um
fluxo completo. Apaguei a minha migração e fiquei com a dele.

### 2.2 Preservei o que ele fez de bom

O método `sendUserVerificationLinkEmail` é dele. Mantive-o com a mesma
assinatura e o mesmo propósito — mas a passar pelo invólucro comum, com o nome
e a URL escapados (antes iam em bruto para dentro do HTML).

### 2.3 Discordo de uma coisa, e explico porquê

Ele acrescentou um **recurso silencioso**: quando o Resend recusa por domínio
não verificado, o envio era repetido a partir de `onboarding@resend.dev`.

Isto parece uma solução e é o contrário disso:

- `onboarding@resend.dev` **só entrega ao dono da conta**. Para qualquer outro
  destinatário falha na mesma — não resolve nada para um utilizador real;
- faz os **teus** testes passarem, porque tu recebes. Esconde exatamente aquilo
  que este trabalho existe para tornar visível: o domínio continua por verificar;
- repetia o POST **sem chave de idempotência**, o que pode duplicar emails.

**Não o apaguei** (tinha uma finalidade: deixar-te continuar a testar). Passei-o
a explícito:

- desligado por omissão — `RESEND_ALLOW_SANDBOX_FALLBACK=true` para ligar;
- **ignorado em produção**, sempre;
- quando dispara, escreve um aviso no log e devolve `code: 'SENT_VIA_SANDBOX_SENDER'`,
  com a mensagem a dizer que só chegou ao dono da conta;
- usa chave de idempotência própria, porque remetente diferente é email diferente.

Assim continua a servir-te para testar, mas **nenhum teste pode ficar verde a
pensar que o envio foi normal.**

---

## 3. O que corrigi no `EmailService`

### 3.1 Uma falha de auditoria fazia o email sair três vezes

Encontrado pelo teste, não por leitura. A auditoria do sucesso estava **dentro**
do `try` do ciclo de retentativas. A `AuditService` lança de propósito quando
não consegue gravar um evento de segurança — e essa exceção era apanhada pelo
`catch` como se fosse falha de rede. Resultado: envio bem-sucedido tratado como
falha, e **reenviado**.

Corrigido: a auditoria do sucesso passou para fora do ciclo. Se a gravação
falhar, o email já saiu — abortar não o traz de volta e repetir duplicava-o. O
chamador recebe `ok: true` com `code: 'SENT_BUT_NOT_AUDITED'`. A falha é
assinalada, não escondida. **Há um teste de regressão para isto.**

### 3.2 Os emails mentiam sobre a validade do código

O texto dizia *"expira em 15 minutos"*. O código faz:

```ts
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas
```

O Antigravity corrigiu o texto para 24 horas. Mantive. Agora a validade vem de
uma constante única (`OTP_VALIDITY_LABEL`) com o valor real documentado ao lado.

> ⚠️ **Para tua decisão:** 24 horas é muito para um código de 6 dígitos. O
> habitual são 5–15 minutos. O `otpAttempts` limita a força bruta, mas não
> protege de um código interceptado e usado horas depois. **Não encurtei** —
> é alteração de comportamento e alguém alargou o prazo de propósito
> (provavelmente porque os emails não chegavam). Quando o domínio estiver
> verificado, este prazo devia voltar a ser curto.

### 3.3 Dados de utilizador iam em bruto para dentro do HTML

`${name}` era interpolado sem escape. Um nome como
`</div><a href="javascript:...">` num pedido de acesso injetava marcação e
ligações num email que aparenta ser nosso. Não é XSS clássico — os clientes de
email não correm scripts — mas é falsificação de conteúdo.

Corrigido: tudo o que vem de fora passa por `esc()`, e as URLs dos botões por
`safeUrl()` (só `http(s)`; qualquer outra coisa cai no `APP_URL`). **Testado.**

### 3.4 Todos os emails eram só-HTML

Sem parte `text/plain`. Isso é penalizado pelos filtros de spam e é ilegível em
clientes de texto. Agora todos os envios levam as duas partes.

### 3.5 Sem retentativas, sem idempotência

Um 503 momentâneo do Resend perdia o email. Agora: 3 tentativas com espera
crescente, só em 429 e 5xx (repetir um 4xx dá o mesmo resultado), **sempre com
a mesma chave de idempotência** — uma retentativa depois de um timeout não pode
duplicar o email. **Testado.**

### 3.6 O modo simulado era indistinguível de um envio a sério

Sem `RESEND_API_KEY`, o serviço devolvia `ok: true`. Uma suite inteira podia
passar a verde sem nunca ter falado com o fornecedor. Agora devolve
`simulated: true` e o log diz **"SIMULADO — NADA FOI ENVIADO"**. Em produção
continua a falhar de forma explícita, como já fazia.

### 3.7 Três cópias do mesmo HTML

Cada template repetia cabeçalho e rodapé. Agora há um invólucro único e cada
template só descreve o miolo.

---

## 4. O que acrescentei

**Configuração** — `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`, `RESEND_REPLY_TO`,
`APP_URL`, `RESEND_ALLOW_SANDBOX_FALLBACK`, `ENFORCE_EMAIL_VERIFICATION`.
`SMTP_FROM` continua aceite para não partir o que já está em produção.

> Não havia `reply-to`. Quem respondesse a um email do ERP não chegava a ninguém.

**Tipos de email que faltavam** — além dos três que existiam (verificação, OTP,
conta aprovada) e do `sendUserVerificationLinkEmail` do Antigravity:

`sendAccountRejectedEmail` · `sendWelcomeEmail` · `sendPasswordResetEmail` ·
`sendInvitationEmail` · `sendSecurityAlertEmail` · `sendNotificationEmail`

O último existe para que **nenhum módulo tenha razão para chamar o Resend por
si**. HCCALL, CRM, 2SellMais e Finanças mandam notificações por aqui.

**Idiomas** — pt-PT e inglês, ambos escritos, não gerados. Acrescentar espanhol
ou francês é acrescentar uma entrada na tabela `STRINGS`. Não escrevi traduções
que não revi.

**Guarda contra ciclos** — máximo 8 envios por destinatário por minuto.
*Honestamente:* em Vercel isto é **por instância**, portanto é uma rede contra
um ciclo acidental, **não** um limite de segurança. O limite verdadeiro teria de
viver na base de dados.

**Diagnóstico** — `GET /api/platform/email/health` (super-admin) diz se está
configurado, qual o remetente, e lista os problemas. Devolve `apiKeyConfigured`
como booleano: **a chave nunca aparece, nem um fragmento dela**. E
`GET /api/platform/email/logs` mostra os últimos eventos de email na auditoria.

**Guarda `requireVerifiedEmail`** — implementada, **desligada**, não ligada a
nenhuma rota. Ligá-la fecharia a porta a contas legítimas anteriores ao fluxo de
validação. O ficheiro diz como ligar e o que confirmar antes.

**Transporte da verificação** — quando um pedido de acesso verificado dá origem
a uma conta, o `emailVerifiedAt` passa agora para o utilizador. Antes a prova
ficava presa em `account_requests` e o utilizador nascia por verificar.

---

## 5. O script de DNS estava errado

`backend/scripts/ovh-configure-dns.mjs`, tal como estava:

| | Devia fazer | Fazia |
|:--|:--|:--|
| DKIM | `TXT resend._domainkey` | ✅ correto |
| SPF | `TXT send` | ❌ escrevia na **raiz** do domínio |
| MX | `MX send` prio 10 | ❌ **não criava de todo** |

Se o tivesses corrido tal como estava: o DKIM verificava, o SPF falhava por
estar no sítio errado, o MX não existia — **domínio NOT VERIFIED, sem indicação
do motivo**. E o SPF da raiz ficava alterado sem necessidade.

Corrigido:

- SPF e MX no subdomínio `send`;
- os valores vêm da **API do Resend para este domínio**, não escritos à mão —
  os valores em código são só recurso se a API não estiver acessível;
- normalização de `send.helderlabs.eu` → `send` (a OVH quer o nome relativo);
- **salvaguarda que aborta** se algum destes registos fosse parar à raiz;
- o SPF da raiz é lido e deixado **intacto**, com o valor registado no log.

`node --check` OK.

---

## 6. Verificações de segurança

| Verificação | Resultado |
|:--|:--|
| Chamadas ao Resend fora do `EmailService` | **nenhuma** para envio. Só `ovh-configure-dns.mjs`, que fala com `/domains` (administração de DNS), nunca com `/emails` |
| `RESEND` ou `re_...` em `backend/public/` | **nenhuma ocorrência** |
| Chave exposta ao cliente desktop | **não** — o cliente local só serve ficheiros estáticos |
| Chave em código | **não** — só `process.env` |
| Chave na auditoria | **não** — verificado por teste |
| Chave no `/email/health` | **não** — só um booleano |
| Outros fornecedores (nodemailer, SendGrid, Mailgun, Postmark, SMTP) | **nenhum** |

---

## 7. Testes

`backend/tests/platform/email-service.test.ts` — **18 testes, 18 verdes.**
Não tocam na rede nem na base de dados: interceptam o `fetch` e inspecionam o
que **teria** sido enviado ao Resend.

Cobrem: remetente, ausência da chave no diagnóstico, escape de marcação
injetada, `href` para `javascript:`, URL não-http num botão, parte de texto
simples, `reply_to`, chave de idempotência, pt/en, destinatário inválido, ciclo
de envio, recuperação de 503 com chave única, 4xx não repetido, produção sem
chave, `simulated: true` em dev, **regressão da falha de auditoria**, e auditoria
sem a chave.

**`tsc --noEmit`: zero erros novos.** (Os 34 restantes são a linha de base do
projeto + os 8 de `modules/finance`, e neste ambiente o Prisma não gera o
cliente — por isso os **nomes de campos do Prisma não estão validados por
tipos**. O Antigravity tem de correr `npx prisma generate && npm run typecheck`
na máquina real.)

---

## 8. O que NÃO consegui fazer, e porquê

**Publicar o DNS.** Não tenho `OVH_APPLICATION_KEY`, `OVH_APPLICATION_SECRET`
nem `OVH_CONSUMER_KEY`. O script está corrigido e pronto; falta correr.

**Confirmar entrega externa.** Sem o domínio verificado, o Resend não deixa
enviar para ninguém além de ti. Enquanto isso não acontecer, **não existe prova
de entrega externa** — e uma resposta HTTP 200 não é prova nenhuma.

**Recomendação de DMARC.** O script cria `_dmarc` com `p=none` se não existir.
`p=none` é o correto para começar: observa sem rejeitar. Só depois de algumas
semanas de relatórios limpos faz sentido subir para `p=quarantine`.

---

## 9. O que falta fazer, por ordem

1. Gerar as chaves da API da OVH em
   `https://eu.api.ovh.com/createToken/?GET=/domain/zone/helderlabs.eu/*&POST=/domain/zone/helderlabs.eu/*&PUT=/domain/zone/helderlabs.eu/*&DELETE=/domain/zone/helderlabs.eu/*`
2. `node backend/scripts/ovh-configure-dns.mjs` (com `RESEND_API_KEY` no ambiente)
3. Esperar a propagação e verificar o domínio no Resend
4. Confirmar que passa a `verified`
5. Pôr `RESEND_FROM_EMAIL=noreply@helderlabs.eu` no ambiente de produção
6. **Enviar um email real para um endereço que NÃO seja o teu** e confirmar que chega
7. Só então: `RESEND_ALLOW_SANDBOX_FALLBACK` pode sair do ambiente de vez

---

## 10. Bloqueadores que continuam em aberto (deste e de trabalhos anteriores)

1. 🔴 **Password do super-administrador por rodar** — continua `admin1234`
2. 🔴 **DNS do Resend por publicar** — bloqueia todo o fluxo de novo utilizador
3. 🟠 **OTP com 24 horas de validade** — decisão tua, com a nota de segurança acima

---

# BLOCO FINAL OBRIGATÓRIO

```
RESEND CONFIGURATION:        READY
  └─ Conta, chave, região e registos exigidos: todos verificados na API viva.

DOMAIN VERIFICATION:         NOT VERIFIED
  └─ helderlabs.eu está em `not_started`. Nenhum registo DNS foi publicado.
     Bloqueado por: credenciais da API da OVH que não tenho.

DNS RECORDS:                 NOT PUBLISHED
  └─ Os valores exatos estão apurados e o script está corrigido e testado
     (syntax check OK). Falta correr contra a OVH.

CENTRAL EMAIL SERVICE:       READY
  └─ Ponto único de saída. Retentativas, idempotência, escape, texto simples,
     dois idiomas, auditoria, diagnóstico. 18 testes verdes.

MODULE INTEGRATION:          READY
  └─ Quatro consumidores, todos via EmailService. Zero chamadas diretas ao
     Resend para envio em todo o código.

SECURITY:                    READY
  └─ Chave só no ambiente do backend. Zero exposição no frontend, no cliente
     desktop, na auditoria ou no endpoint de diagnóstico. Verificado, não assumido.

EMAIL TEMPLATES:             READY
  └─ 10 tipos, invólucro único, HTML + texto simples, pt-PT e inglês.

USER EMAIL VERIFICATION:     PARTIAL
  └─ O campo e o fluxo existem (Antigravity) e a prova do pedido de acesso passa
     agora para o utilizador. A imposição global está IMPLEMENTADA MAS DESLIGADA,
     à espera de autorização e de verificação das contas antigas.

LOGGING & OBSERVABILITY:     READY
  └─ Auditoria de sucesso, falha, simulação e bloqueio. GET /email/health e
     GET /email/logs.

EXTERNAL EMAIL DELIVERY:     NOT CONFIRMED
  └─ Impossível de confirmar enquanto o domínio não estiver verificado. Os 11
     emails que existem foram todos para o dono da conta, pelo remetente
     partilhado do Resend. NÃO existe prova de entrega a terceiros.

DEPLOY:                      NOT DONE
  └─ Nenhum commit, nenhum push, nenhuma alteração à base de dados de produção.

OVERALL:                     NOT READY
  └─ O código está pronto. A infraestrutura não está. Enquanto o DNS não for
     publicado e verificado, e não houver UM email entregue a um endereço que
     não o teu, isto não pode ser declarado pronto — e não vou declarar.
```

---

## Ficheiros escritos no teu repositório

Escritos com guarda de data de modificação (se o Antigravity tivesse tocado
neles entretanto, a escrita era recusada em vez de apagar o trabalho dele).
Nenhum foi recusado.

```
backend/src/modules/platform/services/EmailService.ts          (reescrito + merge)
backend/src/modules/platform/controllers/ApplicationController.ts (1 alteração)
backend/src/modules/platform/routes/platform.routes.ts         (2 endpoints novos)
backend/src/plugins/requireVerifiedEmail.ts                    (novo, desligado)
backend/tests/platform/email-service.test.ts                   (novo, 18 testes)
backend/scripts/ovh-configure-dns.mjs                          (corrigido)
backend/.env.example                                           (documentado)
```

Nenhuma operação destrutiva. Nenhuma alteração à base de dados de produção.
Nenhum `git` executado.
