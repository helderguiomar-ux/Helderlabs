# ERP local — três formas, e a que deves usar

---

## Resposta curta

Sim, e o projeto já tinha quase tudo preparado. Há três montagens possíveis, com riscos muito diferentes:

| | Dados | Risco | Quando usar |
|:--|:--|:--|:--|
| **A · Espelho local** | reais, anonimizados, cópia | nenhum | trabalho do dia a dia |
| **B · Online só-leitura** | reais, ao vivo | nenhum | consultar o estado real |
| **C · Online leitura/escrita** | reais, ao vivo | **escreves em produção** | só quando for mesmo preciso |

Já implementei as três. Mas antes disso há uma coisa mais urgente.

---

## Primeiro: encontrei um problema no caminho

O `npm test` **não tinha guarda de base de dados**.

Vê a diferença nos scripts originais:

```json
"dev":     "npm run db:guard && tsx watch src/server.ts",   ← protegido
"db:reset":"npm run db:guard && prisma migrate reset",      ← protegido
"test":    "node scripts/collect-and-run-tests.mjs"         ← SEM GUARDA
```

O `guard-db.mjs` recusa comandos de schema contra bases não-locais. Está bem feito. Mas os **testes** corriam contra o que quer que estivesse em `DATABASE_URL`.

E o `DATABASE_URL` do teu `.env` aponta para produção — sabemo-lo com certeza, porque foi com ele que o `prisma migrate deploy` aplicou a migração à base que tinha os 18 duplicados e os 1974 registos de auditoria.

Ou seja: **os 169 testes que correram hoje escreveram na base de dados de produção.** Criaram tenants, utilizadores e transações financeiras, apagaram-nos no fim — mas os registos de auditoria que geraram ficaram lá, e são permanentes. Parte daquelas 706 falhas de autenticação vêm daí.

Não é catastrófico. É higiene, e agora está fechado:

```json
"test":        "npm run db:guard && node scripts/collect-and-run-tests.mjs",
"test:unsafe": "node scripts/collect-and-run-tests.mjs"
```

**Isto vai fazer o `npm test` falhar já a seguir**, com a mensagem do guard. Não é uma avaria — é a proteção a funcionar. A saída é montar a base local (opção A), que é o passo seguinte de qualquer maneira.

---

## A · Espelho local — a recomendada

Dados reais, na tua máquina, sem qualquer risco para produção. O `db-mirror.mjs` já existia no projeto e faz exatamente isto: `pg_dump` da produção → restauro local → anonimização.

### Montagem, uma vez

```bash
# 1. Postgres local (o docker-compose.yml já está no repositório)
docker compose up -d

# 2. backend/.env — DATABASE_URL aponta para LOCAL
DATABASE_URL="postgresql://helderlabs:local_dev_only@localhost:5432/helderlabs_erp"

# 3. Estrutura
cd backend && npx prisma migrate deploy

# 4. Trazer os dados reais, anonimizados
PROD_DATABASE_URL="<a tua URL do Neon>" npm run db:mirror
```

### Dia a dia

```bash
docker compose up -d
cd backend && npm run dev        # http://localhost:3333
```

Podes partir tudo, apagar tudo, testar migrações destrutivas. Refrescas com `npm run db:mirror` quando quiseres dados novos. **É aqui que o desenvolvimento deve acontecer.**

Confirma o que o `scripts/anonymize.sql` cobre antes de confiares na anonimização — se não mascarar emails e telefones, há dados pessoais reais na tua máquina.

---

## B · Online, só leitura — para ver o estado real

Aplicação local, base de dados de produção, **escritas impossíveis**. Não por disciplina tua, mas porque o servidor de base de dados as recusa.

### Criar o utilizador só-de-leitura no Neon

```sql
CREATE ROLE helderlabs_ro WITH LOGIN PASSWORD '<uma password forte>';
GRANT CONNECT ON DATABASE <a_tua_bd> TO helderlabs_ro;
GRANT USAGE ON SCHEMA public TO helderlabs_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO helderlabs_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO helderlabs_ro;
```

### `backend/.env`

```bash
DATABASE_URL="postgresql://helderlabs:local_dev_only@localhost:5432/helderlabs_erp"   # continua LOCAL
ONLINE_DATABASE_URL="postgresql://helderlabs_ro:<password>@<host>.neon.tech/<bd>?sslmode=require"
ONLINE_DB_READONLY=true
```

### Usar

```bash
cd backend && npm run dev:online
```

```
 BD ONLINE · SÓ LEITURA 
  Host       : ep-xxx.eu-central-1.aws.neon.tech
  Aplicação  : http://localhost:3333
  Modo       : só leitura (as escritas falham no servidor)
```

Navegas, vês os dados reais, abres dashboards. Qualquer tentativa de escrita devolve erro — incluindo as escritas de auditoria, o que significa que **os ecrãs de leitura funcionam e os fluxos de escrita não**. É intencional: é o preço de não poder estragar nada.

---

## C · Online, leitura e escrita — o que pediste, com travões

Mesmo comando, `ONLINE_DB_READONLY=false`. Pede confirmação escrita antes de arrancar:

```
 BD ONLINE · LEITURA E ESCRITA 
  Modo       : ESCRITA REAL EM PRODUÇÃO

  Tudo o que fizeres nesta sessão altera dados reais.
  Cada pedido não-GET grava também na cadeia de auditoria de produção.

  Escreve "producao" para continuar:
```

### Porque é que isto é um comando próprio e não uma linha no `.env`

Porque o `DATABASE_URL` é usado por **tudo**: `prisma migrate`, `db push`, o seed, os testes. Apontá-lo para produção é exatamente como os testes acabaram a escrever lá. A ligação online fica numa variável separada que **só este comando lê**, e o `.env` mantém-se local.

O script também força `ALLOW_DEV_OTP=false` e `ALLOW_DEV_MASTER_OTP=false` — o código mestre `123456` nunca funciona contra dados reais, independentemente do que esteja no `.env`.

### O que continua a ser verdade neste modo

- Cada operação de escrita entra na **cadeia de auditoria de produção**, com o teu IP real (a v1.1.1 acabou de corrigir isso).
- O bootstrap do super-admin corre no arranque e escreve na base de produção.
- Uma migração acidental continua bloqueada pelo `guard-db.mjs` — o `DATABASE_URL` é local, logo o Prisma nunca vê a produção.

---

## Qual usar

- **A** para desenvolver. Sempre.
- **B** para "quero ver como é que os dados reais aparecem nos ecrãs".
- **C** só quando tiveres de corrigir dados reais e não houver interface para isso — e nesse caso, provavelmente a resposta certa é construir a interface.

---

## Ficheiros alterados

```
backend/package.json          test com guarda + test:unsafe + dev:online
backend/scripts/dev-online.mjs  novo
backend/.env.example          ONLINE_DATABASE_URL, ONLINE_DB_READONLY, ONLINE_DB_CONFIRM
```

Nada disto toca no código da aplicação — são só ferramentas de desenvolvimento. Não precisa de deploy, não entra na v1.1.1.

---

## Uma consequência a ponderar

Se os testes andaram a correr contra produção desde o início, vale a pena verificar se ficaram resíduos:

```sql
SELECT id, name, slug, "createdAt" FROM tenants
 WHERE slug LIKE 'tenant-%teste%' OR slug LIKE '%test%' OR name ILIKE '%teste%'
 ORDER BY "createdAt" DESC;

SELECT id, email, name, "createdAt" FROM users
 WHERE email LIKE '%@exemplo.pt' OR email LIKE 'test%' OR email LIKE '%.teste.%'
 ORDER BY "createdAt" DESC;

SELECT COUNT(*) AS eventos_de_teste FROM audit_logs
 WHERE "actorEmail" LIKE '%@exemplo.pt' OR resource = 'TesteConcorrencia';
```

Os tenants e utilizadores podem ser apagados se forem mesmo resíduo de teste. **Os registos de auditoria não** — apagar linhas da cadeia parte-a, e é exatamente o que esta versão existe para impedir. Ficam onde estão; agora sabes de onde vieram.
