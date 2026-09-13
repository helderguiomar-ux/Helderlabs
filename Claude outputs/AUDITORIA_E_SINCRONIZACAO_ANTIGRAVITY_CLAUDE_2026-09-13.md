# AUDITORIA E SINCRONIZAÇÃO CANÓNICA: ANTIGRAVITY ⟷ CLAUDE
**Data de Emissão:** 13 de Setembro de 2026  
**Versão Oficial do Sistema:** `1.5.0`  
**Commit Canónico Ativo:** `1e509835e297a2c67f0ac0f56de239488c9688d9` (curto: `1e50983`)  
**Ambiente:** Produção (`https://helderlabs.eu`)  
**Base de Dados:** Neon PostgreSQL Serverless (22 tabelas RLS, 10 migrações aplicadas)  
**Paridade de Testes:** 205/205 testes automatizados aprovados em 56 suítes (100% verde)

---

## 🎯 1. Objetivo Deste Ficheiro

Este documento serve de **marco de verdade absoluto e sincronização operacional** entre os agentes de IA **Antigravity** e **Claude**. Ambos os agentes ficam, a partir deste momento, plenamente capacitados e alinhados para intervir, manter e evoluir a aplicação em produção com segurança industrial, garantindo que nenhum dos agentes introduz regressões, sobrescreve o trabalho do outro ou compromete os dados existentes.

---

## 📜 2. Manifesto do Que Está Feito até 13/09/2026

### 🏛️ A. Núcleo da Plataforma & Backend (Fastify + TypeScript)
1. **Arquitetura Serverless & Standalone**:
   - `api/index.ts`: Adapter Serverless nativo para a Vercel, emitindo eventos de request diretamente para a instância Fastify.
   - `backend/src/server.ts`: Servidor HTTP standalone para ambiente local, Docker e testes integrados na porta 3333.
   - `backend/src/app.ts`: Builder Fastify com `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit`, errorHandler centralizado e registo modular de rotas.
2. **Autenticação & Sessões Seguras**:
   - Suporte híbrido: Email + Password cifrada com `bcrypt` (12 rounds) ou Código OTP de 6 dígitos enviado por email via `EmailService` (Resend API).
   - JWT estruturado com `signAuthToken` contendo `sub`, `email`, `role`, `tenantId`, `impersonationId`, `actingUserId` e `actingTenantId`.
   - Plugin de autenticação (`authenticate.ts`) que injeta `request.user` e instancia o cliente de dados `request.db`.
3. **Isolamento Multi-Tenant**:
   - `tenantScopedClient.ts`: Prisma Client Extension que interseta automaticamente todas as operações de leitura e escrita para injetar o filtro do `tenantId` da sessão ativa, impedindo IDOR e vazamento entre empresas.
4. **Motor de Licenciamento & Entitlements**:
   - `EntitlementService.ts`: Resolução hierárquica de permissões (Tenant ➔ Aplicação ➔ Utilizador).
   - Geração de assinaturas HMAC-SHA256 para o manifesto do Workspace (`signature`).
   - Caching em memória com TTL de 60 segundos e invalidação cirúrgica por tenant (`EntitlementService.invalidateCache(tenantId)`).
   - Guards Fastify reutilizáveis: `requireApp(key)` e `requirePermission(perm)`.
5. **Cadeia de Auditoria Criptográfica**:
   - `AuditService.ts`: Registo append-only com encadeamento de hash SHA-256 (`previousHash` ➔ `currentHash`).
   - Trigger nativo no PostgreSQL que proíbe explicitamente operações de `UPDATE` e `DELETE` na tabela `audit_logs`.
   - Algoritmo de verificação de adulteração (`verifyAuditChain`) que deteta qualquer alteração direta na base de dados.
6. **Módulo de Cópias de Segurança (Backups)**:
   - `PlatformBackupService.ts`: Descoberta dinâmica de esquema e exportação de dados estruturados em JSON com manifesto e assinatura SHA-256.
   - Endpoints: `GET /api/platform/backup/tenant/:tenantId` (individual) e `GET /api/platform/backup/all` (global).

---

### 📦 B. Módulos de Negócio Concluídos e Operacionais
| Módulo | Chave | Estado | Capacidades Chave |
| :--- | :--- | :--- | :--- |
| **CRM Comercial** | `crm` | `ACTIVE` | Gestão de Leads, Oportunidades, Contactos, Interações, Funil de Vendas e API pública de captura (`POST /api/public/leads`). |
| **Gestão de Condomínios** | `condominios` | `IN_CONSTRUCTION` | Gestão de Edifícios, Frações autónomas, Proprietários, Quotas, Emissão de Avisos e Contabilidade básica. |
| **Gestão Financeira** | `finance` | `BETA` | Contas Bancárias, Centros de Custo, Categorias, Transações em cêntimos inteiros, Regras Recorrentes (com clamping de final de mês), Projeções a 30 dias e Orçamentos. |
| **HCCALL Telecom** | `hccall` | `ACTIVE` | Campanhas de Operadores Telecom, Catálogo de Serviços/Produtos com `monthlyTarget` individual, Motor de Comissões puro (Retroativo, Marginal, Flat, Milestone), Simulador de Comissões, Dinamizações, Metas e Dashboard. |
| **2SELLMAIS** | `sellmais` | `ACTIVE` | Inventário de Antiguidades e Arte, Proveniência histórica, Restauro com custo automático, Leilões com controlo de concorrência e lances atómicos, Assistente IA para catálogo/peritagem, Motor Outbox de canais e Catálogo público SSR. |
| **Consola Super Admin** | `platform` | `ACTIVE` | Gestão de Empresas (criação, edição, bloqueio), Atribuição de Módulos, Sessões de Suporte / Impersonation com banner persistente, Métricas de Armazenamento por cliente, Auditoria de Saúde da BD e Backups. |

---

### 🖥️ C. Frontend & Catálogo de Ecrãs (HTML5 / Vanilla JS ES2023)
1. **`index.html`**: Landing Page institucional pública com i18n PT-PT / EN-US, formulário de contacto/lead e design system "Caderno de Engenharia".
2. **`login.html`**: Ecrã de autenticação com suporte para Password e OTP, visualizador de password com SVG inline e pedido de registo de nova conta.
3. **`workspace.html`**: Hub principal do utilizador do tenant:
   - **Banner de Licenciamento (#tenant-license-banner)**: Exibe a modalidade contratada, estado, validade e módulos licenciados.
   - **Grelha Estrita de Aplicações**: Apresenta **exclusivamente** os módulos que o tenant tem contratados.
   - Modal de alteração de palavra-passe com validação de complexidade.
   - Atalho de teclado `Ctrl + K`.
4. **`app.html`**: Shell SPA legado para execução de módulos de gestão interna.
5. **`hccall.html`**: Aplicação rica do módulo HCCALL Telecom, incluindo catálogo de serviços com meta mensal, registo rápido de vendas, KPIs em tempo real, simulação e banner de intervenção do Super Admin.
6. **`super-admin.html`**: Consola de controlo central:
   - Listagem e pesquisa de Tenants com botão direto `✏️ Editar`.
   - Modal `#edit-tenant-modal` para edição cadastral e operacional.
   - Secção de **Armazenamento de Clientes** com estimativas de espaço em disco e distribuição de registos.
   - Secção de **Saúde & Auditoria da Base de Dados** com análise de integridade prévia.
   - Botões de Backup individual e consolidado.

---

### 🗄️ D. Base de Dados PostgreSQL (Neon) & Migrações
Histórico de 10 migrações aplicadas e ativas:
1. `20260228000000_init_multi_tenant_schema`
2. `20260228000001_add_roles_and_permissions`
3. `20260301000000_add_condominios_and_branding`
4. `20260302000000_add_crm_pipeline_and_audit`
5. `20260303000000_add_finance_module`
6. `20260304000000_add_hccall_telecom`
7. `20260305000000_add_sellmais_antiques`
8. `20260306000000_add_audit_tamper_evident_trigger`
9. `20260307000000_add_rls_policies`
10. `20260913214500_add_product_id_to_hccall_objectives` (adiciona `productId` e índice em `hccall_objectives`).

---

## 🚀 3. Implementações Concluídas Especificamente a 13/09/2026

### 1. Resolução do Erro P2022 na Criação de Serviços
- **Causa:** O Prisma Schema definia a relação opcional `product HccallProduct?` em `HccallObjective`, mas a coluna `productId` não existia no Neon.
- **Resolução:** Criada e aplicada a migração aditiva `20260913214500_add_product_id_to_hccall_objectives`, adicionado o campo `monthlyTarget` no payload de criação de produto e protegido o código com fallback seguro.

### 2. Assunção e Destaque do Tenant em Intervenção
- **Causa:** Ao fazer impersonate, o Super Admin precisava de ter total certeza de em que tenant estava a intervir e de ter ferramentas de saída e backup imediatos.
- **Resolução:** Criado banner de intervenção com badge `🏢 TENANT ATIVO: [Nome da Empresa]`, email do administrador, atalho para backup imediato e botão para encerrar a sessão de suporte.

### 3. Restrição Estrita de Módulos para o Tenant
- **Causa:** Utilizadores de tenant viam módulos que a empresa não tinha contratado como opções de upsell.
- **Resolução:** No `EntitlementService.ts`, para utilizadores de tenant sem privilégios de plataforma nem sessão de suporte (`!isPrivileged`), o manifesto filtra os módulos para devolver **apenas** os que têm estado `ACTIVE`, `TRIAL`, `GRACE` ou `SUSPENDED`. Módulos `NONE` e `DISABLED` são omitidos e `showUpsell` fica a `false`.

### 4. Edição de Dados do Tenant na Consola Super Admin
- **Causa:** Não existia forma de editar os dados cadastrais da empresa através da interface de Super Admin.
- **Resolução:** Implementadas as rotas `PUT /api/platform/tenants/:id` e `PATCH /api/platform/tenants/:id` com auditoria imutável, criado o modal `#edit-tenant-modal` e adicionados botões de edição rápida na tabela e no modal de detalhes em `super-admin.html`.

### 5. Banner de Licenciamento no Workspace do Tenant
- **Causa:** O cliente precisava de ver claramente que licenciamento possui ao aceder ao sistema.
- **Resolução:** O endpoint `GET /api/me/workspace` fornece o objeto `licensing` e o `workspace.html` renderiza o banner `#tenant-license-banner` com o estado da licença, nome do plano, validade e tags dos módulos ativos.

### 6. Resolução do Erro de Sintaxe em `workspace.html`
- **Causa:** Faltavam duas chavetas de encerramento em funções do modal de password e impersonate, bloqueando a execução do script no navegador e causando ecrã em branco.
- **Resolução:** Corrigida a sintaxe e validado a zero erros no frontend.

---

## 🛡️ 4. Regras Absolutas para Antigravity e Claude Operarem em Produção

Para que tanto o **Antigravity** como o **Claude** possam continuar o trabalho sem conflitos:

1. **Proteção Total de Dados**:
   - **NUNCA** executar `prisma migrate reset`, `db push --force-reset`, `DROP TABLE` ou `TRUNCATE`.
   - Qualquer nova alteração de base de dados deve ser feita via migração aditiva (`prisma migrate dev --create-only` ou script SQL retrocompatível) e aplicada exclusivamente via `prisma migrate deploy`.

2. **Isolamento de Tenant Obrigatório**:
   - **NUNCA** aceitar `tenantId` vindo do corpo do pedido (`req.body`) ou da query string em rotas autenticadas.
   - Extrair sempre de `request.user.tenantId` (ou do contexto de impersonation).
   - Utilizar sempre `request.db` ou `tenantScopedClient(tenantId)` para consultar e gravar registos vinculados a tenants.

3. **Respeito pelo Modelo de Licenciamento**:
   - Ao adicionar novas rotas ou controladores em módulos, proteger sempre com o preHandler `app.requireApp('module_key')`.
   - Lembrar que utilizadores comuns só recebem módulos com licença efetiva no seu manifesto.

4. **Auditoria Obrigatória em Mutações**:
   - Toda a operação que altere dados de plataforma ou configurações deve invocar `AuditService.audit({ action, entity, entityId, details, ... })`.

5. **Paridade e Suíte de Testes Verde (205 Testes)**:
   - Antes de submeter código para produção, correr obrigatoriamente:
     ```bash
     cd backend
     npm run build
     npm test
     ```
   - Todos os 205 testes devem passar a 100%.

6. **Deploy Determinístico na Vercel**:
   - Commits e push na branch `master`.
   - Deploy com: `npx vercel deploy --prod --yes`.
   - Verificação pós-deploy confirmando o hash do commit em `https://helderlabs.eu/api/version`.

---

## 📋 5. Tabela de Verificação e Sincronização

| Componente | Estado em 13/09/2026 | Responsável / Verificador |
| :--- | :--- | :--- |
| **API Online** | `1.5.0` (Online em `https://helderlabs.eu`) | Antigravity / Claude |
| **PostgreSQL Neon** | Sincronizado, 10 migrações, RLS ativo | Antigravity / Claude |
| **Frontend Web** | Vercel Static, 6 ecrãs operacionais | Antigravity / Claude |
| **Cliente Desktop** | `local-client/` na porta 3400 apontado à API | Antigravity / Claude |
| **Infraestrutura Resend** | Ativa e validada (`helderlabs.eu`) | Antigravity / Claude |
| **Cadeia de Auditoria** | Ativa com triggers PostgreSQL | Antigravity / Claude |
| **Testes Automatizados** | 205/205 testes verdes em 56 suítes | Antigravity / Claude |

---
*Este documento é uma declaração conjunta de estado para garantir a continuidade perfeita e colaborativa entre Antigravity e Claude.*
