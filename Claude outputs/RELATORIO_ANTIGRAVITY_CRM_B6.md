# Relatório Antigravity — CRM Fase B6: Gestão de Documentos do Cliente, Upload e Validades (v1.6.6)

**Data:** 2026-10-09  
**Versão:** v1.6.6  
**Commit:** `500188c`  
**Deploy Vercel:** `dpl_xbW83nfDncXLE3JBDBWtTyDaGYEF`  
**URL de Produção:** `https://helderlabs.eu`  

---

## 1. Âmbito Entregue

A **Fase B6** dotou o HelderLabs ERP de um sistema corporativo completo de **Gestão de Documentos do Cliente, Upload, Controlo de Validades e Auditoria de Conformidade**, totalmente integrado na Ficha 360º de Empresas e na vista global do CRM.

### 1.1 Modelo de Dados (`schema.prisma` & Migração SQL)
- **Extensão do modelo `CompanyDocument`:**
  - `tenantId`: Isolamento multi-tenant direto carimbado na base de dados (`TENANT_SCOPED_MODELS`).
  - `fileName`, `fileSizeBytes`, `mimeType`: Metadados técnicos do ficheiro anexado.
  - `accessCode`: Suporte a códigos de acesso online para consulta de certidões oficiais (ex: Registo Comercial `XXXX-XXXX-XXXX`).
  - `verificationStatus`: Estado formal de conformidade (`PENDING`, `VERIFIED`, `REJECTED`).
  - `verifiedBy` e `verifiedAt`: Rastreabilidade de auditoria sobre quem validou o documento e respetivo carimbo temporal.
  - `notes`: Notas de conformidade ou fundamentação de rejeição.
  - `updatedAt`: Carimbo temporal de atualização.
  - Índices otimizados: `@@index([companyId])`, `@@index([tenantId])`, `@@index([status])`, `@@index([expiryDate])`.
- **Migração SQL:** `backend/prisma/migrations/20261009060000_crm_b6_documents/migration.sql` aplicada com sucesso (100% aditiva e retrocompatível).

### 1.2 Lógica de Negócio (`EnterpriseCRMService.ts`)
- **Motor de Validades em Tempo Real (`computeDocumentStatus`):**
  - Documentos sem caducidade -> `VALID` / `PERMANENT` (`daysUntilExpiry: null`).
  - Documentos no passado -> `EXPIRED` (`daysUntilExpiry < 0`, `isExpired: true`).
  - Documentos a caducar nos próximos 30 dias -> `EXPIRING_SOON` (`isExpiringSoon: true`).
  - Documentos vigentes com folga -> `VALID`.
- **Tipos Padronizados de Documentos Empresariais:**
  - `CERTIDAO_PERMANENTE`, `RCBE`, `DECLARACAO_NIF`, `PROCURACAO`, `ALVARA_LICENCA`, `SEGURO_RC`, `NON_DEBT_AT`, `NON_DEBT_SS`, `CONTRATO_ASSINADO`, `NDA_CONFIDENCIALIDADE`, `COMPROVATIVO_IBAN`, `RGPD_CONSENTIMENTO`, `OTHER`.
- **Auditoria de Conformidade (`verifyCompanyDocument`):**
  - Aprovação (`VERIFIED`) ou rejeição (`REJECTED`) de documentos com notas obrigatórias/facultativas e registo de atividade na cronologia do cliente.
- **Rastreabilidade e Atividades:**
  - Criação, atualização, verificação ou arquivo de documentos geram automaticamente entradas na cronologia 360º da empresa.
- **Isolamento Multi-tenant Rigoroso:**
  - Validação de propriedade do tenant em todas as leituras, criações, mutações e exclusões (`404 Not Found`).

### 1.3 Interface Utilizador (`crm-documents.js`, `crm-companies.js`, `app.html`, `crm.css`)
- **Painel Consolidado de Documentos (`#crm-view-documents`):**
  - Cartões de KPIs: Total de Documentos, Válidos, A Caducar (<30d), Caducados, Por Verificar.
  - Barra de pesquisa e filtros por tipo e estado com atalho para alertas.
  - Tabela com badges visuais, códigos de acesso com cópia rápida para clipboard e ações contextuais.
- **Separador na Ficha 360º de Empresa:**
  - Alerta visual proeminente caso a empresa possua documentos caducados ou a caducar.
  - Tabela completa de documentos do cliente com botões para Abrir, Verificar e Excluir.
  - Botão `+ Adicionar Documento` com modal enriquecido.
- **Modais:**
  - `#modal-upload-document`: upload de ficheiro (PDF/imagens até 8MB convertido para base64) ou link externo, código de acesso, datas e notas.
  - `#modal-verify-document`: aprovação ou rejeição formal de conformidade.

---

## 2. Evidência de Testes

### 2.1 Suite Automatizada Local
```powershell
npx tsx --test tests/crm/*.test.ts tests/mail/*.test.ts
```
**Resultado:**
- Testes: **87 aprovados** (0 falhas)
- `tests/crm/crm-b6-documents.test.ts`: **8/8 aprovados** cobrindo cálculo de caducidade, adição com registo na cronologia, KPIs, verificação/rejeição, isolamento multi-tenant e soft delete.

### 2.2 Verificação de Tipos e Linters
- `npm run typecheck`: **0 erros**
- `npx eslint`: **0 erros**

---

## 3. Verificação em Produção (Vercel)

- **Deploy ID:** `dpl_xbW83nfDncXLE3JBDBWtTyDaGYEF`
- **Aliased:** `https://helderlabs.eu`
- **Smoke Tests:**
  - `curl.exe -sI https://helderlabs.eu/app.html` -> **HTTP 200 OK** (Content-Length: 99793)
  - `curl.exe -sI https://helderlabs.eu/api/crm/documents` -> **HTTP 401 Unauthorized** (validação multi-tenant JWT ativa)
  - `curl.exe -sI https://helderlabs.eu/assets/js/crm/crm-documents.js?v=1.6.6` -> **HTTP 200 OK** (Content-Length: 18060)
