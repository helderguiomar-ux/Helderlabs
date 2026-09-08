# PROMPT DE EXECUÇÃO — ANTIGRAVITY
## HELDERLABS ERP · Reconstrução dos Módulos **FINANCEIRO** e **CRM / EMPRESAS**
### Zero regressões · Zero perda de dados · Interface 10/10

> **Diretoria canónica:** `C:\Users\helde\Desktop\Dev\helderlabs-erp`
> **Versão base:** v0.3.0 · **Alvo:** v0.4.0
> **Documento gerado a partir de auditoria directa ao código** (schema Prisma, controllers, rotas, `app.html`, `super-admin.html`, `login.html`, `index.html`) em 2026-09-08.
> **Este documento substitui**, para o âmbito Financeiro + CRM, os anteriores `docs/PROMPT_ANTIGRAVITY_FINANCAS.md` e `docs/PROMPT_ANTIGRAVITY_APROVACOES_LEADS.md`. Lê-os para contexto histórico, mas **em caso de conflito, este documento manda.**

---

# 0. REGRAS ABSOLUTAS — LER ANTES DE TOCAR EM CÓDIGO

1. **NÃO COMEÇAS POR ESCREVER CÓDIGO.** A Fase 0 (auditoria + plano) é obrigatória e tem entregável escrito.
2. **NADA É APAGADO.** Nenhum `DROP TABLE`, nenhum `DROP COLUMN`, nenhum `prisma migrate reset`, nenhum `db push --accept-data-loss`. Colunas que deixem de ser usadas ficam no schema marcadas como `@deprecated` em comentário. Registos são desativados (`deletedAt`), nunca eliminados fisicamente.
3. **MIGRAÇÕES RETROCOMPATÍVEIS.** Toda a migração tem de permitir *instant rollback* do código anterior. Adiciona colunas com `NULL` ou `DEFAULT`; nunca renomeies colunas em uso (adiciona a nova, copia, mantém a antiga).
4. **BACKUP LÓGICO ANTES DE QUALQUER MIGRAÇÃO.** `pg_dump` da BD local e verificação de que o ficheiro não tem 0 bytes (nota: `backend/backup-pre-migracoes-2026-09-07.dump` tem **0 bytes** — o backup anterior falhou e ninguém reparou; não repitas o erro).
5. **`guard-db.mjs` não se contorna.** Desenvolvimento e migrações dev só contra `localhost`.
6. **O tenant vem sempre da sessão** (`request.user.tenantId`), nunca de query/body.
7. **Proibido `PrismaClient` cru fora de `tenantScopedClient.ts`** (ADR 001). Isto é hoje violado em quase todo o módulo `finance/` — faz parte do trabalho corrigir.
8. **Toda a escrita administrativa ou destrutiva regista evento no `AuditService`.**
9. **Antes e depois de cada fase: `cd backend && npm run verify`** (typecheck estrito + testes). Não avanças com vermelho.
10. **Nunca confies nos ficheiros `.md` do repositório como descrição do sistema.** Ver §1.4 — vários documentam funcionalidades que **não existem**. A fonte da verdade é o código.

---

# 1. ESTADO REAL AUDITADO — O QUE VAIS ENCONTRAR

## 1.1 Stack confirmada

- Backend: Node 20 + Fastify 4 + TypeScript strict + Prisma 5 + PostgreSQL (Neon em produção, Docker local).
- Frontend: HTML5/CSS/JS vanilla estático em `backend/public/` (`index.html`, `login.html`, `workspace.html`, `app.html`, `super-admin.html`).
- `app.html` tem **89 KB num único ficheiro** com HTML, CSS e JS inline. É o principal obstáculo à interface 10/10.
- Deploy: Vercel serverless via `api/index.ts`.

## 1.2 🔴 O PROBLEMA ESTRUTURAL Nº 1 — EXISTEM DOIS MÓDULOS FINANCEIROS A COMPETIR

Isto não é uma opinião. Está no schema e nas rotas:

| | Módulo A — `financas` | Módulo B — `finance` |
|---|---|---|
| Código | `backend/src/modules/financas/` | `backend/src/modules/finance/` |
| Rotas | `/api/financas/*` | `/api/finance/*` |
| Modelos Prisma | `FinanceCategory`, `FinanceTransaction`, `RecurringRule`, `Loan`, `LoanPayment` | `FinancialTransaction`, `FinancialAttachment`, `Budget`, `BudgetItem`, `CashFlowProjection`, `BankReconciliation`, `FinancialReport` |
| Valores | `amountCents Int` (cêntimos inteiros) | `amount Float` (vírgula flutuante) |
| Datas | `dueDate` + `paidDate` (`@db.Date`) | `date` + `dueDate` (`DateTime`) |
| Categorias | tabela `FinanceCategory` por tenant, com subcategorias possíveis | enum fixo `ExpenseCategory` (13 valores hardcoded) |
| Estados | `PLANNED` / `PAID` | `PENDING` / `APPROVED` / `REJECTED` / `RECONCILED` / `PLANNED` / `PAID` |
| Tenant scoping | usa `forTenant()` ✅ | usa `prisma` cru ❌ |
| Guarda de licença | `requireApp('financas')` ✅ | **nenhuma** ❌ |

**E o `app.html` chama os dois ao mesmo tempo, na mesma vista, com fallback silencioso por `.catch()`:**

```js
// app.html, loadFinancas()
api('/api/finance/dashboard').catch(() => api('/api/financas/dashboard'))
api('/api/finance/transactions').catch(() => api('/api/financas/transactions'))
// ...
window.deleteFinanceTx = function(id) {
  api(`/api/finance/transactions/${id}`, { method: 'DELETE' })
    .catch(() => api(`/api/financas/transactions/${id}`, { method: 'DELETE' }));
};
```

**Consequências reais, hoje, em produção:**
- Os KPIs, a tabela e os gráficos podem estar a ler de **tabelas diferentes** → números que nunca batem certo.
- O `deleteFinanceTx` tenta apagar numa tabela e, se falhar, apaga **na outra** com o mesmo id. Um id de `FinanceTransaction` nunca existe em `FinancialTransaction` → o utilizador vê "Transação eliminada" e nada foi eliminado, ou pior, é eliminado o registo errado se algum dia os ids colidirem.
- O padrão `.catch(fallback)` **esconde todos os erros de rede e de autorização**. Um 403 `APP_NOT_LICENSED` aparece ao utilizador como "sem dados".
- `qa/CONTRATO.md` ponto 12 exige montantes em cêntimos inteiros. O módulo B usa `Float`. **O contrato de não-regressão já está violado.**

> **A minha recomendação técnica, e a decisão que este prompt fixa:** consolidar tudo no **modelo A (`financas`, cêntimos inteiros, categorias em tabela)**, absorvendo do modelo B os conceitos que ele tem a mais e que fazem falta (anexos, aprovação, centro de custo, entidade, nº de fatura, orçamentos, projeções). Ver §3.

## 1.3 🔴 PORQUE É QUE A LISTA DE APROVAÇÃO NUNCA APARECE — causa raiz encontrada

O botão **"Solicitar Acesso ao ERP"** em `backend/public/login.html` (`submitRequestAccess()`) faz:

```js
const res = await fetch('/api/public/leads', { ... });   // ❌ cria um Lead
```

E o `index.html` faz exactamente o mesmo. Ou seja: **o pedido de acesso é gravado como Lead do CRM, não como `AccountRequest`.**

O endpoint que cria o `AccountRequest` — `POST /api/public/register` em `backend/src/routes/public.routes.ts` — **existe, está completo, tem consentimento RGPD, gera OTP... e não é chamado por nenhum ecrã.** Por isso `GET /api/platform/account-requests` devolve sempre vazio e a aba "Aprovações de Contas" da consola fica permanentemente sem linhas.

O ecrã de aprovação em `super-admin.html` está construído e funciona — só nunca tem input.

## 1.4 🔴 A DOCUMENTAÇÃO DO REPOSITÓRIO ESTÁ A MENTIR

Isto é crítico porque tu, Antigravity, lês estes ficheiros e acreditas neles.

`docs/MODULOS.md` afirma que o módulo financeiro já tem:
- soft delete com `deleted_at` e banner de Undo de 10 s → **não existe**; `deleteTransaction` faz `DELETE` físico nos dois módulos;
- Contas Bancárias e Transferências internas → **não existe** modelo `Account`; `TransactionType.TRANSFER` existe no enum mas nada o trata;
- Objetivos de Poupança (`goals`) e Dívidas (`debts`) → **não existem** esses modelos;
- gráficos em Recharts → o frontend é SVG desenhado à mão em vanilla JS;
- CLI `npm run audit:verify` e ficheiros JSONL → **não existem**;
- rota `/signup` → **não existe**.

`ESTADO.md` afirma "Exportação SAF-T (PT) XML". O `ExportController.exportSaft` devolve **JSON** e o frontend grava-o com extensão `.xml` — o ficheiro sai corrompido.

`ADR 003` (em `DECISOES.md`) fixa `erp_session` como chave de sessão. `qa/CONTRATO.md` ponto 16 declara `hl_token` imutável e proíbe alterá-la. **Dois documentos canónicos em contradição direta.**

**Tarefa obrigatória desta missão:** corrigir `docs/MODULOS.md`, `ESTADO.md` e `qa/CONTRATO.md` para descreverem o sistema **real** no fim do trabalho. Um ERP que mente na própria documentação não é auditável, e a auditabilidade é o princípio fundador deste projeto.

## 1.5 A ambiguidade "Empresa" — resolver antes de escrever qualquer campo

A palavra **empresa** designa duas coisas diferentes neste sistema:

| | Empresa-cliente da plataforma | Empresa no CRM |
|---|---|---|
| Modelo | `Tenant` (+ `TenantBranding`) | `Customer` / `Lead` |
| Quem gere | Super Admin, em `super-admin.html` | Utilizador do tenant, em `app.html` |
| Para quê | licenciar módulos, cobrar, suspender | vender, faturar, contratar |

**Decisão fixada:** a ficha rica de empresa (§5) é construída **no CRM**, sobre uma nova entidade **`Company`** que unifica `Lead` e `Customer`. O `Tenant` recebe apenas os campos de licenciamento e cobrança (§6). Não se misturam.

---

# 2. BUGS CONFIRMADOS — LISTA DE CORREÇÃO OBRIGATÓRIA

Cada bug tem: onde está · o que acontece · o que fazer · como se prova que ficou resolvido.
**Nenhum destes é hipotético — todos foram lidos no código.**

## 2.1 Segurança e isolamento multi-tenant (prioridade máxima)

**BUG-01 · `/api/finance/*` não verifica licença nenhuma**
`backend/src/modules/finance/routes/*.routes.ts` — todas as 7 rotas registam apenas `app.authenticate`. Qualquer utilizador autenticado de qualquer tenant acede ao módulo financeiro sem o ter licenciado, contornando o `EntitlementService` por completo.
→ Adicionar `app.requireApp('financas')` em todas. Teste: utilizador de tenant sem licença recebe 403 `APP_NOT_LICENSED` em todos os endpoints financeiros.

**BUG-02 · TENANT_ADMIN pode auto-licenciar-se módulos**
`applications.routes.ts` autoriza `TENANT_ADMIN`; `ApplicationController.create` faz `tenantId = isSuperAdmin && body.tenantId ? body.tenantId : user.tenantId`. Um TENANT_ADMIN faz `POST /api/platform/applications { moduleId }` e activa qualquer módulo activo para a própria empresa, de graça.
→ `create`, `update` e `remove` de `ApplicationInstance` passam a exigir `SUPER_ADMIN`/`PLATFORM_ADMIN`. TENANT_ADMIN mantém **leitura** e **atribuição de utilizadores dentro do próprio tenant**. Teste: TENANT_ADMIN recebe 403 ao tentar criar/alterar um aplicativo.

**BUG-03 · `update`/`remove`/`assignUser` de aplicativos sem verificação de tenant**
`ApplicationController.update` e `.remove` fazem `findUnique({ where: { id: applicationId } })` e escrevem, sem confirmar a que tenant pertence. Combinado com o BUG-02, um TENANT_ADMIN altera o estado do licenciamento **de outra empresa**.
→ Verificar sempre `app.tenantId` contra o actor. Teste: admin do tenant A recebe 404/403 sobre um `applicationId` do tenant B.

**BUG-04 · OTP guardado em texto limpo e escrito no log**
`public.routes.ts`: `otpHash: otpCode` e `app.log.info({ email, otpCode }, ...)`.
→ `bcrypt.hash(otpCode, 10)` antes de gravar; remover o código do log (log apenas o email e o `requestId`). Teste: consultar `account_requests.otpHash` na BD e confirmar prefixo `$2b$`.

**BUG-05 · Novo pedido público reabre uma conta já aprovada**
`public.routes.ts` faz `update` do `AccountRequest` existente forçando `status: 'PENDING'`. Quem já foi aprovado pode ser reposto em pendente por qualquer pessoa que saiba o email.
→ Se `status === 'APPROVED'`, responder 409 com mensagem neutra ("já existe uma conta associada a este email — inicie sessão ou recupere o acesso") e **não escrever nada**. Teste: submeter registo com email já aprovado → 409, registo intacto.

**BUG-06 · Lead pública pode cair num tenant arbitrário**
`EnterpriseCRMService.createPublicLead` usa `defaultPrismaClient` cru e, se não encontrar `slug: 'helderlabs-platform'`, faz `tenant.findFirst()` — grava a lead na **primeira empresa que existir na base de dados**, que pode ser um cliente. Fuga de dados entre tenants. O fallback seguinte, `tenantId = 'helderlabs-platform'` literal, rebentaria a foreign key.
→ Eliminar este método. Existe apenas **uma** entrada pública de leads: `POST /api/public/leads` em `public.routes.ts`, que já resolve o tenant por `PLATFORM_TENANT_SLUG` e devolve 503 se não existir. Remover a rota duplicada `POST /api/crm/public/leads`. Teste: com o tenant da plataforma ausente → 503 e nenhuma lead criada.

**BUG-07 · `invoiceNumber` é único globalmente, não por tenant**
`schema.prisma`: `invoiceNumber String? @unique` em `FinancialTransaction`. Se o tenant A registar a fatura `FT2026/1`, **nenhum outro tenant no mundo** consegue registar esse número.
→ Migrar para `@@unique([tenantId, invoiceNumber])`. Migração retrocompatível: criar o índice composto, só depois remover o índice simples.

## 2.2 Integridade de dados

**BUG-08 · Eliminação física de transações e de leads**
`FinancasController.deleteTransaction`, `FinanceController.deleteTransaction`, `EnterpriseCRMService.deleteLead` — todos fazem `delete` físico. Viola a regra "NADA é apagado" do `AGENTS.md`.
→ Adicionar `deletedAt DateTime?` a `FinanceTransaction`, `Company`/`Lead`, `Opportunity`, `FinanceCategory` (já tem `archivedAt`), e converter todos os `delete` em `update({ deletedAt: new Date() })`. Todas as leituras filtram `deletedAt: null`. Adicionar restauro (`POST /:id/restore`) e banner de Undo de 10 s na UI. Teste: eliminar + contar registos na BD → contagem inalterada, item desaparece da lista, Undo repõe.

**BUG-09 · `DELETE /api/financas/gdpr/anonymize` destrói dados em massa sem travão**
`FinancasController.anonymizeGdpr` faz `updateMany` sobre **todas** as transações e empréstimos do tenant, substituindo descrição e notas. Não pede confirmação, não regista auditoria, e está protegido apenas por `requireApp('financas')` — **qualquer utilizador com acesso ao módulo pode apagar o histórico financeiro inteiro da empresa com um pedido HTTP**.
→ Exigir `requirePermission('financas.admin')`, exigir confirmação explícita no body (`{ confirm: "ANONIMIZAR", scope: "..." }`), gravar snapshot em `audit_logs.oldValue`, registar `AuditService` com resultado, e restringir o âmbito a um sujeito identificado (RGPD é sobre uma *pessoa*, não sobre a contabilidade toda). Teste: sem permissão → 403; sem confirmação → 400; com ambos → auditoria criada e apenas os registos do âmbito alterados.

**BUG-10 · `upsertBudget` chama-se upsert mas faz sempre `create`**
`FinancasController.upsertBudget` usa `db.budget.create` contra uma tabela com `@@unique([tenantId, year, month])`. O segundo orçamento do mesmo mês rebenta com P2002 → erro 500 opaco para o utilizador.
→ Converter em `upsert` real sobre a chave `[tenantId, year, month]`.

**BUG-11 · `upsertBudget` grava um cuid de categoria numa coluna enum**
O mesmo método aceita `body.category` (que no ecrã é o `categoryId` de uma `FinanceCategory`, um cuid) e escreve-o em `BudgetItem.category`, que é o enum `ExpenseCategory`. Prisma rejeita → 500. O `BudgetSchema` declarado no topo do ficheiro **nunca é usado** — o método lê `req.body as any` sem validação.
→ Resolve-se com a unificação de categorias (§3.2). Entretanto: validar sempre com Zod, nunca `as any`.

**BUG-12 · Perda silenciosa de `paidDate`**
`FinancasController.updateTransaction`: quando `body.paidDate` não vem e o estado não é `PAID`, força `paidDate: null`, apagando a data de pagamento de um movimento já liquidado numa edição de descrição.
→ Só alterar `paidDate` quando o estado muda ou quando o campo é enviado explicitamente.

**BUG-13 · Sanitizadores que corrompem dados em silêncio**
`FinanceController.sanitizeExpenseCategory` mapeia qualquer categoria desconhecida para `MISCELLANEOUS`; `sanitizeStatus` mapeia qualquer estado inválido para `PAID`. Um erro de digitação transforma-se em dados errados sem nenhum aviso. Pior: a função de categoria de **despesa** é aplicada também a receitas.
→ Substituir por validação Zod estrita: input inválido → 400 com a lista de valores aceites. Nunca "adivinhar".

**BUG-14 · `createdBy` fica sempre nulo**
`ApplicationController.create` usa `user.id`, mas o payload JWT (`AuthTokenPayload`) tem `sub`, não `id`.
→ `createdBy: user.sub`. Teste: criar aplicativo e confirmar `createdBy` preenchido.

**BUG-15 · Chave de módulo inconsistente: `financas` vs `finance`**
`seed.ts` cria o módulo com `key: "finance"`. `module.manifest.ts` declara `key: 'financas'`. `approveAccountRequest` normaliza `financas → finance` e **cria um `Module` novo se não existir**. O `requireApp` só não parte porque tem um alias hardcoded (`moduleKey === 'financas' ? 'finance' : ...`). Basta uma aprovação numa BD com o seed antigo para ficares com **duas linhas em `modules`** para o mesmo módulo, licenças divididas entre as duas, e cartões duplicados no launcher.
→ Fixar **uma** chave canónica: **`financas`**. Migração de dados: se existirem ambas, mover `ApplicationInstance` da chave `finance` para a `financas` (preservando estado, plano, datas), marcar a antiga `isActive: false` e **não a apagar**. Remover o alias do `requireApp` só depois de confirmar a migração. Teste: `SELECT key FROM modules` devolve uma única linha financeira.

## 2.3 Endpoints partidos (404 garantido em produção)

**BUG-16 · `GET /api/finance/cashflow/projections`** (chamado em `app.html`) — a rota real é `/api/finance/cashflow/projection`, no singular. O ecrã de Fluxo de Caixa nunca carregou dados reais.

**BUG-17 · `GET /api/finance/reports/pnl?startDate=…`** (chamado em `app.html`) — não existe. Bate no `GET /reports/:id` com `id = "pnl"` e devolve `REPORT_NOT_FOUND`. O gerador de P&L do ecrã nunca funcionou. O backend só tem `POST /api/finance/reports`.

**BUG-18 · SAF-T devolve JSON e é gravado como `.xml`** — `exportSaft` devolve um objecto JSON; o `exportFinanceSAFT()` do frontend embrulha-o num `Blob` com `type: 'application/xml'` e descarrega `SAFT_PT_2026.xml`. O ficheiro não abre em lado nenhum. Além disso o `TaxRegistrationNumber` está **hardcoded a `999999990`** e o `SoftwareCertificateNumber` a `0/AT` — um SAF-T assim não é submissível e dá uma falsa sensação de conformidade fiscal.
→ Decisão: **SAF-T sai da navegação principal** (§4.2). Ou se gera XML válido com o NIF real do tenant, ou se renomeia honestamente para "Exportação de Movimentos (JSON)". Não fica no meio.

**BUG-19 · CSV sem BOM UTF-8** — `ExportController.exportCsv` e `FinancasController.exportData` não emitem `\uFEFF`. Aberto no Excel em Português, todos os acentos aparecem partidos. O `qa/CONTRATO.md` ponto 14 exige compatibilidade com Excel.
→ Prefixar `\uFEFF` e usar `;` como separador em locale PT.

## 2.4 Cálculos errados

**BUG-20 · Totais diferentes no mesmo ecrã**
`DashboardController.getDashboard` soma transações com `status: { not: 'REJECTED' }`. `FinanceController.getSummary` soma só `status: 'APPROVED'`. `BudgetController.analyzeBudget` usa `APPROVED`; `listBudgets` usa `not REJECTED`. Quatro definições de "receita" no mesmo módulo.
→ Definir **uma** regra, em `§4.5`, num único módulo de cálculo partilhado. Nenhum controller volta a somar por sua conta.

**BUG-21 · A projeção de fluxo de caixa não projeta nada**
`getCashFlowProjection` percorre os próximos N meses e, para cada um, agrega `FinancialTransaction` com `date` dentro desse mês futuro. Mas transações futuras raramente existem — logo a projeção devolve entradas e saídas ≈ 0 e um saldo plano. **Ignora `dueDate`, ignora recorrências, ignora movimentos planeados, ignora empréstimos.** Os multiplicadores de cenário (×1,15 / ×0,85) aplicados a zero continuam a dar zero.
→ Reescrever segundo §4.6. Isto responde diretamente ao teu requisito: **a evolução do saldo tem de considerar as datas de vencimento registadas.**

**BUG-22 · `availableBalance = profit`**
No `DashboardController`, o "saldo disponível" é o lucro dos últimos 12 meses. Não é saldo, não é disponível, e ignora saldo inicial, comprometido e transferências.
→ Redefinir segundo §4.5.

**BUG-23 · Orçamento por categoria que não olha para a categoria**
`DashboardController` e `BudgetController.listBudgets` comparam o total de **todas** as despesas do período contra o total orçamentado, ignorando `BudgetItem.category`. Um orçamento de 400 € para Alimentação aparece a 100 % assim que a empresa gastar 400 € em qualquer coisa.
→ Cruzar sempre `BudgetItem.category` com a categoria da despesa.

**BUG-24 · Transferências contadas como receita e despesa**
`TransactionType.TRANSFER` existe no enum, o `<select>` do `app.html` oferece "🔄 Transferência", e nenhum cálculo a exclui. Mover 300 € entre contas inflaciona receitas e despesas.
→ Excluir `TRANSFER` de todos os agregados de receita/despesa/resultado. Só afeta saldos de conta. (Ver §4.7.)

## 2.5 Desempenho

**BUG-25 · N+1 no dashboard financeiro**
`getDashboard` faz 2 agregações globais + **24 agregações sequenciais** (12 meses × 2) + 1 `groupBy` + 1 `findMany` + 1 agregação por cada orçamento activo. Em Neon serverless, cada uma é um round-trip. Um dashboard = 30+ viagens à BD.
→ Substituir por **uma** query de série temporal (`$queryRaw` com `date_trunc('month', ...)` + `GROUP BY`) e uma agregação por categoria. Alvo: ≤ 4 queries por dashboard, p95 < 400 ms.

**BUG-26 · Listagens sem limite**
`FinancasController.listTransactions`, `getDashboard` e `exportData` fazem `findMany` sem `take`. Com 10 000 movimentos (o limite do plano declarado no manifesto), o payload rebenta o limite de resposta serverless da Vercel.
→ Paginação obrigatória (`take`/`skip` com máximo 200) em todas as listagens; exportação em streaming.

**BUG-27 · `GET /api/financas/categories` escreve na base de dados**
`listCategories` chama `seedFinancas()` se a contagem for zero. Um GET com efeito secundário, disparado por qualquer refresh, e com risco de corrida se dois pedidos chegarem juntos.
→ O seed acontece **na ativação do módulo** (`approveAccountRequest` / `ApplicationController.create`), nunca numa leitura.

## 2.6 Interface

**BUG-28 · Emojis na interface** — `AGENTS.md` §4 proíbe emojis e exige SVG inline. Contagem actual: **50 em `app.html`**, **36 em `super-admin.html`**, 6 em `workspace.html`. Todos os botões de ação, tabs e títulos os usam.

**BUG-29 · `app.html` importa o design system e depois reescreve-o** — carrega `tokens.css` e a seguir redefine `--accent`, `--text-primary`, `--gridline` etc. num `:root` inline. Além disso `styles.css` define um segundo conjunto de tokens concorrente (já registado em `docs/INVENTARIO.md` como "defeito a)").

**BUG-30 · `prompt()` e `confirm()` nativos** — `promptLoanPayment` pede um valor com `prompt()`; várias ações usam `confirm()`. Num ERP é indefensável: sem validação de formato, sem contexto, sem acessibilidade, e a página fica bloqueada.

**BUG-31 · O padrão `.catch(fallback)` esconde erros** — descrito em §1.2. Erros de autorização, validação e rede aparecem todos como "sem dados". **Eliminar completamente este padrão.**

---

# 3. DECISÃO DE ARQUITETURA — CONSOLIDAÇÃO FINANCEIRA (BLOQUEANTE)

## 3.1 Modelo canónico

O modelo canónico passa a ser o do módulo `financas`, **estendido**. Razões: cêntimos inteiros (exigidos pelo `qa/CONTRATO.md` ponto 12 e única forma correta de representar dinheiro), categorias em tabela (personalizáveis por tenant, com hierarquia), tenant scoping já correto, e `dueDate` como cidadão de primeira classe — que é o que a previsão precisa.

Extensões a acrescentar a `FinanceTransaction` (todas como colunas novas, anuláveis — migração aditiva, zero risco):

```prisma
model FinanceTransaction {
  // ... campos existentes preservados na íntegra ...

  type            FinanceMovementType @default(EXPENSE) // INCOME | EXPENSE | TRANSFER
  accountId       String?             // conta financeira (§4.7)
  transferToId    String?             // conta destino, quando type = TRANSFER
  costCenterId    String?             // centro de custo (§4.8)
  companyId       String?             // ligação ao CRM (§5) — quem pagou / a quem se pagou
  counterpartyName String?            // fornecedor/cliente em texto livre quando não há Company
  documentNumber  String?             // nº de fatura/recibo (substitui invoiceNumber)
  approvalStatus  ApprovalStatus?     // NONE | PENDING | APPROVED | REJECTED
  approvedBy      String?
  approvedAt      DateTime?
  tags            String[]            @default([])
  deletedAt       DateTime?           // soft delete (BUG-08)

  attachments     FinanceAttachment[]

  @@unique([tenantId, documentNumber])   // corrige BUG-07
  @@index([tenantId, dueDate, status])
  @@index([tenantId, deletedAt])
}
```

`FinanceCategory` ganha hierarquia e orçamento:

```prisma
model FinanceCategory {
  // ... existente ...
  parentId  String?            // subcategorias
  parent    FinanceCategory?   @relation("CategoryTree", fields: [parentId], references: [id])
  children  FinanceCategory[]  @relation("CategoryTree")
  sortOrder Int @default(100)
}
```

`Budget`/`BudgetItem` mantêm-se como tabelas, mas `BudgetItem.category` (enum) é **acompanhado** por `categoryId String?` a apontar para `FinanceCategory`. A coluna enum antiga fica, marcada como deprecada, para não quebrar o rollback.

## 3.2 Migração de dados — plano exato, reversível

1. **Backup** `pg_dump` + verificação de tamanho > 0.
2. **Contagem antes**: `SELECT count(*), sum(amount) FROM financial_transactions GROUP BY tenant_id, type;` e o equivalente em `finance_transactions`. **Guardar o resultado num ficheiro em `docs/migracao/`.**
3. **Migração aditiva** das colunas novas (nada é removido).
4. **Script de cópia** `backend/scripts/migrate-finance-consolidation.mjs`, idempotente:
   - cada `FinancialTransaction` gera uma `FinanceTransaction` com `amountCents = Math.round(amount * 100)`;
   - `type REVENUE → INCOME`, `EXPENSE → EXPENSE`, `TRANSFER → TRANSFER`;
   - `status APPROVED|RECONCILED|PAID → PAID`; `PENDING|PLANNED → PLANNED`; `REJECTED → PLANNED` + `approvalStatus = REJECTED`;
   - `dueDate = dueDate ?? date`; `paidDate = date` quando o estado é liquidado;
   - `category` (enum) → `FinanceCategory` correspondente, criada por tenant se não existir, com o nome PT legível;
   - guardar o id de origem em `notes` ou num campo `legacyId` para permitir reconciliação e reversão;
   - **não apagar nada em `financial_transactions`.**
5. **Contagem depois** e comparação: número de movimentos e soma total têm de bater exatamente (em cêntimos). Diferença ≠ 0 → **rollback e parar**.
6. As tabelas `financial_transactions`, `bank_reconciliations` e `financial_reports` ficam na BD como arquivo histórico, sem UI.
7. As rotas `/api/finance/*` mantêm-se durante **uma versão**, reimplementadas como *adaptadores finos* sobre o modelo canónico, com header `Deprecation` e log de aviso. Só se removem quando nenhum ecrã as chamar.

> ⚠️ **Se a contagem não bater, não improvises.** Reverte a migração, escreve o relatório da divergência em `docs/migracao/` e para. É preferível uma fase incompleta a um número financeiro errado.

---

# 4. MÓDULO FINANCEIRO — ESPECIFICAÇÃO FUNCIONAL

## 4.1 Filosofia

Não é um software de contabilidade. É um **centro de gestão financeira orientado à decisão**. Ao abrir *Financeiro → Visão Geral*, o utilizador tem de perceber a situação em **menos de 10 segundos**, sem clicar em nada.

Três níveis de leitura, e a interface tem de os tornar óbvios:
1. **Visão rápida** — "Como estou?"
2. **Análise** — "Porque estou assim?"
3. **Previsão** — "O que acontece se continuar assim?"

O ecrã actual mostra sobretudo o que já aconteceu. O novo mostra **o que aconteceu + porque aconteceu + o que provavelmente acontecerá**.

## 4.2 Navegação nova

```
Visão Geral · Movimentos · Receitas · Despesas · Orçamentos
Fluxo de Caixa · Previsões · Análises · Recorrências
Categorias · Documentos · Configuração
```

**Sai da navegação principal:** Reconciliação Bancária e SAF-T.
**Não se cria:** emissão de faturas, processamento fiscal, contabilidade organizada, lançamentos por partidas dobradas.

> ⚠️ **Aviso técnico sobre remover a Reconciliação Bancária — lê isto antes de a tirares.**
> O saldo inicial da projeção de fluxo de caixa (`getCashFlowProjection`) é hoje lido da **última reconciliação bancária**. Se removeres a funcionalidade sem substituir a origem do saldo, a projeção passa a arrancar de zero e todo o módulo de previsão fica errado — uma regressão que ninguém nota até um cliente reclamar.
> **Ordem obrigatória:** (1) criar `FinanceAccount` com `openingBalanceCents` (§4.7); (2) migrar o saldo inicial de cada tenant a partir da última reconciliação existente; (3) apontar a projeção às contas; (4) só então retirar a Reconciliação da navegação. Os dados de `bank_reconciliations` **ficam na BD**.

## 4.3 Visão Geral — o cockpit

Primeira linha, seis cartões, cada um com valor **e** comparação com o período anterior (variação absoluta e percentual, com direção):

`Saldo Atual` · `Receitas` · `Despesas` · `Resultado` · `Comprometido` · `Disponível`

Seletor de período aplicável a todo o ecrã: Hoje · Esta semana · Este mês · Últimos 3/6/12 meses · Este ano · Ano anterior · Intervalo personalizado. **Mudar o período recalcula tudo — cartões, gráficos e tabelas — a partir da mesma fonte.**

Layout abaixo dos cartões:

```
┌──────────────────────────────────────────────────────────┐
│  EVOLUÇÃO FINANCEIRA — Receitas · Despesas · Resultado    │
│  (gráfico grande, com alternância de séries)              │
├───────────────────────────────┬──────────────────────────┤
│  FLUXO DE CAIXA (90 dias)     │  DESPESAS por categoria  │
├───────────────────────────────┼──────────────────────────┤
│  ORÇAMENTO — utilização        │  RECEITAS — evolução     │
├───────────────────────────────┴──────────────────────────┤
│  INSIGHTS FINANCEIROS · alertas · tendências · ações      │
└──────────────────────────────────────────────────────────┘
```

## 4.4 CRUD completo em todas as entidades

Movimentos · Receitas · Despesas · Categorias · Subcategorias · Orçamentos · Recorrências · Contas · Centros de custo · Documentos · Etiquetas · Regras.

Para cada uma: criar · consultar · editar · **eliminar sempre por soft delete** · duplicar (onde faz sentido) · restaurar. O formulário de movimento tem **"Guardar e criar outro"** para introdução rápida.

Campos do movimento: Data · Descrição · Tipo · Valor · Categoria · Subcategoria · Conta · Centro de custo · Entidade relacionada (empresa do CRM ou texto livre) · Recorrente · Estado · Data de vencimento · Data de pagamento · Etiquetas · Notas · Documento anexo.

## 4.5 Definições de cálculo — uma só, num só sítio

Cria `backend/src/modules/financas/services/FinanceCalcService.ts`. **Nenhum controller volta a somar por conta própria.** Definições fixadas:

- **Receita do período** = Σ `amountCents` de movimentos `INCOME`, `deletedAt: null`, `type ≠ TRANSFER`, cuja **data de competência** cai no período. Data de competência = `paidDate` se `status = PAID`, senão `dueDate`.
- **Despesa do período** = idem para `EXPENSE`.
- **Resultado** = Receita − Despesa.
- **Saldo atual** = Σ `openingBalanceCents` das contas ativas + Σ movimentos **liquidados** (`status = PAID`) até hoje. Transferências afetam contas individuais, nunca o total.
- **Comprometido** = Σ despesas `PLANNED` com `dueDate` ≥ hoje.
- **A receber** = Σ receitas `PLANNED` com `dueDate` ≥ hoje.
- **Disponível** = Saldo atual − Comprometido nos próximos 30 dias.
- **Em atraso** = `PLANNED` com `dueDate` < hoje (destacar sempre, em receitas e despesas).

Estas definições ficam escritas em `docs/FINANCEIRO_DEFINICOES.md` e **cobertas por testes unitários**. Quando um número da UI não bater com a expectativa, é este ficheiro que arbitra.

## 4.6 Fluxo de caixa e previsão — baseados em datas de vencimento

Este é o requisito central. O algoritmo:

```
saldo(d0) = Σ openingBalance das contas + Σ movimentos PAID até hoje

para cada dia/semana/mês do horizonte:
    entradas previstas =
        movimentos INCOME  PLANNED com dueDate nesse intervalo
      + ocorrências de RecurringRule INCOME projetadas nesse intervalo
      + prestações de empréstimos concedidos (LENT) com vencimento no intervalo
    saídas previstas =
        movimentos EXPENSE PLANNED com dueDate nesse intervalo
      + ocorrências de RecurringRule EXPENSE projetadas
      + prestações de empréstimos obtidos (BORROWED) com vencimento no intervalo
    saldo previsto = saldo anterior + entradas − saídas
```

Requisitos:
- Vistas de **7 / 30 / 60 / 90 dias** e horizonte configurável até 12 meses.
- Granularidade diária, semanal ou mensal.
- **Distinção visual inequívoca entre realizado e previsto** (linha sólida vs. tracejada, e legenda explícita).
- Movimentos **vencidos e não pagos** entram no dia de hoje, não na data original — e são sinalizados.
- As recorrências são projetadas **em memória**, sem materializar registos na BD (materializar futuros polui os dados e é irreversível).
- Cenários Base / Otimista / Pessimista aplicam-se sobre valores previstos reais, não sobre zero. Se não houver dados suficientes, mostrar estado vazio honesto ("dados insuficientes para projetar") em vez de uma linha plana enganadora.
- Alerta destacado quando o saldo previsto ficar negativo, com a data prevista.

## 4.7 Contas financeiras

Novo modelo `FinanceAccount`: nome · tipo (Banco, Caixa, Carteira, Conta digital, Poupança, Outra) · `openingBalanceCents` · moeda · estado · descrição · `deletedAt`.

**Transferências** entre contas: um movimento `TRANSFER` com `accountId` e `transferToId`. Debita uma, credita a outra, e **não conta como receita nem despesa em nenhum agregado**. Testar explicitamente (BUG-24).

**Sem reconciliação bancária.** Sem importação OFX/QIF nesta versão.

## 4.8 Orçamentos e centros de custo

Orçamentos por **categoria** (não por total), com períodos mensal / trimestral / anual, e opcionalmente por centro de custo. Barra de progresso com quatro escalões — verde < 70 %, amarelo 70–90 %, laranja 90–100 %, vermelho > 100 % — e alertas automáticos aos 80 %, 90 % e 100 % conforme o `qa/CONTRATO.md` ponto 13.

Centros de custo em árvore (Operações, Marketing, Tecnologia, Administração, Projetos), com análise de receitas e despesas por centro.

## 4.9 Documentos anexos

⚠️ **Restrição técnica que tens de respeitar:** a Vercel serverless **não tem disco persistente com escrita**. `FinancialAttachment.fileUrl` guarda um URL, mas nada no código faz upload. Anexar ficheiros exige armazenamento externo — **Vercel Blob**, S3 ou Cloudflare R2.

Se o armazenamento ainda não estiver provisionado: **não construas um botão de upload que não funciona.** Constrói a tabela de documentos com estado "sem armazenamento configurado" e uma nota clara. Um botão morto é pior do que a ausência da funcionalidade — e o `qa/CONTRATO.md` ponto 11 proíbe-o explicitamente.

Cada documento: Nome · Tipo · Data de emissão · Validade · Estado · Quem carregou. **Nunca eliminar automaticamente documentos associados a um movimento.**

## 4.10 Análises, alertas e insights

**Análise de despesas:** onde se gasta, evolução mensal, deteção de aumentos significativos ("Transportes subiram 23 % este mês"), Top 10 despesas, recorrentes vs. extraordinárias.
**Análise de receitas:** evolução, fontes, concentração (% da maior fonte), estabilidade, sazonalidade.
**Comparação de períodos:** mês vs. mês anterior e mês vs. mesmo mês do ano anterior, em tabela com variação absoluta e percentual.

**Alertas:** despesa acima da média · orçamento perto do limite · saldo previsto negativo · receita abaixo do habitual · despesa recorrente aumentou · movimento de valor elevado · categoria ultrapassou orçamento · movimentos vencidos por liquidar.

**Insights automáticos** — frases geradas a partir de regras determinísticas (nada de invenção): «As despesas aumentaram 14 % face ao mês anterior.» · «Transportes representam 18 % das despesas.» · «Despesas recorrentes: 1 240 €/mês.» · «Ao ritmo atual, o saldo estimado em dezembro será 3 840 €.» · «Tem 870 € de despesas previstas nos próximos 30 dias.»

Cada insight tem de ser **verificável** — clicar leva aos movimentos que o originaram.

## 4.11 Relatórios

Mensal · anual · receitas · despesas · resultado · fluxo de caixa · orçamento · categorias · centros de custo. Todos com filtros, gráficos, exportação CSV (com BOM UTF-8) e impressão/PDF onde já houver suporte.

---

# 5. MÓDULO CRM — FICHA DE EMPRESA COMPLETA

## 5.1 Estado atual

`Customer` tem **três** campos úteis: `companyName`, `website`, `assignedUserId`. `Contact` tem cinco. A vista CRM do `app.html` são três tabelas planas; a de Clientes mostra duas colunas. Não há ficha de empresa, não há detalhe, não há histórico.

## 5.2 Modelo novo — `Company`

Criar `Company` como entidade central do CRM, unificando o que hoje está disperso por `Lead` e `Customer`. **`Lead` e `Customer` não são apagados**: passam a apontar para `Company` (`companyId`), e um script preenche a nova tabela a partir dos registos existentes. As rotas antigas continuam a responder.

### Identificação
Nome comercial · Razão social · NIF/NIPC · Tipo de entidade (ENI, Lda., S.A., Associação, Particular, Outro) · País · Região/Distrito · Morada · Código postal · Localidade · Website · Telefone geral · Email geral · Data de constituição · Estado (Ativa, Inativa, Potencial cliente, Cliente, Ex-cliente, Fornecedor).

### Informação comercial
Setor · Segmento · Subsetor · Dimensão · Nº de trabalhadores · Volume de negócios · Origem do contacto · Responsável comercial · Gestor de conta · Classificação · Potencial de negócio · Prioridade · Etiquetas · Observações.

### Contactos (`CompanyContact`, N por empresa)
Nome · Cargo · Departamento · Email · Telefone · Telemóvel · Notas · e **papéis múltiplos** (principal / financeiro / comercial / técnico) — um contacto pode acumular papéis, por isso usa flags booleanas ou uma tabela de papéis, não um único campo.

### Moradas (`CompanyAddress`, N por empresa)
Finalidade (Sede, Faturação, Entrega, Loja, Armazém, Filial, Escritório) · morada · código postal · localidade · país · principal.

### Dados de faturação (separados dos comerciais)
Nome de faturação · NIF · morada de faturação · código postal · país · email de faturação · condições de pagamento · prazo · método · IBAN · regime de IVA · série de faturação · observações fiscais.
⚠️ IBAN é dado sensível: guardar cifrado ou mascarado na UI (mostrar só os últimos 4 dígitos), com acesso restrito a permissão dedicada.

### Documentos (`CompanyDocument`)
Nome · Tipo (certidão permanente, cartão de empresa, comprovativo de NIF, contrato, proposta, orçamento, fatura, licença, seguro, doc. técnica, outro) · Data de emissão · Validade · Estado · Quem carregou.
Alerta automático de documento a expirar (30/15/7 dias). **Aplica-se a mesma restrição de armazenamento do §4.9.**

### Contratos (`Contract`)
Número · Tipo · Data de início · Data de fim · Renovação automática · Valor · Periodicidade · Estado · Documento associado · Responsável · Alertas de renovação (90/60/30 dias).

### Informação financeira da empresa
Limite de crédito · crédito utilizado · condições de pagamento · saldo em aberto · total faturado · total recebido · total vencido · última faturação · último pagamento.
Estes valores são **derivados** dos movimentos financeiros ligados por `FinanceTransaction.companyId` — nunca campos escritos à mão que se desatualizam.

### Relações (`CompanyRelation`)
Empresa A → pertence ao Grupo B · tem filial C · fornecedor D · cliente E. Tipo de relação + direção, para construir a rede empresarial e permitir navegar por ela.

### Timeline
Vista única e cronológica de tudo o que aconteceu com a empresa: chamadas · emails · reuniões · notas · propostas · oportunidades · vendas · faturas · pagamentos · contratos · documentos · **alterações de dados** (a partir do `audit_logs`). Filtrável por tipo e período.

### Dados internos (acesso restrito por permissão)
Responsável interno · departamento · classificação · margem · comissões · notas internas · risco · probabilidade de venda · estado do relacionamento.
Estes campos **nunca** aparecem em exportações, listagens públicas ou no portal do cliente.

## 5.3 Perfil progressivo — obrigatório

**Não obrigues ninguém a preencher 40 campos para criar uma empresa.**

**Mínimo para criar:** Nome · Tipo de entidade · País · Email ou telefone. (O NIF **não** é obrigatório na criação — leads iniciais raramente o têm; passa a obrigatório na transição para o estado *Cliente*.)

Depois, indicador de completude no topo da ficha — «Perfil da empresa: 35 % completo» — com sugestões acionáveis:
- ⚠ Falta morada de faturação
- ⚠ Falta contacto principal
- ⚠ Falta NIF
- ⚠ Falta condição de pagamento

A completude é calculada por pesos configuráveis, não por contagem simples de campos: o NIF vale mais que o website.

## 5.4 Estrutura da ficha (separadores)

```
EMPRESA
├── Identificação      (dados gerais · fiscais · contacto)
├── Comercial          (segmentação · responsáveis · oportunidades · vendas)
├── Contactos
├── Moradas
├── Faturação
├── Contratos
├── Documentos
├── Atividades         (chamadas · emails · reuniões · notas)
├── Financeiro         (faturas · pagamentos · saldos)
└── Histórico          (timeline completa)
```

## 5.5 Restantes correções do CRM

- `createLeadSchema` rejeita `mobile`, `role`, `website` e `assignedUserId` apesar de o modelo `Lead` os ter. Alinhar o schema Zod com o modelo.
- Pipeline de oportunidades em **kanban** com arrastar entre fases, além da tabela.
- Importação de contactos por CSV (já está listada como próximo passo no `ESTADO.md`).
- Lead da landing page: manter `POST /api/public/leads` como entrada única (BUG-06), criar `Company` no estado *Potencial cliente*, gravar a mensagem como `Communication`, e criar oportunidade conforme o `PlatformSetting` `crm.landing.auto_create_opportunity`. **Isto já funciona — não o partas.** Cobre-o com um teste de regressão antes de mexer.

---

# 6. APROVAÇÕES E LICENCIAMENTO — O QUE FALTA

## 6.1 Ligar o pedido de acesso ao ecrã de aprovação (corrige §1.3)

`login.html → submitRequestAccess()` e o equivalente no `index.html` passam a chamar **`POST /api/public/register`**, enviando `companyName`, `contactName`, `email`, `phone`, `intendedModule`, `acceptedTerms`, `acceptedPrivacy`.

Distinção clara na interface, porque são dois fluxos diferentes:
- **"Solicitar acesso ao ERP"** → `/api/public/register` → `AccountRequest` → aba **Aprovações** da consola.
- **"Falar connosco / pedir contacto"** → `/api/public/leads` → `Lead` → **CRM da HelderLabs**.

Teste de aceitação: submeter o formulário de acesso e ver a linha aparecer em `super-admin.html → Aprovações`, com o contador do badge a incrementar.

## 6.2 O ecrã de aprovação tem de decidir licença, período e preço

Hoje, o modal de aprovação oferece três checkboxes de módulos e mais nada. `ApplicationInstance` **já tem** `plan`, `features`, `limits`, `validFrom`, `validUntil`, `graceDays` — e o `ApplicationController` **ignora-os todos**. O `EntitlementService` já sabe interpretar `validUntil` e `graceDays` (calcula estados TRIAL/GRACE/SUSPENDED e `daysLeft`). Falta apenas expor isto.

Campos novos em `ApplicationInstance` (migração aditiva):

```prisma
priceCents      Int?      // valor a cobrar
billingPeriod   String?   // MONTHLY | YEARLY | ONE_OFF
currency        String    @default("EUR")
discountPercent Int?
billingNotes    String?
```

O modal de aprovação, e o ecrã de gestão da empresa, passam a ter **por módulo**:
Módulo · Plano · Estado (Trial/Ativo) · Válido de · Válido até · Dias de tolerância · **Valor** · **Periodicidade (mensal/anual)** · Limites · Funcionalidades.

Resumo no topo: **MRR total desta empresa** e **MRR da plataforma** na lista de tenants.

Alertas de licença a expirar (30/15/7 dias) na consola do Super Admin e banner no workspace do cliente.

`ApplicationController.create` e `.update` passam a aceitar e validar estes campos (hoje o `UpdateApplicationSchema` só aceita `status` e `config`). Toda a alteração de licenciamento gera `AuditService` com valor antigo e novo — é informação de faturação.

## 6.3 Perfis (roles) com CRUD real

Hoje `GET /api/platform/roles` devolve **um array hardcoded** de strings e `UserRole` é um **enum Prisma** — por isso criar ou alterar perfis é literalmente impossível sem uma migração de schema. É esta a causa do problema que reportaste.

**Caminho não destrutivo** (não mexas no enum, é usado no JWT e em dezenas de comparações):

```prisma
model Role {
  id          String  @id @default(cuid())
  tenantId    String?          // NULL = perfil global da plataforma
  key         String           // slug estável
  name        String
  description String?
  isSystem    Boolean @default(false)   // perfis de sistema não se apagam
  baseRole    UserRole                  // mapeia para o enum legado — mantém compatibilidade
  deletedAt   DateTime?
  permissions RolePermissionLink[]
  @@unique([tenantId, key])
}
```

- `User` ganha `roleId String?`. Enquanto for `NULL`, vale o `role` (enum) — **zero regressões**.
- Seed cria os perfis de sistema equivalentes aos valores do enum atual, com `isSystem: true`.
- A tabela `Permission` já existe mas está vazia de utilidade: popular com o catálogo real (`financas.read`, `financas.write`, `financas.admin`, `crm.lead.read`, `crm.company.write`, `crm.internal.read`, `platform.licensing.write`, …).
- UI: ecrã **Perfis & Permissões** com criar / duplicar / editar / desativar perfil e uma **matriz de permissões** (perfil × permissão) com checkboxes.
- `requirePermission` passa a resolver por `roleId` quando existir, com fallback para o enum. A regra atual, que dá passe livre a `SUPER_ADMIN` e `TENANT_OWNER` e devolve `[\`${mod.key}.access\`]` como única permissão, é substituída pelas permissões reais do perfil.
- Perfis de sistema não podem ser apagados nem despromovidos.

---

# 7. INTERFACE 10/10 — O QUE ISSO SIGNIFICA CONCRETAMENTE

## 7.1 Fundações

1. **Partir o monólito.** `app.html` (89 KB) divide-se em `app.html` (estrutura) + `assets/css/app.css` + `assets/js/app.js` + um ficheiro JS por módulo (`finance.js`, `crm.js`, `condominios.js`). Sem framework novo: continua vanilla ES2023, conforme o `AGENTS.md`.
2. **Um só sistema de tokens.** Eliminar o `:root` inline do `app.html` e os tokens concorrentes de `styles.css`. Fonte única: `assets/css/design-system/tokens.css`. Consolidar `tokens.css` + `typography.css` + `components.css` num bundle (já registado como dívida técnica de média prioridade).
3. **Zero emojis.** Substituir os 50 do `app.html`, 36 do `super-admin.html` e 6 do `workspace.html` por um sprite SVG inline (`assets/img/icons.svg` + `<use>`). É regra explícita do `AGENTS.md` §4.
4. **Estética "Caderno de Engenharia".** Papel quadriculado, tinta azul (`--pen`), vermelho de correção (`--red`), cantos de 2 px, tipografia Spectral / Archivo / IBM Plex Mono. Números **sempre** em `font-variant-numeric: tabular-nums` — numa tabela financeira, dígitos que não alinham são um defeito.
5. **Modo claro e escuro** completos, testados nos dois, com `prefers-color-scheme` respeitado.

## 7.2 Componentes

- **Nada de `prompt()` / `confirm()` / `alert()`.** Modais próprios, com foco preso, fecho por `Esc`, botão primário à direita, e para ações destrutivas confirmação por escrito do nome do registo.
- **Estados vazios desenhados** — ícone, uma frase que explica, e o botão da ação seguinte. Nunca "A carregar…" eternamente.
- **Estados de carregamento por skeleton**, não spinners que fazem saltar o layout.
- **Estados de erro visíveis e específicos.** Fim do `.catch(fallback)`. 403 mostra "módulo não licenciado"; 401 leva ao login; 500 mostra o `requestId` para suporte.
- **Tabelas:** cabeçalho fixo, ordenação por coluna, filtros persistentes no URL, seleção múltipla com ações em lote, densidade ajustável, coluna de valor alinhada à direita.
- **Formulários:** validação inline com mensagem por campo, preservação do que foi escrito em caso de erro (o `connection-banner.js` já faz isto para offline — reutilizar), `autofocus` no primeiro campo.
- **Toasts** com ação de desfazer para todas as eliminações (10 s).
- **Atalhos:** `Ctrl+K` para pesquisa global (já existe no workspace — estender ao `app.html`), `N` para novo movimento, `Esc` para fechar.

## 7.3 Gráficos

Grandes, legíveis, com eixos rotulados e valores no hover. Paleta derivada dos tokens, não cores soltas. Distinção clara entre realizado e previsto. Sempre com equivalente acessível: tabela de dados por baixo ou `aria-label` com o resumo.

**Os gráficos e as tabelas têm de usar exactamente a mesma fonte de dados.** Hoje não usam — é a origem de metade da desconfiança nos números.

## 7.4 Responsividade e acessibilidade

Desktop, tablet e telemóvel. Tabelas com scroll horizontal próprio, nunca a página. Contraste AA mínimo. Navegação completa por teclado. `aria-live` nos toasts e nos totais que mudam com o filtro.

---

# 8. TESTES OBRIGATÓRIOS

Sem estes verdes, a fase não está concluída.

**Isolamento multi-tenant**
- Utilizador do tenant A não lê, não altera e não apaga nada do tenant B, em todos os endpoints novos.
- TENANT_ADMIN não consegue criar nem alterar licenças (BUG-02, BUG-03).
- Endpoint financeiro sem licença → 403 `APP_NOT_LICENSED` (BUG-01).

**Integridade financeira**
- Receita − Despesa = Resultado, com transferências excluídas (BUG-24).
- Saldo inicial + entradas − saídas = saldo atual.
- Recorrências geram as ocorrências certas em cada periodicidade, sem duplicar ao correr duas vezes (idempotência).
- Orçamento: percentagem por categoria correta; alertas disparam a 80/90/100 %.
- Soft delete: eliminar não reduz a contagem na BD; restaurar repõe (BUG-08).
- Migração: contagem e soma antes = contagem e soma depois, ao cêntimo.

**Previsão**
- Com movimentos planeados a 15, 45 e 75 dias, a projeção de 90 dias reflete-os nas datas certas.
- Movimento vencido e não pago aparece no dia de hoje.
- Sem dados suficientes → estado vazio explícito, não linha plana.

**Fluxo de aprovação**
- Submeter "Solicitar Acesso" → `AccountRequest` criado → aparece na consola → aprovar com módulos, datas e valor → `ApplicationInstance` com `validUntil` e `priceCents` corretos → o utilizador entra e vê exatamente os módulos licenciados.
- Registo com email já aprovado → 409 e registo intacto (BUG-05).

**CRM**
- Lead da landing continua a chegar ao CRM da plataforma (teste de regressão **antes** de qualquer alteração).
- Criar empresa só com os campos mínimos funciona; completude calculada corretamente.
- Converter Lead → Oportunidade → Cliente preserva todo o histórico de comunicações.

**Interface (Playwright)**
- Percurso completo do módulo financeiro em desktop e mobile.
- Zero erros no `console` em todos os ecrãs.
- Zero emojis no HTML renderizado (assertivo, por regex).
- Contraste e navegação por teclado nos formulários principais.
- Screenshots antes/depois de cada ecrã alterado, guardados em `qa/screenshots/`.

**Verificação final obrigatória**
```bash
cd backend && npm run verify        # typecheck estrito + suite completa
```
Mais: correr a app, abrir cada ecrã, comparar os números do dashboard com uma query SQL direta à BD. **Se não bater, não está pronto — mesmo que compile.**

---

# 9. ORDEM DE EXECUÇÃO

Cada fase termina com `npm run verify` verde, commit próprio e atualização do `DIARIO.md`.

**Fase 0 — Auditoria e plano** *(sem alterar código)*
Mapear entidades, tabelas, campos, relações, endpoints, cálculos e dependências entre os dois módulos financeiros. Contar registos por tabela e por tenant. Produzir `docs/AUDITORIA_FIN_CRM.md` com o inventário e o plano de migração. **Entregar antes de continuar.**

**Fase 1 — Segurança e correções sem risco**
BUG-01 a BUG-07, BUG-14. Sem alterações de schema exceto o índice de `documentNumber`. Ganho imediato, risco quase nulo.

**Fase 2 — Corrigir o fluxo de aprovação** (§6.1)
Duas linhas de frontend resolvem o problema que mais te incomoda. Fazer cedo.

**Fase 3 — Migração aditiva do schema**
Colunas novas, `FinanceAccount`, `CostCenter`, `Company` e satélites, `Role`/`RolePermissionLink`, `deletedAt`. Nada é removido. Backup + contagens antes e depois.

**Fase 4 — Consolidação financeira** (§3.2)
Script de migração, `FinanceCalcService`, rotas `/api/finance/*` convertidas em adaptadores deprecados. Verificação de totais obrigatória.

**Fase 5 — Backend financeiro novo**
CRUD completo, contas, transferências, centros de custo, orçamentos por categoria, previsão por `dueDate`, análises, alertas, insights, relatórios, exportações.

**Fase 6 — Backend CRM**
`Company` + contactos + moradas + faturação + contratos + documentos + relações + timeline + completude.

**Fase 7 — Licenciamento e perfis** (§6.2, §6.3)

**Fase 8 — Interface**
Partir o monólito, tokens únicos, remover emojis, componentes, gráficos, responsividade, acessibilidade.

**Fase 9 — QA visual e correção**
Playwright, screenshots, correções, nova ronda.

**Fase 10 — Documentação honesta**
Corrigir `docs/MODULOS.md`, `ESTADO.md`, `qa/CONTRATO.md`, `docs/INVENTARIO.md` e `DIVIDA_TECNICA.md` para descreverem o sistema **real**. Resolver a contradição `erp_session` vs `hl_token` com um ADR novo em `DECISOES.md`.

---

# 10. FORA DE ÂMBITO NESTA VERSÃO

Emissão de faturas certificadas · contabilidade organizada e partidas dobradas · reconciliação bancária e importação OFX/QIF · SAF-T XML certificado · integração bancária PSD2 · portal do cliente · módulos rent-a-car e RH.

---

# 11. RELATÓRIO FINAL — FORMATO EXIGIDO

No fim, produz `docs/RELATORIO_FIN_CRM_v040.md` com:

1. O que foi alterado, ficheiro a ficheiro.
2. Bugs desta lista corrigidos, com a prova de cada um (teste, query ou screenshot).
3. Bugs **não** corrigidos e porquê.
4. Migrações aplicadas, com contagens e somas antes/depois por tabela e por tenant.
5. Testes executados e resultado.
6. Problemas novos encontrados durante o trabalho.
7. Dívida técnica criada — se criaste alguma, declara-a em `DIVIDA_TECNICA.md`, não a escondas.
8. Recomendações para a versão seguinte.

---

# 12. REGRA FINAL

Não entregues código. Entrega um **sistema**.

Um módulo financeiro cujos números batem certo com a base de dados, cuja previsão usa as datas de vencimento reais, cujos dados antigos continuam todos lá, e cuja interface responde à pergunta "como estou?" em menos de dez segundos.

Um CRM onde uma empresa é uma entidade completa e navegável, não duas colunas numa tabela.

E, acima de tudo: **se em algum momento não conseguires garantir que nenhum dado se perde, para e reporta.** Uma funcionalidade em falta corrige-se numa tarde. Um histórico financeiro perdido não se recupera.
