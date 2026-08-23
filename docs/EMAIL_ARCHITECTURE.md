# Arquitetura de E-mail

## 1. Visão Geral
A arquitetura de e-mails da HELDERLABS ERP baseia-se num sistema unificado de envio, orquestrado pelo módulo `EmailDispatcher.ts`, desenhado para ambientes isolados (Multi-Tenant).

## 2. Tipos de E-mail
- **SYSTEM**: E-mails de infraestrutura (Confirmações de Registo, Recuperações de Password, MFA, Avisos Críticos).
- **OPERATIONAL**: E-mails de negócio (Faturas, Orçamentos, Notificações de RH, Alertas de Stock).

## 3. Entidades
- **`PlatformEmailConfiguration`**: Dados do provedor SMTP global da Plataforma (ex. Google Workspace, AWS SES, SendGrid). Serve apenas para despachar e-mails de tipo SYSTEM.
- **`TenantSmtpConfiguration`** (JSON no Registo do Tenant): Dados do provedor SMTP isolado do cliente.
- **`EmailQueue`**: Filas de processamento para envios assíncronos que protegem as respostas síncronas HTTP e lidam com picos de tráfego (Throttle/Rate Limits).
- **`EmailLog`**: Repositório central de telemetria, rastreando sucesso, falha, duração (ms), identificador da mensagem (MessageID) e provedor.

## 4. O Fluxo de Execução
Quando uma rotina (ex: registo de conta) requer envio de e-mail, insere uma linha no `EmailQueue`.
O `EmailWorker` corre periodicamente, puxa o job e envia o parâmetro `platform: true`. O `EmailDispatcher` extrai as credenciais corretas, desencripta a password em tempo real e dispara via `NodemailerProvider`. O log final (Sucesso/Erro) atualiza o Dashboard do Super Admin instantaneamente.
