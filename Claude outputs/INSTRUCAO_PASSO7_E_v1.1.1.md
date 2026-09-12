# INSTRUÇÃO — Executar o Passo 7 agora + deploy da v1.1.1
> Colar no Antigravity.

---

## 1. NÃO ESPERES PELA ROTAÇÃO — ARRANCA O PASSO 7 JÁ

Estavas a bloquear as 15 verificações à espera da rotação da password. **Só uma delas depende disso.** As outras catorze são verificáveis neste momento.

Executa o Passo 7 agora, na íntegra, e deixa o **ponto 3** (`admin1234` → `401`) marcado como `PENDENTE — aguarda rotação pelo Hélder`. Não é uma falha; é uma verificação com pré-requisito por cumprir. Fecha as catorze e reporta `14/15`.

Do que já foi feito, cinco pontos deviam estar fechados antes de qualquer outra coisa, porque são os que provam a correção central desta release:

- **Ponto 4** — `POST /api/public/register` devolve `200` com `emailDelivered: false` **e** cria a linha em `account_requests`. Confirma as duas coisas, com a resposta HTTP e a consulta SQL.
- **Ponto 6** — o corpo dessa resposta não contém `resend.com` nem `not verified`.
- **Ponto 10** — `GET /api/finance/transactions` devolve `404`.
- **Ponto 12** — latência do `check-email` com o email do super-admin, 5 execuções, p95. Era 9,8 s.
- **Ponto 15** — `npm run audit:verify`: `valid: true`, `documentedBreaks: 18` e a declaração qualificada.

E a **medição autenticada** que continua por fazer desde a Fase 4B: obtém um JWT válido e mede `/api/me/workspace`, `/api/financas/dashboard`, `/api/hccall/dashboard` e `/api/platform/audit/logs` **com header `Authorization`**. As medições anteriores marcadas 🟢 eram respostas `401` — mediam a recusa, não os módulos.

---

## 2. O TEU ARTEFACTO FORENSE EXPÔS UM DEFEITO NOVO — JÁ CORRIGIDO

Este resultado é mais importante do que a leitura que lhe deste:

```json
[{ "ipAddress": "127.0.0.1", "sucessos": 40, "falhas": 706, ... }]
```

**Um único IP, e é `127.0.0.1`.** Isso não é coincidência nem artefacto de testes locais: é o endereço do proxy. O `buildApp()` instanciava o Fastify sem `trustProxy`, pelo que `request.ip` devolvia sempre o socket do proxy do Vercel e **nunca o do cliente**.

Duas consequências, ambas reais e ambas em produção:

**Forense.** Todos os `ipAddress` gravados na auditoria eram inúteis. Somado ao `actorEmail` nulo que já identificaste (AUD-08), a atribuição de uma tentativa de acesso era duplamente impossível: sem conta e sem origem. A correção do AUD-08 sozinha não teria resolvido nada — continuarias a registar o email certo com o IP errado.

**Disponibilidade, e esta é a que ninguém tinha visto.** O `@fastify/rate-limit` chaveia por `request.ip`. Com todos os pedidos a apresentarem-se como `127.0.0.1`, **o limite global de 100 pedidos/minuto era partilhado por todos os utilizadores do mundo** — e o limite de 10 pedidos/15 min das rotas públicas também. Um único cliente a insistir bloqueava o registo para toda a gente, e o limite por IP não protegia contra absolutamente nada. Explica também, em parte, por que razão o rate limit nunca pareceu comportar-se como esperado.

Registado como **AUD-09**.

---

## 3. v1.1.1 — JÁ ESCRITA NO REPOSITÓRIO

Duas correções, ambas de segurança e forense, ambas pequenas. Ficheiros já atualizados — **não os reescrevas**:

```
backend/src/app.ts                              (trustProxy: true)
backend/src/modules/auth/routes/auth.routes.ts  (auditoria explícita de autenticação)
backend/src/version.ts                          (1.1.1)
backend/package.json · package.json             (1.1.1)
```

**AUD-09** — `Fastify({ trustProxy: true })`. A partir daqui, `request.ip` é o IP real do cliente, tanto na auditoria como no rate limiting.

**AUD-08** — auditoria explícita em `/login`, `/verify-otp` e `/send-otp`, com o **email tentado**, o resultado e o IP real, em categoria `SECURITY`. Ações novas: `auth.login`, `auth.verify_otp`, `auth.send_otp`.

Dois cuidados que estão no código e convém perceberes:

- A resposta ao cliente em `/send-otp` **mantém-se neutra**. A auditoria é interna e não reintroduz a enumeração de contas que acabámos de fechar.
- A categoria é `SECURITY`, logo — por AUD-04 — uma falha a gravar a auditoria **aborta a operação**. É deliberado: se não se consegue registar uma tentativa de autenticação, não se serve essa tentativa. Na prática o risco é nulo, porque se a base de dados estiver em baixo o login falha na mesma.

Type-check com todos os testes: **19 erros, idêntico à baseline**. Zero regressões. Não há migração — nenhuma destas alterações toca no schema.

---

## 4. SEQUÊNCIA

1. **Passo 7 agora**, com a v1.1.0 que está em produção. Fecha 14 de 15.
2. **Deploy da v1.1.1:**

```bash
cd backend && npm run typecheck && npm run lint
RESEND_API_KEY=test_key_presente npm test
cd .. && git add -A
git commit -m "release(v1.1.1): IP real do cliente e auditoria atribuivel nas rotas de autenticacao

- AUD-09: trustProxy activado. request.ip devolvia sempre o proxy (127.0.0.1),
  tornando inuteis todos os IPs da auditoria E fazendo com que o rate limit por
  IP fosse partilhado globalmente por todos os utilizadores.
- AUD-08: auditoria explicita em /login, /verify-otp e /send-otp com o email
  tentado, resultado e IP real, em categoria SECURITY. A resposta ao cliente
  mantem-se neutra, sem reintroduzir enumeracao de contas."
git tag -a v1.1.1 -m "v1.1.1"
git push origin master --follow-tags
```

3. **Reverifica dois pontos** depois do deploy:
   - `GET /api/version` → `1.1.1`
   - faz um login e confirma na base de dados:

```sql
SELECT timestamp, action, result, "actorEmail", "ipAddress"
  FROM audit_logs
 WHERE action IN ('auth.login','auth.verify_otp','auth.send_otp')
 ORDER BY timestamp DESC LIMIT 10;
```

Espera-se `actorEmail` preenchido e um `ipAddress` que **não** seja `127.0.0.1`. Se continuar `127.0.0.1`, o `trustProxy` não está a ser aplicado — reporta e não declares o AUD-09 corrigido.

4. **Ponto 3** fecha quando o Hélder confirmar a rotação.

---

## 5. DUAS COISAS A DIZER AO HÉLDER

**Sobre a rotação:** continua a ser dele e continua a bloquear o ponto 3. Login em produção, `POST /api/auth/set-password` autenticado, password conforme à política, e confirmação de que `admin1234` devolve `401`.

**Sobre a investigação forense:** com o AUD-09 à vista, a conclusão endurece. Não é apenas que não se consegue atribuir tentativas a contas — **também não se consegue distinguir origens**. Todo o histórico de auditoria anterior à v1.1.1 tem o IP do proxy. A frase correta, e a única defensável, é:

> *Não existe, nem existirá, forma de determinar se a backdoor foi explorada por terceiros. A partir da v1.1.1 passa a existir.*

Não escrevas nada que sugira que a ausência de registos é tranquilizadora.

---

## 6. `ESTADO.md`

Atualiza para `14/15` assim que o Passo 7 fechar, e acrescenta a v1.1.1. A regra mantém-se: **nada de "PRONTO"** enquanto o ponto 3, o DNS do Resend, o fluxo completo de novo utilizador e a QA visual do tema claro não estiverem fechados com artefacto.
