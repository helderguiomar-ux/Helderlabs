# Separação de Ambientes & Guia de Deploy — HELDERLABS ERP

Este documento estabelece a arquitetura oficial dos 3 ambientes e o fluxo de trabalho de deploy para o **HELDERLABS ERP (v0.2.0)**.

---

## 🏛️ 1. Matriz de Ambientes & Fronteiras de Segurança

| Ambiente | Onde corre | Base de Dados | Tipo de Dados | Acesso & Credenciais |
|---|---|---|---|---|
| **local** | Máquina de Dev (`npm run dev`) | PostgreSQL Local (`localhost:5432`) | Seed sintético ou dump anonimizado | Ficheiro `backend/.env` local (sem segredos de prod) |
| **preview** | Vercel Preview (Branch/PR) | Neon Branch Efémero | Dados anonimizados descartáveis | Injetados pelas Vercel Env Vars do ambiente Preview |
| **production** | Vercel Production (`helderlabs.eu`) | Neon Cloud PostgreSQL (`main`) | Dados reais de clientes | Apenas Vercel Production Env Vars (acesso restrito) |

### Regras Absolutas de Segurança:
1. **Zero Credenciais de Produção em Disco Local**: Ficheiros `.env.production` ou `.env.local` contendo segredos de produção são estritamente proibidos no disco local e ignorados pelo Git.
2. **Guarda de Base de Dados Ativa (`guard-db.mjs`)**: Todos os comandos mutativos locais (`npm run dev`, `npm run db:migrate`, `npm run db:reset`, `npm run db:seed`) executam uma verificação prévia do host da base de dados. Se `DATABASE_URL` não for `localhost`/`127.0.0.1`/`postgres`, o comando é instantaneamente abortado.
3. **Migrações em Produção**: A produção recebe alterações de schema **exclusivamente via `prisma migrate deploy`** executado no pipeline de deploy, nunca a partir de uma máquina de desenvolvimento.
4. **Paridade de Runtimes**: Node.js `>=20` e PostgreSQL 18 fixados em local e produção.

---

## 💻 2. Desenvolvimento e Testes Locais

### 2.1 Arrancar a Base de Dados Local
```bash
# Opção A: PostgreSQL Local nativo (serviço local na porta 5432)
# Opção B: Docker Container
cd backend
npm run db:up
```

### 2.2 Migrar e Popular Dados Sintéticos
```bash
cd backend
npm run db:migrate -- --name <descricao_da_migracao>
npm run db:seed
```

O `seed.ts` popula automaticamente os 4 cenários de teste essenciais:
- **Tenant 0 (`helderlabs-platform`)**: Super Admin com todos os 6 módulos `ACTIVE`.
- **Tenant 1 (`consultoria-alfa`)**: CRM `ACTIVE` (limites de consumo perto do topo: 4/5 leads), Financeiro em `TRIAL` (expira em 3 dias), Utilizador `PENDING_APPROVAL` e Utilizador sem atribuição.
- **Tenant 2 (`administra-condo`)**: Tenant em estado `GRACE` com módulo de Condomínios.
- **Tenant 3 (`startup-inovacao`)**: Tenant em estado `SUSPENDED` por falta de pagamento.

### 2.3 Execução do Servidor
```bash
# Modo Standalone (servidor HTTP local em http://localhost:3333)
npm run dev

# Modo Serverless (simula a runtime da Vercel)
npm run dev:serverless
```

---

## 🔄 3. Fluxo de Trabalho & Deploy Pipeline

```
1. Feature Branch ──► git checkout -b feat/<nome>
                             │
                             ▼
2. Dev Local ───────► npm run db:migrate -- --name <nome>
                      npm run db:seed
                      npm run dev & npm run dev:serverless
                             │
                             ▼
3. Verificação ─────► npm run verify (typecheck + 44 testes)
                             │
                             ▼
4. Push & Preview ──► git push -u origin feat/<nome>
                      (Vercel gera Preview URL com Neon branch)
                             │
                             ▼
5. Validation ──────► Testes de aceitação no Preview URL
                             │
                             ▼
6. Pull Request ────► Merge para branch `master`
                             │
                             ▼
7. Deploy Produção ─► Pipeline: env:check ➔ prisma migrate deploy ➔ build ➔ deploy
```

---

## 🛡️ 4. Plano de Reversão (Disaster Recovery & Rollback)

### Backup Prévio a Deploy:
Antes de qualquer deploy contendo migrações de schema em produção, efetuar um backup binário da Neon Cloud DB:
```bash
pg_dump "<PROD_DATABASE_URL>" -F c -b -v -f "../backups/backup_pre_deploy_$(date +%Y%m%d_%H%M).dump"
```

### Regras de Retrocompatibilidade de Schema:
- Migrações e código devem ser sempre **retrocompatíveis**. Novas colunas devem ser criadas como opcionais ou com valor `DEFAULT`.
- Eliminações de colunas ou tabelas realizam-se em dois deploys faseados:
  1. **Deploy 1**: O código deixa de ler/escrever na coluna/tabela obsoleta.
  2. **Deploy 2**: A migração remove a coluna/tabela da base de dados.
- Em caso de emergência, o **Instant Rollback na Vercel** repõe a versão anterior do código instantaneamente, permanecendo compatível com a base de dados devido às regras de retrocompatibilidade.
