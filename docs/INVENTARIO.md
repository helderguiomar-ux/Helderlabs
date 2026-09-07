# Inventário Funcional Completo — HELDERLABS ERP v0.3.0

> **Ficheiro de Controlo de Integridade de Funcionalidades (Regra 2)**
> Data: 2026-09-07 | Diretoria: `C:\Users\helde\Desktop\Dev\helderlabs-erp`

---

## 1. Páginas, Ficheiros e Rotas do Sistema

### 1.1 Páginas Públicas e Ficheiros Servidos (`backend/public/`)
| Ficheiro | Rota Pública | Função & Descrição |
|---|---|---|
| `index.html` | `/` | Landing page pública institucional, diagnóstico, apresentação de serviços e modal de autenticação. |
| `login.html` | `/login.html` | Ecrã de autenticação dedicado (Verificação de email, código OTP cifrado, definição de palavra-passe e OAuth). |
| `workspace.html` | `/workspace.html` | Hub de Aplicações da Área de Cliente (App Launcher, gestão do tenant e seleção de módulos ativos). |
| `app.html` | `/app.html` | Shell principal do ERP com navegação entre Finanças, CRM, Condomínios e Definições. |
| `super-admin.html` | `/super-admin.html` | Painel de controlo do Super-Administrador (aprovação de empresas, licenciamento por módulo, impersonation e auditoria). |

### 1.2 Estilos CSS (`backend/public/assets/css/`)
- `design-system/colors.css`: Define 13 variáveis de cor com prefixo `--color-*` (ex: `--color-bg-primary`, `--color-accent-indigo`).
- `design-system/typography.css`: Define famílias de fontes (`Inter`, `JetBrains Mono`), tamanhos e pesos.
- `design-system/components.css`: Estilos de botões, cartões, modais, formulários e badges.
- `styles.css`: Define 21 variáveis de cor sem prefixo `--*` (ex: `--bg-primary`, `--accent-indigo`), criando o defeito a) de tokens a competir.

---

## 2. Ponto a Ponto das Ações de Utilizador e Formulários

### 2.1 Formulário de Contacto / Diagnóstico (`index.html`)
- **Campos**: Nome (`#lead-name`), Empresa (`#lead-company`), Email (`#lead-email`), Telefone (`#lead-phone`), Setor (`#lead-sector`), Mensagem (`#lead-message`), Termos (`#lead-terms`), Privacidade (`#lead-privacy`).
- **Validação**: Client-side (campos obrigatórios e checkboxes RGPD).
- **Destino da Rede**: `POST /api/public/leads` com payload JSON.
- **Resposta**: Sucesso exibe mensagem verde em `#lead-feedback.success`; erro exibe em `#lead-feedback.error`.

### 2.2 Modal de Autenticação / Login Social (`index.html` & `login.html`)
- **Disparo**: Botão `#open-auth-modal` ("Área de Cliente") ou acesso a `/login.html`.
- **Botões de Login Social**:
  - Google: Redireciona para `POST /api/auth/google` (OAuth 2.0 PKCE).
  - Microsoft: Redireciona para `POST /api/auth/microsoft`.
  - Apple: Redireciona para `POST /api/auth/apple`.
- **Login por Email / OTP**:
  - `POST /api/auth/check-email`: Verifica se o email existe.
  - `POST /api/auth/send-otp`: Envia código OTP cifrado por email.
  - `POST /api/auth/verify-otp`: Valida código e devolve JWT token.

### 2.3 Área de Cliente & ERP Shell (`workspace.html` & `app.html`)
- **Hub Workspace**: Apresenta os cartões de módulos aos quais a empresa tem licença ativa (`GET /api/me/workspace`).
- **Navegação no ERP**: Alternância entre tabs (Dashboard, Rendimentos, Despesas, Orçamentos, Objetivos, Dívidas, Contas, Relatórios, Auditoria, CRM, Condomínio).

---

## 3. Pontos de Rede (API Serverless Fastify)

| Rota API | Método | Função |
|---|---|---|
| `/api/public/leads` | POST | Registo de pedido de contacto/diagnóstico da landing page. |
| `/api/auth/check-email` | POST | Verificação da existência de conta. |
| `/api/auth/send-otp` | POST | Emissão de código OTP. |
| `/api/auth/verify-otp` | POST | Validação de OTP e sessão JWT. |
| `/api/auth/google` | GET/POST | OAuth Google. |
| `/api/auth/microsoft` | GET/POST | OAuth Microsoft. |
| `/api/auth/apple` | GET/POST | OAuth Apple. |
| `/api/me/workspace` | GET | Retorna perfil do utilizador, tenant e licenças de módulos ativas. |
| `/api/crm/*` | GET/POST/PUT | Endpoints do módulo CRM (Leads, Oportunidades, Clientes). |
| `/api/financas/*` | GET/POST/PUT/DELETE | Endpoints de Finanças v2 (Movimentos, Contas, Orçamentos, Objetivos, Dívidas, Relatórios, Auditoria). |
| `/api/condominios/*` | GET/POST/PUT | Endpoints de Condomínios. |
| `/api/platform/*` | GET/POST | Endpoints de SuperAdmin e gestão de licenças. |

---

## 4. Estado Guardado no Navegador

| Chave | Tipo de Armazenamento | Função |
|---|---|---|
| `hl_lang` | `localStorage` | Idioma selecionado (`pt` ou `en`). |
| `hl_theme` | `localStorage` | Tema visual (`dark`, `light`, ou `system`). |
| `hl_token` / `auth_token` | `localStorage` / Cookie | JWT Token de sessão do utilizador autenticado. |
| `hl_tenant_id` | `localStorage` | ID do tenant/empresa selecionado no Hub. |

---

## 5. Configurações de Alojamento e Deploy
- **Vercel Project**: `helderlabs-erp` (`prj_HSjQPqsENNCduQtJNtz2BGMIWZSR`)
- **Vercel Team**: `team_grzPq1IuWXqYUo3ksTtUiSCz`
- **Output Directory**: `backend/public`
- **Build Command**: `cd backend && npm install && npx prisma generate && npx prisma migrate deploy && npm run build`
