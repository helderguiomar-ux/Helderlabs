# INSTRUÇÃO — Retomar o deploy da v1.1.0 a partir do Passo 3
> Colar no Antigravity, na sessão em curso.

---

## 1. A PARAGEM ESTAVA CERTA

Fizeste exatamente o que devias. O pre-flight encontrou 18 elos duplicados, paraste antes do `migrate deploy` e reportaste com os dados. Não contornaste, não apagaste registos, não "arranjaste" nada em silêncio. É assim que se faz.

A tua análise da Secção 3 também está certa e é a peça que faltava a todo este diagnóstico: **intervalos entre 2 ms e 181 ms** são a assinatura inequívoca de escrita concorrente sem lock. Não houve intrusão. Nunca houve. Esses 18 registos são a prova material de que a `partitionQueues: Map` em memória não funcionava em serverless.

---

## 2. O QUE MUDOU — E PORQUÊ NÃO SE VAI RE-SELAR

O procedimento de desbloqueio que propuseste era o que a migração original mandava: re-selar as duas partições e reaplicar. **Foi revisto, e a instrução mudou.**

Havia dois problemas.

**O primeiro é mecânico, e era um defeito de ordenação meu.** O `repairChain` novo escreve na tabela `audit_chain_reseals` e nas colunas `resealedAt` / `resealedBy` / `resealBatchId`. Nada disso existe antes da migração — e a migração recusava-se a correr antes do `repairChain`. Dependência circular. Terias batido nela no passo seguinte.

**O segundo é de princípio, e é o que interessa.** Re-selar as duas partições faria os 18 duplicados desaparecerem. Mas esses 18 duplicados *são* a evidência de que a corrida existiu e de que a correção do lock era necessária. Apagá-los para a migração passar é, na sua essência exata, o que aconteceu a 2026-09-11 às 00:53 — alguém encontrou um alerta de integridade e resolveu-o reescrevendo a prova em vez de corrigir a causa. Repetir isso numa release cujo propósito declarado é impedir precisamente esse padrão seria contraditório.

**A abordagem nova: documentar, não apagar.**

A migração foi reescrita e já está no repositório. Passa a:

1. Criar a tabela `audit_chain_incidents` e **registar cada uma das 18 descontinuidades** com contagem, primeiro e último instante, intervalo em milissegundos e classificação automática — `CONCURRENCY_RACE` quando o intervalo é ≤ 5 s, `UNCLASSIFIED` caso contrário — mais uma nota a explicar a causa técnica.
2. Criar o índice único do elo como **índice PARCIAL**, a partir de um limiar calculado no momento da migração (`MAX(timestamp) + 1s`, nunca anterior ao instante atual). Protege toda a escrita futura **sem reescrever uma única linha de histórico**. O limiar fica gravado em `platform_settings` sob a chave `audit.chain.enforced_since`.
3. **Deixar de abortar** por causa dos duplicados. O único aborto que subsiste é para `hash`/`prevHash` NULL — que o teu pre-flight já confirmou serem zero — e para duplicados que apareçam *depois* do limiar, o que não deve ser possível.

O `AuditService.verifyAuditChainForPartition` foi atualizado em conformidade: ao encontrar uma descontinuidade, consulta os incidentes documentados. Se for uma corrida conhecida, reancora e prossegue; se não for, devolve inválido como sempre. **A verificação de conteúdo por hash continua a ser feita registo a registo, sem exceção** — o que fica documentado é o elo partido, nunca o conteúdo. Uma adulteração real continua a ser detetada.

A declaração final deixa de poder ser um simples "íntegra":

> *"Conteúdo de todos os N registos verificado por hash. 18 descontinuidade(s) documentada(s) por corrida de escrita anterior à v1.1.0 (elo partido, conteúdo íntegro)."*

---

## 3. FICHEIROS ATUALIZADOS NO REPOSITÓRIO

Já escritos. **Não os reescrevas** — usa-os como estão:

```
backend/prisma/schema.prisma                    (+ modelo AuditChainIncident)
backend/prisma/migrations/20260912120000_.../migration.sql   (reescrita)
backend/prisma/migrations/PREFLIGHT_audit_integrity.sql      (+ secção 6)
backend/src/modules/platform/services/AuditService.ts        (verificador)
```

Verificação de tipos feita: **19 erros, idêntica à baseline**. Zero regressões.

---

## 4. RETOMAR AQUI

### 4.1 · Revalidar

```bash
cd backend
npx prisma generate
npm run typecheck
```

O `generate` é obrigatório: há um modelo Prisma novo (`AuditChainIncident`) e o `AuditService` já o usa. Sem regenerar, falha.

### 4.2 · Pre-flight outra vez

```bash
psql "$DATABASE_URL" -f prisma/migrations/PREFLIGHT_audit_integrity.sql
```

As secções 1 a 5 devem devolver o mesmo de antes — **os 18 duplicados continuam lá, e é esse o comportamento correto**. A secção 6 ainda não devolve nada; é para depois da migração.

### 4.3 · Migração

```bash
npx prisma migrate deploy
```

Desta vez passa. Se abortar, lê a mensagem e **para** — mas os dois motivos de aborto que restam já foram descartados pelo teu pre-flight.

**Artefacto obrigatório:**

```sql
-- Os 18 incidentes documentados e classificados
SELECT COALESCE("tenantId",'__global__') AS particao, classification, COUNT(*), SUM(occurrences)
  FROM audit_chain_incidents GROUP BY 1,2;

-- Limiar a partir do qual a unicidade passa a ser imposta
SELECT key, value FROM platform_settings WHERE key = 'audit.chain.enforced_since';

-- O índice existe e é parcial
SELECT indexdef FROM pg_indexes
 WHERE tablename='audit_logs' AND indexname='audit_logs_chain_link_unique';

-- hash e prevHash passaram a obrigatórios
SELECT column_name, is_nullable FROM information_schema.columns
 WHERE table_name='audit_logs' AND column_name IN ('hash','prevHash');
```

Espera-se: 18 incidentes, os `platform-tenant` e `cmtw6g6n2000011fkz27onkh0` classificados como `CONCURRENCY_RACE`, o `indexdef` com cláusula `WHERE "timestamp" >= '...'`, e `is_nullable = NO` em ambas as colunas.

### 4.4 · Continuar no Passo 5 do prompt original

Testes, commit, deploy e as 15 verificações de produção, sem alterações — **exceto o ponto 15**, que passa a esperar isto:

| # | Verificação | Esperado |
|:--|:--|:--|
| 15 | `npm run audit:verify` contra produção | `valid: true`, com `documentedBreaks: 18` e a declaração qualificada. **Não** um "íntegra" simples |

Se devolver "Íntegra desde a génese" sem qualificação, algo correu mal — os incidentes não foram documentados. Reporta.

---

## 5. ACRESCENTO À DOCUMENTAÇÃO

No `DECISOES.md`, uma ADR nova que vale a pena ficar registada por escrito:

> **ADR — Descontinuidades históricas da cadeia de auditoria: documentar, não apagar.**
> As 18 colisões de `prevHash` anteriores à v1.1.0 são consequência da serialização em memória, inoperante em serverless, e estão confirmadas como corridas de escrita por intervalos de 2 a 181 ms. Optou-se por preservá-las e documentá-las em `audit_chain_incidents`, aplicando o índice único apenas a partir do momento da migração. Re-selar a cadeia faria a evidência desaparecer — que foi o que sucedeu a 2026-09-11 e é o padrão que esta versão existe para eliminar. Uma cadeia de auditoria cuja própria história de falhas é apagada não tem valor probatório.

No `DIARIO.md`, regista também a paragem no Passo 3 e a razão pela qual a instrução mudou. Um relatório que mostra onde o plano estava errado vale mais do que um que só mostra o plano a correr bem.

---

## 6. RESUMO

Não vais re-selar nada. Vais documentar 18 incidentes, aplicar a unicidade daqui para a frente, e deixar o histórico como está — partido onde esteve partido, e com a explicação ao lado.

Regenera o Prisma, corre o pre-flight, aplica a migração, e segue para o Passo 5.
