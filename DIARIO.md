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

4. **Reestruturação do Login com Password**:
   - Atualizado `login.html` para incluir diretamente os campos de **Email** e **Palavra-passe** (com olho de visibilidade) na vista principal.
   - Ajustado o fluxo para submeter email + password diretamente com o botão "Entrar no ERP".
   - Atualizado o teste de browser Playwright (`test-e2e-browser.mjs`) para cobrir o fluxo direto com email e password.

5. **Estabilização do Módulo Financeiro**:
   - Corrigida a função `exportFinancas` em `app.html` para realizar o pedido HTTP autenticado com o cabeçalho `Authorization: Bearer <token>` e descarregar o ficheiro CSV via Blob.
   - Adicionado o pré-preenchimento automático da data atual nos campos de vencimento, início e empréstimo nos formulários de Finanças.
   - Garantida a limpeza integral de `localStorage` e `sessionStorage` em todos os handlers de `logout()`.

6. **Sistema de Rastreio & Governança**:
   - Criados e atualizados os ficheiros de governança de raiz: `AGENTS.md`, `CLAUDE.md`, `ESTADO.md`, `DIARIO.md`, `DECISOES.md`, `DIVIDA_TECNICA.md`.

7. **Correção Critical — Router app.html (Finanças abria CRM)**:
   - Identificado bug no `route()`: a ordem colocava `MODULES_REGISTRY` (em_construcao/planeado) antes do bloco `financas`, fazendo `#/financas` (status `beta`) cair no `else` e abrir o CRM.
   - Reordenado: `financas` e `condominios` verificados PRIMEIRO, antes do registry.
   - Removido código orphaned `loadCRM(); } }`.
   - Build local OK. Deploy `dpl_3wtMNn8iPbNJYGwwWfw61fWhPkzs` → `https://helderlabs.eu` · READY · 21:42 WEST.

8. **Correção Critical — modules.js compilado pelo Vercel para CJS**:
   - Vercel compilava `modules.js` (ESM: `export const`) para CJS durante deploy. Browser tentava importar como ES Module → importação falhava silenciosamente → `route()` nunca corria → `view-finance` ficava `display:none` → página em branco.
   - Convertido `modules.js` para globals `window.MODULES_REGISTRY` e `window.renderIncompleteModuleScreen`.
   - `app.html` e `index.html` actualizados para usar `<script src="...">` em vez de `import`.
   - Deploy `dpl_GTxeAGX2CKxw2gVJkuACiytVRDe6` · READY · 21:58 WEST.

9. **Correção Critical — IIFE órfão em app.html**:
   - Ao substituir `<script type="module">` por `<script>`, o `})();` do IIFE original ficou sem o `(function() {` correspondente → SyntaxError fatal → todo o JS parava → página em branco.
   - Removido `})();` órfão da linha 1238.
   - Deploy `dpl_4Ht1MyWGY9xvqbEodnk774gGvBzn` · READY · 22:09 WEST.

10. **Landing page — Botão "Entrar" e botões separados**:
    - Separados dois botões: `auth-area-btn` (com sessão → workspace) e `open-auth-modal` (sem sessão → login.html directo).
    - Modal actualizado: texto "Entrar com Email e Palavra-passe".
    - Login Enter key: corrigido para chamar `loginWithPassword()` directamente.
    - Logout: redireciona para `/` (landing) em vez de `/login.html`.

