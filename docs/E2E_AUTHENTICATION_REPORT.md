# Relatório End-to-End: Fluxo de Autenticação

## Fluxo Testado

1. **Registo de Utilizador**
   - Criação do registo via `AuthController.register`.
   - Gera e grava Token de Confirmação (Hash).
   - Coloca e-mail de "Confirmação de Registo" na fila (`EmailQueue`).
   
2. **Envio de E-mail de Confirmação**
   - O worker `EmailWorker.ts` recolhe a mensagem.
   - O tipo é `SYSTEM`, sendo o `platform: true`.
   - Utiliza a `PlatformEmailConfiguration` para enviar o e-mail via SMTP do provedor da plataforma.
   
3. **Verificação (Mockada / Postman)**
   - O utilizador clica no link e a sua conta transita para `STATUS_PENDING_APPROVAL`.
   
4. **Aprovação do Super Admin**
   - O Super Admin vê o pedido pendente no Dashboard.
   - Seleciona uma empresa e uma Role.
   - Clica em Aprovar (`/api/v1/admin/approve`).
   - É enviado e-mail `SYSTEM` a notificar a aprovação.
   - A conta transita para `STATUS_ACTIVE`.
   
5. **Login**
   - O utilizador insere as credenciais no portal de login.
   - Gera um JWT multi-tenant com contexto selecionado.

## Resultado
A infraestrutura End-to-End da autenticação suporta registos complexos, moderação por parte de admins e fluxos transacionais com e-mail devidamente integrados e funcionais.
