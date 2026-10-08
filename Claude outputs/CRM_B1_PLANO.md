# Plano de Implementação — CRM Fase B1: Fundações e Segurança

> **Data:** 2026-10-09  
> **Fase:** B1 — Fundações e Segurança  
> **Objetivo:** Resolver as vulnerabilidades críticas de isolamento entre tenants (IDOR), XSS em renderização de dados, deleção física em leads/relações, perda de dados no campo `decisionPower`, paginação/pesquisa no servidor, validação de NIF/telefone/email e deteção de duplicados com código 409.

---

## 1. Modelos Afetados e Migração Aditiva

### 1.1 `schema.prisma`
- **Enum `DecisionPower`**:
  ```prisma
  enum DecisionPower {
    DECISOR
    INFLUENCIADOR
    UTILIZADOR
    OUTRO
  }
  ```
- **Modelo `CompanyContact`**:
  - Adição da coluna: `decisionPower DecisionPower?` (nullable, aditiva).
- **Modelo `CompanyRelation`**:
  - Adição da coluna: `deletedAt DateTime?` (nullable, aditiva).
  - Adição de índice: `@@index([deletedAt])`.
- **Modelo `Lead`**:
  - Já possui `deletedAt DateTime?`. O serviço passará a utilizá-lo (soft-delete) em vez de `delete()`.

### 1.2 Migração SQL Aditiva: `backend/prisma/migrations/20261009000000_crm_b1_foundations/migration.sql`
- `DO $$ BEGIN CREATE TYPE "DecisionPower" AS ENUM ('DECISOR', 'INFLUENCIADOR', 'UTILIZADOR', 'OUTRO'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
- `ALTER TABLE "crm_company_contacts" ADD COLUMN IF NOT EXISTS "decisionPower" "DecisionPower";`
- `ALTER TABLE "crm_company_relations" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);`
- `CREATE INDEX IF NOT EXISTS "crm_company_relations_deletedAt_idx" ON "crm_company_relations"("deletedAt");`

Zero instruções `DROP`, zero alterações de tipos existentes, idempotente e segura para rollback.

---

## 2. Rotas e Serviços Afetados

### 2.1 Rotas (`backend/src/modules/crm/routes/crm.routes.ts`)
1. `GET /companies`: Suporte a paginação e filtros no servidor (`limit`, `cursor`, `search`, `status`, `sector`, `ownerUserId`), devolvendo `{ companies, nextCursor, total }`.
2. `GET /companies/metrics`: Agregações no servidor via `groupBy` e `count` sem carregar todas as linhas para memória.
3. `POST /companies`: Validação Zod `.strict()`, NIF português com dígito de controlo (módulo 11), telefone normalizado E.164. Verificação de duplicados (NIF ou email no tenant): devolve **409 Conflict** com `{ existingCompanyId }` a menos que `force: true`.
4. `PUT /companies/:id`: Atualização de empresa validando posse pelo tenant (404 se pertencer a outro tenant).
5. `DELETE /companies/:id`: Soft-delete validando posse.
6. `POST /companies/:id/contacts`: Valida posse da empresa e grava `decisionPower`.
7. `PUT /contacts/:contactId`: Valida posse do contacto (através da empresa e tenant) antes de alterar; devolve 404 se de outro tenant. Grava `decisionPower`.
8. `DELETE /contacts/:contactId`: Soft delete validando posse (404 se de outro tenant).
9. `POST /companies/:id/addresses`: Valida posse da empresa.
10. `DELETE /addresses/:addressId`: Soft delete validando posse (404 se de outro tenant).
11. `POST /companies/:id/documents`: Valida posse da empresa.
12. `DELETE /documents/:docId`: Soft delete validando posse (404 se de outro tenant).
13. `POST /companies/:id/contracts`: Valida posse da empresa.
14. `PUT /contracts/:contractId`: Valida posse do contrato e empresa no tenant (404 se de outro tenant).
15. `DELETE /contracts/:contractId`: Soft delete validando posse (404 se de outro tenant).
16. `POST /companies/:fromCompanyId/relations`: Valida que **ambas** as empresas pertencem ao tenant.
17. `DELETE /relations/:relationId`: Soft delete validando posse (404 se de outro tenant).
18. `POST /leads/:leadId/convert`: Valida posse da lead no tenant antes de converter.
19. `POST /opportunities/:opportunityId/win`: Valida posse da oportunidade no tenant antes de ganhar.
20. `DELETE /leads/:id`: Soft delete (`deletedAt: new Date()`) validando posse no tenant.

### 2.2 Isolamento Entre Tenants — Helpers de Posse
Criação de helpers no serviço `EnterpriseCRMService`:
- `assertCompanyOwned(companyId: string): Promise<Company>`
- `assertContactOwned(contactId: string): Promise<CompanyContact>`
- `assertAddressOwned(addressId: string): Promise<CompanyAddress>`
- `assertDocumentOwned(docId: string): Promise<CompanyDocument>`
- `assertContractOwned(contractId: string): Promise<Contract>`
- `assertRelationOwned(relationId: string): Promise<CompanyRelation>`
- `assertLeadOwned(leadId: string): Promise<Lead>`
- `assertOpportunityOwned(oppId: string): Promise<Opportunity>`

Qualquer registo inexistente ou que pertença a outro tenant lança `AppError.notFound('Registo não encontrado.')` que resulta em **HTTP 404**.

---

## 3. Segurança Front-End (XSS) e Modularização

### 3.1 Reestruturação dos Assets
- Criar `backend/public/assets/js/crm/crm-core.js`:
  - Função `esc(value)` segura contra XSS.
  - Normalizador de dados e formatador de moeda/percentagem/data.
  - Helpers de delegação de eventos com `data-id`.
- Criar `backend/public/assets/js/crm/crm-companies.js`:
  - Grelha e lista de empresas com paginação do servidor (`limit`, `cursor`).
  - Painel de métricas com dados agregados da API.
  - Ficha 360º com escape rigoroso de todos os campos.
  - Tratamento de resposta 409 (Duplicado) com opções "Abrir existente" e "Criar mesmo assim".
- Criar `backend/public/assets/js/crm/crm-contacts.js`:
  - Gestão de contactos com campo `decisionPower`.
- Criar `backend/public/assets/css/crm.css`:
  - Estilos específicos do CRM integrados com o design system do ERP.
- Manter `backend/public/assets/js/crm.js` como integrador com retrocompatibilidade para `window.CRMModule`.
- Atualizar `backend/public/app.html` com tags `<script src="/assets/js/crm/crm-core.js?v=1.6.1">`, etc., e link de CSS com versão.

---

## 4. Riscos Identificados e Mitigações

1. **Risco de regressão no módulo legado de Leads:**
   * *Mitigação:* `Lead` mantém todos os campos, soft-delete utiliza coluna já existente `deletedAt`, e testes de regressão do CRM cobrem criação, conversão e listagem.
2. **Risco de colisão de NIF na base existente durante a validação:**
   * *Mitigação:* A verificação de duplicados é restrita ao mesmo tenant e apenas a registos não arquivados (`deletedAt IS NULL`). Empresas arquivadas não bloqueiam criação.
3. **Risco de Cache em Browsers (Vercel max-age):**
   * *Mitigação:* Todos os assets do CRM em `app.html` recebem versão explícita `?v=1.6.1`.

---

## 5. Plano de Testes Automatizados (B1)

Criar suite de testes abrangente em `backend/tests/crm/crm-b1-security.test.ts`:
1. **Isolamento de tenant (404 nos filhos):**
   - Tentativa de atualizar contacto de outro tenant ➔ 404.
   - Tentativa de apagar endereço de outro tenant ➔ 404.
   - Tentativa de apagar documento de outro tenant ➔ 404.
   - Tentativa de atualizar contrato de outro tenant ➔ 404.
   - Tentativa de relacionar empresa de outro tenant ➔ 404.
   - Tentativa de apagar relação de outro tenant ➔ 404.
   - Tentativa de converter lead de outro tenant ➔ 404.
2. **Validação de NIF:**
   - NIF português válido (ex.: 500000000 cálculo módulo 11) aceite.
   - NIF português com checksum errado rejeitado com 400.
3. **Deteção de Duplicados:**
   - Criação de empresa com NIF ou email idêntico ➔ 409 com ID da existente.
   - Criação com `force: true` ➔ 201 e cria com auditoria.
4. **Campo `decisionPower`:**
   - Criação e atualização de contacto gravam e devolvem o valor do enum.
5. **Soft-delete:**
   - Apagar lead marca `deletedAt` e não apaga linha da base.
   - Apagar relação marca `deletedAt` e não apaga linha da base.
6. **Paginação e Busca no Servidor:**
   - Devolve `nextCursor` e respeita `limit`.
7. **Neutralização XSS:**
   - `esc()` neutraliza tags `<script>` e `<img src=x onerror=alert(1)>`.
