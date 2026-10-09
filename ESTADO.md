# ESTADO DO PROJETO — HELDERLABS ERP

> **Ficheiro de Atualização Obrigatória a cada Sessão de Trabalho**
> Última atualização: 2026-10-09 02:48 (WEST) · Responsável: `[antigravity]`
> Versão: **v1.6.6 — CRM HelderLabs Enterprise: Fases B1 a B6 (Isolamento & Segurança, Pipeline & Oportunidades, Atividades & Cronologia 360º, Propostas & Orçamentos A4 com Envio de Email, Contratos de Avença com SLA, e Gestão de Documentos do Cliente, Upload e Controlo de Validades).**
> Testes: **87 / 87 testes CRM e Mail verdes (100% de sucesso). Suite de build de produção verificada.**

---

## 📌 1. Resumo Executivo
- **Projeto**: HELDERLABS ERP
- **Versão Atual**: `1.5.0`
- **Ambiente de Produção**: Vercel (`https://helderlabs.eu`) & Base de Dados Online Neon PostgreSQL
- **Arquitetura**: Aplicação Web e Cliente Desktop ligam ambos exclusivamente à mesma API Online e Base de Dados Online Neon.
- **Infraestrutura de Email**: Domínio `helderlabs.eu` verificado no Resend (DKIM, SPF, MX, DMARC), motor centralizado `EmailService` em toda a plataforma, e prova de entrega externa para `helder@mail.com` validada com `last_event = delivered`.
- **Ramo Atual**: `master`

---

## 🚀 2. Módulos & Funcionalidades Ativas

| Módulo | Estado | Descrição |
| :--- | :--- | :--- |
| **Plataforma Core / Auth** | `ATIVO` | Login JWT + OTP, Reativação, Alteração de Password, Impersonation, Multi-tenant isolation |
| **Super Admin** | `ATIVO` | Gestão de Tenants, Pedidos de Conta, Atribuição de Licenças, Audit Logs com SHA-256 |
| **Finanças & Tesouraria** | `ATIVO` | Receitas/Despesas (*Cents), Orçamentos, Cash Flow, Relatórios P&L / Balanço, SAF-T (PT) |
| **CRM & Empresas 360** | `ATIVO` | Fases B1 a B6: Leads, Negócios, Pipeline Kanban, Atividades, Cronologia 360º, Propostas/Orçamentos A4 com envio de email, Contratos de Avença com SLA, MRR/ARR, e Gestão de Documentos do Cliente com Controlo de Validades |
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
1. **CRM Fase B6**: Gestão de Documentos do Cliente, Upload, Categorização e Controlo de Validades / Caducidade.
2. **CRM Fase B7**: Painel Executivo do CRM com Gráficos SVG Nativos (Funil de Vendas, Receita Ponderada e Métricas de Conversão).
3. **CRM Fase B8**: Matriz Granular de Permissões RBAC (`crm.*`) e Auditoria Rigorosa de Ações Comerciais.
