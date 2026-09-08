# HELDERLABS ERP — AUDITORIA INDEPENDENTE
## Ciclo 1 · Foco: módulo HCCALL (novo) + regressão dos achados anteriores

> **Auditor:** Claude (independente) · **Implementação:** Antigravity
> **Data:** 2026-09-08 · **Repositório:** `C:\Users\helde\Desktop\Dev\helderlabs-erp`
> **Método:** análise estática do código real. Ver §0 para o que **não** foi possível executar.

---

# 0. ÂMBITO REAL DESTA AUDITORIA — LER PRIMEIRO

Não vou reportar como feito o que não fiz.

**Executado:** Fase 1 (discovery), Fase 4 (módulos), Fase 5 (schema), Fase 6 (isolamento ao nível do código), Fase 7 (autorização e exposição de dados), Fase 12 (code review), Fase 13 (melhorias), Fase 9 (regressão sobre os 31 achados anteriores).

**NÃO executado, e porquê:** esta sessão tem acesso de **leitura e escrita de ficheiros** na tua máquina, mas **não tem shell** nela. Não consigo correr `npm run verify`, arrancar o servidor, abrir o browser nem consultar a base de dados. As Fases 2, 3, 8, 10 e 11 ficam por fazer **no ambiente onde o código corre**.

Duas formas de as desbloquear, à tua escolha:
1. **Corres tu os comandos e colas-me a saída** (`npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run test:browser`). Eu analiso e integro no relatório.
2. **Autorizas-me a montar o projeto neste ambiente de nuvem** (clonar, instalar, subir um Postgres, migrar e correr) — demora, e o `prisma generate` precisa de rede que pode estar bloqueada, mas tentamos.

Tudo o que está abaixo é **verificável lendo o código**, com ficheiro e função indicados. Nada aqui é suposição.

---

# 1. INVENTÁRIO DO SISTEMA (Fase 1)

**Stack real:** Node 20 · Fastify 4 · TypeScript strict · **Prisma 5** (não Drizzle) · PostgreSQL (Neon em produção, Docker local) · frontend HTML/CSS/JS vanilla servido por `@fastify/static` · deploy Vercel serverless via `api/index.ts`.

**Isolamento multi-tenant:** Prisma Client Extension `tenantScopedClient.ts`. **RLS não está ativo** — está documentado como dívida DT-01 (a app liga-se como dona das tabelas e o Postgres ignora RLS para o dono).

**Scripts reais** (`backend/package.json`): `verify` = `lint && typecheck && test && test:e2e && test:browser`; testes por `scripts/collect-and-run-tests.mjs`, `run-e2e-audit.mjs`, `test-e2e-browser.mjs`; `dev` com `db:guard`; `build` = `prisma generate && tsc`.

**Módulos em `src/modules/`:** `auth`, `platform`, `crm`, `financas`, `finance` (legado paralelo), `condominios`, **`hccall` (novo)**, e três apenas com README (`invoicing`, `sales`, `tasks`).

**Schema:** 55 KB. Inclui já **todos os modelos `Sell*` do 2SELLMAIS** (24 modelos) — mas **não existe `src/modules/sellmais/`**. Schema à frente do código.

**Testes existentes:** `auth`, `condominios`, `crm` (incl. `Company360`), `database`, `financas` (incl. `FinanceCalcService`), `platform`, `public`, `security`. **Zero testes para `hccall`.**

---

# 2. RESULTADO GLOBAL

```
HELDERLABS ERP
AUDITORIA AUTOMÁTICA — CICLO 1

Overall Health:      58 / 100

Módulos auditados:   8
Achados:             23
  CRITICAL:           2
  HIGH:               9
  MEDIUM:             9
  LOW / IMPROVEMENT:  3

Regressão (31 achados do ciclo anterior):
  Corrigidos:        11
  Por corrigir:      12
  Não verificáveis:   8   (exigem execução)

Testes automáticos:  NÃO EXECUTADOS (sem shell — ver §0)
Build / typecheck:   NÃO EXECUTADOS
```

## Classificação por módulo (Fase 4)

| Módulo | Estado | Razão |
| :--- | :--- | :--- |
| `platform` | 🟡 | Guardas de licença corrigidas; falta verificar tenant em algumas escritas. |
| `auth` | ⚫ | Não auditado neste ciclo. |
| `crm` | 🟡 | `Company` implementada; falta validar em execução. |
| `financas` | 🟡 | `FinanceCalcService` criado; coexistência com `finance` por resolver. |
| `finance` (legado) | 🔴 | Continua a duplicar o modelo de dados financeiro. |
| `condominios` | ⚫ | Não auditado neste ciclo. |
| **`hccall`** | 🔴 | **Inacessível de ponta a ponta** + IDOR intra-tenant + escritas sem auditoria. |
| `sellmais` | ⚫ | Só schema. Sem código, sem rotas, sem testes. |

---

# 3. CRITICAL

### HL-C01 · O módulo HCCALL não é acessível por ninguém
```
ID              HL-C01
Severity        CRITICAL          Tipo: CONFIRMED BUG
Module          hccall
Problem         O backend está escrito, mas 4 dos 10 passos de registo de um
                módulo não foram feitos. O módulo é inalcançável.
Expected        Utilizador licenciado abre o HCCALL e usa-o.
Actual          - `prisma/seed.ts` não contém `hccall` → não há linha na tabela
                  `Module`; o `EntitlementService` percorre `prisma.module.findMany()`
                  e nunca encontra a app → `requireApp('hccall')` devolve
                  SEMPRE 403 APP_NOT_LICENSED, para todos os tenants.
                - `public/assets/js/modules.js` não tem entrada → não aparece
                  no launcher do workspace.
                - `public/locales/pt.json` e `en.json` sem chaves `hccall.*`.
                - `public/hccall.html` NÃO EXISTE, e é o `frontendEntry`
                  declarado no manifesto → 404.
File            backend/prisma/seed.ts · backend/public/assets/js/modules.js
                backend/public/locales/*.json · backend/public/hccall.html
Function        seed() · MODULES_REGISTRY · manifest.frontendEntry
Root cause      Implementou-se o backend e saltou-se o registo do módulo e todo
                o frontend.
Recommended fix Criar a linha em `Module` no seed (key exatamente `hccall`),
                entrada em MODULES_REGISTRY, chaves i18n pt/en, e a página
                `hccall.html`. Sem isto nada do resto é testável em uso real.
Test required   E2E: licenciar `hccall` a um tenant → GET /api/hccall/dashboard
                devolve 200; abrir /hccall.html devolve 200.
```

### HL-C02 · IDOR intra-tenant: um operador altera e apaga as vendas dos colegas
```
ID              HL-C02
Severity        CRITICAL          Tipo: CONFIRMED BUG
Module          hccall
Problem         O âmbito de visibilidade (`hccall.visibility = OWN`, o valor por
                omissão) é aplicado às LISTAGENS mas não às operações por id.
Expected        Com visibilidade OWN, o utilizador A não lê, não altera e não
                apaga vendas do utilizador B do mesmo tenant.
Actual          getSaleById/updateSale verificam apenas `sale.tenantId !== tenantId`.
                deleteSale e restoreSale não verificam sequer isso:
                    return db.hccallSale.update({ where: { id }, data: {...} });
                Recebem `tenantId` e `userId` como parâmetros e NÃO OS USAM —
                prova de que a verificação foi esquecida, não decidida.
                Conhecendo o id (ou iterando cuid), o operador A altera a comissão
                ou elimina a venda do operador B.
File            backend/src/modules/hccall/services/HccallSaleService.ts
Line            ~162 (updateSale) · ~300 (getSaleById) · ~395 (deleteSale)
                · ~402 (restoreSale)
Function        HccallSaleService.updateSale / getSaleById / deleteSale / restoreSale
Root cause      O âmbito vive no serviço de listagem; as operações por id não o
                consultam.
Recommended fix Aplicar `HccallScopeService.getVisibilityScope()` a TODAS as
                operações por id: carregar com `where: { id, ...scope }` e devolver
                404 quando não pertence. Nunca `update({ where: { id } })` nu.
Test required   Utilizador A (OWN) → PUT e DELETE em venda do utilizador B → 404.
                Com TEAM → 200.
```

---

# 4. HIGH

### HL-H01 · Criação de venda sem transação — 7 passos, nenhum atómico
```
Severity        HIGH               Tipo: CONFIRMED BUG          Module: hccall
Actual          createSale executa em sequência, fora de qualquer $transaction:
                idempotência → cliente → serviço → promoção → estado → contador
                → venda → histórico. Se a criação da venda falhar, ficam para trás
                um cliente criado e um número de venda queimado (salto na
                numeração). `grep -rn "\$transaction" src/modules/hccall` = 0 ocorrências.
File            services/HccallSaleService.ts · createSale (linhas 28-135)
Fix             Envolver do passo 1 ao 7 em `db.$transaction`.
Test            Forçar falha na criação da venda → cliente não fica criado e o
                contador não avança.
```

### HL-H02 · Idempotência com race (TOCTOU) — o cenário normal do offline
```
Severity        HIGH               Tipo: CONFIRMED BUG          Module: hccall
Actual          `findUnique(tenantId_clientUuid)` seguido de `create` não é atómico.
                Em rede intermitente o cliente reenvia o lote enquanto o primeiro
                ainda processa → dois `create` simultâneos → P2002 → erro 500 e a
                operação é marcada como falhada em vez de `duplicate`.
File            services/HccallSaleService.ts · createSale (linhas 30-40)
Fix             `create` em try/catch a apanhar P2002 e devolver `{isDuplicate:true}`,
                ou `upsert` sobre `tenantId_clientUuid`.
Test            Disparar 20 sincronizações concorrentes do mesmo clientUuid →
                1 venda criada, 19 respostas `duplicate`, zero erros.
```

### HL-H03 · Alterações de venda podem ficar sem histórico
```
Severity        HIGH               Tipo: CONFIRMED BUG          Module: hccall
Actual          Em createSale e updateSale, o registo em HccallSaleChange termina
                em `.catch(() => {})`. A venda é alterada e, se o histórico falhar,
                não fica rasto — sem erro, sem log.
                É a funcionalidade central do módulo (§9 do briefing) a falhar em silêncio.
File            services/HccallSaleService.ts linhas ~128 e ~285
Fix             Histórico dentro da MESMA transação da alteração. Falha do histórico
                anula a alteração.
Test            Simular falha na escrita do histórico → a venda não é alterada.
```

### HL-H04 · Nenhuma escrita do HCCALL passa pelo AuditService
```
Severity        HIGH               Tipo: CONFIRMED BUG          Module: hccall
Actual          `grep -rn "AuditService" src/modules/hccall` = 0 ocorrências.
                `AGENTS.md` §4: "Sem ESCRITAS sem Auditoria".
                HccallSaleChange é uma tabela normal, editável e sem encadeamento
                — não substitui a cadeia SHA-256 tamper-evident.
Fix             AuditService em: alteração de comissão, alteração de estado,
                eliminação/restauro, anonimização RGPD.
Test            Alterar comissão → entrada em audit_logs com hash encadeado válido.
```

### HL-H05 · GET que escreve na base de dados (e pode devolver 500)
```
Severity        HIGH               Tipo: CONFIRMED BUG          Module: hccall
Actual          listServices, listPromotions e listSaleStatuses chamam
                `ensureDefaults()`, que CRIA registos. Três endpoints GET com efeito
                secundário. Sem transação nem bloqueio: dois GETs concorrentes de um
                tenant novo colidem em @@unique([tenantId,key]) → P2002 → 500 num GET.
                É o mesmo defeito do `listCategories` do módulo financeiro, repetido.
File            services/HccallConfigService.ts linhas 7, 61, 152, 215
Fix             Semear na ativação do módulo (ApplicationController.create /
                approveAccountRequest), nunca numa leitura.
Test            2 GETs concorrentes a /api/hccall/statuses num tenant novo → 200 nos dois.
```

### HL-H06 · Endpoint de IA ignora o âmbito de visibilidade
```
Severity        HIGH               Tipo: CONFIRMED BUG          Module: hccall
Actual          intent RECENT_CHANGES:
                    db.hccallSaleChange.findMany({ where: { tenantId }, take: 20 })
                Sem `ownerUserId`, sem join à venda. Com visibilidade OWN, o operador
                A vê as alterações de comissão do operador B — campo, valor antigo e
                valor novo.
File            controllers/HccallController.ts · handleAiQuery (~linha 345)
Fix             Filtrar por vendas dentro do âmbito:
                `where: { tenantId, sale: { ...scope } }`.
Test            A (OWN) chama RECENT_CHANGES → zero alterações de vendas de B.
```

### HL-H07 · statusId inválido é aceite e gravado
```
Severity        HIGH               Tipo: CONFIRMED BUG          Module: hccall
Actual          createSale: `statusId = defaultStatus?.id || 'registada'` — grava a
                string literal quando não há estados. updateSale aceita qualquer
                statusId sem verificar existência. Como não há FK (ver HL-H08), a
                escrita passa. A venda deixa de ter `commissionState` classificável
                e desaparece dos totais de comissões.
File            services/HccallSaleService.ts linhas ~88-95 e ~173-182
Fix             Validar que o estado existe e pertence ao tenant; 400 caso contrário.
Test            POST /sales com statusId="xpto" → 400.
```

### HL-H08 · Os 24 modelos novos não têm chave estrangeira para `tenants`
```
Severity        HIGH               Tipo: CONFIRMED BUG          Module: hccall + sellmais
Actual          Nenhum modelo Hccall* ou Sell* declara
                `tenant Tenant @relation(fields:[tenantId], references:[id])`.
                Todos os modelos anteriores (FinanceTransaction, Company, Lead…)
                declaram. Consequências: sem integridade referencial, sem
                onDelete: Cascade, um tenantId inexistente é aceite, e apagar um
                tenant deixa órfãos silenciosos.
File            backend/prisma/schema.prisma linhas 1400-1910
Fix             Migração aditiva acrescentando a relação e a FK em todos.
Test            INSERT com tenantId inexistente → recusado pela base de dados.
```

### HL-H09 · Dashboard carrega todas as vendas do mês para memória
```
Severity        HIGH               Tipo: CONFIRMED BUG          Module: hccall
Actual          getSummaryMetrics faz dois findMany SEM take (hoje e mês) e agrega
                em JavaScript. É o ECRÃ INICIAL. Com visibilidade TEAM num call
                center de 20 operadores são ~10.000 registos completos por abertura.
File            services/HccallSaleService.ts · getSummaryMetrics (~linha 420)
Fix             `groupBy` por statusId com `_sum: { commissionCents }` e `_count`.
Test            Medir com 10.000 vendas: alvo p95 < 400 ms.
```

---

# 5. MEDIUM

| ID | Módulo | Problema | Ficheiro |
| :--- | :--- | :--- | :--- |
| HL-M01 | hccall | `updatePromotion` **nunca incrementa `version`**. O snapshot guarda sempre `version: 1`, tornando impossível distinguir que regra estava em vigor. O valor da venda está protegido; a rastreabilidade da regra não. | `HccallConfigService.ts` · updatePromotion |
| HL-M02 | hccall | Exportação CSV força `limit: 200` em silêncio. Quem exporta um ano recebe 200 linhas e julga que é tudo. (BOM UTF-8 e `;` estão corretos.) | `HccallController.ts` · exportSalesCsv |
| HL-M03 | hccall | `anonymizeCustomer` acessível a qualquer utilizador com `hccall.use`, sem confirmação explícita e sem auditoria. É o padrão que o próprio briefing mandava não copiar do módulo financeiro. | `HccallCustomerService.ts` |
| HL-M04 | hccall | Deteção de conflito na sincronização depende de `op.occurredAt`, que é **opcional**. Sem ele, a atualização offline sobrepõe-se ao servidor sem qualquer aviso. | `HccallSyncService.ts` ~linha 90 |
| HL-M05 | hccall | `HccallScopeService` tem `catch {}` vazio: qualquer erro de leitura da definição cai silenciosamente em OWN. Falha invisível. | `HccallScopeService.ts` |
| HL-M06 | hccall | `HccallCounterService` importa `prisma` cru e não o usa. Import morto que pode disparar a regra ESLint `no-restricted-imports` (ADR 001) e fazer `npm run lint` falhar. | `HccallCounterService.ts` linha 1 |
| HL-M07 | hccall | `TOP_SERVICES` calcula sobre as **últimas 100 vendas** e apresenta o resultado como "serviços mais vendidos". Estatística enviesada dada como facto. | `HccallController.ts` · handleAiQuery |
| HL-M08 | hccall | Comissão em falta e sem dinamização → grava **0 €** em silêncio, em vez de recusar. | `HccallSaleService.ts` linha ~59 |
| HL-M09 | sellmais | `SellAuctionLot` tem `@@unique([auctionId, lotNumber])` **sem `tenantId`**, contra a convenção de todo o schema. | `schema.prisma` linha 1884 |

---

# 6. REGRESSÃO — os 31 achados do ciclo anterior (Fase 9)

**Corrigidos e verificados (11):** `/api/finance/*` passou a ter `requireApp('financas')` (BUG-01) · `Company` e satélites criados (§5 do prompt CRM) · `Role`/`RolePermissionLink` criados · `FinanceAccount` e `CostCenter` criados · `FinanceCalcService` centraliza cálculos (BUG-20) · `deletedAt` em `FinanceTransaction` (BUG-08) · `@@unique([tenantId, documentNumber])` (BUG-07) · `FinanceMovementType` com `TRANSFER` (BUG-24) · testes novos `Company360` e `FinanceCalcService` · `applications.routes.ts` alterado (BUG-02/03 — **carece de verificação em execução**) · `public.routes.ts` alterado (BUG-04/05 — **idem**).

**Por corrigir (12):** o módulo `finance` legado continua a existir a par de `financas`, com `FinancialTransaction` em `Float` (BUG-11, viola `qa/CONTRATO.md` ponto 12) · endpoint de anonimização RGPD do financeiro (BUG-09) · `docs/MODULOS.md`, `ESTADO.md` e `modules.js` continuam a descrever funcionalidades inexistentes (RLS, `audit:verify`, objetivos, dívidas, Recharts) · SAF-T em JSON gravado como `.xml` com NIF fixo `999999990` (BUG-18) · contradição `erp_session` vs `hl_token` entre ADR 003 e CONTRATO ponto 16 · restantes por confirmar em execução.

---

# 7. IMPROVEMENTS

```
Improvement          Semear a configuração na ativação do módulo
Module               hccall
Current behaviour    ensureDefaults() corre dentro de três GETs
Recommended          Semear em ApplicationController.create e approveAccountRequest
Expected benefit     Elimina HL-H05, torna os GETs puros e mais rápidos
Risk                 Baixo
Priority             Alta
```
```
Improvement          Agregação no motor de base de dados
Module               hccall
Current behaviour    findMany + agregação em JavaScript no ecrã inicial
Recommended          groupBy com _sum/_count por statusId
Expected benefit     Dashboard constante em O(1) de transferência
Risk                 Baixo
Priority             Alta
```
```
Improvement          Um único guardião de âmbito para todas as operações
Module               hccall
Current behaviour    O âmbito é aplicado só nas listagens
Recommended          Helper `loadOwnedSale(db, tenantId, userId, id)` usado por
                     get/update/delete/restore
Expected benefit     Fecha HL-C02 numa única linha de defesa, e evita repetições
Risk                 Baixo
Priority             Crítica
```

---

# 8. O QUE FALTA PARA FECHAR O CICLO

Estes pontos **não são achados** — são partes da auditoria que só se fazem com o sistema a correr:

- `npm run lint` · `npm run typecheck` · `npm test` · `npm run test:e2e` · `npm run test:browser`
- Arranque do servidor, percurso de utilizador no browser, responsividade e mobile
- Medição de tempos de resposta e de queries lentas
- Verificação de integridade da base de dados (órfãos, índices em falta, dados inconsistentes)
- Teste de isolamento entre tenants **em execução** (a análise estática mostra que a extensão cobre os modelos; falta a prova empírica)

---

# 9. CONDIÇÕES DE ACEITAÇÃO DO CICLO

```
CRITICAL = 0        atual: 2      ✗
HIGH = 0            atual: 9      ✗
REGRESSION = 0      atual: 12     ✗
BUILD = PASS        não executado ⚫
TYPECHECK = PASS    não executado ⚫
SECURITY = PASS     atual: FAIL   ✗  (HL-C02, HL-H06)
CORE E2E = PASS     não executado ⚫
```

**O ciclo não está fechado.** A prioridade, por esta ordem: HL-C02 (segurança), HL-C01 (o módulo não existe para o utilizador), HL-H01/H02/H03 (integridade e auditoria das vendas), HL-H05/H06.
