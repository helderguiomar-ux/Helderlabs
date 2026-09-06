# 📊 HelderLabs ERP — Relatório de Auditoria de Produção & Recomendações por Módulo

**Versão:** `1.0.0-consolidada` | **Data:** 23 de Agosto de 2026  
**Domínio de Produção:** [https://helderlabs.eu](https://helderlabs.eu)  
**Base de Dados Cloud:** Neon PostgreSQL (`neondb` em `<NEON_HOST_PLACEHOLDER>`)

---

## 🏛️ 1. RESUMO EXECUTIVO DA AUDITORIA DE PRODUÇÃO

O **HelderLabs ERP** encontra-se **100% operacional, consolidado e publicado em produção na Vercel**, ligado à base de dados PostgreSQL Cloud da **Neon DB**.

- ✅ **Infraestrutura Unificada**: O código local (`C:\Users\helde\Desktop\Dev\helderlabs-erp`) e a produção online (`helderlabs.eu`) utilizam **a mesma base de dados online em tempo real**, permitindo testar localmente com os dados exatos de produção.
- ✅ **Super Admin Funcional**: O utilizador `helderguiomar@gmail.com` é auto-promovido a `SUPER_ADMIN` com acesso exclusivo à Consola de Gestão (`/super-admin.html`).
- ✅ **Interface Vercel Serverless**: Entrada Serverless nativa em `api/index.ts` executando o Fastify sem erros 404 ou de CORS.

---

## 🔐 2. ARQUITETURA REGISTADA DO FLUXO DE REGISTO E AUTENTICAÇÃO

Ficou assente e implementado rigorosamente no sistema o seguinte fluxo para novos utilizadores:

```
[ Novo Utilizador ]
        │
        ▼
1. POST /api/auth/check-email ──► Sistema identifica email inexistente ou sem password
        │
        ▼
2. Envio de Código OTP ────────► Código de 6 dígitos enviado por email via Resend API (ou 123456 em dev)
        │
        ▼
3. POST /api/auth/verify-otp ──► Validação do código de 6 dígitos
        │
        ├────────────────────────────────────────────────────────┐
        ▼                                                        ▼
4. Dupla Confirmação de Password                    5. Registo na BD
   - Campo 1: Nova Password                           - Estado: PENDING_APPROVAL
   - Campo 2: Confirmar Nova Password                 - Cifragem: bcrypt (10 rounds)
   - Validação JS & Backend de igualdade                     │
        │                                                        ▼
        └──────────────────────────────────────────► 6. Aguarda Aprovação
                                                        - Notificação no ecran de login
                                                        - Acesso bloqueado a /app.html
                                                        - Aprovação exclusiva por Super Admin
                                                          (helderguiomar@gmail.com)
```

---

## 🔍 3. AUDITORIA DETALHADA E SUGESTÕES DE MELHORIA POR MÓDULO

---

### 👑 MÓDULO 1: Platform Core & Super Admin Console (`/super-admin.html`)

#### Estado Atual:
- Painel escuro de alto desempenho com navegação por abas (**Gestão de Empresas**, **Aplicativos & Módulos**, **Utilizadores Online**, **Monitorização**, **Perfis e Permissões**).
- Gestão de Tenants fictícios e reais (Consultoria Alfa, Administra Condo, StartUp Inovação, HelderLabs Platform System).
- Sistema de **Módulos como Aplicativos** (`ApplicationInstance` e `ApplicationAssignment`) permitindo ao Super Admin ativar/desativar módulos e atribuir licenças por empresa.

#### 💡 Sugestões de Melhoria Recomendadas:
1. **Aprovação de Utilizadores em 1-Clique na UI**: Adicionar um botão de ação rápida "Aprovar Utilizador" na tabela da aba *Utilizadores* do Super Admin, permitindo associar o tenant diretamente na janela modal.
2. **Dashboard de Consumo da Plataforma**: Adicionar gráficos de chamadas de API por tenant e consumo de armazenamento da BD em tempo real.
3. **Audit Trail Global**: Registar no modelo `AuditLog` todas as alterações de perfil ou alteração de estado efectuadas pelo Super Admin.

---

### 💼 MÓDULO 2: CRM & Gestão Comercial (`/api/crm`)

#### Estado Atual:
- Ciclo de vendas completo com modelos `Lead`, `Opportunity` e `Customer`.
- **CRUD Completo**: `POST`, `GET`, `PUT` e `DELETE` ativados em `/api/crm/leads`.
- Transição de estados: Qualificação de Lead ➔ Oportunidade ➔ Fecho Ganho (`WON`) com migração automática para Cliente.
- Dashboard Comercial Avançado com cálculo do Pipeline, Receita Esperada, Taxa de Conversão e Leads por Origem.

#### 💡 Sugestões de Melhoria Recomendadas:
1. **Kanban Visual de Oportunidades**: Adicionar drag-and-drop no frontend para mover oportunidades entre fases (*Diagnóstico*, *Proposta*, *Negociação*, *Ganho*).
2. **Notificações por Email de Novas Leads**: Integrar com a Resend API para enviar um email automático ao responsável comercial quando uma nova Lead for submetida via formulário público.
3. **Histórico de Interações**: Criar o submódulo `LeadActivity` para registar chamadas, reuniões e notas associadas a cada cliente.

---

### 🏢 MÓDULO 3: Gestão de Condomínios (`/api/condominios`)

#### Estado Atual:
- Estrutura hierárquica baseada nos modelos `Building` (Edifícios) e `Unit` (Frações).
- **CRUD Completo**: Suporte a criar, listar, editar e eliminar Edifícios (`/buildings`) e Frações (`/units`).
- Isolamento multi-tenant transitivo: Frações só podem ser geridas se o Edifício pertencer ao tenant autenticado.

#### 💡 Sugestões de Melhoria Recomendadas:
1. **Emissão de Avisos de Cobrança / Recibos PDF**: Gerar documentos PDF automáticos de recibos de quotas para cada fração com cálculo de permilagem.
2. **Gestão de Ocorrências / Manutenção**: Criar o modelo `Incidence` para os condóminos reportarem avarias em zonas comuns (ex.: elevadores, portões).
3. **Portal do Condómino**: Criar uma vista simplificada em `/app.html` onde os proprietários consigam consultar as suas quotas pendentes e atas de assembleia.

---

### 💳 MÓDULO 4: Finanças & Faturação (`/api/finance`)

#### Estado Atual:
- Estrutura preparada no modelo `ApplicationInstance` com módulo `FINANCE` disponível para ativação em regime de *Trial* ou *Active*.

#### 💡 Sugestões de Melhoria Recomendadas:
1. **Integração com Gateway de Pagamentos (Stripe / MB WAY)**: Permitir a liquidação direta de faturas/quotas online.
2. **Exportação de SAF-T (PT)**: Implementar a geração de ficheiro XML SAF-T compatível com a Autoridade Tributária portuguesa.
3. **Plano de Contas SNC**: Mapeamento de receitas, despesas e centros de custo por empresa.

---

### 🛡️ MÓDULO 5: Autenticação & Segurança (`/api/auth`)

#### Estado Atual:
- **Resend API Integration**: Envio de códigos de 6 dígitos via email.
- **Cifragem Criptográfica**: Passwords cifradas com `bcrypt` (10 rounds) e suporte a tokens JWT com expiração configurável (`8h`).
- **Suporte a OAuth 2.0 PKCE**: Endpoints e testes automatizados configurados para fluxos federados.
- **Dupla Confirmação no Frontend**: Ecrã `login.html` atualizado com dois campos de password e validação de igualdade.

#### 💡 Sugestões de Melhoria Recomendadas:
1. **Autenticação Multi-Fator (MFA/TOTP)**: Permitir ativar Google Authenticator / Authy para contas de administrador.
2. **Rate Limiting por IP**: Adicionar o plugin `@fastify/rate-limit` nos endpoints `/send-otp` e `/login` para prevenir ataques de força bruta.
3. **Sessões Ativas**: Permitir ao utilizador terminar sessões noutros dispositivos no painel de perfil.

---

## 📋 4. SÍNTESE DA ARQUITETURA DE PRODUÇÃO

```
   ┌─────────────────────────────────────────────────────────┐
   │                   HELDERLABS ERP                        │
   │           https://helderlabs.eu (Vercel)                │
   └────────────────────────────┬────────────────────────────┘
                                │
          ┌─────────────────────┴─────────────────────┐
          ▼                                           ▼
┌──────────────────┐                        ┌──────────────────┐
│  Serverless API  │                        │ PostgreSQL Cloud │
│ (api/index.ts)   │                        │   (Neon DB)      │
└─────────┬────────┘                        └─────────┬────────┘
          │                                           │
          ├────────► Resend (Emails OTP)              │
          │                                           │
          └────────► Multi-Tenant Isolation ──────────┘
```
