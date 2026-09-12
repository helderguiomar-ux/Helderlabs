# ESTADO DO PROJETO — HELDERLABS ERP

> **Ficheiro de Atualização Obrigatória a cada Sessão de Trabalho**
> Última atualização: 2026-09-12 19:35 (WEST) · Responsável: `[antigravity]`
> Versão: **v1.2.0 — Licenciamento Global Centrado na Empresa, Validação de Email Obrigatória via Resend (24h) e Licenças Vitalícias Ativas.**
> Testes: **169 / 169 testes verdes (100% de sucesso).**

---

## 📌 1. Resumo Executivo
- **Projeto**: HELDERLABS ERP
- **Versão Atual**: `1.2.0`
- **Ambiente de Produção**: Vercel (`https://helderlabs.eu`) & Base de Dados Online Neon PostgreSQL
- **Arquitetura**: Aplicação Web e Cliente Desktop ligam ambos exclusivamente à mesma API Online e Base de Dados Online Neon.
- **Licenciamento Global**: Gestão centrada na **Empresa (Tenant)**, 4 cartões de métricas reais no topo, suporte a **Licenças Vitalícias** (`ATIVA · VITALÍCIA (∞)` sem expiração e excluídas de contagem a 30d), e **Regra de Segurança de Email Validado** (apenas utilizadores com email validado via Resend no prazo de 24h podem receber atribuição de licença de módulo).
- **Ramo Atual**: `master`

---

## 🚀 2. Módulos & Funcionalidades Ativas

| Módulo | Estado | Descrição |
| :--- | :--- | :--- |
| **Plataforma Core / Auth** | `ATIVO` | Login JWT + OTP, Reativação, Alteração de Password, Impersonation, Multi-tenant isolation |
| **Super Admin** | `ATIVO` | Gestão de Tenants, Pedidos de Conta, Atribuição de Licenças, Audit Logs com SHA-256 |
| **Finanças & Tesouraria** | `ATIVO` | Receitas/Despesas (*Cents), Orçamentos, Cash Flow, Relatórios P&L / Balanço, SAF-T (PT) |
| **CRM & Empresas 360** | `ATIVO` | Leads, Oportunidades, Fichas de Empresa 360 com NIF, contactos e histórico integrado |
| **HCCALL Telecom** (`hccall`) | `ATIVO` | PWA mobile-first, registo <20s, snapshot imutável de comissões, offline-first IndexedDB e RGPD |
| **2SELLMAIS** (`sellmais`) | `ATIVO` | Inventário de velharias/antiguidades, atributos JSONB, máquina de estados estrita, custos materializados, consignações, leilões concorrentes e catálogo público SSR |
| **Condomínios** | `EM_CONSTRUÇÃO` | Estrutura de Edifícios e Frações (em desenvolvimento) |
| **Rent-a-Car** | `PLANEADO` | Gestão de Frota e Reservas |
| **Recursos Humanos** | `PLANEADO` | Gestão de Colaboradores e Processamento |

---

- **Módulo de Finanças & Tesouraria Completo**:
  - Implementação de API REST robusta (`/api/finance/*`): Dashboard, Transações (CRUD, status, aprovações), Orçamentos (limiares e alertas >90%), Fluxo de Caixa (projeções Base, Otimista e Pessimista), Relatórios P&L e Balanço Patrimonial, Reconciliação Bancária com extratos, e Exportação SAF-T (PT) XML e CSV.
  - Modelos Prisma criados e migrados com segurança multi-tenant: `FinancialTransaction`, `FinancialAttachment`, `Budget`, `BudgetItem`, `CashFlowProjection`, `BankReconciliation`, `FinancialReport`.
  - Interface do utilizador moderna em `app.html` com sub-navegação em tabs, cartões de KPIs em tempo real, gráficos interativos em SVG (evolução mensal 12m e distribuição de custos por categoria), barras de progresso de orçamento e gerador de relatórios P&L.
- **Login Direto com Password**: Reestruturação do ecrã de autenticação (`login.html`) para apresentar ambos os campos (Email e Palavra-passe com olho de visibilidade) logo na primeira vista, permitindo a autenticação imediata por password ou alternância para OTP.
- **Correção da Limpeza de Sessão (Logout)**: Garantida a limpeza integral de `localStorage` e `sessionStorage` ao fazer logout em todos os ecrãs corporativos (`workspace.html`, `super-admin.html`, `app.html`).
- **Módulo Financeiro & Exportação CSV**: Otimização do carregamento do módulo financeiro (`loadFinancas()`), pré-preenchimento automático de datas nos formulários e exportação autenticada de ficheiros CSV por Blob.
- **Aviso de Ligação Offline**: Introdução do script global `connection-banner.js` em todos os ecrãs para alerta visual e preservação automática de formulários em `localStorage`.
- **Governança de Agentes**: Implementação integral da especificação `AGENTS.md`, `CLAUDE.md`, `ESTADO.md`, `DIARIO.md`, `DECISOES.md` e `DIVIDA_TECNICA.md`.

---

## 🎯 4. Próximos Passos Prioritários
1. Implementar importação de ficheiros bancários (OFX / QIF) na Reconciliação Bancária.
2. Implementar importação de contactos CSV no módulo CRM.
3. Adicionar avisos de cobrança automatizados de quotas no módulo de Condomínios.
