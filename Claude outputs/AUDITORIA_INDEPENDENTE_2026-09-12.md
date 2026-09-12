# Auditoria Independente — HELDERLABS ERP
**Data:** 2026-09-12 · **Âmbito:** backend `helderlabs-erp` (plataforma, auth, CRM, Finanças, 2SELLMAIS, HCCALL)
**Método:** leitura direta do código-fonte em `C:\Users\helde\Desktop\Dev\helderlabs-erp` + estado real da conta Resend.
**Natureza:** revisão estática com evidência citada. Não foi executado o build nem testes — cada afirmação abaixo é rastreável a um ficheiro.

---

## 0. Conclusão em três frases

O `ESTADO.md` declara **v0.5.0 · PRONTO / VALIDADO · 82/82 testes 100% verde**. Essa declaração é falsa como indicador de prontidão para produção, e a **secção 2 deste relatório explica mecanicamente porquê os testes passam enquanto a aplicação está partida** — não é má fé do agente, é uma suite construída sobre um ambiente que não reproduz produção.

O motor de comissões do HCCALL é a melhor peça de engenharia do repositório. O resto do sistema tem **uma backdoor de autenticação ativa em produção**, **duas fontes de verdade concorrentes no módulo financeiro** e **uma cadeia de auditoria estruturalmente incapaz de se manter íntegra em serverless**.

Nenhum dos módulos que consideras "prontos para produção" (CRM / 2SELLMAIS / Finanças / HCCALL) o está, mas por razões diferentes e com esforços de correção muito diferentes.

---

## 1. O erro do ecrã — cadeia de causalidade completa

O que vês:

> `Falha no envio de email: The helderlabs.eu domain is not verified. Please, add and verify your domain on https://resend.com/domains`

### 1.1 Causa raiz (infraestrutura)

Verifiquei a tua conta Resend diretamente. O domínio existe desde **04/08/2026** e está no estado **`not_started`** — ou seja, **os registos DNS nunca foram publicados**. Os três registos em falta:

| Tipo | Nome | Valor | Prioridade |
|:--|:--|:--|:--|
| TXT (DKIM) | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDm4h/ZDaglIhKbPlrZBh71wyY4ra9ldOg5q86y5ldvAqwokJ7s8ivCtTWkRJYGQ5cQVHlU+HrQFsBVeFFn/QCaTxmzIpau7t1czZxFiOe6HhXkHBHnFzVXyKpZWy1GYRCsv39V+21e9KOlB4NJbXFvDU4G1o2Enscyt7xNGS90TQIDAQAB` | — |
| MX (SPF) | `send` | `feedback-smtp.eu-west-1.amazonses.com` | 10 |
| TXT (SPF) | `send` | `v=spf1 include:amazonses.com ~all` | — |

Região: `eu-west-1`. Há um script no repositório para isto — `backend/scripts/ovh-configure-dns.mjs` — o que sugere que o passo foi previsto e nunca concluído.

### 1.2 Causa raiz (código) — e é aqui que está o problema a sério

`backend/src/routes/public.routes.ts`, rota `POST /api/public/register`:

```
1. gera OTP
2. → EmailService.sendVerificationEmail(...)     ← envio
3. if (!emailResult.ok) return reply.status(502) ← aborta
4. prisma.accountRequest.create({...})           ← NUNCA CHEGA AQUI
```

**O email é enviado antes de o pedido de acesso ser persistido.** Com o domínio por verificar, o passo 3 aborta sempre e o `AccountRequest` **nunca é criado**.

Isto resolve de uma vez **dois** dos defeitos que reportaste como separados:

- "Falha no envio de email" — sintoma visível;
- **"Pedidos de acesso não aparecem no módulo de atribuição"** — não aparecem porque **não existem**. Não é um bug do super-admin; é a consequência silenciosa do mesmo aborto.

**Correção estrutural (não é só verificar o DNS):** persistir primeiro em `PENDING_VERIFICATION`, enviar depois, e degradar com elegância — se o email falhar, o pedido fica gravado com `emailDeliveryFailed`, o utilizador recebe "não conseguimos enviar o código, o teu pedido ficou registado" e o super-admin vê-o na lista com um botão de reenvio. Um sistema empresarial não pode perder um lead porque o fornecedor de email respondeu 403.

### 1.3 Fuga de informação

A mensagem de erro do fornecedor é devolvida **verbatim** num endpoint público não autenticado (`message: emailResult.message`). Qualquer pessoa que carregue no botão descobre: que usas Resend, que o domínio não está verificado, e o URL da consola do fornecedor. Erros de terceiros nunca devem atravessar a fronteira pública — regista-se o detalhe, devolve-se um código estável (`EMAIL_DELIVERY_FAILED`).

### 1.4 O registo não valida o que pediste

`PublicRegisterSchema` (mesmo ficheiro):

```ts
emailConfirmation: z.string().email().optional(),   // ← opcional
password: z.string().min(4).optional(),             // ← 4 caracteres
passwordConfirmation: z.string().optional(),        // ← opcional
```

A confirmação de email e de password só é verificada **se o cliente as enviar**. Um POST direto à API ignora-as. A tua queixa ("registo não pede confirmação de email nem de password") está correta **ao nível do servidor**, não apenas do formulário. Password mínima de 4 caracteres é inaceitável num sistema destinado a clientes reais.

---

## 2. Porque é que o Antigravity declarou 122/122 verde com a aplicação partida

Esta é a secção mais importante do relatório. Não desconfies do agente — desconfia da suite.

### 2.1 O ramo de simulação mascara o bug exato que te bloqueia

`backend/src/modules/platform/services/EmailService.ts`:

```ts
if (!apiKey) {
  // ... em dev/test:
  return { ok: true, code: 'SIMULATED', message: 'Email simulado com sucesso (modo dev/test).' };
}
```

Em ambiente de teste **não há `RESEND_API_KEY`** → o serviço devolve sempre `ok: true` → `public.routes.ts` nunca entra no ramo `if (!emailResult.ok)` → o `AccountRequest` é criado → o teste `POST /api/public/register creates pending_verification account request with OTP` (`tests/public/publicRoutes.test.ts`) passa.

Em produção **a chave existe** e o domínio não está verificado → o ramo de falha dispara.

**Não existe um único teste que force `emailResult.ok === false`.** O caminho que está partido em produção é literalmente o único que a suite nunca percorre. 122/122 verde é, neste ponto, uma medição do ambiente de teste, não do sistema.

### 2.2 `app.inject()` não é o Vercel

Todos os testes usam `app.inject()` num processo único de `node:test`, sequencial. Isso significa que:

- a serialização de auditoria em memória (secção 4) funciona sempre nos testes e **nunca** funciona em produção;
- não existe concorrência, cold start, nem múltiplas instâncias lambda;
- nenhum teste faz um pedido HTTP real a `https://helderlabs.eu`.

Daí a divergência que reportaste entre a fonte de verdade e o que está online: **nada na suite verifica o artefacto implantado.** Verde no repositório não diz nada sobre o deploy.

### 2.3 Um teste que esconde o bug em vez de o expor

`tests/financas/finance-consistency-and-crud.test.ts`:

```ts
let modFinance = await prisma.module.findFirst({
  where: { key: { in: ['financas', 'finance'] } }
});
```

O teste aceita **qualquer uma** das duas chaves. A ambiguidade `financas` / `finance` **é** o defeito (secção 3) e o teste foi escrito para a tolerar. Um teste que se adapta ao bug converte-o em comportamento esperado.

### 2.4 Regra a impor daqui para a frente

> Nenhum agente pode declarar "pronto" com base em testes que correm com variáveis de ambiente diferentes das de produção, num único processo, e sem tocar no URL implantado.

A secção 3 do prompt para o Antigravity formaliza isto.

---

## 3. Módulo financeiro — duas fontes de verdade a coexistir

Este é o achado com maior impacto no teu dia a dia ("inconsistência de dados", "gráficos e análises incorretos", "não permite editar operações").

### 3.1 A evidência

Em `backend/prisma/schema.prisma` (87 modelos no total) coexistem:

| Linha | Modelo | Usado por |
|:--|:--|:--|
| 901 | `FinanceTransaction` | `modules/financas` → `/api/financas` |
| 1096 | `FinancialTransaction` | `modules/finance` → `/api/finance` |
| 951 | `FinanceAttachment` | `modules/financas` |
| 1149 | `FinancialAttachment` | `modules/finance` |

E em `backend/src/app.ts` **ambos os módulos são registados em simultâneo**:

```ts
app.register(financasRoutes,      { prefix: '/api/financas' });
app.register(financeModuleRoutes, { prefix: '/api/finance'  });
```

São **duas tabelas diferentes, com duas APIs diferentes, para o mesmo domínio de negócio**. Um ecrã que grava em `/api/financas` e um gráfico que lê de `/api/finance` mostram universos distintos. Não há aqui "inconsistência de dados" no sentido de corrupção — há dois sistemas financeiros a viver lado a lado.

### 3.2 O catálogo canónico agrava

`backend/src/config/modules.ts` declara **uma** entrada:

```ts
finance: { key: 'finance', aliases: ['financas'], routePrefix: '/api/financas', ... }
```

Chave `finance`, alias `financas`, prefixo `/api/financas`. O `/api/finance` **não existe no catálogo** — ou seja, metade da superfície financeira da aplicação corre fora do registo que se declara "Fonte da Verdade para módulos ativos, permissões e licenciamento". O ficheiro que devia resolver a ambiguidade é ele próprio ambíguo.

### 3.3 Serviços fantasma

`modules/finance/services/` tem quatro ficheiros que juntos somam **2,4 KB**:

- `BudgetService.ts` (392 B) — um `findFirst`
- `ReportService.ts` (329 B) — um `findMany`
- `CashFlowService.ts` (708 B) — dois `aggregate`
- `FinanceService.ts` (985 B) — dois `aggregate`

Enquanto `FinancasController.ts` tem **34,5 KB** e `DashboardController.ts` 8 KB. A camada de serviço existe no nome da pasta, não na arquitetura: **a lógica de negócio vive nos controllers.** `CashFlowController.getProjections` é literalmente um reencaminhamento de três linhas para `DashboardController`.

Consequência prática: qualquer regra financeira só pode ser testada através de HTTP, não isoladamente. É por isso que a matemática financeira não tem cobertura real.

### 3.4 Decisão que te compete

Não há forma de "corrigir" isto incrementalmente. Ou `financas` absorve `finance`, ou o contrário — com migração de dados de uma tabela para a outra e remoção física da outra rota. Recomendo manter `financas` (é o que o catálogo e o frontend referenciam) e absorver de `finance` apenas o que existir lá e não exista cá (reconciliação bancária, SAF-T, exportação). **Antes de apagar, inventário e aprovação** — como já definiste como método.

---

## 4. Auditoria e cadeia SHA-256 — não houve adulteração

O alerta que viste — *"falha na cadeia criptográfica SHA-256, adulteração detetada em prevHash na linha seq=1"* — **não é uma intrusão**. É um bug de concorrência. Tenho três evidências independentes.

### 4.1 A serialização é em memória do processo

`backend/src/modules/platform/services/AuditService.ts`:

```ts
private static partitionQueues: Map<string, Promise<any>> = new Map();
```

O encadeamento correto (`ler último hash → calcular → gravar`) é serializado por uma fila **no processo Node**. Isto funciona perfeitamente numa máquina só. **O ERP corre no Vercel**, onde há múltiplas invocações concorrentes, cada uma com o seu próprio `Map` vazio. Dois pedidos simultâneos leem o mesmo `lastLog`, calculam o mesmo `prevHash` e gravam ambos. A cadeia parte no instante em que há dois utilizadores ao mesmo tempo.

Não há `transaction`, nem `SELECT ... FOR UPDATE`, nem advisory lock.

### 4.2 A base de dados não impõe nada

No `schema.prisma`, modelo `AuditLog`:

```
seq   BigInt   @default(autoincrement())
hash  String?          ← NULLABLE
@@index([tenantId, timestamp])   ← só índices, nenhum @@unique
```

- `hash` é **opcional** — pode gravar-se uma linha de auditoria sem hash nenhum;
- **não existe** constraint única sobre `prevHash` nem sobre `(tenantId, seq)`.

Ou seja, nada ao nível da base de dados impede duas linhas com o mesmo `prevHash`. A integridade da cadeia depende inteiramente de uma estrutura em memória que não sobrevive ao modelo de execução escolhido. Isto é uma incompatibilidade de arquitetura, não um bug pontual.

**Correção:** `@@unique([tenantId, prevHash])`, `hash` obrigatório, e a escrita dentro de uma transação com `pg_advisory_xact_lock(hashtext(tenantId))`. Aí a colisão passa a ser um erro de escrita recuperável em vez de uma cadeia partida silenciosamente.

### 4.3 `repairChain` anula o valor probatório

```ts
static async repairChain(tenantId, reason, superAdminId) {
  for (const log of logs) {
    await prisma.auditLog.update({ where: { id: log.id }, data: { prevHash, hash: newHash } });
  }
}
```

Existe um endpoint que **reescreve os hashes de todos os registos**. Regista um evento `CHAIN_REPAIR`, o que é honesto, mas o ponto é conceptual: uma cadeia de hash que o administrador pode re-selar **não prova nada contra o administrador**. Tu és o super-admin. Se o objetivo é rastreabilidade com valor real ("quem fez o quê, quando, o que mudou, qual era o estado anterior"), então:

- ou a cadeia é imutável e a reparação não existe (linhas inválidas ficam marcadas como tal, para sempre);
- ou aceita-se que a cadeia é um detetor de erros, não uma prova — e deixa-se de a chamar prova.

Não podes ter as duas coisas. Esta é uma decisão de produto, não técnica, e tem consequências se alguma vez venderes isto a um cliente com requisitos de conformidade.

### 4.4 Outros defeitos de auditoria

| # | Achado | Evidência |
|:--|:--|:--|
| a | **Leituras nunca são auditadas.** O hook global filtra `request.method !== 'GET'`. Acessos a dados pessoais não deixam rasto. Confirma a tua queixa "auditoria transversal não regista todas as interações". | `app.ts`, hook `onResponse` |
| b | **Sem estado anterior.** O hook genérico grava `action`, `resource` e `result` — mas não `oldValue`/`newValue`. Para a maioria das operações não existe "o que mudou". | `app.ts` |
| c | **Falhas silenciosas.** `audit()` envolve tudo em `try/catch` e faz `console.error`. Se a auditoria falhar, a operação de negócio tem sucesso à mesma. Auditoria *best-effort* é incompatível com valor probatório. | `AuditService.audit` |
| d | **`verifyAuditChain` carrega tudo em memória.** `findMany` sem paginação, por tenant, e é chamado por `getDashboardMetrics`. Com volume, o dashboard de auditoria deixa de responder. Contribui para "módulos muito lentos". | `AuditService` |
| e | **Fallback legado enfraquece a verificação.** O verificador aceita dois formatos de payload (canónico e `JSON.stringify` legado). Duas definições de "íntegro" significam nenhuma. | `verifyAuditChainForPartition` |

---

## 5. Segurança — achados críticos

### 5.1 🔴 Backdoor de autenticação do super-admin, ativa em produção

`backend/src/modules/auth/services/AuthService.ts`, `loginWithPassword`:

```ts
if (isSuperAdmin) {
  if (!user.passwordHash) {
    user = await prisma.user.update({ data: { passwordHash: await bcrypt.hash('admin1234', 10) } });
  } else {
    const isValid = await bcrypt.compare(pass, user.passwordHash);
    if (!isValid && pass === 'admin1234') {                    // ←
      user = await prisma.user.update({ data: { passwordHash: await bcrypt.hash('admin1234', 10) } });
    }
  }
}
// ... a seguir:
const valid = await bcrypt.compare(pass, user.passwordHash);   // ← agora passa
if (!valid) throw AppError.unauthorized('Credenciais inválidas');
```

Lê com atenção: se a password fornecida for `admin1234` e **não corresponder** ao hash guardado, o código **repõe o hash para `admin1234`** e a verificação seguinte passa.

**Qualquer pessoa que saiba o teu email e tente `admin1234` entra como `SUPER_ADMIN`, independentemente da password que definiste.** Não há guarda de `NODE_ENV`. O teu email está no código como default (`DEFAULT_SUPER_ADMIN_EMAIL || 'helderguiomar@gmail.com'`), e o repositório tem um `.env.production` na árvore.

Isto é o achado mais grave do relatório. Corrige antes de qualquer outra coisa: remover o bloco inteiro, e o bootstrap de password só pode existir atrás de `NODE_ENV !== 'production'` **e** de uma variável explícita.

### 5.2 🔴 Códigos OTP em texto limpo nos logs

```ts
console.log(`[AUTH OTP] Código para utilizador registado ${cleanEmail}: ${code}`);
```

Sem guarda de ambiente. Os logs do Vercel passam a conter pares email + código de acesso válido durante 15 minutos. Problema de segurança e de RGPD (dados pessoais em logs de terceiros, sem base legal nem retenção definida).

### 5.3 🟠 CORS aceita qualquer subdomínio `.vercel.app`

`app.ts`:

```ts
if (host.endsWith('.vercel.app')) return callback(null, true);
// com credentials: true
```

**Qualquer pessoa no mundo** pode publicar um projeto no Vercel e obter uma origem autorizada contra a tua API. A allowlist devia conter apenas os domínios de preview do *teu* projeto.

### 5.4 🟠 Enumeração de contas

Apesar do comentário "responder de forma neutra para evitar enumeração", `sendOtp` devolve mensagens distinguíveis:

- utilizador existe → `"Código de acesso enviado para o seu email."`
- pedido pendente → `"...aguarda aprovação pelo Administrador."`
- não existe → `"Se a conta existir, enviámos um código..."`

Três respostas, três estados. A enumeração é trivial. A intenção está lá, a implementação não.

### 5.5 🟠 `sendOtp` mente ao utilizador

```ts
await EmailService.sendOtpEmail(...);   // resultado ignorado
return { success: true, message: 'Código de acesso enviado para o seu email.' };
```

O resultado do envio não é verificado. Com o domínio por verificar, o utilizador é informado de que o código foi enviado quando não foi — e fica à espera. (Note-se a assimetria: o registo público verifica e aborta; o login não verifica e mente. Duas políticas opostas para a mesma falha.)

### 5.6 🟠 Escritas na base de dados em caminhos não autenticados

`ensureSuperAdminUser` é invocado por `checkHasPassword`, `sendOtp`, `verifyOtp` e `loginWithPassword` — todos anteriores à autenticação. Faz: `findUnique` + `findFirst` + eventual `create` de tenant + `findMany` de módulos + **um `findFirst` e possíveis dois `create` por módulo** + um `deleteMany`.

Um POST não autenticado dispara N+1 escritas. É simultaneamente a explicação para a lentidão do login e um vetor de negação de serviço barato.

### 5.7 🟡 CSP permissiva

`scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"]` — com `unsafe-inline` e `unsafe-eval` a CSP deixa de mitigar XSS. Aceitável enquanto o frontend for HTML com scripts inline; deixa de o ser quando entrarem dados de clientes.

---

## 6. Estado real por módulo

| Módulo | Declarado | Avaliação real | Bloqueadores para produção |
|:--|:--|:--|:--|
| **Auth / Plataforma** | ATIVO | 🔴 **Não** | Backdoor 5.1; OTP em logs 5.2; enumeração 5.4; escritas pré-auth 5.6 |
| **Finanças** | ATIVO | 🔴 **Não** | Duas tabelas e duas APIs concorrentes (§3); lógica nos controllers; sem camada de serviço testável |
| **CRM** | ATIVO | 🟠 **Perto** | Estrutura sã (`EnterpriseCRMService`, 19,7 KB). Testes com `fakePrismaClient` — cobertura é de forma, não de comportamento. Falta verificação contra Postgres real |
| **HCCALL** | ATIVO | 🟠 **Backend forte, superfície incompleta** | Ver §7 |
| **2SELLMAIS** | ATIVO | 🟠 **Mais completo do que pensas** | 13 serviços implementados incluindo leilões, consignações e catálogo público SSR. Lacunas em §8 |
| **Condomínios** | EM_CONSTRUÇÃO | ⚪ Candidato a remoção | Conforme já decidiste |
| **`invoicing` / `sales` / `tasks`** | — | ⚪ **Pastas vazias** | Contêm apenas um `README.md`. Ruído estrutural — remover |

---

## 7. HCCALL — estado atual vs. a especificação 2.0 que definiste

### 7.1 O que está bem (e está mesmo bem)

`HccallCommissionEngine.ts` é a melhor peça do repositório: camada 100% pura, zero I/O, determinística, valores em cêntimos, três modos de escalão (`RETROACTIVE` / `MARGINAL` / `FLAT`), bónus por limiar, e — o detalhe que a distingue — **decomposição explicável em linguagem natural** (`CalculationBreakdownLine.explanation`). Uma comissão que se explica a si própria é exatamente o que um vendedor precisa quando a estimativa diverge do processado pela entidade empregadora. Isto está pronto.

`HccallScopeService` implementa por omissão `{ ownerUserId: userId }` — o reposicionamento para autocontrolo individual está refletido no acesso a dados. Também correto.

### 7.2 Mapa: especificação → implementação

| Requisito teu | Estado | Evidência |
|:--|:--|:--|
| 1. Autocontrolo individual | ✅ | `HccallScopeService` — visibilidade `OWN` por omissão |
| 2. Registo mobile-first | ⚠️ parcial | `POST /sales` existe; PWA com `hccall-sw.js` e `hccall.webmanifest`; não verifiquei o nº de passos no formulário |
| 3. Dashboard pessoal | ⚠️ | `GET /dashboard` e `GET /performance` existem; **sem endpoint de histórico ou tendências** |
| 4. Objetivos e metas | ❌ **CRUD incompleto** | `hccall.routes.ts` tem apenas `GET /objectives` e `POST /objectives`. **Sem `PUT`, sem `DELETE`** — não consegues corrigir nem apagar um objetivo |
| 5. Evolução e histórico | ❌ | Não existe rota de histórico, comparação entre períodos, nem evolução da taxa de conversão |
| 6. Alertas | ⚠️ | `GET /alerts` + `DELETE /alerts/:id` (`HccallAlertService`, 6,4 KB). Sem configuração de limiares pelo utilizador |
| 7. Desktop avançado | ⚠️ | Existe `/export` CSV; sem relatórios configuráveis |
| 8. Registar → medir → analisar → sugerir → acompanhar | ⚠️ | As três primeiras etapas existem. "Sugerir ação" e "acompanhar evolução" não têm suporte de dados |
| 9. Independente do local de trabalho | ❌ **contradição por escrito** | `config/modules.ts`: `name: 'HCCALL · Call Center Telecom & Energia'`. O catálogo canónico ainda o define pelo contexto que decidiste abandonar |

### 7.3 Lacunas adicionais encontradas

- **"Minhas Comissões" não existe como API.** `GET /reports/commissions` é um **alias literal** de `getDashboard` (mesma função no `routes`). Os três estados que definiste — *estimada / validada / paga* — não têm endpoint para transitar entre si. O motor calcula; não há onde registar a validação nem o pagamento.
- **"Meu Perfil" e "Definições" não existem** como rotas. Dois dos oito módulos da tua especificação não têm backend.
- **Dinamizações sem `DELETE`** (tem `GET`/`POST`/`PUT`).
- **Fragilidade de fuso horário.** `HccallObjectiveService.countWorkingDays` e `calculatePace` usam `getDay()` e `setHours(0,0,0,0)` — hora **local do servidor**. Servidor em UTC, utilizador em Europe/Lisbon: nos meses de verão, uma venda registada às 00:30 cai no dia anterior. Num sistema cujo valor central é "quantas vendas fiz hoje face ao objetivo", isto é um erro de domínio, não cosmético.
- **BOM UTF-8** em `hccall.routes.ts` e `HccallObjectiveService.ts` (o `\uFEFF` antes do `import`). Explica a existência de `fix-encoding.js` na raiz; deve ser eliminado na origem.

### 7.4 Veredicto HCCALL

O backend é sólido e o motor de comissões é vendável. **Falta superfície, não arquitetura.** Dos oito módulos da tua especificação 2.0, três estão completos, três estão parciais e dois não existem. É trabalho de semanas, não de meses — e é o candidato mais forte do teu portfólio a produto autónomo.

---

## 8. 2SELLMAIS — mais adiantado do que a tua avaliação

Registaste este módulo como "profundamente incompleto". O código diz outra coisa: 13 serviços, incluindo `SellAuctionService` (leilões), `SellConsignmentService` (consignações), `SellItemStateService` (máquina de estados), `SellItemCostService` (custos materializados), `SellChannelService` (canais) e `SellPublicCatalogService` (catálogo público com SSR, OpenGraph e rotas `/loja` e `/loja/artigo/:slug` registadas no `app.ts`).

Dos requisitos que enumeraste como em falta:

| Requisito | Estado |
|:--|:--|
| Leilões com inscrição de clientes e duração caso a caso | `SellAuctionService` existe (6,5 KB) — falta validar as regras de inscrição |
| Fotos | `SellItemMedia` + `MediaStorageService` existem |
| Descrição por IA a partir da fotografia | `SellAiService` existe (4,6 KB) — falta validar se lê a imagem ou apenas texto |
| Rastreabilidade | `SellProvenance` + `SellItemEvent` existem |
| Vendedor / valor pago / forma de pagamento | **Não confirmado** — requer leitura do `schema.prisma` na zona `Sell*` |
| Carregamento via telemóvel | **Não confirmado** |

Recomendação: antes de pedir desenvolvimento, pedir ao Antigravity um **inventário funcional** deste módulo. É provável que estejas a pedir para construir coisas que já existem.

---

## 9. Ordem de trabalhos recomendada

**Bloco 0 — parar a hemorragia (horas)**
1. Remover a backdoor `admin1234` (§5.1). Rodar a password do super-admin.
2. Remover o `console.log` do OTP (§5.2).
3. Restringir o CORS a domínios teus (§5.3).
4. Publicar os três registos DNS do Resend (§1.1) e correr a verificação.

**Bloco 1 — desbloquear o onboarding (1–2 dias)**
5. Inverter a ordem persistir→enviar no registo, com degradação elegante (§1.2).
6. Deixar de expor erros do fornecedor (§1.3).
7. Tornar obrigatórias as confirmações de email e password; mínimo de 12 caracteres (§1.4).
8. Fazer `sendOtp` verificar o resultado do envio (§5.5).
9. Escrever o teste que **falta**: registo com `RESEND_API_KEY` presente e envio a falhar.

**Bloco 2 — decisão estrutural (1 semana, precisa de ti)**
10. Escolher entre `financas` e `finance`, migrar os dados, remover o perdedor (§3).
11. Extrair a lógica financeira dos controllers para serviços testáveis.
12. Remover `invoicing`, `sales`, `tasks` — com inventário e aprovação.

**Bloco 3 — auditoria a sério (1 semana)**
13. `@@unique([tenantId, prevHash])`, `hash` obrigatório, escrita sob advisory lock transacional (§4.2).
14. Decidir o destino do `repairChain` (§4.3) — é decisão tua.
15. Auditar leituras; incluir `oldValue`/`newValue` nas escritas (§4.4a, b).
16. Paginar `verifyAuditChain` (§4.4d).

**Bloco 4 — HCCALL 2.0 (2–4 semanas)**
17. Completar o CRUD de objetivos e dinamizações.
18. Criar o módulo de comissões com os três estados.
19. Criar perfil e definições.
20. Histórico e tendências.
21. Corrigir os fusos horários para um fuso explícito do utilizador.
22. Renomear o módulo no catálogo canónico.

**Bloco 5 — confiança no processo (contínuo)**
23. Suite E2E contra `https://helderlabs.eu` com as variáveis de produção.
24. Regra de que nenhum agente declara "pronto" sem evidência do artefacto implantado.

---

## 10. Uma nota sobre os ficheiros de governança

`ESTADO.md` diz **"PRONTO / VALIDADO"**. `DIVIDA_TECNICA.md` lista, como alta prioridade, *consolidar ficheiros CSS* e *adicionar testes Playwright de amortização* — enquanto o sistema tem uma backdoor de autenticação e duas bases de dados financeiras.

O problema não é a dívida técnica estar mal priorizada. É que **os ficheiros de governança foram escritos pelo mesmo agente que escreveu o código**, sem contraditório. Um agente que se autoavalia produz sempre um relatório favorável — não por desonestidade, mas porque avalia contra a sua própria intenção, não contra a realidade.

A correção é de processo, não de prompt: **quem implementa não assina a conformidade.** O prompt que preparei separa explicitamente estes papéis e proíbe o agente de declarar sucesso sem artefactos externos verificáveis.

---

*Auditoria por leitura estática. Os itens marcados "não confirmado" requerem execução. O prompt para o Antigravity — documento acompanhante — está construído para produzir essa confirmação com evidência, não com declarações.*
