# PROMPT — HELDERLABS ERP v2 · Verificação de Email, Ficha de Licenciamento, Tema Claro e Acessos

> Cola este documento inteiro no Antigravity, com o repositório `C:\Users\helde\Desktop\Dev\helderlabs-erp` aberto.

---

## 0 · Contexto e correcção ao relatório anterior

O relatório de intervenção anterior declarou concluído trabalho que **não foi feito**, e não detectou defeitos graves. Antes de começar, assume o seguinte como verificado por leitura directa do código:

**O que o relatório anterior disse mal:**

1. **"Bloco D — Ficha de Licenciamento" não foi implementado.** O que foi feito foi acrescentar checkboxes de módulos ao modal de aprovação. Não existe em lado nenhum um campo de valor mensal ou de data de renovação no interface.
2. **`backend/public/assets/js/api.js` mantém as quatro chaves de sessão** (`erp_session`, `hl_token`, `auth_token`, `erp_token`) em vez de convergir para uma. Isto foi descrito como "suporte resiliente"; é perpetuação de dívida técnica.
3. **Os 97 testes correm em 5,3 segundos** — isso não é E2E de browser real. O `npm run verify` inclui `test:e2e` e `test:browser`; confirma se correram de facto.

**O que o relatório não detectou (e é o mais importante):**

4. **O domínio `helderlabs.eu` NÃO está verificado no Resend.** Estado actual: `not_started`. Os três registos DNS (DKIM, SPF MX, SPF TXT) nunca foram adicionados. Isto significa que **nenhum email sai da plataforma** — o Resend rejeita qualquer envio a partir de `noreply@helderlabs.eu`. Ver secção 1.0.
5. **`POST /api/public/register` nunca envia email.** Gera o OTP, grava o `otpHash`, escreve no log e devolve *"Verifique o seu email"* — uma mensagem falsa. Não existe endpoint de verificação para esse código.
6. **`AuthService.sendOtp()` cria um `AccountRequest` para qualquer email desconhecido escrito no ecrã de login.** Qualquer pessoa consegue encher a fila de aprovações com endereços inventados, sem autenticação.
7. **O erro do Resend é engolido com `console.warn`.** Um email inexistente falha em silêncio e o utilizador é na mesma mandado consultar a caixa de correio.
8. **`approveAccountRequest` não verifica `emailVerifiedAt`.** É possível aprovar uma conta cujo email nunca foi validado.
9. **Existem dois módulos financeiros em paralelo:** `backend/src/modules/financas` (controller de 33 KB) e `backend/src/modules/finance` (sete controllers). Ambos vivos.
10. **`backend/backup-pre-migracoes-2026-09-07.dump` tem 0 bytes.** O backup anterior às migrações está vazio.
11. **O bloco de impersonation em `EntitlementService.resolveForUser` é código morto:** faz uma query à BD por cada módulo do catálogo e o resultado é descartado — `impersonation: null` está fixo no retorno.

Trabalha por tarefas. **Cada tarefa é um commit próprio. Não avances sem os testes da tarefa anterior a passar.**

---

## 1 · TAREFA A — Verificação de email e fila de aprovações

Objectivo: nenhum email inexistente chega à fila de aprovações do super-administrador.

### 1.0 · Pré-requisito de infra-estrutura (bloqueante, mas fora do código)

Enquanto o domínio não estiver verificado, nada do resto desta tarefa funciona em produção. Regista no relatório final que o Hélder tem de adicionar estes registos no DNS de `helderlabs.eu` e depois carregar em *Verify* no painel do Resend:

| Tipo | Nome | Valor | Prioridade |
|---|---|---|---|
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDm4h/ZDaglIhKbPlrZBh71wyY4ra9ldOg5q86y5ldvAqwokJ7s8ivCtTWkRJYGQ5cQVHlU+HrQFsBVeFFn/QCaTxmzIpau7t1czZxFiOe6HhXkHBHnFzVXyKpZWy1GYRCsv39V+21e9KOlB4NJbXFvDU4G1o2Enscyt7xNGS90TQIDAQAB` | — |
| MX | `send` | `feedback-smtp.eu-west-1.amazonses.com` | 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |

**Enquanto isso não estiver feito, usa um remetente de teste do Resend em desenvolvimento** e faz a aplicação avisar em arranque quando `RESEND_API_KEY` estiver ausente ou o remetente não for de domínio verificado.

### 1.1 · Serviço de email centralizado

Cria `backend/src/modules/platform/services/EmailService.ts`. Hoje a chamada ao Resend está embutida em `AuthService.sendOtp()`; passa a ser um serviço único, usado por todos os fluxos.

Requisitos:
- Método `send({ to, subject, html, tags })` que devolve **`{ ok: true, id }` ou `{ ok: false, code, message }`** — nunca engole o erro.
- Distingue explicitamente: falta de `RESEND_API_KEY`, domínio não verificado, endereço inválido/rejeitado, e falha de rede.
- Regista sempre o resultado na auditoria (`AuditService`), com o email destinatário, o resultado e o código de erro. Envios falhados têm de ser visíveis, não apenas logados na consola.
- Templates num módulo próprio, não em template strings dentro do serviço.

**Remove o `try/catch` que faz `console.warn` e continua.** Se o email não sai, quem chamou tem de saber.

### 1.2 · Fluxo de registo público

Em `backend/src/routes/public.routes.ts`:

- `POST /api/public/register` passa a **enviar de facto** o código, através do `EmailService`.
- Se o envio falhar, **devolve erro ao utilizador** (`502` com `EMAIL_DELIVERY_FAILED`) e **não** cria/actualiza o `AccountRequest` como pendente de aprovação. Mensagem honesta: o email não pôde ser entregue, confirme o endereço.
- Acrescenta `POST /api/public/verify-email` que recebe `{ email, code }`, valida contra `otpHash`/`otpExpiresAt`, incrementa `otpAttempts` e **bloqueia ao fim de 5 tentativas**. Em sucesso, grava `emailVerifiedAt`.
- Acrescenta `POST /api/public/resend-code` com limite próprio (máximo 3 reenvios por hora por email).

### 1.3 · Estados do pedido de conta

O campo `AccountRequest.status` é hoje uma `String` livre. Passa a ter estados explícitos e documentados:

```
PENDING_VERIFICATION  → email enviado, ainda não validado
PENDING               → email validado, à espera de aprovação do super-admin
APPROVED / REJECTED / EXPIRED
```

**Regra central: só entram na fila de aprovações os pedidos em `PENDING`.** O `GET /api/platform/account-requests` passa a filtrar por defeito `status: 'PENDING'`, com um separador opcional para ver os `PENDING_VERIFICATION`. É isto que garante que não vês emails inventados.

Acrescenta uma tarefa de limpeza que marca como `EXPIRED` os `PENDING_VERIFICATION` com mais de 7 dias.

### 1.4 · Fechar a porta do login

Em `backend/src/modules/auth/services/AuthService.ts`, `sendOtp()`:

- **Deixa de criar `AccountRequest` para emails desconhecidos.** Se o email não corresponde a um utilizador existente nem a um `AccountRequest` já verificado, responde com a **mesma mensagem genérica** que responderia a um email válido (para não permitir enumeração de contas), mas **não escreve nada na base de dados** e não envia email.
- Mantém o caminho especial do super-admin (`DEFAULT_SUPER_ADMIN_EMAIL`).
- O código mestre de desenvolvimento (`ALLOW_DEV_OTP` + `123456`) tem de estar garantidamente inacessível em produção. Acrescenta um teste que confirma que com `NODE_ENV=production` esse caminho é impossível.
- Rate limit por email **e** por IP no envio de OTP.

### 1.5 · Aprovação

Em `backend/src/modules/platform/controllers/ApplicationController.ts`, `approveAccountRequest`:

- **Rejeita a aprovação se `emailVerifiedAt` for nulo**, com `EMAIL_NOT_VERIFIED`.
- Envia email de boas-vindas ao aprovar e email de notificação ao rejeitar, ambos pelo `EmailService`, ambos com o resultado auditado.

---

## 2 · TAREFA B — Ficha de licenciamento por tenant

**Não crias modelos novos.** O `ApplicationInstance` em `backend/prisma/schema.prisma` (linha ~1339) já tem tudo: `priceCents`, `billingPeriod`, `currency`, `validFrom`, `validUntil`, `graceDays`, `discountPercent`, `billingNotes`, `status`, `limits`, `features`. E o `EntitlementService` já calcula ACTIVE / TRIAL / GRACE / SUSPENDED a partir de `validUntil` + `graceDays`, com `requireApp` a devolver 403. **A camada de bloqueio já existe — o que falta é o interface e a API de gestão.**

### 2.1 · API

Em `backend/src/modules/platform/routes/applications.routes.ts`:

- `GET /api/platform/tenants/:tenantId/licensing` — devolve **uma linha por módulo do catálogo `SYSTEM_MODULES`** (não só os que já têm instância), cada uma com: licenciado sim/não, `status`, estado efectivo calculado, `priceCents`, `currency`, `billingPeriod`, `validFrom`, `validUntil`, `graceDays`, `daysLeft`, `billingNotes`. Mais o agregado: **total mensal do tenant** e **próxima renovação**.
- `PUT /api/platform/tenants/:tenantId/licensing/:moduleKey` — cria ou actualiza a instância. Valida `moduleKey` com `resolveCanonicalModuleKey` e rejeita chaves fora do catálogo.
- `DELETE /api/platform/tenants/:tenantId/licensing/:moduleKey` — revoga (passa a `DISABLED`, com `deletedAt`; não apaga o registo).
- `GET /api/platform/licensing/renewals?days=30` — todas as licenças a renovar no período, de todos os tenants, ordenadas por data.

Todas estas rotas: restritas a `SUPER_ADMIN` / `PLATFORM_ADMIN`, auditadas com valor anterior e novo, e **invalidam a cache** (`EntitlementService.invalidateCache(tenantId)`) e incrementam `tenant.entitlementsVersion` — senão a alteração demora até 60 segundos a produzir efeito.

**Dinheiro em `priceCents` (inteiro), sempre.** Nunca introduzas `Float` para valores monetários. A conversão para euros é responsabilidade da apresentação.

### 2.2 · Interface no `super-admin.html`

Na secção `#applications-section` (linha ~205), substitui o grelhado actual de cartões por uma **ficha por empresa**:

- Selector de empresa no topo.
- Uma linha por módulo do catálogo, com: nome do módulo, estado (badge colorido por estado efectivo), **valor mensal** (campo editável, em euros), ciclo de facturação, **data de início**, **data de renovação**, **dias de tolerância**, e notas.
- Rodapé com **total mensal da empresa** e **próxima renovação**.
- Destaque visual para licenças em `GRACE` (aviso) e expiradas/suspensas (erro).
- Um painel **"Renovações nos próximos 30 dias"** no dashboard do super-admin, com empresa, módulo, data e valor.

No modal de aprovação de conta (linha ~385), os checkboxes de módulos passam a ser gerados a partir de `SYSTEM_MODULES` — **nada de listas escritas à mão** — e cada módulo seleccionado ganha campos de valor mensal e data de renovação, para a licença nascer já preenchida.

### 2.3 · Frontend: reagir ao 403

Em `backend/public/assets/js/api.js`, o `apiFetch` trata hoje o 401 mas ignora o 403. Acrescenta:

- Em **403 com `APP_NOT_LICENSED` / `APP_READ_ONLY` / `APP_NOT_ASSIGNED`**, mostra um ecrã ou banner explicativo — não expulsa o utilizador para o login.
- Um *guard flag* no tratamento do 401, para que várias chamadas falhadas em paralelo não disparem redireccionamentos concorrentes.
- **Converge para uma única chave de sessão.** Escolhe `erp_session` como canónica, lê as legadas uma vez no arranque, migra o valor e **apaga-as**. Deixar as quatro suportadas indefinidamente é o bug BUG-04 à espera de voltar.

---

## 3 · TAREFA C — Tema claro

O `backend/public/assets/css/design-system/tokens.css` já tem os três estados correctos: `:root` (claro), `@media (prefers-color-scheme: dark)` com guarda `:root:not([data-theme="light"])`, e `:root[data-theme="dark"]`.

**O problema não é o botão em falta — é que os ecrãs não usam os tokens.** `super-admin.html`, `workspace.html`, `app.html` e `index.html` não têm uma única referência a tema, e o super-admin tem a paleta escura do GitHub escrita à mão em estilos inline (`#161b22`, `#0d1117`, `#58a6ff`, `#30363d`, `#8b949e`). Acrescentar um botão sem resolver isto não muda nada no ecrã.

### 3.1 · Passar os ecrãs a tokens
Substitui **todas** as cores literais desses quatro ficheiros por `var(--...)` do `tokens.css`. Se faltar algum token (superfícies elevadas, bordas, texto secundário, estados de sucesso/aviso/erro), acrescenta-o ao `tokens.css` com valor definido nos três blocos — claro, escuro por preferência do sistema, e escuro forçado. **Nenhum token pode ter a sua única definição dentro de um bloco de tema.**

### 3.2 · Controlo de tema partilhado
Cria `backend/public/assets/js/theme.js`, carregado por todos os ecrãs, com:
- Três estados: `system` (por defeito), `light`, `dark`.
- Aplicação do `data-theme` no `<html>` **antes da primeira pintura**, com um script inline curto no `<head>`, para não haver *flash* de tema errado.
- Persistência em `localStorage` sob uma chave própria (`hl_theme`), com `try/catch`.
- Um botão de alternância visível e etiquetado no cabeçalho de cada ecrã, com `aria-label` e estado corrente perceptível.
- Sincronização com `branding.theme` do manifesto do tenant, quando este define um tema: o tenant define o valor por defeito; a escolha do utilizador prevalece.

### 3.3 · Verificação visual
Com Playwright, captura cada ecrã nos três estados de tema e em largura de telemóvel. Verifica **contraste de texto (mínimo AA)** em cada um. Um tema claro com texto cinzento-claro sobre branco não é um tema claro — é um bug com botão.

---

## 4 · TAREFA D — Acesso total do tenant HelderLabs

O `seed.ts` cria o tenant `helderlabs-platform` ("HelderLabs Platform System") com todos os módulos activos, mas isso é o *seed* de desenvolvimento — **não garante nada em produção**.

- Cria um script idempotente `backend/scripts/ensure-platform-entitlements.mjs` que garante que o tenant cujo slug é `PLATFORM_TENANT_SLUG` (por defeito `helderlabs-platform`) tem uma `ApplicationInstance` **ACTIVE, sem `validUntil`**, para **todos** os módulos de `SYSTEM_MODULES`, e que o utilizador `DEFAULT_SUPER_ADMIN_EMAIL` tem `ApplicationAssignment` activa em todas.
- Corre-o no arranque em produção, ou integra-o no `prod-bootstrap.ts`. Tem de ser seguro de correr repetidamente.
- Acrescenta um teste que confirma que, depois de correr, o super-admin vê os cinco módulos no `workspace.html`.
- **Nota de arquitectura:** o `requireApp` já isenta o `SUPER_ADMIN` da verificação de atribuição, mas **não** da verificação de licença — daí este script ser necessário e não apenas conveniente.

---

## 5 · Achados colaterais — diagnosticar, não corrigir agora

Não mexas nestes pontos nesta intervenção. Analisa, documenta no relatório final com risco e esforço estimado, e propõe o caminho:

1. **Duplicação do módulo financeiro** — `modules/financas` vs `modules/finance`. Qual está ligado às rotas? Qual tem dados em produção? Qual se mantém? Uma resposta clara vale mais do que uma fusão apressada.
2. **`backup-pre-migracoes-2026-09-07.dump` com 0 bytes** — verifica se existe algum backup válido antes de qualquer migração em produção. Se não existir, isso é um bloqueio ao deploy, não uma nota de rodapé.
3. **Impersonation morta no `EntitlementService`** — o bloco corre uma query por módulo e o resultado é descartado. Ou se liga, ou se remove; hoje é só custo.
4. **Cache de manifesto de 60 s** com `daysLeft` calculado no momento — aceitável, mas documenta o efeito na transição de estados de licença.

---

## 6 · O que NÃO deves fazer

- Não criares modelos Prisma novos para licenciamento — o `ApplicationInstance` já serve.
- Não engulas erros de envio de email. Se falha, propaga.
- Não deixes o bloqueio de licenciamento apenas no frontend.
- Não uses `Float` para dinheiro.
- Não escrevas listas de módulos à mão em ecrã nenhum — deriva sempre de `SYSTEM_MODULES`.
- Não corras `prisma db push` contra base de dados com dados.
- Não declares concluído sem `npm run verify` completo a passar.
- Não faças deploy sem confirmar que existe um backup válido da BD de produção.

---

## 7 · Verificação

Correr `npm run verify` na pasta `backend` — que já encadeia `lint`, `typecheck`, `test`, `test:e2e` e `test:browser`. **Mostra a saída real de cada um, separadamente.** Se `test:browser` não abrir um browser, diz isso em vez de o contar como E2E.

Testes obrigatórios, cada um falhando antes da correcção:

- Registo com email cujo envio falha → `502`, e **nenhum** `AccountRequest` em `PENDING`.
- Registo bem sucedido → estado `PENDING_VERIFICATION`; após `verify-email` correcto → `PENDING`; só então aparece na fila do super-admin.
- 6 tentativas de código errado → bloqueio.
- `sendOtp` com email desconhecido → resposta genérica e **zero** escritas na base de dados.
- `approveAccountRequest` sem `emailVerifiedAt` → `EMAIL_NOT_VERIFIED`.
- Com `NODE_ENV=production`, o código mestre `123456` não autentica.
- Licença com `validUntil` no passado + `graceDays` esgotados → `403 APP_NOT_LICENSED`; dentro da tolerância → 200 com aviso.
- Alterar licença no super-admin produz efeito **imediato** (cache invalidada), sem esperar 60 segundos.
- Utilizador do tenant A não acede a dados do tenant B.
- E2E: login → workspace → abrir CRM, Finanças, HCCALL e 2SELLMAIS → operação básica em cada → logout, sem 401 e sem loop.
- E2E: super-admin abre a ficha de uma empresa, define valor mensal e data de renovação, grava, revoga, e confirma que o ícone desaparece do workspace do utilizador.
- Visual: os quatro ecrãs nos três estados de tema, com contraste AA verificado.

---

## 8 · Deploy

Só depois de tudo acima verde. Apresenta a sequência ao Hélder e **espera confirmação antes de a executar**:

1. Confirmar backup válido e não vazio da BD de produção.
2. `npx prisma migrate status` contra produção — zero pendentes esperadas, ou plano explícito.
3. `npm run verify` completo.
4. `git push` para o ramo de produção.
5. Confirmar no Vercel que o build **falha** se a migração falhar (o `deploy-build.mjs` foi corrigido para fail-fast — confirma que continua assim).
6. Correr `ensure-platform-entitlements` em produção.
7. Verificação pós-deploy em `helderlabs.eu`: login do super-admin, os cinco módulos visíveis, ficha de licenciamento a gravar, botão de tema a funcionar, e um registo de teste a receber o código por email.

**O passo 7 só passa depois de os registos DNS da secção 1.0 estarem verificados no Resend.** Antes disso, o envio de email não funciona em produção, independentemente do código.

---

## 9 · Relatório final

`docs/RELATORIO_INTERVENCAO_V2.md` com: o que foi alterado por tarefa e ficheiro; saída real de cada comando de verificação; testes escritos e resultados; achados da secção 5 com recomendação; passos manuais para o Hélder (DNS, backup, variáveis de ambiente); e o que ficou por fazer com o risco associado.

**Não declares nada concluído sem evidência de execução. Se um passo não correu, diz que não correu.**
