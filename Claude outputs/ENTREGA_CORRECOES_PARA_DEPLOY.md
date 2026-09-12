# ENTREGA — Correções aplicadas, prontas para deploy
> Alterações escritas diretamente em `C:\Users\helde\Desktop\Dev\helderlabs-erp`.
> Autor das alterações: Claude. Executor do deploy: Antigravity.
> Data: 2026-09-12 · Base: commit `f50cd1c` (Bloco 0 já aplicado)

---

## O QUE FOI VERIFICADO, E O QUE NÃO FOI

**Verificado.** Montei o backend completo num ambiente limpo (`npm install` com as dependências reais do projeto) e corri `tsc --noEmit` antes e depois de cada alteração.

- Baseline antes das alterações: **19 erros**
- Depois de todas as alterações: **19 erros — os mesmos, nas mesmas linhas**

Zero regressões de tipo. Os 19 erros são pré-existentes e induzidos pelo ambiente (ver limitação abaixo); não foram introduzidos nem resolvidos por esta entrega.

**Não verificado — e é importante.** `prisma generate` não corre neste ambiente: `binaries.prisma.sh` está bloqueado por política de rede. Sem o cliente Prisma gerado, os tipos dos modelos não existem, pelo que usei um shim de tipos permissivo apenas para a verificação (não faz parte da entrega). Consequência concreta:

> **O type-check NÃO validou nomes de campos nem de modelos Prisma.**

Compensei cruzando cada acesso a modelo diretamente contra o `schema.prisma` — e isso apanhou um erro real: eu tinha escrito `db.hccallSaleItem.count({ where: { dynamizationId } })`, e `HccallSaleItem` não tem esse campo; `dynamizationId` vive em `HccallSale`. Corrigido. Mas este é precisamente o tipo de erro que uma verificação completa apanharia sozinha, pelo que a **primeira coisa a fazer é `npm run typecheck` com o cliente gerado**.

---

## SEQUÊNCIA DE EXECUÇÃO

### Passo 1 · Validar com o Prisma gerado (obrigatório, antes de tudo)

```bash
cd backend
npx prisma generate
npm run typecheck
npm run lint
```

Se aparecer qualquer erro em: `public.routes.ts`, `AuthService.ts`, `auth.routes.ts`, `entitlements.ts`, `AuditService.ts`, `HccallController.ts`, `HccallObjectiveService.ts`, `HccallDynamizationService.ts`, `app.ts`, `config/modules.ts` — **é meu, corrige e reporta**. Erros noutros ficheiros são pré-existentes.

### Passo 2 · Pre-flight da base de dados (leituras apenas)

```bash
psql "$DATABASE_URL" -f prisma/migrations/PREFLIGHT_audit_integrity.sql
```

Diz se a migração vai passar. Lê com atenção as secções 1 e 2: se houver registos sem hash ou elos duplicados, a migração **vai parar de propósito** com mensagem explícita. Não contornes apagando registos de auditoria — reporta.

A secção 3 distingue **corrida de escrita** (duplicados com intervalo de milissegundos) de **adulteração** (intervalo longo). É a prova que faltava sobre a natureza do incidente.

### Passo 3 · Migração

```bash
npx prisma migrate deploy
```

Migração: `20260912120000_onboarding_resilience_and_audit_integrity`.

### Passo 4 · Remover fisicamente o módulo `finance` (D1)

Já desregistei a rota e o import em `app.ts`. **Falta apagar a pasta** — não tenho permissão de eliminação na tua máquina:

```bash
git rm -r backend/src/modules/finance
```

Confirmaste que os controllers eram stubs e que `FinancialTransaction` tem 0 registos. Regista em `DIVIDA_TECNICA.md`, como funcionalidades **por construir de raiz**: reconciliação bancária, SAF-T (PT) XML, importação OFX/QIF.

Os modelos `FinancialTransaction`, `FinancialAttachment`, `FinancialReport`, `BudgetItem`, `CashFlowProjection` e `BankReconciliation` **deixei-os intactos de propósito**: apagá-los no mesmo passo em que a pasta ainda existe faria o build falhar. Remove-os numa migração própria **depois** de a pasta estar apagada e o build verde, confirmando `SELECT count(*)` = 0 em cada uma antes do `DROP`.

### Passo 5 · Testes

```bash
RESEND_API_KEY=test_key npm test
```

A variável tem de estar **definida** — é o ponto central. Dois ficheiros novos em `tests/regression/`.

### Passo 6 · Deploy e verificação em produção

```bash
git add -A
git commit -m "fix(auth,onboarding,audit,hccall): resiliência do registo, fim da enumeração, integridade real da cadeia e CRUD do HCCALL"
git push origin master
```

Depois, com artefacto para cada linha:

| # | Verificação | Esperado |
|:--|:--|:--|
| 1 | `GET /api/version` | SHA = `git rev-parse HEAD` |
| 2 | `POST /api/auth/login` com `admin1234` | `401` |
| 3 | `POST /api/public/register` (domínio ainda por verificar) | `200` **e** `AccountRequest` na BD |
| 4 | Corpo da resposta de 3 | sem `resend.com`, sem `not verified` |
| 5 | `POST /api/auth/check-email` conta existente vs inexistente | corpo idêntico |
| 6 | `POST /api/auth/send-otp` idem | corpo e código idênticos |
| 7 | `GET /api/finance/transactions` | `404` |
| 8 | `GET /api/financas/dashboard` autenticado | mesmos totais de antes, 11 registos |
| 9 | Latência de `check-email` com email do super-admin | < 500 ms (era 9,8 s no p95) |

---

## ALTERAÇÕES, UMA A UMA

### 1 · `src/routes/public.routes.ts` — a correção que desbloqueia o onboarding

**Ordem invertida: persistir primeiro, enviar depois.** Era esta a causa de dois defeitos que reportaste como separados — o 502 no registo e "os pedidos de acesso não aparecem no módulo de atribuição". Não apareciam porque nunca chegavam a existir: a rota abortava antes do `create`.

Agora o `AccountRequest` é gravado sempre, o envio é tentado a seguir, e o resultado fica registado no próprio pedido (`emailDeliveryStatus`, `emailDeliveryError`, `emailLastAttemptAt`, `emailAttemptCount`). Com o email a falhar a resposta é `200` com `emailDelivered: false` e uma mensagem honesta.

**Fim da fuga de informação.** A mensagem do fornecedor ia verbatim para um endpoint público. Passa a ir para `emailDeliveryError` e para um registo de auditoria `SYSTEM`; ao cliente vai texto estável.

**Validação movida para o schema Zod.** `emailConfirmation` e `passwordConfirmation` eram `.optional()` — a validação só acontecia se o cliente as enviasse, e um POST direto contornava-as. Passam a ser obrigatórias, com validação cruzada por `.refine()` **no schema**, onde é impossível contornar. Password mínima de 4 → **12 caracteres com minúscula, maiúscula e algarismo**.

`/resend-code` levou o mesmo tratamento, e o `502` passou a `503` (é indisponibilidade temporária, não erro do cliente).

### 2 · `src/modules/auth/services/AuthService.ts`

**`sendOtp` deixa de mentir e deixa de enumerar.** O resultado do envio era ignorado e respondia sempre "Código enviado". Agora verifica. E as três respostas distinguíveis (conta existente / pedido pendente / desconhecido) colapsaram numa só, idêntica em corpo e código.

Acrescentei **piso de latência de 700 ms**: sem isso, 1,2 s para conta existente contra 230 ms para inexistente enumera por cronómetro mesmo com o corpo igual. É a metade da correção que costuma faltar.

**`loginWithPassword`**: `'Conta sem palavra-passe definida'` revelava que a conta existia. Passa a `'Credenciais inválidas'`.

**Bootstrap fora dos caminhos públicos.** `ensureSuperAdminUser` corria em `checkHasPassword`, `sendOtp`, `verifyOtp` e `loginWithPassword` — todos não autenticados — com criação de tenant, `findMany` de módulos e N+1 escritas por pedido. É a causa medida do p95 de 9,8 s e um vetor de negação de serviço trivial. Passa a `ensureSuperAdminBootstrap()`, guardado por flag estática, invocado **uma vez por instância** num hook `onReady` em `app.ts`.

### 3 · `src/modules/platform/services/AuditService.ts` — integridade a sério

**A fila em memória foi substituída por advisory lock transacional.** `partitionQueues: Map` serializa dentro de um processo; no Vercel há várias instâncias, cada uma com o seu Map vazio. Agora:

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${partitionKey}))`;
  // ler último → calcular → gravar
});
```

Com retry em `P2002` (colisão do elo): a corrida passa a ser um erro recuperável em vez de uma cadeia partida em silêncio.

**A falha de auditoria deixa de ser silenciosa.** Era `try/catch` + `console.error`. Em categoria `SECURITY` passa a **abortar a operação de negócio** — uma ação sensível não pode concluir-se sem rasto. Nas restantes, erro observável.

**`verifyAuditChain` paginado** por cursor sobre `seq`, em lotes de 500. Carregava a partição inteira em memória e era chamado pelo painel a cada abertura.

**Fallback legado removido.** O verificador aceitava dois formatos de digest. Duas definições de "íntegro" significam nenhuma.

**`repairChain` conforme a D2.** Motivo obrigatório com 20+ caracteres; estado anterior guardado **integralmente** no novo modelo `AuditChainReseal` (eram 5 amostras); cada registo fica marcado com `resealedAt`/`resealedBy`/`resealBatchId`; e `verifyAuditChain` **nunca mais devolve um simples "íntegra"** numa partição re-selada — devolve *"Íntegra desde a re-selagem de X por Y; N registos re-selados. A integridade anterior a essa data não é verificável."*

### 4 · `prisma/schema.prisma` + migração

`AccountRequest` ganha os quatro campos de entrega. `AuditLog`: `prevHash` e `hash` passam a **obrigatórios** (eram nullable — dava para gravar auditoria sem hash), mais os três campos de re-selagem. Novo modelo `AuditChainReseal`.

**Um detalhe que quase passava despercebido e teria anulado a correção:** a unicidade do elo não pode ser `@@unique([tenantId, prevHash])` no Prisma. Em PostgreSQL os NULLs são distintos entre si num índice único — e a **partição global usa `tenantId` NULL**, ou seja, o índice não restringiria nada exatamente onde mais importa. Está em SQL na migração, sobre `COALESCE("tenantId",'__global__')`. Deixei a explicação em comentário no schema para ninguém o "arrumar" de volta.

A migração **falha de propósito**, com `RAISE EXCEPTION` e mensagem explícita, se encontrar hashes nulos ou elos duplicados. Uma migração que corrige registos de auditoria em silêncio é o problema, não a solução.

Inclui também a **reconstituição forense das 34 re-selagens de 2026-09-11**: marca os registos anteriores a essa data com origem `desconhecido` e um registo em `audit_chain_reseals` a declarar que o estado anterior não foi preservado e não é recuperável. Não repõe o que se perdeu — deixa de o esconder.

### 5 · `src/plugins/entitlements.ts`

Cache por `(userId, tenantId)` com TTL de 60 s e `invalidateEntitlementCache()` exportada. `resolveForUser` corria em **todos** os pedidos via `requireApp`, e outra vez em `requirePermission`.

> **Ação para ti:** chamar `invalidateEntitlementCache(userId, tenantId)` no `ApplicationController`, onde se alteram licenciamentos e atribuições. Não o fiz porque esse ficheiro tem 36 KB e não quis tocar-lhe sem necessidade. Sem isso, uma alteração de licença demora até 60 s a fazer efeito.

### 6 · HCCALL

**CRUD fechado:** `PUT /objectives/:id`, `DELETE /objectives/:id`, `DELETE /dynamizations/:id`, com os métodos de serviço correspondentes.

Ambos são **soft delete**. A dinamização nunca se apaga fisicamente: as comissões já calculadas referenciam-na, e apagá-la invalidaria o histórico — que é precisamente o registo que te dá o argumento factual numa reclamação. Quando há vendas associadas, a resposta di-lo explicitamente.

**Fusos horários corrigidos.** `countWorkingDays` e `calculatePace` usavam `getDay()`/`setHours()`, ou seja, a hora local do servidor. Servidor em UTC, utilizador em Lisboa: uma venda às 00:30 em julho caía no dia anterior. Num sistema cujo indicador central é "quantas vendas fiz hoje", é um erro de domínio. Toda a aritmética passa por `Intl.DateTimeFormat` no fuso explícito, com `DEFAULT_HCCALL_TIMEZONE = 'Europe/Lisbon'` e parâmetro por chamada.

**Identidade corrigida** em `config/modules.ts`: deixou de ser *"HCCALL · Call Center Telecom & Energia"*. E a chave financeira passou de `finance` (alias `financas`) para `financas` (alias `finance`) — a chave canónica passa a ser a que o frontend e a rota realmente usam.

**BOM UTF-8 removido** de `hccall.routes.ts` e `HccallObjectiveService.ts`.

### 7 · `public/login.html`

Política de password alinhada (12 caracteres + classes) e tratamento de `emailDelivered: false` — deixa de pedir um código que não foi enviado.

### 8 · Testes de regressão

`tests/regression/onboarding-resilience.test.ts` — sete testes. O primeiro é **o que faltava**: `RESEND_API_KEY` definida, `EmailService.send` forçado a falhar, e a asserção de que o `AccountRequest` **existe**. Era o único caminho que a suite nunca percorria, e era o único partido em produção.

`tests/regression/audit-chain-concurrency.test.ts` — 50 escritas em paralelo com verificação de integridade, e a verificação de que `repairChain` exige motivo e deixa marca.

---

## O QUE NÃO FIZ, E PORQUÊ

| Item | Razão |
|:--|:--|
| Apagar `src/modules/finance/` | Sem permissão de eliminação na tua máquina — passo 4 |
| Remover os modelos Prisma órfãos | Partiria o build enquanto a pasta existir — migração própria depois |
| `invalidateEntitlementCache` no `ApplicationController` | Ficheiro de 36 KB; identificado acima como ação tua |
| Auditar leituras sensíveis (AUD-02) | Exige decidir a lista de recursos — decisão de produto, não minha |
| `oldValue`/`newValue` no hook genérico (AUD-03) | Requer alterar cada rota de mutação; bloco próprio |
| Comissões com 3 estados | **Bloqueado por D5** — bónus cumulativos ou milestone? |
| Perfil, Definições, histórico HCCALL | Funcionalidade nova, não correção; depois do deploy |
| Extrair matemática de `FinancasController` | Refactor de 34 KB; merece bloco e testes próprios |
| QA visual / tema claro | Precisa de browser contra produção |

---

## UMA COISA QUE PRECISA DA TUA DECISÃO

Tornei a **password obrigatória** no registo. Antes era opcional, o que permitia registo só com OTP. O frontend já enviava sempre os campos, portanto nada parte — mas é uma mudança de comportamento deliberada: um sistema destinado a clientes reais não devia aceitar contas sem credencial própria.

Se preferires manter o registo só-OTP, o ajuste é tornar `password` opcional no `PublicRegisterSchema` mantendo o `.refine()` da confirmação — dois minutos. Diz.

---

## RESUMO PARA O `ESTADO.md`

```
Corrigido: AUTH-03 (registo resiliente), AUTH-04 (enumeração + latência),
           AUTH-05 (política de password), AUD-01 (advisory lock),
           AUD-04 (falha não silenciosa), AUD-05 (paginação),
           AUD-06 (re-selagem auditável), FIN-01 (rota removida),
           HCC (CRUD objetivos/dinamizações, fusos, identidade)
Pendente:  DNS Resend (ação do Hélder), remoção física de modules/finance,
           AUD-02/AUD-03, comissões 3 estados (D5), QA visual, tema claro
Bloqueado: D5 — bónus cumulativos vs milestone
```

`ESTADO.md` **não pode dizer "PRONTO"** enquanto o portão de produção de 15 critérios não estiver todo fechado com artefacto.
