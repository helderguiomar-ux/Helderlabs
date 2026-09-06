# PROMPT DE EXECUÇÃO — Antigravity
## HelderLabs ERP · Aprovações · Leads da Landing → CRM HelderLabs · Módulo Finanças

> Substitui a secção 2 (decisão de arquitetura) de `docs/PROMPT_ANTIGRAVITY_FINANCAS.md`.
> As restantes secções desse documento — modelo de dados de finanças, recorrências, empréstimos, testes, RGPD — mantêm-se válidas e devem ser seguidas.

---

## 0. DECISÃO DE ARQUITETURA — FIXADA PELO HÉLDER

**Não existe `TenantType`. Não há alteração de schema para distinguir empresa de pessoa singular.**

Um `Tenant` é um tenant. Pode representar uma empresa ou uma pessoa singular — a diferença é apenas o que está preenchido em `TenantBranding` (`legalName`, `taxNumber`) e o nome que lhe é dado. Nenhum código deve ramificar em função disso.

**As Finanças Pessoais são um módulo igual ao CRM e aos Condomínios.** Licenciado por tenant, através de `ApplicationInstance`, com os mesmos estados, limites e guardas. Uma empresa que queira usá-lo para controlo de tesouraria simples licencia-o exatamente da mesma maneira. Não há `allowedTenantTypes`, não há validação de tipo, não há caso especial em lado nenhum.

Consequência prática que deves respeitar: **nada no módulo de finanças pode assumir que o tenant tem um só utilizador.** Usa sempre `tenantId` para isolamento, como qualquer outro módulo. Se dois utilizadores partilharem o tenant, partilham as finanças — e isso é o comportamento correto (conta familiar, ou departamento financeiro de uma empresa).

---

## 1. PRÉ-REQUISITO BLOQUEANTE

Antes de qualquer coisa nesta tarefa, corrigir três guardas que estão incompletas. Se construíres por cima delas, o que construíres nasce sem proteção:

1. **`requireApp` não está aplicado no CRM.** Está em `condominios.routes.ts:33` e em mais lado nenhum. Aplicar `app.requireApp('crm')` às rotas protegidas do CRM.
2. **Bug de escopo em `crm.routes.ts`.** Dentro de `app.register(async (protectedApp) => {...})`, as rotas `PUT /leads/:id` e `DELETE /leads/:id` foram registadas em `app` e não em `protectedApp` — ficam sem o hook de autenticação. Corrigir todas as ocorrências no ficheiro.
3. **`requirePermission` é um no-op.** Compara a permissão pedida com a lista declarada do módulo (`manifest.apps.some(a => a.permissions.includes(permission))`) em vez das permissões efetivas do utilizador. Qualquer utilizador de uma app licenciada passa em todas as verificações dessa app. Reescrever para resolver as permissões a partir do `roleInApp` do utilizador nessa `ApplicationInstance`.

Além disso, `authenticate.ts` lê `impersonationId` do JWT mas nunca carrega a `ImpersonationSession` da base de dados — não valida `endedAt` nem `expiresAt`. Terminar uma sessão de suporte não termina nada. Corrigir aqui.

`npm run verify` verde antes de avançar.

---

## 2. MÓDULO DE APROVAÇÕES — COMPLETAR

### 2.1 Estado atual

`ApplicationController.approveAccountRequest` existe mas está incompleto:

- Exige um `tenantId` que **já tenha de existir** — não cria tenant nenhum
- Não cria `TenantBranding`
- **Não licencia nenhuma app** — o utilizador aprovado entra num workspace vazio
- Não escreve no `AuditLog`
- Não é transacional: se falhar a meio, fica uma conta meio-criada
- Não envia email nenhum

### 2.2 Registo público

`POST /api/public/register` — sem autenticação, com rate limiting próprio (5 pedidos / 15 min por IP):

```
{
  name: string,
  email: string,
  phone?: string,
  companyName?: string,        // vazio = pessoa singular
  intendedModule?: string,     // "financas" | "crm" | ... — o que a pessoa veio procurar
  acceptedTerms: true,
  acceptedPrivacy: true
}
```

Comportamento:

1. Cria ou atualiza `AccountRequest` com `status: PENDING`
2. Grava `acceptedTermsAt`, `acceptedPrivacyAt` e a versão dos documentos aceites (campos novos — ver 2.6)
3. Envia OTP por email para provar posse do endereço
4. **Não cria `User` nem `Tenant`** — só na aprovação
5. Notifica o super admin: email + contador visível na consola

Após validação do OTP, o ecrã diz: *"Email confirmado. A sua conta aguarda aprovação. Receberá um email quando estiver ativa."* Sem prometer prazos.

Se o email já corresponder a um `User` ativo, responde exatamente da mesma forma — não reveles se a conta existe.

### 2.3 Aprovação — reescrever como transação única

`POST /api/platform/account-requests/:id/approve`

```
{
  mode: 'NEW_TENANT' | 'EXISTING_TENANT',
  tenantId?: string,              // obrigatório se EXISTING_TENANT
  tenantName?: string,            // obrigatório se NEW_TENANT
  role: UserRole,                 // default TENANT_OWNER em tenant novo, USER em existente
  modules: Array<{                // apps a licenciar de imediato
    moduleKey: string,
    plan?: string,
    status: ApplicationStatus,    // ACTIVE | TRIAL
    validUntil?: string
  }>,
  notes?: string
}
```

Dentro de **uma** `prisma.$transaction`:

1. Se `NEW_TENANT`: criar `Tenant` (slug único derivado do nome, com sufixo numérico em caso de colisão) e `TenantBranding` com defaults `pt-PT` / `EUR` / `Atlantic/Madeira`
2. Criar ou atualizar `User` — `status: ACTIVE`, ligado ao tenant, com o `role` indicado
3. Para cada módulo pedido: criar `ApplicationInstance` (respeitando `@@unique([tenantId, moduleId])`) e a `ApplicationAssignment` do utilizador com `roleInApp` adequado ao `role`
4. Executar o seed inicial de cada módulo licenciado, através de um `seed(tenantId)` opcional declarado no `module.manifest.ts` — é assim que as categorias de finanças aparecem sem que o controlador de aprovações saiba o que é uma categoria de finanças
5. `AccountRequest.status = 'APPROVED'`, com `approvedBy` e `approvedAt`
6. Incrementar `Tenant.entitlementsVersion`
7. Escrever no `AuditLog`: `action: 'account_request.approved'`, com o corpo do pedido em `newValue`
8. `EntitlementService.invalidateCache(tenantId)`

**Fora** da transação, depois do commit: enviar email de boas-vindas com link para definir password. Um falhanço de email não pode reverter a aprovação — regista-o no log e mostra na consola que o email ficou por enviar, com botão para reenviar.

Se qualquer passo da transação falhar, rollback completo e `500` com a causa. Uma conta meio-criada é pior do que nenhuma: a pessoa recebe o email e não consegue entrar.

### 2.4 Rejeição

`POST /api/platform/account-requests/:id/reject` — `{ reason: string (obrigatório), notifyUser: boolean }`. Auditado. `status: 'REJECTED'`.

### 2.5 Consola — aba "Aprovações"

Nova aba em `super-admin.html`, ou secção da aba de utilizadores:

- Lista de `AccountRequest` pendentes com: nome, email, telefone, empresa (ou "Pessoa singular"), módulo pretendido, **há quantos dias aguarda**, email verificado sim/não
- Badge com contador de pendentes, visível em todas as abas
- Botão **Aprovar** abre modal com: criar tenant novo (nome pré-preenchido) ou associar a tenant existente (pesquisa); papel; **lista de módulos com checkbox, plano e estado**; notas
- Botão **Rejeitar** abre modal com motivo obrigatório
- Filtros: pendentes / aprovados / rejeitados; pesquisa por nome e email

O modal de aprovação é onde decides o que a pessoa vai poder usar. Se não escolheres nenhum módulo, a conta é criada sem apps e o workspace fica vazio — o modal deve avisar disso antes de submeter.

### 2.6 Campos novos em `AccountRequest`

```prisma
model AccountRequest {
  // ... campos atuais ...
  name              String?
  phone             String?
  intendedModule    String?
  acceptedTermsAt   DateTime?
  acceptedPrivacyAt DateTime?
  termsVersion      String?
  privacyVersion    String?
  emailVerifiedAt   DateTime?
  approvedBy        String?
  approvedAt        DateTime?
  rejectedBy        String?
  rejectedAt        DateTime?
  rejectionReason   String?
}
```

---

## 3. LANDING → CRM DA HELDERLABS

### 3.1 O que já existe

`EnterpriseCRMService.createPublicLead()` já cria a `Lead` no tenant `helderlabs-platform`. Não reconstruas — corrige e estende.

### 3.2 Corrigir dois defeitos

**Fallback perigoso.** O código atual faz:

```ts
if (!platformTenant) platformTenant = await defaultPrismaClient.tenant.findFirst();
const tenantId = platformTenant ? platformTenant.id : 'helderlabs-platform';
```

Se o tenant com slug `helderlabs-platform` não for encontrado, a lead vai parar ao **primeiro tenant da tabela** — que pode ser o de um cliente. Um contacto comercial teu aterra no CRM de outra empresa. E o último fallback é uma string literal que nem sequer é um id válido, o que rebenta com erro de chave estrangeira.

Substituir por: procurar o tenant da plataforma pelo slug definido em `PLATFORM_TENANT_SLUG` (env, default `helderlabs-platform`); se não existir, **falhar com log de erro** e devolver `503` ao formulário com uma mensagem neutra. Perder uma lead é mau; entregá-la a outra empresa é pior.

**A mensagem é descartada.** O formulário tem `#lead-message` e o serviço não guarda o campo `message` em lado nenhum. Criar um registo `Communication` (`type: 'note'`, `subject: 'Mensagem do formulário'`, `content: message`) associado à lead. É o histórico da conversa e neste momento perde-se.

### 3.3 Criar a oportunidade

Ao submeter o formulário de diagnóstico, a seguir à `Lead`, criar uma `Opportunity` no mesmo tenant:

```ts
{
  tenantId: <tenant da plataforma>,
  leadId: <lead criada>,
  title: `${company || name} — Diagnóstico`,
  stage: 'QUALIFICATION',
  estimatedValue: 0,
  probability: 10,
  assignedUserId: <super admin>
}
```

E marcar `Lead.status = 'QUALIFICATION'` para não ficar dessincronizada da oportunidade.

Tornar isto configurável em `PlatformSetting`, chave `crm.landing.auto_create_opportunity`, default `true`:

- `true` — cada submissão gera lead **e** oportunidade
- `false` — gera só a lead; a oportunidade é criada ao qualificar, com um botão na UI

> **Nota técnica, para decidires com informação:** a prática habitual em CRM é criar Lead sempre e Oportunidade só na qualificação, porque um pipeline com uma oportunidade por cada formulário preenchido deixa de ser um instrumento de previsão — enche-se de ruído e a taxa de conversão perde significado. Como pediste a criação automática, é esse o default; a definição existe para poderes inverter sem alterar código, quando o volume de submissões justificar.

### 3.4 Notificação e resposta

- Email ao super admin com o conteúdo da submissão e link direto para a oportunidade
- Email automático de confirmação a quem submeteu (via Resend), sem prometer prazos
- Ambos falham em silêncio para o utilizador: uma falha de email nunca faz falhar a gravação da lead

### 3.5 Rota

Extrair a submissão pública para `POST /api/public/leads`, com rate limiting próprio, e deixar `POST /api/crm/leads` exclusivamente autenticado e atrás de `requireApp('crm')`. A rota atual mistura os dois caminhos no mesmo handler com um `try/catch` vazio à volta da autenticação — é frágil e impede aplicar o guard.

**Atualizar `index.html` no mesmo commit**, ou o formulário parte. Manter o `#lead-form` a funcionar exatamente como hoje do ponto de vista do visitante.

---

## 4. MÓDULO FINANÇAS — COMO QUALQUER OUTRO

Seguir `docs/PROMPT_ANTIGRAVITY_FINANCAS.md` secções 5 a 7 e 10 (modelo de dados, recorrências, empréstimos, endpoints, frontend, testes), com estas diferenças:

- **Sem `allowedTenantTypes`** no `module.manifest.ts` — foi removido da especificação
- **Sem validação de tipo de tenant** em `ApplicationController.create`
- O manifesto declara um `seed(tenantId)` que cria as categorias iniciais, chamado pelo fluxo de aprovação (ponto 2.3.4) e também ao licenciar o módulo a um tenant já existente

```ts
// backend/src/modules/financas/module.manifest.ts
export const manifest = {
  key: 'financas',
  name: 'Finanças',
  icon: 'wallet',
  color: '#22c55e',
  routePrefix: '/api/financas',
  frontendEntry: '/app.html#/financas',
  permissions: ['financas.read', 'financas.write', 'financas.export', 'financas.admin'],
  features: ['orcamento', 'emprestimos', 'relatorios'],
  defaultLimits: { transacoes_por_mes: 500 },
  seed: seedFinancas
};
```

Recordar os quatro defeitos do protótipo da Lovable que **não** podem ser repetidos, e que estão detalhados na secção 4 desse documento: valores monetários em vírgula flutuante; recorrências que só contam no mês em que são criadas; saldo calculado como acumulado histórico; empréstimos guardados como despesas.

---

## 5. TESTES

**Aprovação:**
- aprovar com `NEW_TENANT` cria tenant + branding + user + entitlements + assignments + seed do módulo, tudo numa transação
- falha simulada no passo 4 faz rollback total — nenhum registo sobrevive
- aprovar com `EXISTING_TENANT` não cria tenant novo e não duplica `ApplicationInstance`
- slug em colisão recebe sufixo e não rebenta
- falha de envio de email não reverte a aprovação
- aprovar duas vezes o mesmo pedido não duplica nada

**Registo:**
- email já registado devolve a mesma resposta que um email novo
- 6.ª tentativa em 15 minutos devolve `429`
- sem `acceptedTerms` devolve `400`

**Leads:**
- submissão pública cria Lead + Opportunity + Communication no tenant da plataforma
- com `crm.landing.auto_create_opportunity = false`, cria só a Lead
- **se o tenant da plataforma não existir, devolve `503` e não escreve em nenhum outro tenant** — este teste é o que impede o bug do fallback de voltar
- a mensagem do formulário fica gravada e é legível na oportunidade

**Finanças:** os da secção 10 do documento anterior, sem os relativos a tipo de tenant.

---

## 6. ORDEM DE EXECUÇÃO

```
1. Pré-requisito: requireApp no CRM, escopo das rotas, requirePermission, ImpersonationSession
2. Campos novos em AccountRequest + migração
3. POST /api/public/register + OTP + rate limiting
4. Aprovação transacional + seed por manifesto + auditoria + emails
5. Aba de Aprovações na consola
6. POST /api/public/leads + correção do fallback + Communication + Opportunity + PlatformSetting
7. Atualização do index.html (formulário de contacto + formulário de registo + i18n)
8. Módulo financas — modelo de dados e RecurrenceService (com testes antes da UI)
9. Endpoints de finanças + guards + auditoria
10. Frontend de finanças
11. Testes completos + verificação local + preview + relatório
```

`npm run verify` verde no fim de cada passo. Nada vai a produção sem passar pelo preview, conforme `docs/PROMPT_ANTIGRAVITY_AMBIENTES.md`.

Se alguma coisa nesta especificação se revelar errada durante a execução, **para e diz** — não contornes.
