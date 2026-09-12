# PROMPT — Deploy da v1.1.0 para produção
> Colar no Antigravity, raiz de `C:\Users\helde\Desktop\Dev\helderlabs-erp`.
> As correções de código **já estão escritas no repositório**. O teu papel nesta sessão é **validar, migrar e implantar** — não reescrever.

---

## MANDATO

Não és o autor destas alterações. És o responsável pelo deploy.

Isso significa três coisas:

1. **Não reescrevas o código entregue** sem reportar primeiro. Se algo não compila ou está errado, **para e diz o que é** — não "arranjes" em silêncio. Foi exatamente esse reflexo que, a 2026-09-11, levou alguém a resolver um alerta de integridade reescrevendo a cadeia de hashes em vez de corrigir a causa.
2. **Cada passo fecha com artefacto**: saída de comando com código de saída, resposta HTTP com estado e corpo, ou consulta SQL com resultado. Afirmação sem artefacto conta como falha.
3. **Se um passo falhar, paras.** Não avanças para o seguinte deixando o anterior a meio.

**Versão alvo: `1.1.0`.** Já está aplicada em `package.json` (raiz e backend), em `backend/src/version.ts` (fonte única) e propagada a `/api/health` e `/api/version`. Não a alteres.

---

## ESTADO DE PARTIDA

| | |
|:--|:--|
| Produção corre | `ddb240a` — **ainda com a backdoor `admin1234` ativa** |
| Repositório local | `f50cd1c` + alterações desta entrega, por commitar |
| Domínio Resend | `helderlabs.eu` em `not_started` — DNS por publicar |
| Versão | `1.0.0` → **`1.1.0`** |

Documento de referência das alterações: `Claude outputs/ENTREGA_CORRECOES_PARA_DEPLOY.md`.

---

## PASSO 1 · VALIDAÇÃO ESTÁTICA

```bash
cd backend
npx prisma generate
npm run typecheck
npm run lint
```

**Contexto que precisas de ter:** a verificação de tipos feita pelo autor correu **sem o cliente Prisma gerado** — `binaries.prisma.sh` está bloqueado no ambiente dele. A baseline era de 19 erros pré-existentes e ficou em 19 depois das alterações, mas **nomes de campos e modelos Prisma não foram validados**. É agora que são.

Se aparecerem erros nestes ficheiros, **são das alterações entregues** — reporta com a linha exata antes de tocar em nada:

```
src/routes/public.routes.ts
src/modules/auth/services/AuthService.ts
src/modules/auth/routes/auth.routes.ts
src/modules/platform/services/AuditService.ts
src/modules/platform/controllers/VersionController.ts
src/plugins/entitlements.ts
src/modules/hccall/controllers/HccallController.ts
src/modules/hccall/services/HccallObjectiveService.ts
src/modules/hccall/services/HccallDynamizationService.ts
src/modules/hccall/routes/hccall.routes.ts
src/config/modules.ts
src/version.ts
src/app.ts
```

Erros noutros ficheiros são pré-existentes — regista-os, não os corrijas neste deploy.

**Artefacto:** saída completa de `npm run typecheck` com código de saída.

---

## PASSO 2 · REMOÇÃO FÍSICA DO MÓDULO `finance` (decisão D1)

A rota e o import já foram removidos de `app.ts`. Falta apagar a pasta — o autor não tem permissão de eliminação na máquina.

```bash
git rm -r backend/src/modules/finance
npm run typecheck
```

O typecheck **tem de continuar limpo**: se acusar imports órfãos, alguma coisa ainda referencia o módulo — reporta.

**NÃO removas agora os modelos Prisma** `FinancialTransaction`, `FinancialAttachment`, `FinancialReport`, `BudgetItem`, `CashFlowProjection`, `BankReconciliation`. Ficam para uma migração própria, depois deste deploy estar verde, e só com `SELECT count(*) = 0` confirmado em cada um.

Atualiza `DIVIDA_TECNICA.md`: reconciliação bancária, SAF-T (PT) XML e importação OFX/QIF passam a constar como funcionalidades **por construir de raiz** — eram stubs, não são migrações pendentes.

**Artefacto:** `git status` e typecheck limpo.

---

## PASSO 3 · PRE-FLIGHT DA BASE DE DADOS (apenas leituras)

```bash
psql "$DATABASE_URL" -f backend/prisma/migrations/PREFLIGHT_audit_integrity.sql
```

Lê o resultado com atenção:

- **Secção 1** — registos com `hash` ou `prevHash` NULL. Qualquer valor > 0 faz a migração parar no passo 4.
- **Secção 2** — elos duplicados. Qualquer valor > 0 faz a migração parar no passo 5.
- **Secção 3** — é a que interessa tecnicamente: duplicados com **intervalo de milissegundos** são corrida de escrita concorrente; **intervalo longo** seria adulteração. É a prova que faltava sobre a natureza real do incidente de integridade.

Se as secções 1 ou 2 devolverem linhas: **para e apresenta ao Hélder**. Não apagues registos de auditoria para a migração passar — a saída correta é re-selar a partição afetada com `repairChain` (que agora deixa marca permanente) e reaplicar.

**Artefacto:** saída completa das cinco secções.

---

## PASSO 4 · MIGRAÇÃO

```bash
npx prisma migrate deploy
```

Migração: `20260912120000_onboarding_resilience_and_audit_integrity`.

Faz três coisas irreversíveis, por esta ordem: acrescenta os campos de entrega de email ao `AccountRequest`; cria `audit_chain_reseals` e marca retroativamente as 34 re-selagens de 2026-09-11 com origem `desconhecido`; torna `hash` e `prevHash` obrigatórios e cria o índice único do elo da cadeia sobre `COALESCE("tenantId",'__global__')`.

Se falhar, falhou **de propósito** e a mensagem diz porquê. Não contornes.

**Artefacto:** saída da migração + confirmação:

```sql
SELECT column_name, is_nullable FROM information_schema.columns
 WHERE table_name='audit_logs' AND column_name IN ('hash','prevHash','resealedAt');
SELECT indexname FROM pg_indexes WHERE tablename='audit_logs' AND indexname='audit_logs_chain_link_unique';
SELECT batchId, affectedCount, performedBy FROM audit_chain_reseals;
```

---

## PASSO 5 · TESTES

```bash
RESEND_API_KEY=test_key_presente npm test
```

**A variável tem de estar definida.** É o ponto central de todo este processo: a suite anterior corria sem ela, o `EmailService` devolvia sempre `{ ok: true, code: 'SIMULATED' }`, e o único caminho partido em produção era o único que os testes nunca percorriam.

Dois ficheiros novos:

- `tests/regression/onboarding-resilience.test.ts` — sete testes. O primeiro força o envio a falhar com a chave presente e verifica que o `AccountRequest` **existe na base de dados**.
- `tests/regression/audit-chain-concurrency.test.ts` — 50 escritas em paralelo com verificação de integridade, e a verificação de que `repairChain` exige motivo e deixa marca.

Se algum teste da suite antiga falhar por causa da nova política de password (12 caracteres, confirmações obrigatórias), **atualiza o teste, não a política** — e reporta quais.

**Artefacto:** saída do `npm test` com contagem de passes/falhas.

---

## PASSO 6 · COMMIT E DEPLOY

```bash
git add -A
git commit -m "release(v1.1.0): onboarding resiliente, fim da enumeração de contas, integridade real da cadeia de auditoria e CRUD do HCCALL

- AUTH-01: backdoor admin1234 removida (Bloco 0)
- AUTH-03: AccountRequest persistido antes do envio de email; falha deixa de perder o pedido
- AUTH-04: check-email e send-otp deixam de enumerar contas (corpo, codigo e latencia)
- AUTH-04: bootstrap do super-admin sai dos caminhos nao autenticados (p95 9,8s)
- AUTH-05: password minima 12 caracteres; confirmacoes obrigatorias no schema Zod
- AUD-01: fila em memoria substituida por pg_advisory_xact_lock transacional
- AUD-04: falha de auditoria em categoria SECURITY aborta a operacao
- AUD-05: verifyAuditChain paginado por cursor
- AUD-06: repairChain com motivo obrigatorio, estado anterior integral e marca permanente
- FIN-01: rota /api/finance removida; financas passa a chave canonica
- HCC: PUT/DELETE objetivos, DELETE dinamizacoes, fusos horarios explicitos
- Versao consolidada em fonte unica: 1.1.0"
git tag -a v1.1.0 -m "v1.1.0"
git push origin master --follow-tags
```

Aguarda a conclusão do build no Vercel e confirma que terminou sem erro.

**Artefacto:** SHA do commit, output do deploy.

---

## PASSO 7 · VERIFICAÇÃO EM PRODUÇÃO

Cada linha com o artefacto respetivo. **Nenhuma se declara sem resposta HTTP ou consulta colada.**

| # | Verificação | Esperado |
|:--|:--|:--|
| 1 | `GET /api/version` | `version: "1.1.0"` e `commitSha` = `git rev-parse HEAD` |
| 2 | `GET /api/health` | `version: "1.1.0"`, `database: "ready"` |
| 3 | `POST /api/auth/login` com o email do super-admin e `admin1234` | **`401`**, sem token |
| 4 | `POST /api/public/register` com dados válidos | **`200`** com `emailDelivered: false` (o DNS ainda está por publicar) |
| 5 | `SELECT * FROM account_requests WHERE email = '<o do passo 4>'` | **linha existe**, `emailDeliveryStatus = 'FAILED'` |
| 6 | Corpo da resposta do passo 4 | **sem** `resend.com`, **sem** `not verified` |
| 7 | `POST /api/public/register` com password de 8 caracteres | `400` |
| 8 | `POST /api/auth/check-email` — conta existente vs inexistente | corpo **idêntico** |
| 9 | `POST /api/auth/send-otp` — idem | corpo e código **idênticos**; medir tempo de ambos |
| 10 | `GET /api/finance/transactions` | **`404`** |
| 11 | `GET /api/financas/dashboard` **autenticado** | mesmos totais de antes; 11 transações |
| 12 | `POST /api/auth/check-email` com o email do super-admin, 5 execuções | p95 **< 500 ms** (era 9,8 s) |
| 13 | `PUT` e `DELETE` em `/api/hccall/objectives/:id` autenticado | `200`; objetivo deixa de aparecer na listagem |
| 14 | `DELETE /api/hccall/dynamizations/:id` com vendas associadas | `200` com `linkedSales > 0`; comissões históricas intactas |
| 15 | `npm run audit:verify` contra produção | íntegra, **com a declaração de re-selagem** (não um simples "íntegra") |

O ponto 3 **deixou de ser destrutivo** — é seguro e obrigatório precisamente porque a correção existe. Se devolver `200`, o deploy não chegou a produção e paras tudo.

O ponto 15 é o teste da decisão D2: a partição re-selada tem de devolver *"Íntegra desde a re-selagem de … por …; N registos re-selados"*, e nunca mais um "íntegra" sem qualificação.

---

## PASSO 8 · DOCUMENTAÇÃO

Atualiza com a realidade, não com otimismo:

**`ESTADO.md`** — versão `1.1.0` (está desatualizado em `0.5.0`). E **não pode dizer "PRONTO / VALIDADO"**: o portão de produção de 15 critérios continua aberto enquanto o DNS do Resend não estiver publicado e o fluxo completo de novo utilizador não estiver demonstrado ponta a ponta.

**`CHANGELOG.md`** — entrada `v1.1.0` com os IDs de achado corrigidos.

**`DIARIO.md`** — a sessão de hoje, incluindo a nota retroativa das 34 re-selagens de 2026-09-11 e o facto de a origem exata não ser determinável.

**`DECISOES.md`** — ADR novas: D1 (consolidação em `financas`), D2 (`repairChain` auditável), D4 (modo `TEAM` restrito a papéis de supervisão), e a decisão de que a versão passa a ter fonte única em `src/version.ts`.

**`DIVIDA_TECNICA.md`** — substitui a lista atual (consolidar CSS, i18n espanhol) pela dívida real: AUD-02 (auditar leituras), AUD-03 (`oldValue`/`newValue` no hook), FIN-02 (extrair matemática dos controllers), reconciliação bancária e SAF-T por construir, `invalidateEntitlementCache` por ligar no `ApplicationController`.

---

## DEPOIS DO DEPLOY — ACÇÕES DO HÉLDER

Sinaliza estas três e **não avances sem elas**:

1. **Publicar os registos DNS** de `helderlabs.eu` (estado atual: `not_started`, região `eu-west-1`) — DKIM `resend._domainkey`, MX `send`, TXT `send`. Existe `backend/scripts/ovh-configure-dns.mjs`; verifica se está operacional e propõe-no. Depois dispara a verificação no Resend e confirma `verified`.
2. **Rodar a password do super-administrador.** A backdoor esteve ativa durante um período indeterminado.
3. **Rever o histórico de acessos** e sinalizar IPs desconhecidos:

```sql
SELECT timestamp, "actorEmail", action, result, "ipAddress", "userAgent"
  FROM audit_logs
 WHERE ("action" ILIKE '%login%' OR "action" ILIKE '%auth%')
   AND "actorEmail" = 'helderguiomar@gmail.com'
 ORDER BY timestamp DESC LIMIT 200;
```

---

## POR FAZER, E DECLARADO

Não faz parte deste deploy — regista, não implementes:

- **D5 por decidir:** bónus de objetivo do HCCALL acumulam entre si ou vigora só o escalão mais alto? Bloqueia o módulo de comissões com os três estados.
- `invalidateEntitlementCache(userId, tenantId)` por ligar no `ApplicationController` — sem isso, uma alteração de licença demora até 60 s a fazer efeito.
- AUD-02 (auditar leituras sensíveis) e AUD-03 (`oldValue`/`newValue`).
- HCCALL: Meu Perfil, Definições, histórico e tendências.
- Extrair a matemática financeira de `FinancasController` (34,5 KB) para serviços puros.
- QA visual completa, incluindo o **tema claro**, reportado como ilegível e nunca verificado.
- Fluxo completo de novo utilizador ponta a ponta — bloqueado até o DNS estar publicado.

---

## REGRA FINAL

Se algum dos 15 pontos do passo 7 não fechar com artefacto, **a v1.1.0 não está em produção** — está implantada, que é coisa diferente. Diz qual falhou e porquê, e não escrevas "PRONTO" em lado nenhum.

Um relatório que diz "13 de 15 verificados, faltam estes dois pelas seguintes razões" vale mais do que um que diz que correu tudo bem.
