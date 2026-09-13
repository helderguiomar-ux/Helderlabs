# FASE 2 — DIAGNÓSTICO DO MÓDULO HCCALL (HelderLabs ERP)

> **Data da Auditoria:** 2026-09-13  
> **Classificação de Risco:** PRE-PRODUCTION AUDIT REPORT  
> **Âmbito:** Isolamento Multi-Tenant, CRUD, Cadeia de Auditoria SHA-256, Consistência de Dados e Performance.

---

## 2.1 FUGAS DE ISOLAMENTO MULTI-TENANT

### 2.1.1 Análise de Endpoints e Ingestão de `tenant_id`
- **Derivação de Sessão:** Todos os 32 endpoints em `backend/src/modules/hccall/routes/hccall.routes.ts` derivam o `tenantId` estritamente do token JWT assinado (`req.user.tenantId`) através do hook de autenticação. **Nenhum endpoint aceita `tenant_id` vindo de parâmetros de URL, corpo da mensagem ou cabeçalhos arbitrários do cliente.**
- **Tentativas de Injeção / IDOR em Schemas Zod:** Os esquemas Zod (`CreateSaleSchema`, `CreateDynamizationSchema`, `CreateProductSchema`, etc.) não possuem o campo `tenantId`, rejeitando ou ignorando qualquer tentativa de injeção externa.

### 2.1.2 Fugas Transitivas e Falhas de Resolução por ID sem Tenant (Vulnerabilidades Identificadas)
Foram detetadas ocorrências de resolução de entidades por `id` bruto sem restrição de `tenantId` na query:

1. **`backend/src/modules/hccall/services/HccallSaleService.ts` (Linhas 80 e 94):**
   ```typescript
   const prod = await tx.hccallProduct.findUnique({ where: { id: item.productId } });
   ```
   *Impacto:* Se um utilizador do Tenant A submeter um pedido com o `productId` pertencente ao Tenant B, a venda no Tenant A resolverá com sucesso o nome e preço base do produto do Tenant B (fuga de metadados e configuração entre tenants).
2. **`backend/src/modules/hccall/services/HccallSaleService.ts` (Linhas 114 e 151):**
   ```typescript
   const dyn = await tx.hccallDynamization.findUnique({ where: { id: dynId }, include: { tiers: true, bonuses: true } });
   const promo = await tx.hccallPromotion.findUnique({ where: { id: dynId } });
   ```
   *Impacto:* Permite a um operador do Tenant A aplicar e capturar em snapshot uma regra comercial ou promoção criada pelo Tenant B.
3. **`backend/src/modules/hccall/services/HccallDynamizationService.ts` (Linha 131):**
   ```typescript
   const existing = await tx.hccallDynamization.findUnique({ where: { id } });
   ```
   *Impacto:* Não valida posse de tenant antes de calcular a nova versão e apagar escalões.
4. **`backend/src/modules/hccall/services/HccallConfigService.ts` (Linhas 112 e 201):**
   ```typescript
   const existing = await db.hccallPromotion.findUnique({ where: { id } });
   const existing = await db.hccallSaleStatus.findUnique({ where: { id } });
   ```
   *Impacto:* Leitura direta de chave primária global sem filtro de tenant.

### 2.1.3 Ausência de Isolamento ao Nível do Motor de Base de Dados (PostgreSQL)
- **Row-Level Security (RLS) INATIVO:** A verificação empírica na tabela `pg_tables` confirmou que `rowsecurity = false` em **100% das tabelas** do módulo HCCALL e da plataforma.
- **Ausência de Foreign Keys para `tenants`:** Nenhuma das 19 tabelas do HCCALL (`hccall_sales`, `hccall_products`, `hccall_dynamizations`, etc.) tem uma `FOREIGN KEY` formal apontando para `tenants(id)` no catálogo PostgreSQL (apenas a tabela `users` possui `users_tenantId_fkey`).
- *Consequência:* Toda a segurança de isolamento depende exclusivamente da camada aplicacional Node.js. Qualquer bug num handler ou query SQL direta expõe dados entre empresas.

---

## 2.2 DIAGNÓSTICO DE CRUD E OPERAÇÕES

| Entidade | Create | Read | Update | Delete | Diagnóstico & Falhas Encontradas |
|---|---|---|---|---|---|
| **Vendas (`HccallSale`)** | OK | OK | OK | OK | Criação transacional e código sequencial funcionais. A eliminação é soft-delete (`deletedAt`). Contudo, falta motivo obrigatório (`delete_reason`) e identificação de `deleted_by` no schema da BD. |
| **Dinamizações (`HccallDynamization`)** | OK | OK | **DEFEITO** | OK | Na atualização (`updateDynamization`), o código executa `deleteMany` físico em `hccall_dynamization_tiers` e `hccall_dynamization_bonuses`, violando a Regra Inviolável #1 de não destruição de dados. |
| **Produtos (`HccallProduct`)** | OK | OK | OK | OK | CRUD funcional. Falta validação de unicidade composta (`tenantId, sku`). |
| **Objetivos (`HccallObjective`)** | OK | OK | OK | **DEFEITO** | `deleteObjective` faz `db.hccallObjective.delete` físico em vez de soft-delete. |
| **Clientes (`HccallCustomer`)** | OK | OK | — | OK | Anonimização RGPD funcional (`anonymizedAt`). |
| **Serviços Legados (`HccallService`)** | OK | OK | OK | OK | Criação padrão semeia `ownerUserId: 'system'`, que é uma string solta sem utilizador real associado. |

---

## 2.3 CADEIA DE AUDITORIA & CAUSA-RAIZ DO DEFEITO `seq=1` / `prevHash`

A auditoria de integridade revelou a anatomia exata das falhas históricas da cadeia de auditoria SHA-256:

### Causa-Raiz 1: `seq` Global vs. Âmbito por Tenant
- A coluna `seq` da tabela `audit_logs` é um `BigInt` gerado pela sequence do PostgreSQL (`bigserial` global).
- Quando um novo tenant é criado e grava a sua primeira ação, o seu primeiro registo recebe um valor como `seq = 3202`, e **nunca** `seq = 1`.
- Qualquer validador ou rotina que espere que o elo Genesis de um tenant tenha `seq = 1` falha com falso-positivo de quebra de integridade.

### Causa-Raiz 2: Definição Instável do Genesis PrevHash
- Nas versões iniciais (anteriores a v1.1.0), o primeiro registo gravava `prevHash` como `null` ou string vazia `""`.
- As migrações posteriores introduziram o valor padrão canónico `GENESIS_PREV_HASH` (64 zeros: `0000000000000000000000000000000000000000000000000000000000000000`).
- A mistura de registos com `prevHash = ''` e `prevHash = '00...00'` quebrou a verificação dos primeiros blocos históricos.

### Causa-Raiz 3: Concorrência em Serverless (Fila em Memória Inoperante)
- A serialização da cadeia era originalmente feita através de um `Map` em memória do processo (`partitionQueues`).
- Na infraestrutura serverless (Vercel), cada invocação HTTP corre num isolamento próprio. Quando dois pedidos concorrentes eram executados:
  1. Ambos liam o mesmo `lastLog` na BD;
  2. Ambos calculavam o mesmo `prevHash`;
  3. Ambos gravavam registos paralelos com o mesmo `prevHash`, partindo a continuidade estrita da cadeia.
- *Evidência Real:* Existem **18 registos de incidentes** preservados na tabela `audit_chain_incidents` e **24 operações de re-selagem** em `audit_chain_reseals`.
- *Mitigação Atual:* A v1.1.0 introduziu `pg_advisory_xact_lock(hashtext(partitionKey))` dentro da transação Prisma, o que resolveu o problema para novas escritas.

---

## 2.4 CONSISTÊNCIA DE DADOS

1. **Registos Órfãos:**
   - Vendas sem tenant: **0** (todas as 5 vendas pertencem a `cmtqabwsw0006ta1y84r5vog4`).
   - Vendas sem utilizador: **0**.
   - Itens de venda órfãos: **0**.
   - Escalões de dinamização órfãos: **0**.
2. **Comissões Armazenadas vs. Recalculadas:**
   - As 5 vendas existentes na BD têm comissão armazenada de **45,00 € (4500 cents)** com snapshot da campanha "Campanha Fibra Audit v0.5.0".
   - O recálculo determinístico através da regra do snapshot devolve exatamente **45,00 € (100% de paridade)**.
3. **Incoerências de Estado Identificadas:**
   - As 5 vendas existentes têm `saleValueCents = 0` (registadas na v1 antes da obrigatoriedade do valor de venda em cêntimos).
   - O código sequencial das 5 vendas antigas é `#00001` a `#00005`, enquanto o motor v2 gera `VND-YYYY-XXXXX`.
   - Vendas agendadas no futuro não possuem mecanismo de bloqueio na contagem de KPIs se forem gravadas com estado `registada` em vez de máquina de estados estrita (`scheduled` vs `closed`).

---

## 2.5 PERFORMANCE E ESCALABILIDADE

| Cenário de Teste | Tempo Medido (p95) | Orçamento Máximo | Estado |
|---|---|---|---|
| Autenticação + Resolução de Workspace | 16.27 ms | <= 100 ms | ✅ OK |
| Listagem paginada de vendas (50 itens com includes) | 6.65 ms | <= 300 ms | ✅ OK |
| Cálculo puro em memória do Motor de Comissões | 0.99 ms | <= 10 ms | ✅ OK |
| Benchmark de Carga (1.000 iterações do motor) | 4.20 ms | <= 50 ms | ✅ OK |
| Payload Inicial da UI (`hccall.html`) | 64.3 KB | <= 500 KB | ✅ OK |
| 50 escritas concorrentes na Cadeia de Auditoria | 426.25 ms | <= 1500 ms | ✅ OK |

*Pontos de Atenção de Performance:*
- A tabela `audit_logs` tem 8.446 registos e cresce rapidamente. A verificação da cadeia (`verifyAuditChainForPartition`) faz leitura em lotes de 500 registos sobre o índice `seq`. Deve ser evitada a execução síncrona na abertura do painel de administração geral.

---

## 2.6 LISTA PRIORIZADA DE ANOMALIAS E RISCOS

### 🔴 BLOQUEADOR DE PRODUÇÃO (Corrupção / Fuga / Perda de Dados)
1. **Ausência de RLS na Base de Dados:** O PostgreSQL tem `rowsecurity = false` em todas as tabelas. Um erro numa query Prisma ou SQL cru expõe dados entre empresas.
2. **Ausência de Foreign Keys de Tenancy:** Nenhuma tabela de negócio do HCCALL referencia formalmente `tenants(id)` com `ON DELETE RESTRICT`.
3. **Fugas Transitivas de IDOR em Produtos/Dinamizações:** Resolução de produtos e dinamizações por `id` simples em `HccallSaleService` permite utilizar IDs de outro tenant.
4. **Destruição Física de Dados em Escalões de Dinamização:** `HccallDynamizationService.updateDynamization` executa `deleteMany` em escalões e bónus históricos.
5. **Cobertura Incompleta de Auditoria em Mutações:** O módulo HCCALL não grava evento na tabela `audit_logs` em todas as criações, edições e exportações CSV.

### 🟠 GRAVE (Integridade de Negócio & Conformidade)
6. **Definição de Papéis Hardcoded vs RBAC:** O sistema tem tabelas de `roles` e `permissions` vazias (0 linhas) e depende da coluna `user.role`.
7. **Ausência de Máquina de Estados com Confirmação de Agendamento:** Vendas futuras não exigem confirmação explícita de agendamento na UI nem transição atómica com validação de relógio.
8. **Valores de Venda Históricos a Zero:** 5 vendas legadas têm `saleValueCents = 0`.

### 🟡 MÉDIO (Operacional & Auditoria)
9. **`seq` Global de Auditoria:** Confusão entre a sequência global de BD e a sequência contígua esperada por tenant.
10. **Semeador com Ator Fictício:** `HccallConfigService` usa `ownerUserId: 'system'` sem utilizador na tabela `users`.

### 🟢 BAIXO (Estética & Usabilidade)
11. **Formato Heterogéneo de Código de Venda:** Coexistência de `#00001` (legado) e `VND-2026-00001` (canónico).
