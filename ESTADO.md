# ESTADO DO PROJETO — HELDERLABS ERP

> **Ficheiro de Atualização Obrigatória a cada Sessão de Trabalho**
> Última atualização: 2026-09-07 21:42 (WEST) · Responsável: `[antigravity]`
> Último deploy: `dpl_3wtMNn8iPbNJYGwwWfw61fWhPkzs` · Estado: **READY** · URL: https://helderlabs.eu

---

## 📌 1. Resumo Executivo
- **Projeto**: HELDERLABS ERP
- **Versão Atual**: `0.3.0`
- **Ambiente de Produção**: Vercel (`https://helderlabs.eu`)
- **Status do Build / Testes**: 100% verde (60/60 unitários, 22/22 E2E API, 8/8 Playwright Headless)
- **Ramo Atual**: `master`

---

## 🚀 2. Módulos & Funcionalidades Ativas

| Módulo | Estado | Descrição |
| :--- | :--- | :--- |
| **Plataforma Core / Auth** | `ATIVO` | Login JWT + OTP, Reativação, Alteração de Password, Impersonation, Multi-tenant isolation |
| **Super Admin** | `ATIVO` | Gestão de Tenants, Pedidos de Conta, Atribuição de Licenças, Audit Logs |
| **Finanças** | `BETA` | Receitas, Despesas, Orçamentos, Contas Bancárias, Amortizações, Undo 10s |
| **CRM** | `BETA` | Leads da Landing Page, Fichas de Contacto, Pipeline Oportunidades |
| **Condomínios** | `EM_CONSTRUÇÃO` | Estrutura de Edifícios e Frações (em desenvolvimento) |
| **Rent-a-Car** | `PLANEADO` | Gestão de Frota e Reservas |
| **Recursos Humanos** | `PLANEADO` | Gestão de Colaboradores e Processamento |

---

- **Login Direto com Password**: Reestruturação do ecrã de autenticação (`login.html`) para apresentar ambos os campos (Email e Palavra-passe com olho de visibilidade) logo na primeira vista, permitindo a autenticação imediata por password ou alternância para OTP.
- **Correção da Limpeza de Sessão (Logout)**: Garantida a limpeza integral de `localStorage` e `sessionStorage` ao fazer logout em todos os ecrãs corporativos (`workspace.html`, `super-admin.html`, `app.html`).
- **Módulo Financeiro & Exportação CSV**: Otimização do carregamento do módulo financeiro (`loadFinancas()`), pré-preenchimento automático de datas nos formulários e exportação autenticada de ficheiros CSV por Blob.
- **Aviso de Ligação Offline**: Introdução do script global `connection-banner.js` em todos os ecrãs para alerta visual e preservação automática de formulários em `localStorage`.
- **Governança de Agentes**: Implementação integral da especificação `AGENTS.md`, `CLAUDE.md`, `ESTADO.md`, `DIARIO.md`, `DECISOES.md` e `DIVIDA_TECNICA.md`.
- **Correção Router app.html (Finanças vs CRM)**: O router `route()` em `app.html` verificava `MODULES_REGISTRY` antes de `financas`, fazendo com que `#/financas` abrisse o CRM. Corrigido: `financas` e `condominios` são verificados primeiro. Orphaned `loadCRM(); } }` removido. Deploy `dpl_3wtMNn8iPbNJYGwwWfw61fWhPkzs` em produção.

---

## 🎯 4. Próximos Passos Prioritários
1. Implementar importação de contactos CSV no módulo CRM.
2. Adicionar avisos de cobrança automatizados de quotas no módulo de Condomínios.
3. Alargar cobertura de testes E2E Playwright aos fluxos de amortização do módulo de Finanças.
