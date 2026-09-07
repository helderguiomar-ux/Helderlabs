# DIÁRIO DE TRABALHO — HELDERLABS ERP

> Registo cronológico de sessões, alterações de código, depurações e deploys.

---

## 2026-09-08 · [antigravity]

### 🎯 Objetivo
Resolver o bloqueio de login em produção, estabilizar a persistência de sessão e implementar o framework de governança `AGENTS.md`.

### 🔍 Ações Efetuadas
1. **Depuração do Loop de Login**:
   - Identificada discrepância entre `login.html` (que guardava `hl_token`) e os ecrãs corporativos (`workspace.html`, `super-admin.html`, `app.html`), que procuravam `erp_session`.
   - Atualizado `login.html` para guardar `erp_session` com `{ token, user }` no `localStorage` e redirecionar utilizadores `SUPER_ADMIN` e `PLATFORM_ADMIN` diretamente para `/super-admin.html`.
   - Atualizados os ecrãs de destino para resolver tokens por fallback (`erp_session` -> `hl_token` -> `auth_token`).

2. **Banner de Ligação & Preservação Offline**:
   - Desenvolvido `backend/public/assets/js/connection-banner.js`.
   - Integrado em `index.html`, `login.html`, `workspace.html`, `app.html` e `super-admin.html`.
   - Garante exibição do aviso top bar "Sem ligação ao servidor" e preservação automática de dados de formulário em `localStorage`.

3. **Verificação E2E em Produção**:
   - Executado teste Playwright em browser real contra `https://helderlabs.eu/login.html` com as credenciais de Super Administrador (`helderguiomar@gmail.com` / `admin1234`).
   - Confirmado acesso com sucesso e navegação sem redirecionamentos infinitos.

4. **Sistema de Rastreio & Governança**:
   - Criados os ficheiros de governança de raiz: `AGENTS.md`, `CLAUDE.md`, `ESTADO.md`, `DIARIO.md`, `DECISOES.md`, `DIVIDA_TECNICA.md`.
