# CHANGELOG — HELDERLABS ERP

Todas as alterações notáveis do repositório unificado **HELDERLABS ERP** são registadas neste ficheiro.

## [v1.6.7] - 2026-10-09

### CRM Fase B7 — Conta Corrente de Clientes, Extrato Progressivo, Alocação de Pagamentos e Análise de Antiguidade (Aging)
- **Salvaguarda Legal & Regulamentar Inviolável**:
  - Implementação do aviso estrito e omnipresente: *"Registo de documentos emitidos no seu software de faturação certificado. O HelderLabs CRM não emite faturas nem serve de documento fiscal."*
  - Exclusão expressa e estrutural de qualquer campo de natureza tributária (como ATCUD, hash de faturação certificado ou QR Code da AT).
- **Imutabilidade Contabilística Estrita (Garantida por Triggers PostgreSQL)**:
  - Criação dos modelos `CrmAccountEntry` e `CrmAccountAllocation` imutáveis.
  - Proibição estrita de operações `DELETE` e bloqueio de `UPDATE` sobre atributos estruturais (`amountCents`, `type`, `entryDate`, `companyId`, `tenantId`).
  - Correção de enganos exclusivamente através de lançamentos de estorno (`REVERSAL`), que referenciam o lançamento original via `reversesEntryId`, anulam o seu impacto no saldo devedor e cancelam as alocações ativas ligadas.
- **Precisão Monetária em Cêntimos Inteiros & Tipos Tipificados**:
  - Todos os valores monetários são geridos como inteiros em cêntimos (`amountCents`).
  - Débitos (+ dívida): `INVOICE`, `DEBIT_NOTE`, `REFUND`, `OPENING_BALANCE` e estornos de pagamentos.
  - Créditos (- dívida): `PAYMENT`, `CREDIT_NOTE` e estornos de faturas.
  - Validação estrita: `INVOICE`, `DEBIT_NOTE` e `CREDIT_NOTE` exigem o preenchimento obrigatório do número de documento externo emitido no software de faturação certificado.
- **Motor de Alocações (Manual & FIFO Automático)**:
  - Suporte a alocações parciais ou integrais de pagamentos a documentos pendentes.
  - Proteção do servidor contra sobre-alocação (>100% do saldo do documento ou do pagamento).
  - Alocação automática opcional com método FIFO liquidando documentos a débito da antiguidade mais recuada para a mais recente.
- **Extrato de Conta Corrente Progressivo & Antiguidade da Dívida (Aging)**:
  - Extrato dinâmico linha a linha com cálculo de débito, crédito, saldo acumulado progressivo, estado liquidado/pendente e saldo vencido.
  - Análise de antiguidade (Aging) em 5 escalões: Corrente (não vencido), 1–30 dias, 31–60 dias, 61–90 dias, e >90 dias (crítico).
- **Impressão A4 & Envio por Email pelo Tenant**:
  - Endpoint `GET /api/crm/companies/:id/account/statement/print` com folha de estilo A4 profissional pronta a imprimir.
  - Endpoint `POST /api/crm/companies/:id/account/statement/send` com envio através do `TenantMailService` (`context: 'crm.statement'`) e registo automático de atividade comercial na cronologia do cliente.
- **Interface Web & Ficha 360º Integrada**:
  - Nova sub-vista *Conta Corrente* na barra de sub-navegação do CRM (`crm-account.js`).
  - Separador *Conta Corrente* perfeitamente integrado na Ficha 360º de Empresa em `crm-companies.js`.
  - Modais para novo lançamento, estorno justificado, alocação de recebimento e expedição de extrato.
- **Modelo de Dados (Migração `20261009070000_crm_b7_account_entries`)**:
  - Tabelas `crm_account_entries` e `crm_account_allocations` com chaves estrangeiras `ON DELETE RESTRICT` e triggers de integridade `trg_crm_account_entry_guard` e `trg_crm_account_alloc_guard`.
  - Adicionado `CrmAccountEntry` e `CrmAccountAllocation` a `TENANT_SCOPED_MODELS` para isolamento integral na camada de dados.
- **Testes Automatizados**: Suite `tests/crm/crm-b7-account-entries.test.ts` com 8 testes novos (68 testes CRM no total, 95 testes conjuntos no repositório com 100% de aprovação).

## [v1.6.6] - 2026-10-09

### CRM Fase B6 — Gestão de Documentos do Cliente, Upload, Controlo de Validades & Conformidade
- **Dossier Digital & Tipos Padronizados de Documentos**:
  - Suporte empresarial para Certidão Permanente (`CERTIDAO_PERMANENTE`), Registo Central do Beneficiário Efetivo (`RCBE`), Cartão de NIF / Identificação Fiscal (`DECLARACAO_NIF`), Procurações (`PROCURACAO`), Alvarás e Licenças Profissionais (`ALVARA_LICENCA`), Seguros de Responsabilidade Civil (`SEGURO_RC`), Certidões de Não Dívida às Finanças/AT (`NON_DEBT_AT`) e Segurança Social (`NON_DEBT_SS`), Contratos Assinados (`CONTRATO_ASSINADO`), Acordos de Confidencialidade (`NDA_CONFIDENCIALIDADE`), Comprovativos de IBAN (`COMPROVATIVO_IBAN`), Consentimentos RGPD (`RGPD_CONSENTIMENTO`) e outros anexos.
- **Códigos de Acesso Online**: Suporte a códigos de acesso de certidões (ex: Registo Comercial `XXXX-XXXX-XXXX`) com botão de cópia rápida para a área de transferência (`copyAccessCode`).
- **Motor de Validades & Alertas Preventivos de Caducidade**:
  - Cálculo dinâmico em tempo real de `daysUntilExpiry` e estado (`VALID`, `EXPIRING_SOON`, `EXPIRED`, `PERMANENT`).
  - Sinalização visual com badges distintos e banners de aviso em clientes com documentos expirados ou a caducar nos próximos 30 dias.
- **Auditoria de Conformidade & Verificação**:
  - Fluxo formal de aprovação/rejeição de documentos (`PATCH /api/crm/documents/:id/verify`) com estado `VERIFIED` ou `REJECTED`, captura de notas de validação, utilizador validador (`verifiedBy`) e carimbo temporal (`verifiedAt`).
  - Registo automático de atividades no histórico 360º de cada cliente em todas as mutações de documentos.
- **Upload Seguro e Gestão de Anexos**:
  - Modal de upload com suporte a seleção de ficheiros locais (PDF e imagens até 8MB) convertidos para Data URI base64, ou ligação para URLs externos.
- **Interface e Navegação do CRM**:
  - Nova sub-vista *Documentos & Validades* no painel CRM com cartões de KPIs (Total, Válidos, A Caducar, Caducados, Por Verificar), barra de pesquisa e filtros por tipo e estado.
  - Separador *Documentos* completamente renovado na Ficha 360º de Empresa com badges enriquecidos, alerta de caducidade e botão direto `+ Adicionar Documento`.
  - Modais modulares `#modal-upload-document` e `#modal-verify-document`.
- **Modelo de Dados (Migração `20261009060000_crm_b6_documents`)**:
  - Expansão do modelo `CompanyDocument` com colunas `tenantId`, `fileName`, `fileSizeBytes`, `mimeType`, `accessCode`, `verificationStatus`, `verifiedBy`, `verifiedAt`, `notes`, `updatedAt`.
  - Índices dedicados para `tenantId`, `companyId`, `status` e `expiryDate`.
  - Adicionado `'CompanyDocument'` a `TENANT_SCOPED_MODELS` para isolamento rigoroso na camada de dados.
- **Testes Automatizados**: Suite `tests/crm/crm-b6-documents.test.ts` com 8 novos testes unitários e de integração (60 testes CRM no total, 87 testes conjuntos com 100% de aprovação).

## [v1.6.5] - 2026-10-09

### CRM Fase B5 — Gestão de Contratos de Avença, SLA e Renovações Automáticas
- **Gestão de Avenças e Subscrições**: Contratos com numeração sequencial estruturada (`CTR-YYYY-XXXX`), associação a empresa e proposta adjudicada, data de início, data de término ou tempo indeterminado (`isIndefinite`), periocidade de faturação (`MONTHLY`, `QUARTERLY`, `SEMIANNUAL`, `ANNUAL`, `ONE_OFF`).
- **Métricas e Previsão de Receita Recorrente (MRR & ARR)**: Cálculo em tempo real de Monthly Recurring Revenue (MRR) e Annual Recurring Revenue (ARR) com base na periocidade contratada, contagem de avenças ativas e controlo de renovações.
- **Níveis de Serviço (SLA) & Alertas de Expiração**: Suporte a níveis de SLA (Standard, Bronze, Silver, Gold, Platinum, Custom) com horas garantidas de primeira resposta e resolução. Monitorização de expirações iminentes (30, 60, 90 dias) e contratos em formalização.
- **Ciclo de Vida & Renovações Automáticas**:
  - Ação de Renovação (`PATCH /api/crm/contracts/:id/renew`) com extensão de vigência (ex: +12 meses), atualização percentual de preço por inflação/IPC, carimbo de `lastRenewedAt` e registo automático de atividade comercial.
  - Ação de Rescisão/Cancelamento (`PATCH /api/crm/contracts/:id/terminate`) com captura obrigatória de motivo e data de efeito.
- **Documento Resumo & Salvaguarda Legal Inviolável**: Rota `GET /api/crm/contracts/:id/summary` com visualização e impressão A4 contendo o aviso legal obrigatório: *"Resumo de Contrato Comercial de Prestação de Serviços / Avença. Não serve de fatura nem de documento de quitação fiscal."*
- **Interface Modular e Ficha 360º**:
  - Nova sub-vista *Contratos & Avenças* no painel CRM com KPIs de MRR/ARR e filtros avançados.
  - Separador *Contratos* renovado na Ficha 360º de Empresa com listagem de avenças, SLAs e botão direto de novo contrato.
  - Modais `#modal-create-contract`, `#modal-renew-contract` e `#modal-terminate-contract`.
- **Modelo de Dados (Migração `20261009050000_crm_b5_contracts`)**:
  - Extensão do modelo `Contract` com colunas aditivas `proposalId`, `isIndefinite`, `monthlyValueCents`, `slaLevel`, `slaResponseHours`, `slaResolutionHours`, `renewalNoticeDays`, `lastRenewedAt`, `cancelledAt`, `cancellationReason`, `termsAndConditions`, `notes`.
  - Índices otimizados por `tenantId`, `contractNumber`, `proposalId`, `endDate` e `deletedAt`.
- **Auditoria Transversal**: Ações `CREATE_CONTRACT`, `UPDATE_CONTRACT`, `RENEW_CONTRACT`, `CANCEL_CONTRACT` e `DELETE_CONTRACT` auditadas no sistema transversal.
- **Testes Automatizados**: Suite `tests/crm/crm-b5-contracts.test.ts` com 8 novos testes unitários e de integração (52 testes CRM no total, 79 testes conjuntos com 100% de aprovação).

## [v1.6.4] - 2026-10-09

### CRM Fase B4 — Propostas Comerciais, Orçamentos com Impressão A4/PDF e Envio por Email do Tenant
- **Motor de Orçamentação e Propostas**: Criação de propostas comerciais completas com numeração sequencial única (`PROP-YYYY-XXXX`), associação a empresa, contacto e oportunidade, data de emissão, validade, notas e condições de fornecimento.
- **Grelha Dinâmica de Linhas e Precisão Monetária**: Suporte a múltiplas linhas de serviço/artigo com descrição, quantidade, preço unitário em cêntimos (`unitPriceCents`), desconto percentual (`discountPercent`), taxa de IVA configurável (23%, 13%, 6%, 0%), com recálculo em tempo real de subtotais, valor do IVA e total geral.
- **Salvaguarda Legal Inviolável**: Inclusão mandatória do aviso legal *"Orçamento Comercial / Proposta de Honorários. Não serve de fatura nem de documento de quitação fiscal."* em todos os ecrãs, emails e impressões A4.
- **Página de Impressão A4 / Exportação PDF**: Endpoint dedicado `GET /api/crm/proposals/:id/print` com folha de estilo de impressão A4 limpa, logotipo, dados fiscais, linhas detalhadas e acionamento nativo `window.print()` sem dependências pesadas de headless browser.
- **Envio por Email Integrado com o Tenant**: Endpoint `POST /api/crm/proposals/:id/send` com envio HTML formatado através do `TenantMailService` (SMTP do próprio tenant ou plataforma), transição de estado para `SENT` e registo automático de atividade comercial `Communication` (`email`).
- **Sincronização com Pipeline de Vendas**: Ao aprovar a proposta (`ACCEPTED`), a oportunidade comercial associada é automaticamente convertida em `WON` (ganha), qualificando o cliente.
- **Interface e Ficha 360º Integrada**:
  - Nova sub-vista *Propostas & Orçamentos* no painel CRM com KPIs em tempo real (Volume Orçamentado, Volume Aceite, Rascunhos) e filtros avançados.
  - Novo separador *Orçamentos & Propostas* na Ficha 360º de Empresa com listagem de propostas e botão direto de nova proposta.
  - Modais modulares `#modal-create-proposal` e `#modal-send-proposal` com linhas dinâmicas recalculadas em tempo real.
- **Modelo de Dados (Migração `20261009040000_crm_b4_proposals`)**:
  - Enum `ProposalStatus` (`DRAFT`, `SENT`, `ACCEPTED`, `REJECTED`, `EXPIRED`).
  - Modelos `Proposal` e `ProposalItem` com RLS multi-tenant, soft-delete (`deletedAt`) e índices otimizados.
  - Adicionado `'Proposal'` a `TENANT_SCOPED_MODELS`.
- **Auditoria Transversal**: Ações `CREATE_PROPOSAL`, `UPDATE_PROPOSAL`, `UPDATE_PROPOSAL_STATUS`, `SEND_PROPOSAL` e `DELETE_PROPOSAL` auditadas no sistema transversal.
- **Testes Automatizados**: Suite `tests/crm/crm-b4-proposals.test.ts` com 6 novos testes unitários e de integração (44 testes CRM no total, 71 testes conjuntos com 100% de aprovação).

## [v1.6.3] - 2026-10-09

### CRM Fase B3 — Atividades Comerciais, Histórico 360º e Follow-ups
- **Histórico Comercial Unificado & Tipos de Atividades**: Registo de tarefas (`task`), chamadas telefónicas (`call`), reuniões (`meeting`), emails (`email`), notas comerciais (`note`) e mensagens WhatsApp (`whatsapp`).
- **Gestão de Follow-ups e Alerta de Atraso**: Deteção automática e contadores em tempo real de tarefas pendentes, atrasadas (`dueDate < now`), agendadas para hoje e próximas, com sinalização visual de alerta.
- **Timeline Cronológica 360º**:
  - Nova sub-vista *Atividades & Follow-ups* no painel CRM com filtros por estado, tipo e atraso.
  - Integração da Timeline na Ficha 360º de Empresa (`#company-detail-modal`) no separador *Atividades & Histórico*, permitindo consulta e registo de novas ações diretamente na empresa.
  - Integração do separador *Oportunidades* na Ficha 360º com tabela de negócios associados.
- **Ações Rápidas de Produtividade**: Conclusão de atividades com 1 clique (`PATCH /api/crm/activities/:id/complete`) com apêndice opcional de notas de conclusão, e exclusão com soft-delete (`DELETE /api/crm/activities/:id`).
- **Modelo de Dados (Migração `20261009030000_crm_b3_activities`)**:
  - Extensão do modelo `Communication` com colunas `companyId`, `contactId`, `opportunityId`, `status`, `dueDate`, `completedAt` e `priority`.
  - Índices dedicados para `companyId`, `contactId`, `opportunityId`, `status`, `dueDate` e `deletedAt`.
  - Relações bidirecionais com `Company`, `CompanyContact` e `Opportunity`.
- **Auditoria Transversal**: Ações `CREATE_ACTIVITY`, `COMPLETE_ACTIVITY`, `UPDATE_ACTIVITY` e `DELETE_ACTIVITY` auditadas com SHA-256 no módulo CRM.
- **Testes Automatizados**: Suite `tests/crm/crm-b3-activities.test.ts` com 6 novos testes unitários e de integração (38 testes CRM no total, 65 testes com 100% de aprovação conjunta com o módulo de email).

## [v1.6.2] - 2026-10-09

### CRM Fase B2 — Pipeline Comercial, Funil de Vendas (Kanban) e Oportunidades
- **Visualização Kanban Interativa**: Quadro com 5 colunas (`QUALIFICATION`, `PROPOSAL`, `NEGOTIATION`, `WON`, `LOST`), cada uma com contagem de cartões, valor total e cálculo de valor ponderado (`estimatedValue * (probability / 100)`).
- **Previsão de Receita Ponderada (Forecast)**: Resumo em tempo real no topo com Pipeline Global, Receita Ponderada, Negócios Ganhos e Taxa de Conversão.
- **Transições de Estágio Automatizadas**: Transição via `PATCH /api/crm/opportunities/:id/stage`.
  - Ao mover para `WON`: define probabilidade para 100%, converte a empresa para estado `CUSTOMER`, marca a lead como `CONVERTED`, cria registo em `Customer` e audita `crm.opportunity.won`.
  - Ao mover para `LOST`: define probabilidade para 0%, captura e grava motivo de perda (`lostReason`), abrindo modal informativo.
- **Sub-navegação no Painel CRM**: Alternância fluida entre *Empresas 360º*, *Pipeline & Funil Kanban* e *Leads & Prospeção* sem recarregar a página.
- **Gestão de Leads & Conversão**: Caderno de prospeção com conversão imediata de lead em Oportunidade Comercial (`POST /api/crm/leads/:id/convert`), com criação e sincronização automática da empresa no Diretório 360º.
- **Modelo de Dados (Migração `20261009020000_crm_b2_pipeline`)**: Adicionados campos aditivos `companyId`, `contactId`, `expectedCloseDate`, `lostReason` e `notes` no modelo `Opportunity`.
- **Soft Delete em Oportunidades**: `deletedAt` registado em `deleteOpportunity`.
- **Testes Automatizados**: Suite `tests/crm/crm-b2-pipeline.test.ts` com 8 novos testes unitários e de integração (32 testes CRM no total, 59 testes conjuntos com Mail).

## [v1.6.1] - 2026-10-09

### CRM Fase B1 — Fundações, Segurança e Isolamento Multi-tenant
- **Isolamento de Tenant em Filhos**: Verificação rigorosa de pertença (`assertCompanyOwned`, `assertChildOwned`) em todos os sub-recursos (contactos, moradas, documentos, contratos e relações), devolvendo 404 estrito (`NOT_FOUND`) em caso de ID pertencente a outro tenant.
- **Prevenção XSS**: Modularização de frontend em `crm/crm-core.js`, `crm/crm-companies.js`, `crm/crm-contacts.js` e fachada `crm.js`, com sanitização sistemática via `esc()` para interpolação segura de strings em HTML.
- **Validação de NIF e Telefone**: Algoritmo Módulo 11 para NIFs portugueses (empresas e individuais, com ou sem prefixo `PT`) e normalização E.164 para números telefónicos (+351 por omissão).
- **Deteção de Duplicados**: Verificação preventiva de NIF/email no mesmo tenant com resposta `409 Conflict` e payload `{ existingCompanyId }`; suporte a `force: true` com auditoria transversal `crm.company.force_create`.
- **Soft Delete**: Preservação de integridade referencial com coluna `deletedAt` em `CompanyRelation` e marcação em `deleteLead`, sem perda física de registos.
- **Perfil de Decisão (`decisionPower`)**: Enum `DecisionPower` (`DECISOR`, `INFLUENCIADOR`, `UTILIZADOR`, `OUTRO`) persistido e editável nos contactos de empresas.
- **Paginação e Métricas no Servidor**: Paginação por cursor (`limit`, `cursor`, `nextCursor`) e filtros avançados (`status`, `search`, `sector`, `ownerUserId`), além de agregação de métricas via `groupBy` em `GET /api/crm/companies/metrics`.
- **Cache-busting**: Inclusão de `crm.css?v=1.6.1` e scripts modulares com `?v=1.6.1` em `app.html`.
- **Testes**: Suite `tests/crm/crm-b1-security.test.ts` com 13 novos testes cobrindo isolamento, validações, duplicados, permissões e XSS.

## [v1.6.0] - 2026-10-08

### Envio de email configurável por tenant
- **Definições de email por empresa** (`app.html` → separador *Email*, visível só para dono/administrador do tenant): remetente da plataforma (Resend, `helderlabs.eu`) ou email próprio por SMTP (Gmail com password de aplicação, ou qualquer servidor SMTP).
- **Credenciais cifradas**: password SMTP guardada com AES-256-GCM (chave `EMAIL_CREDENTIALS_KEY`, tenantId como dados autenticados); nunca devolvida ao cliente nem escrita na auditoria.
- **Proteções**: guarda contra servidores SMTP internos (SSRF) com ligação ao IP resolvido; STARTTLS obrigatório em 587/2525; reintrodução obrigatória da password ao mudar servidor/porta/utilizador; limite diário de envios por tenant; validação contra injeção de cabeçalhos.
- **Registo de envios** (`email_send_logs`): cada tentativa fica registada como SENT, FAILED ou BLOCKED_LIMIT.
- **API**: `GET /api/tenant/email/status`, `GET|PUT /api/tenant/email/settings`, `POST /api/tenant/email/test`, `GET /api/tenant/email/logs`.
- **Serviço reutilizável** `TenantMailService.send()` para os módulos (propostas do CRM a seguir), com suporte a anexos no modo SMTP.
- **Migração** `20261008120000_tenant_email_settings` (apenas aditiva, com RLS).
- **Testes**: 27 novos testes (cifra, guarda SMTP, definições, envio, limite diário, isolamento, protocolo SMTP real com STARTTLS, rotas e permissões).

## [v1.4.0] - 2026-09-12

### ✉️ Infraestrutura Central de Email Transacional & Domínio
- **Verificação de Domínio no Resend**: Domínio `helderlabs.eu` com registos DKIM (`resend._domainkey`), SPF (`send`), MX (`send`) e DMARC (`_dmarc`) verificados e operacionais.
- **Motor Centralizado `EmailService`**: Unificação transversal de todos os envios de email da plataforma (autenticação, validação de email, OTP, magic link, password reset, welcome, convites, licenciamento, faturação e segurança).
- **Segurança & Idempotência**: Idempotência garantida com hashes SHA-256 de 64 caracteres, rate limiting por destinatário, sanitização e escape estrito de HTML e suporte bilingue (PT/EN).
- **Prova de Entrega Externa**: Validação com entrega confirmada (`last_event: delivered`) para destinatário externo fora do domínio da conta.

## [v1.3.0] - 2026-09-12

### 📱 HCCALL Móvel & Estabilização de Performance
- **Modo Móvel HCCALL**: Layout responsivo otimizado para ecrãs táteis, navegação inferior contextual e tabelas adaptativas.
- **Cold Start & Conectividade**: Resolução do bloqueio 503 na Vercel através de verificações assíncronas e leves do PostgreSQL Neon.

## [v0.3.0] - 2026-09-06

### 💳 Módulo de Finanças & Pessoais
- **API Financeira Completa**: Implementadas as rotas `/api/financas/dashboard`, `/categories`, `/transactions`, `/recurring`, `/loans` e `/export` (CSV).
- **Gestão & Criador de Categorias**: Povoamento automático das 11 categorias padrão (*Vendas*, *Serviços*, *Habitação*, *Alimentação*, etc.) e nova interface para criação de categorias personalizadas (🟢 Receita / 🔴 Despesa).
- **Materialização de Recorrências**: Engine de cálculo de frequências (*WEEKLY*, *MONTHLY*, *QUARTERLY*, *YEARLY*) com tratamento idempotente.
- **Empréstimos & Dívidas**: Registo de empréstimos concedidos e obtidos com histórico de amortizações.

### 📋 Aprovações, Leads & RGPD
- **Consola Super Admin**: Novo separador `📋 Aprovações de Contas` com aprovação transacional em 1-clique (`POST /api/platform/account-requests/:id/approve`).
- **Registo Público & OTP**: `POST /api/public/register` com consentimento RGPD obrigatório e geração de código OTP cifrado com bcrypt.
- **Captura de Leads na Landing**: Integrado o formulário institucional (`index.html`) com o módulo CRM da plataforma.

### 🛡️ Resolução de Bugs & Entitlements
- **Normalização de Chaves (`requireApp`)**: Mapeamento transparente de aliases `'financas'` e `'finance'` nos guards de entitlement (`src/plugins/entitlements.ts`) e no router do frontend (`app.html`, `workspace.html`, `super-admin.html`).
- **Mensagem "Em Construção"**: Módulos ainda não desenvolvidos exibem o aviso explícito `🚧 Módulo [X] em construção`.
- **Tratamento de Erros de Conexão**: Restrito o erro 503 `DATABASE_UNAVAILABLE` em `src/app.ts` exclusivamente a erros de conectividade de rede (`P1xxx`).
- **Migração Neon Cloud DB**: Criada migração `20260906214800_full_schema_update` e ativada sincronização `prisma db push` no pipeline de build da Vercel (`vercel.json`).

---

## [v0.2.0] - 2026-09-06

### 🛡️ Fase 0: Correções Críticas de Segurança
- **Remoção de Endpoints Inseguros**: Eliminadas rotas `/demo-login` e `/demo-status`.
- **OTP Hashing & Expiração**: Códigos OTP agora cifrados com `bcrypt`, validade restrita a 15 minutos e máximo de 5 tentativas falhadas (`OtpCode`).
- **Dev Master OTP**: Código mestre `123456` estritamente restrito a desenvolvimento local (`ALLOW_DEV_MASTER_OTP=true` e `NODE_ENV !== 'production'`).
- **Segurança HTTP & Rate Limiting**: Adicionados `@fastify/helmet` (v11) para headers HTTP seguros (CSP, HSTS) e `@fastify/rate-limit` (v8) para mitigar força bruta.
- **Passwords Padrão Removidas**: Eliminadas passwords codificadas no código.

### 🗄️ Fase 1: Modelo de Dados & Schema Consolidados
- **Schema Prisma Expandido**:
  - `Module.key` como identificador único.
  - `ApplicationInstance` com campos `status`, `usageLimits`, `features`, `planKey`, `graceEndsAt`.
  - `TenantBranding` para personalização de marca por empresa (logotipo, cores primária/secundária).
  - `ImpersonationSession` para auditoria de sessões de suporte Super Admin.
  - `AuditLog` com campos `sequenceNum` e `hash` para integridade em cadeia.
  - `Tenant.entitlementsVersion` para controlo de versão e invalidação de cache.
  - Removida tabela obsoleta `TenantModule`.
- **Migração Não-Destrutiva**: Sincronizado com a Neon Cloud DB via `prisma db push` e `seed.ts` atualizado.

### 🔑 Fase 2: Entitlement Engine & Workspace Manifest
- **`EntitlementService`**: Implementada resolução em cascata (Tenant -> ApplicationInstance -> User Permissions).
- **Assinatura HMAC-SHA256**: Manifesto assinado com HMAC para validação no cliente.
- **Cache em Memória**: TTL de 60s com suporte a invalidação instantânea (`invalidateCache`).
- **Endpoint Manifest**: Criado `GET /api/me/workspace` devolvendo os cartões de apps ativas, permissões do utilizador e dados de branding.

### 🛡️ Fase 3: Backend Enforcement Guards
- **Guards de Fastify**: Criado `plugins/entitlements.ts` exportando `requireApp(moduleKey)` e `requirePermission(perm)`.
- **Proteção de Módulos**: Módulos `crm` e `condominios` protegidos com `requireApp`.
- **Public Lead Form**: Isolada a rota pública `POST /api/crm/public/leads` para recolha de contactos na Landing Page sem necessidade de token JWT.

### 🖥️ Fase 4: User Workspace Launcher & UI Shell
- **`workspace.html`**: Novo hub central de aplicativos e zona de administração do tenant. Inclui atalho global (`Ctrl+K`), visualização de limites de consumo, badges de estado e personalização visual via CSS Custom Properties.
- **Contratos de Módulo**: Criados `crm/module.manifest.ts` e `condominios/module.manifest.ts`.
- **Redirecionamento Pós-Login**: Atualizado `login.html` para redirecionar utilizadores autenticados para `/workspace.html`.

### 👑 Fase 5: Control Plane Super Admin & Impersonation Auditada
- **Endpoints de Impersonation**: Criados `POST /api/platform/impersonate` e `POST /api/platform/impersonate/end`.
- **Modo Só Leitura**: Sessões de suporte impõem `IMPERSONATION_READ_ONLY` para bloquear qualquer mutação na BD do cliente durante o suporte.
- **Aprovação em 1-Clique**: Criado `POST /api/platform/account-requests/:id/approve` para aprovação instantânea de registos pendentes.

### 📜 Fase 6: Audit Logging com Hash Chain (SHA-256)
- **`AuditService`**: Gravação sequencial de auditoria com cálculo de `hash = SHA256(tenantId + sequenceNum + previousHash + action + payload)`.
- **Integridade Detetável**: Função `verifyAuditChain(tenantId)` para validação de integridade criptográfica.

### 🧪 Fase 7 & 8: Testes Automatizados & Documentação
- **100% Testes Aprovados**: 44 testes unitários e de integração verdes (`npm test`).
- **Zero Erros TypeScript**: `npm run typecheck` estrito aprovado.
- **Documentação Atualizada**: `CLAUDE.md`, `docs/Architecture.md`, `docs/Security.md`, `docs/PRODUCTION_AUDIT_RECOMMENDATIONS.md` e `CHANGELOG.md` sincronizados.

---

## [v0.1.0] - 2026-08-23

### 📌 Versão Canónica Única & Consolidação de Repositório
- **Versão Canónica Única v0.1.0**: Estabelecida a diretoria `C:\Users\helde\Desktop\Dev\helderlabs-erp` como a única fonte canónica oficial de código para GitHub, Claude, Antigravity e ambiente local.
- **Base de Dados Online**: Vinculada a base de dados em nuvem Neon Cloud PostgreSQL via `DATABASE_URL` no `.env`.
- **Eliminação de Duplicados**: Auditados e removidos todos os diretórios obsoletos e cópias duplicadas nas drives C: e G: (`G:\O meu disco\01_HelderLabs\...` e `G:\O meu disco\01_HeldersLabs\...`).
- **Vinculação Git Remote**: Repositório Git local associado diretamente ao repositório remoto `https://github.com/helderguiomar-ux/Helderlabs.git`.

## [v1.0.0-consolidada] - 2026-08-23

### 🚀 Consolidação Unificada & Preparação para Produção
- **Adaptação Vercel Serverless**: Criado `api/index.ts` na raiz como entrada de Serverless Function nativa para a Vercel, permitindo a execução do Fastify sem dependência de um servidor HTTP escutando portas.
- **Configuração de Build Vercel**: Atualizado `vercel.json` com `buildCommand: "cd backend && npm install && npx prisma generate && npm run build"` e rewrites estáticos/API corrigidos para `/api/index`.
- **ErrorHandler Unificado & Zod**: Fundido o `setErrorHandler` em `backend/src/app.ts`. Validações Zod retornam `400 Bad Request` com mapa de erros, e indisponibilidade de BD retorna `503 Service Unavailable`.
- **CORS Dinâmico**: Adicionado suporte a `ALLOWED_ORIGINS` CSV configurável por ambiente (`https://helderlabs.eu`).

### 🔑 Autenticação, Resend & Super Admin
- **Integração API Resend**: Envio direto de emails transacionais com código de verificação OTP de 6 dígitos via `https://api.resend.com/emails` quando `RESEND_API_KEY` estiver definida.
- **Definição de Password**: Implementado o endpoint `/set-password` cifrando a palavra-passe com `bcrypt` (10 rounds) e guardando em `passwordHash` no PostgreSQL.
- **Auto-provisioning do Super Admin**: Garantido que o email `helderguiomar@gmail.com` é auto-promovido para `SUPER_ADMIN` no Tenant de Sistema `helderlabs-platform` sem bloqueios.
- **Gate de Aprovação (`PENDING_APPROVAL`)**: Novas contas registadas ficam no estado `PENDING_APPROVAL`, sendo impedidas de aceder a módulos do ERP (`/app.html`) até serem aprovadas e atribuídas a uma empresa (Tenant) pelo Super Admin.
