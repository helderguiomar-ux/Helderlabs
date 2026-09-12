# RESPOSTA — Autorização para o Passo 7, com uma correção forense
> Colar no Antigravity.

---

## 1. TRABALHO ACEITE

169/169 testes verdes, lint limpo, migração aplicada, commit `f9bd32b` e tag `v1.1.0` em produção. E, sobretudo: **reportaste o aviso `[CRÍTICO]` literalmente em vez de o contornar.** Era esse o teste de verdade desta sessão, e passaste.

---

## 2. A TUA CONSULTA DE ACESSOS DEVOLVEU 0 — E ISSO É UM ACHADO, NÃO UM ALÍVIO

Escreveste:

> *Resultado obtido: 0 registos sob as ações login/auth com este email exato.*

**Zero registos não significa zero tentativas.** Significa que os eventos de autenticação não são atribuíveis a um email nesta base de dados. A razão está no código:

O hook global em `app.ts` grava `action` como `${moduleName}.${método}`, onde `moduleName` vem de `request.url.split('/')[2]`. Para `POST /api/auth/login` isso dá **`auth.post`** — nunca `login`. A tua cláusula `action ILIKE '%login%'` não podia encontrar nada.

Pior, e é o ponto sério: o mesmo hook preenche `actorEmail` a partir de `request.user?.email`. Numa rota de **login não existe `request.user`** — a autenticação ainda não aconteceu. Portanto **todos os eventos de autenticação foram gravados com `actorEmail` a NULL**, sem exceção.

### Consequência, dita sem rodeios

**Não é possível determinar se a backdoor foi usada por terceiros.** Não há dados que o permitam afirmar nem negar. Não escrevas em lado nenhum que "não houve acessos indevidos" — o que há é ausência de registo atribuível, que é coisa diferente.

### Consulta correta, para o que ainda dá para ver

```sql
-- Todos os eventos de autenticação, por IP (o email não está lá)
SELECT timestamp, action, result, "ipAddress", "userAgent", "actorEmail"
  FROM audit_logs
 WHERE action LIKE 'auth.%'
 ORDER BY timestamp DESC
 LIMIT 500;

-- Distribuição por IP: o que interessa é o que NÃO é do Hélder
SELECT "ipAddress",
       COUNT(*) FILTER (WHERE result = 'SUCCESS') AS sucessos,
       COUNT(*) FILTER (WHERE result = 'FAILURE') AS falhas,
       MIN(timestamp) AS primeiro,
       MAX(timestamp) AS ultimo
  FROM audit_logs
 WHERE action LIKE 'auth.%'
 GROUP BY "ipAddress"
 ORDER BY sucessos DESC;
```

Apresenta a segunda tabela ao Hélder. Ele reconhece os IPs dele; qualquer outro com `sucessos > 0` merece explicação.

### Registar como achado novo

```
ID:            AUD-08
Severidade:    ALTO
Ficheiro:linha: backend/src/app.ts (hook onResponse)
Evidência:     action = `${moduleName}.${method}` → 'auth.post'; actorEmail = request.user?.email
Cenário de falha: em rotas de autenticação não existe request.user, pelo que todos os
                  eventos de login, OTP e verificação ficam gravados com actorEmail NULL.
                  Não é possível atribuir uma tentativa de autenticação a uma conta.
Reprodução:    SELECT COUNT(*) FROM audit_logs WHERE action LIKE 'auth.%' AND "actorEmail" IS NOT NULL;
Impacto:       impossibilidade de investigação forense sobre acessos — precisamente o
               cenário em que a auditoria mais valeria.
Correção proposta: auditoria explícita nas rotas de autenticação, com o email tentado,
               o resultado e o IP, em categoria SECURITY. NÃO implementar nesta release.
```

**Não corrijas isto agora.** Fica para a v1.1.1, depois de a v1.1.0 estar verificada em produção. Regista em `DIVIDA_TECNICA.md` como alta prioridade.

---

## 3. ROTAÇÃO DA PASSWORD — É DO HÉLDER, NÃO TUA

Não definas tu a password nem a proponhas em texto. O procedimento é dele:

1. Login em produção com a credencial atual.
2. `POST /api/auth/set-password` autenticado, com a nova password (mínimo 12 caracteres, minúscula, maiúscula e algarismo — a política nova é validada no schema e recusa qualquer coisa abaixo disso).
3. Confirmar `401` com `admin1234`.

Aguarda a confirmação dele. **Não prossigas para o Passo 7 antes disso** — o ponto 3 das verificações depende da rotação estar feita.

---

## 4. PASSO 7 — AUTORIZADO, ASSIM QUE A ROTAÇÃO ESTIVER CONFIRMADA

Executa as 15 verificações contra `https://helderlabs.eu`, cada uma com artefacto. Cinco notas:

**Ponto 3** (`admin1234` → `401`): agora é o teste da rotação, não do código. Se devolver `200` depois de rodada, para tudo.

**Ponto 4** (registo com o DNS ainda por publicar): o esperado é `200` com `emailDelivered: false` **e a linha em `account_requests`**. Confirma as duas coisas — é a correção central desta release.

**Ponto 12** (latência do `check-email`): mede antes de mais nada. Era 9,8 s no p95 e deve estar abaixo de 500 ms. Se não estiver, o `onReady` de bootstrap pode estar a correr por invocação em vez de uma vez por instância — reporta.

**Ponto 15** (`npm run audit:verify`): espera-se `valid: true` com `documentedBreaks: 18` e a declaração qualificada. Um "Íntegra desde a génese" simples significa que os incidentes não foram lidos — reporta.

**Medição autenticada** (ficou por fazer na Fase 4B): obtém um JWT válido e mede `/api/me/workspace`, `/api/financas/dashboard`, `/api/hccall/dashboard` e `/api/platform/audit/logs` **com header `Authorization`**. As medições anteriores marcadas 🟢 eram respostas `401` — mediam a recusa, não os módulos. A queixa "módulos muito lentos" continua sem uma única medição válida.

---

## 5. O QUE `ESTADO.md` PODE E NÃO PODE DIZER

A v1.1.0 está **implantada**. Não está **verificada em produção** — são coisas diferentes, e a distinção é o ponto de todo este processo.

`ESTADO.md` **não pode dizer "PRONTO"** enquanto:

- a password do super-admin não estiver rodada e confirmada;
- os registos DNS do Resend não estiverem publicados e o domínio `verified`;
- o fluxo completo de novo utilizador não estiver demonstrado ponta a ponta com screenshots;
- a QA visual, incluindo o **tema claro**, não estiver feita;
- os 15 pontos não estiverem fechados com artefacto.

Escreve antes: **"v1.1.0 implantada em produção a <data>, commit f9bd32b. Verificação em curso: N de 15 critérios fechados."** E atualiza esse número à medida que fecham.

---

## 6. RESUMO

Aceite e bom trabalho. Três coisas por esta ordem:

1. Apresenta a tabela de IPs ao Hélder e diz-lhe claramente que **não é possível determinar se a backdoor foi usada**.
2. Aguarda a confirmação da rotação da password.
3. Executa o Passo 7 completo, com a medição autenticada incluída.

Regista AUD-08 na dívida técnica e não o corrijas nesta release.
