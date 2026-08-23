# Deployment & SMTP Guide - HELDERLABS ERP

Detailed instructions for deploying the project to Vercel and configuring SMTP email services.

---

## Configuração SMTP na Vercel

Todas as credenciais de envio de email são lidas de forma dinâmica das Environment Variables da Vercel. 

### Onde Configurar
1. No dashboard da Vercel, abra o seu projeto **`helderlabs-erp`**.
2. Aceda a **Settings** -> **Environment Variables**.
3. Adicione as seguintes variáveis (selecionando todos os ambientes: *Production*, *Preview* e *Development*):

| Variável | Valor Recomendado | Descrição |
| :--- | :--- | :--- |
| **`SMTP_HOST`** | `smtp.gmail.com` | Servidor SMTP do Gmail |
| **`SMTP_PORT`** | `587` | Porta de comunicação TLS |
| **`SMTP_SECURE`** | `false` | true para porta 465, false para TLS 587 |
| **`SMTP_USER`** | `helderguiomar@gmail.com` | E-mail do remetente |
| **`SMTP_APP_PASSWORD`** | `<PASSWORD_DE_APLICAÇÃO_DO_GMAIL>` | Senha de 16 caracteres gerada no painel Google |
| **`SMTP_FROM`** | `HELDERLABS ERP <helderguiomar@gmail.com>` | Remetente visível do email |

---

### Como alterar a password de aplicação futuramente
1. Aceda à sua Conta Google -> **Segurança** -> **Palavras-passe de aplicação**.
2. Elimine a chave anterior e clique em "Criar nova".
3. Copie o código de 16 dígitos e atualize o valor da variável **`SMTP_APP_PASSWORD`** no dashboard da Vercel.
4. Efetue um novo deploy da aplicação para recarregar as definições em produção.
