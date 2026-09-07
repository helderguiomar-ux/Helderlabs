# ESTADO DO PROJETO — HELDERLABS ERP

> **Ficheiro de Atualização Obrigatória a cada Sessão de Trabalho**
> Última atualização: 2026-09-08 · Responsável: `[antigravity]`

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

## 🛠️ 3. Alterações Recentes em Produção
- **Correção da Persistência de Sessão**: Injeção da chave `erp_session` no `localStorage` após login com sucesso e flexibilização da leitura de tokens em `workspace.html`, `super-admin.html` e `app.html`.
- **Aviso de Ligação Offline**: Introdução do script global `connection-banner.js` em todos os ecrãs para alerta visual e preservação automática de formulários em `localStorage`.
- **Validação E2E em Browser Real**: Teste Playwright executado contra `https://helderlabs.eu` com login do Super Administrador (`helderguiomar@gmail.com`) e confirmação de redirecionamento para `/super-admin.html`.
- **Governança de Agentes**: Criação dos ficheiros de rastreio `AGENTS.md`, `CLAUDE.md`, `ESTADO.md`, `DIARIO.md`, `DECISOES.md` e `DIVIDA_TECNICA.md`.

---

## 🎯 4. Próximos Passos Prioritários
1. Implementar importação de contactos CSV no módulo CRM.
2. Adicionar avisos de cobrança automatizados de quotas no módulo de Condomínios.
3. Alargar cobertura de testes E2E Playwright aos fluxos de amortização do módulo de Finanças.
