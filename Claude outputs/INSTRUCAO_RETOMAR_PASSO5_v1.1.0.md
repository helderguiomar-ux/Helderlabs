# INSTRUÇÃO — Retomar a partir do Passo 5 (testes)
> Colar no Antigravity, na sessão em curso.

---

## 1. A MIGRAÇÃO PASSOU E ESTÁ CORRETA

Os quatro artefactos que colaste confirmam o essencial:

- 18 incidentes registados e classificados como `CONCURRENCY_RACE`
- `audit.chain.enforced_since = 2026-09-12T17:30:13.459Z`
- índice **parcial** com `WHERE ("timestamp" >= '2026-09-12 16:30:13.459339')`
- `hash` e `prevHash` com `is_nullable = NO`

O histórico ficou intacto, documentado e explicado; a unicidade do elo passa a ser imposta daqui para a frente. É exatamente o resultado pretendido.

---

## 2. A FALHA Nº 1 NÃO É UM PROBLEMA DE TESTE — É O ACHADO MAIS IMPORTANTE DE HOJE

O teu diagnóstico está tecnicamente certo e é excelente trabalho:

> *o super-admin tem o hash bcrypt de "admin1234" gravado como password real, logo `bcrypt.compare` devolve `true` legitimamente.*

Mas a conclusão que tiraste — *"definir uma password forte na BD local para o teste passar"* — tornaria o teste verde e deixaria o sistema exatamente como está. É a mesma doença que esta auditoria inteira combate: um teste que mede o ambiente em vez do sistema.

**O que isto significa a sério:** remover a backdoor do código **não altera a password que a backdoor gravou**. O código antigo reescrevia o `passwordHash` para `admin1234` sempre que alguém tentava essa password. Portanto, se em produção alguém alguma vez a tentou, **a password real do super-admin em produção é `admin1234` neste momento** — e continuará a ser depois do deploy, porque o deploy não toca em dados.

Isto eleva a rotação da password de "boa prática pós-deploy" a **bloqueador de produção**. Não é opcional e não pode ficar para depois.

### O que foi alterado

O teste foi reescrito para testar o **mecanismo** e não o ambiente. Cria um utilizador próprio com password forte conhecida, tenta `admin1234`, e verifica três coisas:

1. não autentica;
2. **o `passwordHash` guardado não foi modificado** — era *isto* a backdoor;
3. a password verdadeira continua a funcionar depois da tentativa falhada.

Foi acrescentado um segundo teste que verifica se a password do super-admin **do ambiente** corresponde a uma credencial fraca conhecida (`admin1234`, `admin`, `password`, `123456`, `helderlabs`). **Não falha o build** — imprime um aviso `[CRÍTICO]` em consola. É um sinal, não um bloqueio: o objetivo é que ninguém possa dizer que não sabia.

**Quando correres a suite, procura esse aviso na saída e reporta-o.** Se aparecer em ambiente local, quase de certeza aparece também em produção.

---

## 3. AS OUTRAS 8 FALHAS — CORRIGIDAS, TODAS NO TESTE

O teu diagnóstico estava certo em todas. Ficheiros já atualizados no repositório:

| Falha | Causa | Correção aplicada |
|:--|:--|:--|
| `audit-chain-concurrency.test.ts:74` | Discrepância léxica: serviço dizia "re-selado", teste procurava "re-selagem" | Unificado no serviço para `re-selagem de N registo(s)` |
| `guards.test.ts:37` | A cache nova do plugin (TTL 60 s) retinha o estado; o teste só invalidava a do serviço | Teste passa a chamar também `invalidateEntitlementCache()` |
| `e2e-verification-flow.test.ts:143` | Chave canónica passou a `financas` (decisão D1) | Asserção atualizada |
| `hccall-idor-entitlements.test.ts:9` | Idem | Asserção atualizada |
| `publicRoutes.test.ts` (RGPD) | Payload incompleto deixou de chegar à verificação de RGPD — o Zod recusa antes | Payload completado; o teste volta a testar o que dizia testar |
| `publicRoutes.test.ts` (registo) | Faltavam confirmações e password conforme à política | Payloads atualizados |
| `registration-and-account-requests.test.ts` 1 e 2 | `EMAILS_DO_NOT_MATCH` / `PASSWORDS_DO_NOT_MATCH` movidos do handler para o schema Zod | Passam a asserir `VALIDATION_ERROR` **e o campo em falha** |

**Melhoria aproveitada:** o handler de `ZodError` em `app.ts` devolvia sempre `message: 'Pedido inválido.'`. Com as validações agora no schema, era essa a mensagem genérica que o utilizador passaria a ver no formulário. Passa a devolver a mensagem do primeiro problema concreto (*"A palavra-passe e a confirmação de palavra-passe não coincidem."*) e um campo `field` com o caminho. Os testes ficaram mais fortes do que eram: antes verificavam um código, agora verificam código **e** campo.

**Lint:** a diretiva `eslint-disable` não utilizada em `AuditService.ts` foi eliminada — o `while (true)` passou a `for (;;)`.

---

## 4. FICHEIROS ATUALIZADOS — NÃO OS REESCREVAS

```
backend/src/app.ts                                          (ZodError com mensagem útil)
backend/src/modules/platform/services/AuditService.ts       (termo unificado + lint)
backend/tests/regression/onboarding-resilience.test.ts      (teste do mecanismo + aviso de password fraca)
backend/tests/public/publicRoutes.test.ts
backend/tests/auth/registration-and-account-requests.test.ts
backend/tests/platform/guards.test.ts
backend/tests/e2e/e2e-verification-flow.test.ts
backend/tests/security/hccall-idor-entitlements.test.ts
```

Type-check com todos os testes incluídos: **19 erros, idêntico à baseline**. Zero regressões.

---

## 5. RETOMAR

### 5.1 · Revalidar e correr a suite

```bash
cd backend
npm run typecheck
npm run lint
RESEND_API_KEY=test_key_presente npm test
```

Espera-se **0 falhas**. Se sobrar alguma, reporta com o ficheiro, a linha e a asserção — não a contornes.

**Procura na saída o bloco `[CRÍTICO]` sobre a password do super-admin** e inclui-o no relatório, literalmente.

### 5.2 · Commit e deploy

```bash
git add -A
git commit -m "release(v1.1.0): onboarding resiliente, fim da enumeracao de contas, integridade da cadeia de auditoria e CRUD do HCCALL

- AUTH-01: backdoor admin1234 removida; teste passa a verificar o mecanismo (hash nao e reescrito)
- AUTH-03: AccountRequest persistido antes do envio de email
- AUTH-04: check-email e send-otp deixam de enumerar contas (corpo, codigo e latencia)
- AUTH-04: bootstrap do super-admin sai dos caminhos nao autenticados
- AUTH-05: password minima 12 caracteres; confirmacoes obrigatorias no schema Zod
- AUD-01: fila em memoria substituida por pg_advisory_xact_lock transacional
- AUD-04: falha de auditoria em categoria SECURITY aborta a operacao
- AUD-05: verifyAuditChain paginado por cursor
- AUD-06: repairChain com motivo obrigatorio e marca permanente
- AUD-07: 18 descontinuidades historicas documentadas em audit_chain_incidents
- FIN-01: modulo finance removido; financas passa a chave canonica
- HCC: PUT/DELETE objetivos, DELETE dinamizacoes, fusos horarios explicitos
- Versao consolidada em fonte unica: 1.1.0"
git tag -a v1.1.0 -m "v1.1.0"
git push origin master --follow-tags
```

### 5.3 · As 15 verificações de produção

Sem alterações, com duas notas:

- **Ponto 3** (`admin1234` → `401`): se **passar**, ótimo. Se devolver `200`, **não é a backdoor** — é a password real da conta, e confirma o ponto 2 desta instrução. Reporta imediatamente e **não prossigas** até estar rodada.
- **Ponto 15**: `valid: true` com `documentedBreaks: 18` e a declaração qualificada.

---

## 6. BLOQUEADOR DE PRODUÇÃO — ESCALAR AO HÉLDER AGORA

Não esperes pelo fim do deploy. Assim que a suite correr, apresenta-lhe isto:

> **A password do super-administrador tem de ser rodada antes de a v1.1.0 ser considerada em produção.**
> A backdoor removida gravava `admin1234` como password real sempre que era tentada. O deploy corrige o código; não corrige o dado. Enquanto a password não for mudada, a conta continua a abrir com a credencial que a backdoor deixou.

Propõe-lhe a rotação por `POST /api/auth/set-password` autenticado, ou por script direto contra a base de dados — com uma password conforme à nova política (12+ caracteres, minúscula, maiúscula e algarismo). Confirma depois, com artefacto, que `admin1234` devolve `401` em produção.

E apresenta-lhe também o resultado da consulta de acessos:

```sql
SELECT timestamp, "actorEmail", action, result, "ipAddress", "userAgent"
  FROM audit_logs
 WHERE ("action" ILIKE '%login%' OR "action" ILIKE '%auth%')
   AND "actorEmail" = 'helderguiomar@gmail.com'
 ORDER BY timestamp DESC LIMIT 200;
```

---

## 7. PARA O `DECISOES.md`

> **ADR — Um teste de segurança não pode depender do estado do ambiente.**
> O teste da backdoor `admin1234` falhou em desenvolvimento não por a backdoor existir, mas por a password real do super-admin ser literalmente `admin1234` — gravada pela própria backdoor. Corrigir o ambiente para o teste passar teria escondido o facto de que remover código não altera dados já escritos. O teste passa a criar o seu próprio utilizador com password conhecida e a verificar o mecanismo: que uma tentativa falhada não autentica **e não reescreve o hash guardado**. Um teste de segurança que pode ficar verde por alteração do ambiente não é um teste de segurança.
