# PROMPT — Deploy da v1.3.0 · HCCALL móvel
> Colar no Antigravity, na raiz de `C:\Users\helde\Desktop\Dev\helderlabs-erp`.
> **Autorização de deploy dada pelo Hélder** (protocolo §17).

---

## 0. ANTES DE TUDO — PROTOCOLO §12

```bash
type PROJECT_STATE.md      # ler a secção "Sessão — 12/09/2026 · HCCALL móvel"
git status
git branch --show-current
git log -1 --oneline
```

**As alterações desta sessão estão NO WORKING TREE, por commitar.** Foram escritas
diretamente nos ficheiros, não vieram de um `git pull`. Isto significa que
existem **apenas neste computador** e não estão protegidas.

Por isso, e por causa do protocolo §14:

> **Não executes `reset`, `checkout`, `clean`, `stash` nem rebase.** Qualquer uma
> destas operações apaga trabalho que não existe em mais lado nenhum.

Se o `git status` mostrar algo que não esperas, **para e reporta** antes de tocar
em nada.

Ficheiros que devem aparecer como alterados ou novos:

```
M  backend/public/hccall.html                    (reescrito, 64 KB)
M  backend/prisma/schema.prisma
M  backend/src/version.ts
M  backend/src/modules/hccall/controllers/HccallController.ts
M  backend/src/modules/hccall/services/HccallProductService.ts
M  backend/src/modules/hccall/services/HccallDynamizationService.ts
M  backend/src/modules/hccall/services/HccallSaleService.ts
M  backend/package.json · package.json           (1.2.0 → 1.3.0)
M  local-client/server.mjs                       (versão reportada → 1.3.0)
?? backend/prisma/migrations/20260912200000_hccall_mobile_fields/
?? PROJECT_STATE.md
```

---

## 1. PORQUE É QUE ESTE DEPLOY É NECESSÁRIO

O ficheiro novo **já está na pasta do código-fonte** e o cliente desktop serve-o
de imediato: `local-client/server.mjs` lê de `../backend/public`, que é
exatamente onde o `hccall.html` novo foi escrito. Não é preciso `git pull`.

**Mas abrir agora, antes do deploy, dá uma aplicação inútil.** Isto foi
verificado, não presumido — a interface nova foi corrida contra uma simulação da
API de produção tal como está hoje:

```
  Comissão mostrada : 0,00 €
  Nota              : «Pacote TV+Net» ainda não tem comissão definida
```

A aplicação carrega e parece correta, mas:

- **todos os serviços mostram 0,00 €** — a API 1.1.0 não devolve `defaultCommissionCents`;
- **todas as dinamizações mostram 0,00 €** — não devolve `baseAmountPerSaleCents`;
- **o número de ordem é descartado em silêncio** — o Zod antigo remove campos que não conhece, sem erro;
- configurar comissões nas Definições não tem efeito: o valor é aceite e deitado fora.

### Matriz de compatibilidade

| Cliente | API | Resultado |
|:--|:--|:--|
| 1.2.0 (HCCALL antigo) | 1.2.0 | funciona |
| 1.2.0 (HCCALL antigo) | **1.3.0** | **funciona** — os campos novos simplesmente não são enviados |
| **1.3.0 (HCCALL novo)** | 1.1.0 / 1.2.0 | **comissões a zero, n.º de ordem perdido** |
| 1.3.0 | 1.3.0 | funciona |

**`MINIMUM_CLIENT_VERSION` continua em 1.2.0 e NÃO deve ser alterado.** Está
documentado no próprio `src/version.ts`. Subi-lo trancaria à porta um cliente
desktop que ainda não tenha os ficheiros novos.

---

## 2. VALIDAÇÃO ESTÁTICA

```bash
cd backend
npx prisma generate
npm run typecheck
npm run lint
```

Contexto: a verificação de tipos feita pelo autor correu **sem o cliente Prisma
gerado** (o ambiente dele não consegue descarregar os binários). Baseline de 19
erros pré-existentes, mantida em 19 depois das alterações — mas **nomes de campos
Prisma não foram validados**. É agora que são.

Os três campos novos a confirmar: `defaultCommissionCents` (HccallProduct),
`baseAmountPerSaleCents` (HccallDynamization), `orderNumber` (HccallSale).

Erro em qualquer destes ficheiros é das alterações entregues — **reporta a linha
exata antes de tocar em nada**:

```
backend/src/version.ts
backend/src/modules/hccall/controllers/HccallController.ts
backend/src/modules/hccall/services/HccallProductService.ts
backend/src/modules/hccall/services/HccallDynamizationService.ts
backend/src/modules/hccall/services/HccallSaleService.ts
```

**Artefacto:** saída completa com código de saída.

---

## 3. TESTES

```bash
RESEND_API_KEY=test_key_presente npm test
```

A guarda de base de dados recusa correr contra produção — é o comportamento
correto e não é uma avaria. Se falhar por isso, monta a base local
(`docker compose up -d` + `prisma migrate deploy` + `npm run db:mirror`) conforme
o `Claude outputs/GUIA_ERP_LOCAL.md`.

Procura na saída o bloco `[CRÍTICO]` sobre a password do super-admin e inclui-o
no relatório, literalmente.

**Artefacto:** contagem de passes e falhas.

---

## 4. MIGRAÇÃO

```bash
psql "$DATABASE_URL" -c "
SELECT column_name FROM information_schema.columns
 WHERE (table_name='hccall_products'      AND column_name='defaultCommissionCents')
    OR (table_name='hccall_dynamizations' AND column_name='baseAmountPerSaleCents')
    OR (table_name='hccall_sales'         AND column_name='orderNumber');"

npx prisma migrate deploy
```

Migração: `20260912200000_hccall_mobile_fields`.

**Estritamente aditiva.** Três colunas novas, todas com `DEFAULT` ou anuláveis,
todas com `IF NOT EXISTS`. Nenhuma linha existente é alterada, nenhuma query
existente é afetada, e a API 1.1.0 que está em produção continua a funcionar
enquanto o deploy do código não acontecer. **Não há operação destrutiva** — nem
`DROP`, nem `TRUNCATE`, nem `DELETE`.

Pode, por isso, ser aplicada com segurança antes do push.

**Artefacto obrigatório:**

```sql
SELECT table_name, column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
 WHERE (table_name='hccall_products'      AND column_name='defaultCommissionCents')
    OR (table_name='hccall_dynamizations' AND column_name='baseAmountPerSaleCents')
    OR (table_name='hccall_sales'         AND column_name='orderNumber')
 ORDER BY table_name;

SELECT indexname FROM pg_indexes WHERE indexname='hccall_sales_tenant_order_idx';
```

Espera-se três linhas — duas `integer NOT NULL DEFAULT 0`, uma `text` anulável —
e o índice criado.

---

## 5. COMMIT E DEPLOY

```bash
cd ..
git add -A
git status                 # confere a lista antes de commitar

git commit -m "feat(v1.3.0): HCCALL movel - registo de vendas, configuracao e analise

Interface do HCCALL reconstruida como aplicacao mobile-first, servida
localmente ou pela web e a falar sempre com a API online.

Base de dados (migracao aditiva 20260912200000_hccall_mobile_fields):
- hccall_products.defaultCommissionCents: comissao por omissao do servico
- hccall_dynamizations.baseAmountPerSaleCents: comissao fixa por venda.
  O HccallCommissionEngine ja suportava o conceito; faltava a coluna e o
  campo na API para o poder configurar.
- hccall_sales.orderNumber (+ indice): numero de ordem do operador,
  distinto de code (interno) e de customerNumber (cliente)

Backend:
- os tres campos nos schemas Zod e nos servicos correspondentes
- orderNumber incluido na pesquisa de vendas
- APP_VERSION 1.3.0; MINIMUM_CLIENT_VERSION MANTIDO em 1.2.0 para nao
  trancar a porta a um cliente desktop que ainda nao tenha os ficheiros
  novos - todas as alteracoes sao aditivas

Frontend (backend/public/hccall.html):
- quatro ecras: Registar, Vendas, Analise, Definicoes
- mobile: navegacao inferior, alvos de toque 48px, campos a 16px para
  evitar o zoom do iOS, safe-area respeitada
- desktop >=900px: a mesma aplicacao com barra lateral
- registo em um toque no servico mais tres campos; comissao visivel
  dentro da barra fixa, encostada ao botao
- definicoes: CRUD de servicos, dinamizacoes e objetivos mensais
- analise: previsao do mes por dia util, medidor de objetivo com marca
  de ritmo, seis meses de comissao e reparticao por servico
- paleta de dados validada para daltonismo nos dois temas

Verificado: typecheck na baseline (19), sem erros de consola, renderizado
em 390x844, 768x1024 e 1440x900 nos dois temas."

git tag -a v1.3.0 -m "v1.3.0 - HCCALL movel"
git push origin master --follow-tags
```

Aguarda a conclusão do build no Vercel.

---

## 6. VERIFICAÇÃO EM PRODUÇÃO

| # | Verificação | Esperado |
|:--|:--|:--|
| 1 | `GET /api/version` | `version: "1.3.0"`, `minimumClientVersion: "1.2.0"` |
| 2 | `commitSha` = `git rev-parse HEAD` | igual |
| 3 | `GET /api/hccall/products` autenticado | os objetos trazem `defaultCommissionCents` |
| 4 | `POST /api/hccall/products` com `defaultCommissionCents: 1500` | gravado, e a leitura devolve 1500 |
| 5 | `POST /api/hccall/dynamizations` com `baseAmountPerSaleCents: 2500` | gravado |
| 6 | `POST /api/hccall/sales` com `orderNumber: "ORD123"` | gravado e devolvido |
| 7 | `GET /api/hccall/sales?search=ORD123` | encontra a venda pelo número de ordem |
| 8 | Cliente **1.2.0** a chamar a API 1.3.0 | continua a funcionar, sem 426 |

O ponto 8 é o teste da compatibilidade e não pode ser saltado: envia um pedido
com `X-HelderLabs-Client-Version: 1.2.0` e confirma que **não** devolve 426.

**Artefacto:** resposta HTTP de cada um.

---

## 7. TESTE DO HÉLDER — no telemóvel

Depois de o deploy estar verde, avisa-o para:

1. Abrir o ícone **HelderLabs ERP** no Ambiente de Trabalho
2. `Definições` → criar dois ou três serviços com a comissão real de cada um
3. `Definições` → criar a dinamização em curso, com nome, datas e comissão
4. `Definições` → criar o objetivo do mês
5. `Registar` → registar uma venda a sério
6. `Análise` → confirmar que a previsão e o objetivo refletem a venda
7. Abrir `https://helderlabs.eu/hccall.html` no browser e confirmar que **os
   mesmos dados estão lá** — é a prova da arquitetura: dois clientes, uma API,
   uma base de dados

Para usar no telemóvel enquanto o cliente local não estiver acessível da rede, o
caminho é `https://helderlabs.eu/hccall.html` — é a mesma aplicação.

---

## 8. ATUALIZAR `PROJECT_STATE.md` — PROTOCOLO §13

Acrescenta uma secção nova no topo do histórico (**sem apagar o que lá está**):

```
## Sessão — DD/MM/AAAA HH:MM

Agente: Antigravity
Versão: 1.3.0
Branch: master
Commit: <sha>
Estado do projeto: v1.3.0 em produção
Alterações realizadas: deploy da v1.3.0; migração hccall_mobile_fields aplicada
Testes executados: typecheck, lint, npm test, 8 verificações de produção
Resultado: <...>
API: ONLINE   Base de dados: ONLINE
Desktop: serve backend/public a partir do repositório
Web: helderlabs.eu
Tenant utilizado nos testes: <...>
Problemas encontrados: <...>
Trabalho pendente: rotação da password do super-admin; DNS do Resend; D5
PRÓXIMO PASSO: <...>
Git: Committed   GitHub: Pushed   Deploy: Realizado
```

E atualiza o bloco **ESTADO ATUAL** no topo: versão em produção 1.3.0, commit
novo, e a migração deixa de estar "por aplicar".

---

## 9. O QUE CONTINUA EM ABERTO

Não faz parte deste deploy — mantém na lista:

- 🔴 **Password do super-administrador por rodar.** O teste voltou a confirmar
  que `admin1234` continua gravada. É do Hélder.
- 🔴 **DNS do Resend** (`helderlabs.eu` em `not_started`).
- **D5:** bónus de objetivo acumulam ou vigora só o escalão mais alto? Bloqueia
  o módulo de comissões com os três estados.
- Passo 7 do deploy da v1.1.0 — as 15 verificações.
- HCCALL: Meu Perfil, Definições do utilizador, histórico além de 6 meses.

---

## REGRA DE SEGURANÇA

Antes de qualquer operação destrutiva na base de dados de produção: **parar e
pedir confirmação**. Esta migração não é destrutiva. Criar e editar dados através
da API faz parte do funcionamento normal e pode ser testado à vontade.

Se algum passo falhar, **para e reporta** — não avances deixando o anterior a
meio.
