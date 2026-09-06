# PROMPT DE EXECUÇÃO — Antigravity
## HelderLabs ERP · Módulo "Finanças Pessoais" + Registo com Aprovação + Landing Page

> Complementa `docs/PROMPT_ANTIGRAVITY_PLATFORM.md` e `docs/PROMPT_ANTIGRAVITY_AMBIENTES.md`.
> Lê os dois antes de começar. Este módulo é o **primeiro produto real** da plataforma — é ele que valida se a camada de licenciamento funciona.

---

## 1. OBJETIVO

Uma pessoa registar-se em `helderlabs.eu`, o Hélder aprovar o acesso, e essa pessoa passar a ter uma aplicação de gestão de finanças pessoais no seu workspace — isolada de todas as outras.

Nada disto pode contornar a camada de plataforma já construída (entitlements, auditoria, isolamento multi-tenant). O módulo de finanças é o primeiro cliente dessa camada, não uma exceção a ela.

---

## 2. DECISÃO DE ARQUITETURA — LÊ ANTES DE ESCREVER CÓDIGO

O ERP é multi-tenant com `tenant = empresa`. Finanças pessoais é por pessoa. A ligação faz-se assim:

**Cada pessoa aprovada recebe o seu próprio tenant** (*tenant pessoal*, ou "tenant de um"). Não é um caso especial no código — é um `Tenant` normal com `type = PERSONAL`.

Porquê assim, e não com um `userId` em cada tabela de finanças:

- **Isolamento gratuito e já testado.** O `tenantScopedClient` e o `requireApp` passam a proteger as finanças sem uma linha nova de lógica de segurança. Um `userId` paralelo seria um segundo mecanismo de isolamento a conviver com o primeiro — e dois mecanismos significa que um deles vai ser esquecido.
- **Licenciamento reutilizado.** Plano gratuito, plano pago, limites, trial e suspensão por não pagamento já existem ao nível do `ApplicationInstance`. Um módulo fora do modelo de tenants ficaria sem nada disso.
- **Auditoria e impersonation funcionam.** Quando um utilizador pedir apoio, entras pelo fluxo auditado, com motivo registado. Sem tenant, não há contexto onde entrar.
- **Não fecha portas.** Conta familiar = o mesmo tenant com dois utilizadores. Contabilista com vários clientes = utilizador com acesso a vários tenants. Empresa = tenant `COMPANY`. Nenhum destes exige remodelação.

Acrescentar ao `Tenant`:

```prisma
enum TenantType {
  PERSONAL   // pessoa singular — finanças pessoais
  COMPANY    // empresa — CRM, condomínios, etc.
}

model Tenant {
  // ... campos atuais ...
  type TenantType @default(COMPANY)
}
```

**Regra:** um tenant `PERSONAL` nunca pode licenciar módulos `COMPANY` e vice-versa. Declara isso no `module.manifest.ts` de cada módulo (`allowedTenantTypes`) e valida no `ApplicationController.create`.

---

## 3. FLUXO DE REGISTO E APROVAÇÃO

**Grande parte disto já existe.** `AccountRequest`, `UserStatus.PENDING_APPROVAL` e a aprovação na consola de super admin estão construídos. Não reconstruas — liga.

### 3.1 Registo (público)

`POST /api/public/register` — rate-limited, sem autenticação:

```
{ name, email, phone?, acceptedTerms: true, acceptedPrivacy: true }
```

- Cria `AccountRequest` com `status: PENDING`
- Envia OTP por email (Resend) para provar posse do endereço
- **Não cria `User` nem `Tenant` nesta fase** — só depois da aprovação
- Grava `acceptedTermsAt` e `acceptedPrivacyAt` no `AccountRequest` (obrigatório para RGPD; ver secção 8)
- Notifica o super admin: email + contador na consola

Após verificação do OTP, o ecrã diz claramente: *"Email confirmado. A sua conta aguarda aprovação. Receberá um email quando estiver ativa."*

### 3.2 Aprovação (super admin)

Estende `ApplicationController.approveAccountRequest` para executar **numa única transação**:

1. Criar `Tenant` — `type: PERSONAL`, `name: <nome da pessoa>`, `slug` único derivado do nome
2. Criar `TenantBranding` com defaults (`pt-PT`, `EUR`, `Atlantic/Madeira`)
3. Criar `User` — `role: TENANT_OWNER`, `status: ACTIVE`, ligado a esse tenant
4. Criar `ApplicationInstance` do módulo `financas` — plano escolhido pelo super admin no modal (`gratuito` por omissão), `status: ACTIVE`, limites do plano
5. Criar `ApplicationAssignment` — `roleInApp: 'OWNER'`
6. Aplicar o seed inicial de categorias de finanças (secção 5.6)
7. Incrementar `Tenant.entitlementsVersion`
8. Escrever no `AuditLog` (`action: 'account_request.approved'`)
9. Enviar email de boas-vindas com link para definir password

Se qualquer passo falhar, **rollback completo**. Uma conta meio-criada é pior do que nenhuma: a pessoa recebe o email e não consegue entrar.

O modal de aprovação na consola pede: plano, e um campo opcional de notas. Deve mostrar quantos dias a pessoa esteve à espera.

### 3.3 Rejeição

`POST /api/platform/account-requests/:id/reject` com motivo obrigatório. Auditado. Email opcional (checkbox no modal — nem sempre se quer responder).

---

## 4. O QUE NÃO REPETIR DO PROTÓTIPO

Existe um protótipo deste módulo construído na Lovable ("Personal Vault"). **Não portes o código.** Tem quatro defeitos estruturais que têm de ser resolvidos no modelo de dados, não na UI:

**1. Valores monetários em vírgula flutuante.** O protótipo usa `REAL`. Em Postgres usa `Int` em **cêntimos** (`amountCents`), sempre. A divisão por 100 acontece só na formatação. Nunca `Float` para dinheiro, em nenhuma tabela, em nenhum agregado.

**2. Despesas recorrentes que só contam uma vez.** No protótipo, uma despesa mensal é uma linha com uma data; o dashboard filtra pelo mês e ela desaparece no mês seguinte. Uma NOS de 122€/mês aparece uma vez e o mês seguinte mostra zero despesas. Ver secção 5.2 para o modelo correto.

**3. Saldo mal definido.** O protótipo faz `todas as receitas − todas as despesas pagas`, desde sempre, ignorando empréstimos. Ver secção 5.5.

**4. Empréstimos guardados como despesas.** No protótipo, dinheiro emprestado a pessoas foi inserido na tabela de despesas — sinal invertido, sem pagamentos parciais, fora do "a receber". Empréstimos são entidade própria (secção 5.3).

---

## 5. MODELO DE DADOS

Novo ficheiro de módulo: `backend/src/modules/financas/`. Todos os modelos com `tenantId` **e registados em `TENANT_SCOPED_MODELS` no `tenantScopedClient.ts`** — é regra do `CLAUDE.md` e não há exceções.

### 5.1 Categorias e transações

```prisma
enum FinanceKind { INCOME EXPENSE }

model FinanceCategory {
  id        String       @id @default(cuid())
  tenantId  String
  tenant    Tenant       @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  name      String
  kind      FinanceKind
  color     String?
  icon      String?
  isSystem  Boolean      @default(false)   // as do seed: renomeáveis, não elimináveis
  archivedAt DateTime?
  @@unique([tenantId, name, kind])
  @@index([tenantId])
  @@map("finance_categories")
}

enum TransactionStatus { PLANNED PAID }

model FinanceTransaction {
  id          String            @id @default(cuid())
  tenantId    String
  tenant      Tenant            @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  kind        FinanceKind
  description String
  amountCents Int                                   // sempre positivo; `kind` dá o sinal
  currency    String            @default("EUR")
  dueDate     DateTime          @db.Date            // quando é devida
  paidDate    DateTime?         @db.Date            // quando foi efetivamente paga
  status      TransactionStatus @default(PLANNED)
  categoryId  String?
  category    FinanceCategory?  @relation(fields: [categoryId], references: [id])
  notes       String?
  method      String?                               // débito direto, MB WAY, numerário…
  recurringRuleId String?                           // preenchido se gerada por uma regra
  recurringRule   RecurringRule? @relation(fields: [recurringRuleId], references: [id], onDelete: SetNull)
  loanId      String?                               // liga a transação ao empréstimo que a originou
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  @@index([tenantId, dueDate])
  @@index([tenantId, status])
  @@map("finance_transactions")
}
```

Nota sobre `dueDate` vs `paidDate`: são datas diferentes e o protótipo tinha só uma. O relatório de tesouraria precisa da primeira; o histórico real precisa da segunda. Uma despesa vencida a 1 de setembro e paga a 8 pertence a setembro em ambos os casos, mas uma vencida a 28 de agosto e paga a 3 de setembro não — e é exatamente aí que os números começam a divergir da conta bancária.

### 5.2 Recorrências — o ponto crítico

Uma despesa mensal **não é uma linha**. É uma *regra* que gera *ocorrências*:

```prisma
enum RecurrenceFreq { WEEKLY MONTHLY QUARTERLY YEARLY }

model RecurringRule {
  id           String         @id @default(cuid())
  tenantId     String
  tenant       Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  kind         FinanceKind
  description  String
  amountCents  Int
  categoryId   String?
  freq         RecurrenceFreq
  interval     Int            @default(1)      // de 2 em 2 meses = MONTHLY, interval 2
  dayOfMonth   Int?                            // 1-31; 31 num mês curto → último dia
  startDate    DateTime       @db.Date
  endDate      DateTime?      @db.Date
  active       Boolean        @default(true)
  lastGeneratedUntil DateTime? @db.Date        // até onde já foram materializadas
  transactions FinanceTransaction[]

  @@index([tenantId, active])
  @@map("finance_recurring_rules")
}
```

**Materialização:** um serviço `RecurrenceService.materialize(tenantId, until)` gera as `FinanceTransaction` em falta até `until` (por omissão, fim do mês seguinte) e atualiza `lastGeneratedUntil`. Corre:

- ao abrir o dashboard (idempotente, barato, resolve o caso de quem não entra há meses)
- e num job diário quando existir agendador

Requisitos que **têm de estar cobertos por testes**:

- Chamar duas vezes seguidas não duplica nada (idempotência)
- `dayOfMonth: 31` em fevereiro cai no último dia do mês, não transborda para março
- Alterar o valor da regra **não** altera ocorrências já pagas — só as futuras ainda `PLANNED`
- Desativar a regra apaga as ocorrências futuras `PLANNED` e preserva as `PAID`
- Uma ocorrência editada individualmente (valor diferente num mês) não é sobrescrita pela regeneração

Este último ponto é o que separa uma app utilizável de uma que enlouquece o utilizador: marca a ocorrência com `overriddenAt` e a regeneração salta-a.

### 5.3 Empréstimos

Entidade própria, com direção. Serve tanto "emprestei ao José Carlos" como "devo ao banco":

```prisma
enum LoanDirection { LENT BORROWED }
enum LoanStatus { OPEN PARTIAL SETTLED WRITTEN_OFF }

model Loan {
  id             String        @id @default(cuid())
  tenantId       String
  tenant         Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  counterparty   String                             // nome da pessoa ou entidade
  phone          String?
  email          String?
  direction      LoanDirection
  principalCents Int
  loanDate       DateTime      @db.Date
  dueDate        DateTime?     @db.Date
  status         LoanStatus    @default(OPEN)
  settledDate    DateTime?     @db.Date
  notes          String?
  payments       LoanPayment[]

  @@index([tenantId, status])
  @@map("finance_loans")
}

model LoanPayment {
  id          String   @id @default(cuid())
  tenantId    String
  loanId      String
  loan        Loan     @relation(fields: [loanId], references: [id], onDelete: Cascade)
  amountCents Int
  date        DateTime @db.Date
  notes       String?

  @@index([tenantId])
  @@index([loanId])
  @@map("finance_loan_payments")
}
```

`status` é **derivado**, nunca escrito à mão: recalculado numa transação sempre que um pagamento é criado ou apagado. `WRITTEN_OFF` existe porque nem todos os empréstimos a amigos voltam, e a app tem de permitir fechar isso sem mentir nos números.

Um pagamento de empréstimo **não** é uma despesa. Não entra em "despesas do mês"; move valor entre "a receber" e "recebido". Confundir os dois foi o erro do protótipo.

### 5.4 Orçamento

```prisma
model Budget {
  id          String   @id @default(cuid())
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  categoryId  String
  period      String                    // "2026-09"
  limitCents  Int

  @@unique([tenantId, categoryId, period])
  @@index([tenantId, period])
  @@map("finance_budgets")
}
```

Alertas aos 80% e aos 100%, calculados na leitura — não guardados.

### 5.5 Saldo e indicadores — definir antes de calcular

O protótipo errou aqui por não ter definido os termos. Define-os explicitamente no código, com estes nomes e estas fórmulas:

| Indicador | Definição |
|---|---|
| **Receitas do mês** | `SUM(amountCents)` de `INCOME` com `dueDate` no mês |
| **Despesas do mês** | `SUM(amountCents)` de `EXPENSE` com `dueDate` no mês (inclui `PLANNED`) |
| **Já pago este mês** | idem, mas só `status = PAID` |
| **Por pagar este mês** | idem, só `PLANNED` |
| **Saldo do mês** | Receitas do mês − Despesas do mês |
| **Saldo projetado ao fim do mês** | Saldo do mês, contando também as ocorrências futuras já geradas |
| **A receber** | `SUM(principalCents − pagamentos)` de empréstimos `LENT` não liquidados |
| **A pagar (empréstimos)** | idem para `BORROWED` |
| **Património líquido** | *fora do âmbito da v1* — exige saldos de contas bancárias, que não estão modelados |

**Não chames "saldo disponível" a nada disto**, porque nenhum destes números é o saldo da conta bancária — a app não conhece as contas. Chamar-lhe isso é o caminho mais curto para alguém tomar uma decisão errada. Se quiseres saldo real mais tarde, modela `FinanceAccount` com saldo de abertura e reconciliação.

### 5.6 Seed de categorias (na aprovação da conta)

Despesa: Habitação, Alimentação, Transporte, Saúde, Telecomunicações, Subscrições, Educação, Lazer, Família, Empréstimos, Outros
Receita: Salário, Freelance, Reembolsos, Outros

Todas com `isSystem: true` — o utilizador renomeia e muda a cor, mas não as elimina (evita transações órfãs no primeiro dia).

---

## 6. BACKEND

`backend/src/modules/financas/` seguindo a estrutura dos módulos existentes (`controllers/`, `routes/`, `services/`, `module.manifest.ts`).

```ts
// module.manifest.ts
export const manifest = {
  key: 'financas',
  name: 'Finanças Pessoais',
  icon: 'wallet',
  color: '#22c55e',
  routePrefix: '/api/financas',
  frontendEntry: '/app.html#/financas',
  allowedTenantTypes: ['PERSONAL'],
  permissions: ['financas.read', 'financas.write', 'financas.export'],
  features: ['orcamento', 'emprestimos', 'relatorios'],
  defaultLimits: { transacoes_por_mes: 500 }
};
```

Rotas, **todas** atrás de `app.authenticate` **e** `app.requireApp('financas')`:

```
GET/POST/PATCH/DELETE  /api/financas/transacoes
POST                   /api/financas/transacoes/:id/pagar
GET/POST/PATCH/DELETE  /api/financas/recorrencias
GET/POST/PATCH/DELETE  /api/financas/emprestimos
POST/DELETE            /api/financas/emprestimos/:id/pagamentos
GET/PUT                /api/financas/orcamentos
GET/POST/PATCH/DELETE  /api/financas/categorias
GET                    /api/financas/dashboard
GET                    /api/financas/relatorios?tipo=mensal|anual|categoria
GET                    /api/financas/exportar?formato=csv|xlsx|pdf
POST                   /api/financas/importar          (CSV)
GET                    /api/financas/rgpd/exportar     (todos os dados, JSON)
DELETE                 /api/financas/rgpd/apagar       (com dupla confirmação)
```

> **Verifica antes de começar:** o `requireApp` está aplicado no módulo de condomínios mas **não** no CRM, e o `requirePermission` compara a permissão com a lista declarada do módulo em vez das permissões efetivas do utilizador — é um no-op. Corrige ambos antes de construir sobre eles, ou o módulo de finanças nasce sem enforcement real. O mesmo para o `authenticate.ts`, que lê `impersonationId` do JWT sem validar a `ImpersonationSession` em base de dados.

O dashboard resolve-se em **poucas queries agregadas**, não em vinte queries dentro de um ciclo como no protótipo.

Escrever no `AuditLog` todas as escritas de finanças. É a base do "quem alterou o quê" que o projeto exige, e aqui é dado financeiro.

---

## 7. FRONTEND

### 7.1 Módulo no workspace

O cartão aparece automaticamente no `workspace.html` via manifesto — não hardcodes nada lá.

Ecrãs em `/app.html#/financas`:

- **Dashboard** — indicadores da secção 5.5 com os nomes exatos ali definidos, próximos vencimentos, gráfico dos últimos 12 meses (receitas vs despesas), despesas por categoria
- **Movimentos** — lista com filtros (mês, categoria, estado, texto), marcar como pago em linha, criar/editar/duplicar
- **Recorrências** — as regras, valor, próxima ocorrência, ativar/desativar
- **Empréstimos** — lista por direção e estado, detalhe com histórico de pagamentos parciais e barra de progresso
- **Orçamento** — limite por categoria no mês, barra com alertas a 80% e 100%
- **Relatórios** — mensal, anual, por categoria, por pessoa; exportar
- **Definições** — categorias, moeda, exportar tudo, apagar conta

Mobile-first a sério: registar uma despesa no telemóvel, no momento em que acontece, é o caso de uso que decide se a app é usada ou abandonada. Se demorar mais de três toques, ninguém a usa ao fim de duas semanas.

### 7.2 Importar o protótipo

Endpoint `POST /api/financas/importar` que aceite CSV e faça, com pré-visualização antes de gravar:

- Converter valores para cêntimos
- Separar os registos que são empréstimos a pessoas dos que são despesas reais (no protótipo estavam todos como despesas)
- Transformar despesas marcadas como mensais em `RecurringRule`, não em transações soltas

---

## 8. LANDING PAGE

`backend/public/index.html`. **Preservar integralmente**, porque está a funcionar:

- Navegação e âncoras: `#sobre`, `#desafios`, `#ia`, `#casos`, `#resultados`, `#diagnostico`
- Formulário de leads `#lead-form` → `POST /api/crm/leads` (rota pública)
- Modal de autenticação `#open-auth-modal`, alternador de idioma, alternador de tema, banner de desenvolvimento
- Sistema de traduções via `/locales/*.json`

**Acrescentar:**

1. **Secção de produto** (`#financas`), antes de `#diagnostico`: o que a aplicação faz, três ou quatro capturas reais, e um CTA **"Criar conta gratuita"** que abre o formulário de registo — distinto do formulário de diagnóstico.
2. **Entrada na navegação** para a nova secção.
3. **Formulário de registo** (`#register-form`) → `POST /api/public/register`, com checkboxes obrigatórias de termos e privacidade, ligadas às páginas da alínea 5.
4. **Estado pós-submissão claro:** "Recebemos o teu pedido. Vais receber um email quando a conta for ativada." Sem prometer prazos que não controlas.
5. **`/termos.html` e `/privacidade.html`** — páginas reais, no mesmo estilo. Ver secção 9.

**Três avisos:**

- **Toda a copy nova entra nos ficheiros `/locales/*.json`.** Texto escrito direto no HTML fica por traduzir e parte o alternador de idioma.
- **Não misturar as duas mensagens.** A landing hoje vende consultoria B2B ("diagnóstico", "casos", "resultados"). Finanças pessoais é B2C. Na mesma página, uma dilui a outra — um gestor de empresa que aterra numa página que também oferece uma app pessoal gratuita lê aquilo como menos sério. Sugestão: secção contida e bem delimitada agora; página dedicada `/financas.html` assim que houver utilizadores a sério.
- **O `#lead-form` continua a apontar para `/api/crm/leads`.** Se essa rota for extraída para `/api/public/leads` (previsto na Fase 3), atualiza os dois em conjunto no mesmo commit.

---

## 9. RGPD — LER, NÃO SALTAR

A partir do momento em que uma pessoa que não és tu guarda ali as finanças dela, passas a ser responsável pelo tratamento de dados pessoais de categoria sensível sob o RGPD. Isto não é opcional nem adiável para depois do lançamento.

Mínimo antes do primeiro utilizador externo:

- **Política de privacidade real** — que dados recolhes, com que finalidade, onde ficam alojados (Neon, região UE — confirma), durante quanto tempo, quem os pode ver (incluindo tu, via impersonation, e em que circunstâncias)
- **Termos de utilização** — incluindo a ausência de garantia sobre exatidão de cálculos
- **Consentimento explícito registado** — `acceptedTermsAt` e `acceptedPrivacyAt`, com a versão do documento aceite
- **Exportação de todos os dados** em formato legível (`GET /api/financas/rgpd/exportar`)
- **Apagamento efetivo da conta** — apaga mesmo, com dupla confirmação e período de graça de 30 dias
- **Impersonation visível ao utilizador** — quando entrares na conta de alguém, essa pessoa deve poder ver, no histórico dela, que houve um acesso de suporte, quando e com que motivo. Isto não está na especificação da plataforma e é o que separa acesso legítimo de acesso silencioso.
- **Registo de tratamento** e ponto de contacto para exercício de direitos

Se o módulo for gratuito, isto não muda nada: a obrigação não depende de haver pagamento.

---

## 10. TESTES

**Recorrências** (o defeito central do protótipo — cobertura obrigatória):
- materializar duas vezes não duplica
- dia 31 em fevereiro cai no último dia
- alterar a regra não mexe em ocorrências pagas
- ocorrência com `overriddenAt` sobrevive à regeneração
- utilizador ausente 3 meses: ao entrar, os 3 meses são gerados corretamente

**Dinheiro:** somar 0,1 + 0,2 + 0,3 em cêntimos dá exatamente 60; nenhum campo monetário é `Float` em nenhum modelo (teste que faz grep ao schema).

**Empréstimos:** 100€ pagos em 20+30+50 fecham como `SETTLED` com `settledDate` correta; apagar um pagamento reverte o estado; um pagamento não aparece nas despesas do mês.

**Isolamento:** utilizador do tenant A não lê nem escreve nenhum endpoint de finanças do tenant B — todos, gerados a partir da lista de rotas.

**Aprovação:** aprovar cria tenant + branding + user + entitlement + assignment + categorias numa transação; falha a meio faz rollback total.

**Entitlements:** tenant sem o módulo recebe `403 APP_NOT_LICENSED`; tenant `COMPANY` não consegue licenciar `financas`.

**RGPD:** a exportação contém todas as tabelas do utilizador; o apagamento não deixa registos órfãos.

---

## 11. ORDEM DE EXECUÇÃO

```
0. Corrigir requireApp no CRM, requirePermission e validação da ImpersonationSession
1. Tenant.type + validação de allowedTenantTypes
2. Modelo de dados de finanças + migração + tenantScopedClient
3. RecurrenceService + testes (fazer isto antes da UI — é o núcleo)
4. Endpoints + guards + auditoria
5. Fluxo de registo público + aprovação transacional
6. Frontend do módulo
7. Landing page + termos + privacidade + i18n
8. Importador do protótipo
9. Testes completos + verificação local + preview + relatório
```

Cada fase termina com `npm run verify` verde. Nada vai a produção sem passar pelo preview, conforme `docs/PROMPT_ANTIGRAVITY_AMBIENTES.md`.

---

## 12. FORA DO ÂMBITO DA v1

Contas bancárias e reconciliação · património líquido · Open Banking · objetivos de poupança · anexos e comprovativos · notificações push · app móvel nativa · pagamentos e faturação do próprio serviço · multi-moeda
