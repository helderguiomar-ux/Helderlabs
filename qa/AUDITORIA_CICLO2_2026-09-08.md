# HELDERLABS ERP — AUDITORIA INDEPENDENTE · CICLO 2
## Retratação de um falso positivo + reverificação contra o código mais recente

> **Auditor:** Claude (independente) · **Implementação:** Antigravity
> **Data:** 2026-09-08 · Substitui parcialmente `qa/AUDITORIA_2026-09-08.md`
> **Método:** todos os achados abaixo foram lidos de ficheiros re-obtidos do dispositivo nesta ronda, com mtime indicado.

---

# 1. RETRATAÇÃO — HL-C01 ERA UM FALSO POSITIVO

**Retiro o achado HL-C01 ("O módulo HCCALL não é acessível por ninguém"). Estava errado.**

Verificação feita agora, contra o dispositivo:

| Afirmei | Realidade |
| :--- | :--- |
| `seed.ts` não contém `hccall` | **Contém.** Linha 69: `{ key: "hccall", name: "HCCALL Telecom", … isActive: true }` (mtime 1788903896682) |
| `modules.js` sem entrada | **Tem.** Linhas 42 e 49: `key: "hccall"`, `route: "/hccall.html"` (mtime 1788903888434) |
| `locales/pt.json` e `en.json` sem chaves | **Têm**, com paridade (mtime 1788903535417 / 1788903537399) |
| `public/hccall.html` NÃO EXISTE | **Existe**, 34.752 bytes, com `hccall-sw.js` (service worker) e `hccall.webmanifest` (mtime 1788903645699) |

**Causa do erro, sem desculpas:** corri `grep` e `ls` contra a cópia do projeto no meu ambiente, que continha ficheiros trazidos numa ronda **anterior** e, no caso do `hccall.html`, não continha o ficheiro de todo. Um `ls` que não encontra o ficheiro num diretório incompleto não é prova de que o ficheiro não existe no dispositivo. Concluí ausência a partir de uma cópia parcial e desatualizada — exatamente o erro contra o qual o próprio mecanismo de cópia avisa.

**Correção de método, que passo a aplicar sempre:**
1. Nenhuma afirmação de **ausência** (ficheiro, chave, registo) sem re-obter o ficheiro do dispositivo nessa mesma ronda.
2. Nenhuma conclusão a partir de uma cópia sem confirmar o `mtime` contra o dispositivo.
3. Todo o achado passa a indicar o `mtime` da fonte que o suporta.

Isto ilumina uma coisa: **é assim que um auditor perde credibilidade** — não por não encontrar problemas, mas por reportar um problema que não existe. Um falso positivo desta dimensão manda o Antigravity trabalhar em código que já estava feito.

---

# 2. ESTADO REAL — reverificado contra o código mais recente

Entre a auditoria anterior e agora, o Antigravity alterou `HccallSaleService.ts`, `HccallController.ts`, `hccall.routes.ts` e `app.html` (que passou de 89 KB para 35,8 KB — foi partido, como recomendado). Reverifiquei tudo o que reportei.

## 2.1 CRITICAL — continua aberto

### HL-C02 · IDOR intra-tenant: um operador altera e apaga as vendas dos colegas
```
ID              HL-C02
Severity        CRITICAL          Tipo: CONFIRMED BUG
Module          hccall
Fonte           HccallSaleService.ts · mtime 1788905115075 (versão mais recente)
Problem         O âmbito de visibilidade (hccall.visibility = OWN, por omissão) é
                aplicado às listagens, mas não às operações por id.
Expected        Com OWN, o utilizador A não lê, não altera e não apaga vendas de B.
Actual          linha 399  static async deleteSale(db, tenantId, userId, id) {
                linha 400    return db.hccallSale.update({ where: { id },
                linha 402      data: { deletedAt: new Date() } });
                linha 406  static async restoreSale(db, tenantId, userId, id) { … idem
                `tenantId` e `userId` são recebidos e NÃO USADOS.
                updateSale (l.162-168) e getSaleById (l.299-310) validam apenas
                `existing.tenantId !== tenantId` — nunca `ownerUserId`.
Root cause      O âmbito vive no serviço de listagem; as operações por id não o consultam.
Recommended fix Helper único `loadOwnedSale(db, tenantId, userId, id)` que aplica
                `HccallScopeService.getVisibilityScope()` e devolve 404 quando não
                pertence. Usado por get/update/delete/restore. Nunca
                `update({ where: { id } })` nu.
Test required   A (OWN) → PUT e DELETE em venda de B → 404. Com TEAM → 200.
```

## 2.2 HIGH — todos reconfirmados no código mais recente

| ID | Achado | Evidência (grep desta ronda) |
| :--- | :--- | :--- |
| HL-H01 | `createSale` executa 7 passos sem transação | `$transaction` = **0 ocorrências** em todo o módulo |
| HL-H02 | Idempotência com race (TOCTOU) entre `findUnique` e `create` | `HccallSaleService.ts` l.30-40 |
| HL-H03 | Histórico de alterações gravado com `.catch(() => {})` | l.**138** e l.**292** |
| HL-H04 | Nenhuma escrita passa pelo `AuditService` | `AuditService` = **0 ocorrências** no módulo |
| HL-H05 | Três GETs escrevem na BD via `ensureDefaults()` | `HccallConfigService.ts` l.**7**, **61**, **152** (+ dois `.catch(() => {})` em l.235 e l.258) |
| HL-H06 | `RECENT_CHANGES` (IA) ignora o âmbito de visibilidade | `HccallController.ts` · handleAiQuery |
| HL-H07 | `statusId` inválido aceite e gravado | `HccallSaleService.ts` l.~88-95 e ~173-182 |
| HL-H08 | 24 modelos novos (`Hccall*`, `Sell*`) sem FK para `tenants` | `schema.prisma` mtime 1788903664523, linhas 1400-1910 |
| HL-H09 | Dashboard faz `findMany` sem `take` sobre o mês inteiro | `HccallSaleService.ts` · getSummaryMetrics |

## 2.3 MEDIUM — reconfirmados

`version` da dinamização **nunca é incrementado** (`version: { increment` = 0 ocorrências) · CSV limitado a 200 linhas em silêncio · `anonymizeCustomer` sem permissão dedicada, sem confirmação e sem auditoria · deteção de conflito dependente de `occurredAt` opcional · `catch {}` vazio no `HccallScopeService` · import morto de `prisma` no `HccallCounterService` · `TOP_SERVICES` calculado sobre as últimas 100 vendas · comissão em falta grava 0 € · `SellAuctionLot` com `@@unique` sem `tenantId`.

---

# 3. QUADRO ATUALIZADO

```
HELDERLABS ERP
AUDITORIA — CICLO 2

Overall Health:      64 / 100      (era 58; sobe com a retirada do falso positivo)

CRITICAL:             1            (era 2 — HL-C01 retirado)
HIGH:                 9
MEDIUM:               9
Falsos positivos:     1            (assumido e corrigido)

Testes automáticos:  NÃO EXECUTADOS
Build / typecheck:   NÃO EXECUTADOS
```

## Condições de aceitação

```
CRITICAL = 0        atual: 1      ✗   (HL-C02)
HIGH = 0            atual: 9      ✗
BUILD = PASS        não executado ⚫
TYPECHECK = PASS    não executado ⚫
SECURITY = PASS     atual: FAIL   ✗   (HL-C02, HL-H06)
CORE E2E = PASS     não executado ⚫
```

---

# 4. O QUE CONTINUA POR EXECUTAR, E PORQUÊ

Esta sessão lê e escreve ficheiros na tua máquina mas **não tem shell nela**: não consigo correr `npm run verify`, arrancar o servidor nem abrir o browser. Testei também a alternativa de montar o projeto no meu ambiente de nuvem:

- registo npm: **acessível** (HTTP 200)
- `binaries.prisma.sh`: **bloqueado** pelo proxy (sem resposta)
- PostgreSQL: só o cliente `psql`, **sem servidor**

Ou seja, consigo instalar dependências, mas `prisma generate` na forma normal falha e não há base de dados para testes de integração. Resta um caminho parcial e honesto: `prisma generate --no-engine` (gera só os tipos) e depois **`tsc --noEmit` e `eslint`** — o que fecharia a parte estática da Fase 8. Testes que dependem de BD real continuam fora de alcance.

**Duas opções, à tua escolha:**
1. **Corres tu e colas a saída** de `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run test:browser`. É o caminho rápido e completo.
2. **Autorizas-me a montar a parte estática aqui** (trazer o código-fonte, `npm install`, `prisma generate --no-engine`, `tsc --noEmit`, `eslint`). Fecha lint e typecheck; não fecha testes de BD nem browser.

---

# 5. PRIORIDADE RECOMENDADA PARA O MODO FIX

1. **HL-C02** — segurança, e resolve-se com um helper e quatro chamadas.
2. **HL-H01 + HL-H02 + HL-H03** — transação em `createSale`/`updateSale`, idempotência por `upsert`, e histórico dentro da transação. São o mesmo ponto: integridade da venda e da sua auditoria.
3. **HL-H05** — mover `ensureDefaults` para a ativação do módulo.
4. **HL-H06** — filtrar `RECENT_CHANGES` pelo âmbito.
5. **HL-H08** — migração aditiva com as chaves estrangeiras.
