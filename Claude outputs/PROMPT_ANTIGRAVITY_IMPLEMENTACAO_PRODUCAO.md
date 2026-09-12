# PROMPT DE IMPLEMENTAÇÃO — Caminho para Produção
> Colar no Antigravity, raiz de `helderlabs-erp`. Sequência: vem depois do Relatório Consolidado (commit `f50cd1c`).
> Estado de partida: Bloco 0 commitado **localmente**; produção continua em `ddb240a` — **com a backdoor ativa**.

---

## REGRAS DESTA FASE

Agora implementas. As regras de evidência mantêm-se e apertam:

- **E1** — Cada bloco é um commit próprio. Não misturas blocos.
- **E2** — Cada correção fecha com um **artefacto de produção**: pedido HTTP com estado e corpo, consulta SQL com resultado, ou `git rev-parse` do SHA implantado. Alteração local não é correção; é intenção.
- **E3** — Cada correção leva um **teste que falha antes e passa depois**. Commit do teste junto com a correção.
- **E4** — Os testes correm com as **mesmas chaves de ambiente que produção** (valores de teste, chaves presentes). Um teste que só passa porque falta uma variável está a testar o ambiente.
- **E5** — Se um passo não puder ser concluído, **para e reporta**. Não avanças para o bloco seguinte deixando o anterior a meio.

---

## BLOCO 0-DEPLOY — AGORA, ANTES DE TUDO

O commit `e17f19e` removeu a backdoor **no repositório**. Produção corre `ddb240a`. **A backdoor está viva neste momento.**

1. `git push origin master`
2. Aguardar o deploy do Vercel e confirmar que concluiu sem erro.
3. **Artefacto obrigatório:** `GET https://helderlabs.eu/api/version` com o SHA da resposta a coincidir com `git rev-parse HEAD`. Cola a resposta completa.
4. **Prova negativa obrigatória:** confirma que o artefacto implantado já não contém a sobrescrita. Faz `GET` ao bundle implantado ou executa, contra produção, um login com o email do super-admin e a password `admin1234`:
   - **Resultado esperado: `401 Credenciais inválidas`.**
   - Este teste é agora **seguro e obrigatório** — deixou de ser destrutivo precisamente porque a correção existe. Se devolver `200`, a correção não está em produção e paras tudo.

Nada abaixo começa antes deste ponto estar fechado com os quatro artefactos.

---

## AÇÕES DO HÉLDER (não são tuas — sinaliza e aguarda)

Duas coisas que o agente não pode fazer e que bloqueiam o Bloco 1:

**A1 · Publicar os registos DNS** na zona de `helderlabs.eu` (estado atual no Resend: `not_started`, região `eu-west-1`):

| Tipo | Nome | Valor | Prio |
|:--|:--|:--|:--|
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDm4h/ZDaglIhKbPlrZBh71wyY4ra9ldOg5q86y5ldvAqwokJ7s8ivCtTWkRJYGQ5cQVHlU+HrQFsBVeFFn/QCaTxmzIpau7t1czZxFiOe6HhXkHBHnFzVXyKpZWy1GYRCsv39V+21e9KOlB4NJbXFvDU4G1o2Enscyt7xNGS90TQIDAQAB` | — |
| MX | `send` | `feedback-smtp.eu-west-1.amazonses.com` | 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |

Existe `backend/scripts/ovh-configure-dns.mjs` — verifica se está operacional e, se estiver, propõe-no ao Hélder com as credenciais que ele fornecer. Depois dispara a verificação no Resend e confirma o estado `verified`.

**A2 · Rodar a password do super-administrador**, imediatamente após o Bloco 0-DEPLOY. A backdoor esteve ativa durante um período indeterminado; a password atual tem de ser tratada como comprometida.

**A3 · Revisão do histórico de acessos.** As linhas de auditoria sobreviveram às 34 re-selagens (só os hashes foram reescritos). Executa e apresenta ao Hélder:

```sql
SELECT timestamp, "actorEmail", action, result, "ipAddress", "userAgent"
FROM audit_logs
WHERE (action ILIKE '%login%' OR action ILIKE '%auth%')
  AND "actorEmail" = 'helderguiomar@gmail.com'
ORDER BY timestamp DESC
LIMIT 200;
```

Sinaliza qualquer `ipAddress` que não corresponda aos do Hélder. Não é possível provar que a backdoor não foi usada — é possível mostrar o que há.

---

## BLOCO 1 — ONBOARDING (é isto que desbloqueia produção)

### 1.1 · Inverter a ordem no registo público — a correção estrutural

`backend/src/routes/public.routes.ts`, `POST /register`. O comportamento novo:

```
1. validar payload
2. persistir/atualizar AccountRequest com status PENDING_VERIFICATION
   (guardando otpHash, otpExpiresAt)
3. tentar enviar o email
4. gravar o resultado do envio no próprio AccountRequest
5. responder SEMPRE 200 — com uma flag que diz se o email saiu
```

Acrescenta ao modelo `AccountRequest` (migração Prisma):

```prisma
emailDeliveryStatus  String?   // 'SENT' | 'FAILED' | 'PENDING'
emailDeliveryError   String?   // detalhe interno, NUNCA devolvido ao cliente
emailLastAttemptAt   DateTime?
emailAttemptCount    Int       @default(0)
```

Resposta ao cliente quando o envio falha — **sem o erro do fornecedor**:

```json
{
  "success": true,
  "status": "PENDING_VERIFICATION",
  "emailDelivered": false,
  "message": "O seu pedido foi registado. Não conseguimos enviar o código de validação neste momento — a nossa equipa foi notificada e entrará em contacto. Pode também tentar reenviar o código dentro de alguns minutos."
}
```

O detalhe real do fornecedor vai para `emailDeliveryError` e para um registo de auditoria de categoria `SYSTEM`. **Nunca para a resposta HTTP.**

**Critério de aceitação:** com `RESEND_API_KEY` definida e o domínio por verificar, um `POST /api/public/register` devolve `200` e **o `AccountRequest` existe na base de dados**. É este o teste que faltava e que tornou toda a suite anterior inútil.

### 1.2 · Reenvio e visibilidade no super-admin

- `POST /api/public/resend-code` — respeita `emailAttemptCount` e aplica limite.
- No painel de super-admin, os pedidos com `emailDeliveryStatus = 'FAILED'` aparecem **assinalados**, com botão de reenvio manual e a opção de aprovar diretamente (um pedido cujo email nunca saiu não pode ficar preso à espera de um código que não chegou).

### 1.3 · Política de password e confirmações

`PublicRegisterSchema`:

```ts
password: z.string()
  .min(12, 'A palavra-passe deve ter pelo menos 12 caracteres')
  .regex(/[a-z]/, 'Deve conter pelo menos uma letra minúscula')
  .regex(/[A-Z]/, 'Deve conter pelo menos uma letra maiúscula')
  .regex(/[0-9]/, 'Deve conter pelo menos um algarismo'),
passwordConfirmation: z.string(),
emailConfirmation: z.string().email(),
```

Nenhuma delas `.optional()`. Validação cruzada com `.refine()` no schema, **não no handler** — assim é impossível contornar por POST direto. Alinha `login.html` e `index.html` com a nova política.

### 1.4 · `sendOtp` deixa de mentir

`AuthService.sendOtp` passa a verificar o resultado:

```ts
const result = await EmailService.sendOtpEmail(...);
if (!result.ok) {
  return { success: false, code: 'EMAIL_DELIVERY_FAILED',
           message: 'Não foi possível enviar o código neste momento. Tente novamente em instantes.' };
}
```

### 1.5 · Eliminar a enumeração de contas

As três respostas distinguíveis de `sendOtp` colapsam numa só, **idêntica em corpo e em código HTTP** para conta existente, pedido pendente e email desconhecido:

```
"Se existir uma conta associada a este email, enviámos um código de acesso."
```

O mesmo tratamento para `POST /api/auth/check-email`, que hoje devolve `{"hasPassword":true}` para o super-admin e `false` para um email aleatório — enumeração direta, reproduzida em produção. Se o ecrã de login precisa de saber se há password, ou pede sempre ambos os campos, ou a resposta passa a ser constante.

**Adicional:** iguala o tempo de resposta. Uma resposta que demora 1,2 s para conta existente e 230 ms para inexistente enumera por cronómetro mesmo com o corpo igual.

### 1.6 · Tirar `ensureSuperAdminUser` das rotas públicas

É a causa medida do P95 de 9,8 s e é escrita na base de dados sem autenticação.

- Move a lógica para `backend/scripts/prod-bootstrap.ts`, executado **uma vez** no arranque ou por comando manual.
- Remove as invocações em `checkHasPassword`, `sendOtp`, `verifyOtp` e `loginWithPassword`.
- Se o bootstrap tiver mesmo de correr em runtime, protege-o com uma guarda idempotente em memória que corre **no máximo uma vez por instância** e nunca em caminho não autenticado.

### 1.7 · Cache de entitlements

`requireApp` invoca `EntitlementService.resolveForUser` em **todos** os pedidos. Cache em memória com chave `${userId}:${tenantId}`, TTL de 60 s, invalidada em alterações de licenciamento ou de atribuição. Numa instância serverless o ganho é dentro da mesma invocação e entre invocações quentes — mede antes e depois.

### 1.8 · Testes obrigatórios do Bloco 1

1. Registo com `RESEND_API_KEY` presente e envio a falhar → `200` **e** `AccountRequest` persistido. *(o teste que faltava)*
2. Registo com password de 11 caracteres → `400`.
3. Registo sem `passwordConfirmation` → `400`.
4. Registo com `emailConfirmation` diferente → `400`.
5. `send-otp` para email existente e para inexistente → corpo e código **idênticos**.
6. `login` com `admin1234` contra o super-admin → `401`.
7. Latência: `check-email` com o email do super-admin < 500 ms.

### 1.9 · Medição autenticada (a que ficou por fazer)

Obtém um JWT válido e mede **com header `Authorization`**, 5 execuções, mediana e p95:

`/api/me/workspace` · `/api/financas/dashboard` · `/api/hccall/dashboard` · `/api/platform/audit/logs`

As medições anteriores marcadas 🟢 eram respostas `401` — mediam a recusa, não os módulos. Substitui a tabela.

---

## BLOCO 2 — CONSOLIDAÇÃO FINANCEIRA

Confirmado por ti: os controllers de `finance` são stubs, a tabela `FinancialTransaction` tem 0 registos, o frontend fala só com `/api/financas`.

1. Remover `app.register(financeModuleRoutes, { prefix: '/api/finance' })` de `app.ts`.
2. Remover `backend/src/modules/finance/` na íntegra.
3. Migração Prisma que remove `FinancialTransaction`, `FinancialAttachment`, `FinancialReport` e quaisquer `BudgetItem`, `CashFlowProjection`, `BankReconciliation` que fiquem órfãos. **Confirma zero registos em cada uma imediatamente antes do `DROP`** e cola a contagem.
4. Remover os modelos órfãos de `TENANT_SCOPED_MODELS` em `tenantScopedClient.ts`.
5. Atualizar `config/modules.ts`: a chave passa a `financas`, sem ambiguidade entre chave e alias.
6. Registar em `DIVIDA_TECNICA.md`, como funcionalidades **por construir de raiz**: reconciliação bancária, exportação SAF-T (PT) XML, importação OFX/QIF.
7. Extrair de `FinancasController.ts` (34,5 KB) a matemática financeira para serviços puros e testáveis — mesmo padrão do `HccallCommissionEngine`: sem I/O, determinístico, valores em cêntimos. Testes unitários sem contexto HTTP.

**Artefacto:** dashboard financeiro em produção antes e depois, com os mesmos 11 registos e os mesmos totais.

---

## BLOCO 3 — AUDITORIA COM INTEGRIDADE REAL

### 3.1 · Restrições ao nível da base de dados

```prisma
model AuditLog {
  hash      String    // deixa de ser opcional
  prevHash  String
  seq       BigInt    @default(autoincrement())

  @@unique([tenantId, prevHash])
  @@unique([tenantId, seq])
  @@index([tenantId, timestamp])
}
```

Antes da migração: verifica se há linhas com `hash` nulo ou `prevHash` duplicado por tenant. Se houver, **para e reporta** — a migração falha e a forma de resolver é decisão do Hélder, não tua.

### 3.2 · Substituir a fila em memória por advisory lock

Elimina `partitionQueues`. A escrita passa a:

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${partitionKey}))`;
  const last = await tx.auditLog.findFirst({ where: { tenantId }, orderBy: { seq: 'desc' } });
  const prevHash = last?.hash ?? GENESIS_PREV_HASH;
  // calcular hash
  await tx.auditLog.create({ data: { ..., prevHash, hash } });
});
```

O lock é libertado no fim da transação. Colisão passa a ser erro recuperável com retry, não cadeia partida em silêncio.

### 3.3 · Auditar leituras de recursos sensíveis

O hook descarta todos os `GET`. Passa a auditar leituras em recursos sensíveis — clientes, transações financeiras, comissões, logs de auditoria, exportações — com categoria própria. Não audites tudo: define a lista e justifica-a. Ausência de rasto em acessos a dados pessoais é não-conformidade com o RGPD.

### 3.4 · Estado anterior e posterior

Rotas de mutação passam a fornecer `oldValue` e `newValue` ao `AuditService`. Sem isto não existe "o que mudou", que é o requisito central do Hélder para o módulo.

### 3.5 · Falha de auditoria deixa de ser silenciosa

Em categoria `SECURITY`, falha de escrita de auditoria **aborta a operação de negócio**. Nas restantes, regista num canal de erro observável — nunca só `console.error`.

### 3.6 · `verifyAuditChain` paginado

Verificação por lotes com cursor sobre `seq`, sem carregar a partição inteira em memória. `getDashboardMetrics` passa a usar um resumo em cache, não uma verificação completa a cada abertura do painel.

### 3.7 · `repairChain` conforme a decisão D2

1. Grava a **totalidade** dos hashes antigos num registo imutável separado — não `sampleOldHashes` com 5 entradas.
2. Marca permanente por registo re-selado (`resealedAt`, `resealedBy`, `resealBatchId`).
3. `motivo` obrigatório, mínimo de 20 caracteres, sem valor por omissão.
4. `verifyAuditChain` nunca mais devolve um simples "íntegra" numa partição re-selada — devolve `"íntegra desde re-selagem de <data> por <ator>; <n> registos re-selados"`.
5. Indicador visível no painel de auditoria.
6. Aplica retroativamente às 34 re-selagens de 2026-09-11T00:53:56Z, marcando-as com `resealBatchId` e origem `desconhecida (reconstituição forense)`.

---

## BLOCO 4 — HCCALL 2.0

Não toques no `HccallCommissionEngine`. Passou 12 testes de fronteira e 100/100 em determinismo — é a peça boa.

### 4.1 · Fechar o CRUD
`PUT /objectives/:id` · `DELETE /objectives/:id` · `DELETE /dynamizations/:id`. Uma dinamização com vendas associadas **não se apaga** — arquiva-se, para não invalidar comissões históricas.

### 4.2 · Comissões com os três estados

`/reports/commissions` é hoje um alias de `getDashboard`. Constrói o módulo a sério:

- Estados `ESTIMADA → VALIDADA → PAGA`, com transições auditadas.
- Campo para o **valor processado pela entidade empregadora** e para o **desvio face à estimativa**, com justificação. É esta divergência que dá ao vendedor o argumento factual numa reclamação — é o núcleo do valor do produto.
- `GET /commissions`, `POST /commissions/:id/validate`, `POST /commissions/:id/settle`.
- **Bloqueado por D5** até o Hélder decidir se os bónus acumulam ou se vigora o escalão mais alto.

### 4.3 · Perfil, definições, histórico

`GET|PUT /profile` · `GET|PUT /settings` (limiares de alerta, dias úteis, fuso horário) · `GET /history?from&to&groupBy=day|week|month` com evolução de vendas, produtividade, conversão e comparação homóloga.

### 4.4 · Fusos horários

`countWorkingDays` e `calculatePace` usam a hora local do servidor. Passa a fuso **explícito do utilizador** (guardado no perfil, `Europe/Lisbon` por omissão), com toda a aritmética de datas nesse fuso. Testa a fronteira: venda às 00:30 de Lisboa em julho tem de cair no dia certo com servidor em UTC.

### 4.5 · Identidade

`config/modules.ts`: `'HCCALL · Call Center Telecom & Energia'` → nome que reflita sistema pessoal de performance comercial, independente do setor e do local de trabalho.

### 4.6 · Encoding

Remover o BOM UTF-8 de `hccall.routes.ts` e `HccallObjectiveService.ts`. Varrer o repositório e eliminar a causa, para que `fix-encoding.js` deixe de ser necessário.

---

## BLOCO 5 — QA VISUAL (Fase 7, por executar)

Playwright contra produção, em **390×844**, **768×1024** e **1920×1080**, para `index`, `login`, `workspace`, `app` (cada módulo), `hccall`, `super-admin` e `/loja`.

Screenshot com URL e timestamp visíveis. Consola capturada — **qualquer erro é achado**.

**Prioridade:** o **tema claro** está reportado como ilegível e nunca foi verificado. Testa cada ecrã em ambos os temas e mede o contraste contra WCAG AA (4.5:1 em texto normal). Reporta cada par que falhe.

**Fluxo completo de novo utilizador em produção**, do zero, com screenshot de cada passo: registo → email → código → aprovação → atribuição de módulos → primeiro login → workspace. Só é executável depois de A1 e do Bloco 1 — é o teste de saída do onboarding.

---

## PORTÃO DE PRODUÇÃO

O sistema só pode ser declarado pronto quando **todas** estas linhas tiverem artefacto:

| # | Critério | Artefacto |
|:--|:--|:--|
| 1 | `admin1234` contra o super-admin devolve `401` em produção | resposta HTTP |
| 2 | SHA implantado = `HEAD` de `master` | `/api/version` + `git rev-parse` |
| 3 | Domínio `helderlabs.eu` `verified` no Resend | estado da API |
| 4 | Registo em produção cria `AccountRequest` **mesmo com o email a falhar** | `200` + consulta SQL |
| 5 | Fluxo completo de novo utilizador executado ponta a ponta | 7 screenshots |
| 6 | Nenhum OTP, token ou password em logs | varrimento do repositório |
| 7 | CORS recusa origem `.vercel.app` de terceiro | resposta HTTP |
| 8 | `/api/finance` devolve `404`; dashboard financeiro com os mesmos totais | duas respostas HTTP |
| 9 | Cadeia de auditoria íntegra **após** 50 escritas concorrentes | resultado do teste |
| 10 | Leituras sensíveis geram registo de auditoria | consulta SQL |
| 11 | Dashboards **autenticados** abaixo de 1 s (p95) | tabela de medições |
| 12 | `check-email` indistinguível entre conta existente e inexistente, em corpo e em tempo | duas respostas + tempos |
| 13 | Tema claro passa WCAG AA em todos os ecrãs | relatório de contraste |
| 14 | Suite de testes corre com as chaves de produção presentes | configuração + saída |
| 15 | `ESTADO.md` sem bloqueadores CRÍTICO em aberto | ficheiro |

**Enquanto qualquer linha estiver por fechar, `ESTADO.md` não pode dizer "PRONTO".** O critério 15 depende dos catorze anteriores; não é uma declaração que se escreve, é uma consequência.

---

## ORDEM DE EXECUÇÃO

1. **Bloco 0-DEPLOY** — agora. Quatro artefactos.
2. Sinalizar **A1** (DNS) e **A2** (rotação de password) ao Hélder; apresentar **A3**.
3. **Bloco 1** completo, incluindo 1.8 e 1.9. É o que desbloqueia produção.
4. **Bloco 2** — consolidação financeira.
5. **Bloco 3** — auditoria.
6. **Bloco 5** (QA visual) assim que o Bloco 1 permitir o fluxo completo.
7. **Bloco 4** — HCCALL 2.0, com 4.2 à espera do D5.
8. Reavaliação do portão de produção, linha a linha, com artefacto.

**Se um bloco não fechar, paras e reportas.** Um bloco a meio declarado concluído é a falha que este processo inteiro existe para corrigir.
