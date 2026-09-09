# HELDERLABS ERP — Registo de Versões, Fontes da Verdade e Sincronização de Deploy

**Data da Última Atualização:** 09/09/2026  
**Versão Atual:** `v0.5.0-stable` (Estabilização E2E, IDOR Fix & Catálogo Canónico)

---

## 1. Onde Estão Guardadas as Fontes da Verdade (Single Sources of Truth)

Para que qualquer deploy no **Vercel** ou em qualquer servidor ocorra sem erros, todas as camadas do sistema devem ler da sua **Fonte Única da Verdade** correspondente:

| Domínio / Componente | Ficheiro Fonte da Verdade | Papel e Responsabilidade | Sincronizado com |
|---|---|---|---|
| **Catálogo Canónico de Módulos** | `backend/src/config/modules.ts` | Define os 5 módulos oficiais (`crm`, `finance`, `hccall`, `sellmais`, `condominios`), respetivos aliases (`financas`, `condo`), rotas e metadados. | `backend/public/assets/js/modules.js` e `backend/src/plugins/entitlements.ts` |
| **Esquema de Dados & Modelos** | `backend/prisma/schema.prisma` | Fonte de dados de todas as entidades relacionais (Users, Tenants, Sales, Finance, Contracts). | Migrações em `backend/prisma/migrations/*` |
| **Autenticação & HTTP Client** | `backend/public/assets/js/api.js` | Utilitário central de sessão e injeção de JWT (`window.apiFetch`). | `app.html`, `workspace.html`, `super-admin.html`, `hccall.html` e JS dos módulos |
| **Bootstrap & Dados Iniciais** | `backend/scripts/prod-bootstrap.ts` | Sincroniza módulos e tenant super admin no arranque de produção de forma idempotente. | Executado automaticamente no build pelo `deploy-build.mjs` |
| **Regras de Licenciamento (RBAC/RLS)** | `backend/src/plugins/entitlements.ts` | Middleware de validação e bloqueio 403 para acessos não licenciados. | `EntitlementService.ts` e `modules.ts` |

---

## 2. Fluxo de Sincronização e Pipeline de Deploy (Vercel)

Para evitar erros em produção, o script de build oficial (`backend/scripts/deploy-build.mjs`) executa estritamente a seguinte ordem com fail-fast (qualquer falha cancela o deploy antes de ir ao ar):

1. `npx prisma generate` — Gera os tipos TypeScript a partir do `schema.prisma`.
2. `npx prisma migrate deploy` — Aplica todas as migrações pendentes na base de dados de produção.
3. `npx tsx scripts/prod-bootstrap.ts` — Assegura que os 5 módulos e o tenant principal estão ativos na base.
4. `tsc -p tsconfig.json` — Compila o código TypeScript garantindo ausência total de erros de tipo.

---

## 3. Histórico de Evolução de Versões

### `v0.5.0-stable` (09/09/2026) — *Versão Atual*
- **Segurança & Base de Dados:**
  - Resolução do erro `P2022` via aplicação das migrações pendentes no PostgreSQL.
  - Mitigação de vulnerabilidade IDOR crítica no `HccallSaleService` com verificação de escopo `OWN`.
  - Encapsulamento de criação de vendas no HCCALL em transação atómica `$transaction`.
- **Autenticação & Frontend:**
  - Criação do utilitário universal `api.js` (`apiFetch` com injeção automática de JWT).
  - Eliminação do loop de redirecionamento de logout em `app.html`.
  - Unificação de tokens de storage (`erp_session`, `hl_token`, `auth_token`, `erp_token`).
- **Consolidação de Módulos:**
  - Criação de `backend/src/config/modules.ts`.
  - Eliminação definitiva dos módulos mortos (`invoicing`, `sales`, `tasks`, `rent_a_car`).
  - Preservação integral do módulo `condominios` (dormente no frontend, ativo e testado no backend).
  - Compatibilização transparente do alias `finance` <-> `financas`.
- **Super Admin:**
  - Acesso direto funcional aos módulos `hccall` e `sellmais`.
  - Ficha de aprovação de contas com seleção de todos os módulos licenciáveis.
- **Qualidade & Testes:**
  - 97 testes em 24 suites a passar com 100% de sucesso (`npm test`).
  - 0 erros de compilação TypeScript (`npx tsc --noEmit`).

---

## 4. Auditoria de Volume e Espaço do Repositório

- **Código Fonte Limpo (Sem `node_modules` nem `.git`):**
  - **Total de Ficheiros:** 433 ficheiros
  - **Tamanho do Código Fonte:** ~4.4 MB (4.431.792 bytes)
- **Tamanho Total em Disco (Com dependências locais e histórico Git):**
  - **Total de Ficheiros:** 8.699 ficheiros
  - **Espaço em Disco:** ~414.4 MB (434.522.493 bytes)