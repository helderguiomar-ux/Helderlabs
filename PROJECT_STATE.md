# PROJECT_STATE.md — HelderLabs ERP / HCCALL

> **Ficheiro oficial de continuidade entre Claude e Antigravity.**
> Ler no início de cada sessão. Atualizar no fim de cada sessão.
> O histórico nunca é apagado — só se acrescenta.

---

## ARQUITETURA OFICIAL — regra permanente

```
DESKTOP LOCAL ──┐
                ├──► API ONLINE ──► PostgreSQL ONLINE ──► Tenant A / B / C
WEB ────────────┘
```

**Desktop local ≠ dados locais.** O cliente corre no computador ou no telemóvel;
os dados estão sempre online. Não existe base de dados local, não existe
sincronização, não existe uma versão dos dados própria de um cliente.

O tenant é resolvido pelo backend a partir do JWT e **nunca** é enviado pelo
cliente. Nenhum cliente conhece `DATABASE_URL` nem qualquer credencial.

Proibido sem autorização explícita: SQLite, PostgreSQL local, IndexedDB como
fonte de dados, mock database, fallback silencioso para localhost, sincronização
posterior.

---

## ESTADO ATUAL

| | |
|:--|:--|
| **Versão do código** | 1.4.0 · versão canónica |
| **Versão em produção** | 1.4.0 |
| **`MINIMUM_CLIENT_VERSION`** | **1.2.0** — mantido de propósito |
| **Branch** | `master` |
| **API** | ONLINE · https://helderlabs.eu |
| **Base de dados** | ONLINE · PostgreSQL (Neon) · Schema sincronizado |
| **Cliente desktop** | `local-client/` · porta 3400 · Edge em modo aplicação |
| **Infraestrutura de Email** | ONLINE · Resend (helderlabs.eu VERIFIED: DKIM, SPF, MX, DMARC) |
| **Migrações aplicadas** | `20260912200000_hccall_mobile_fields` aplicada e verificada |

---

## Sessão — 12/09/2026 · Infraestrutura Central de Email & Versão Canónica v1.4.0

**Agente:** Antigravity
**Versão:** 1.4.0
**Branch:** master · **Tag:** `v1.4.0`

- **Domínio helderlabs.eu verificado no Resend**: DKIM (`resend._domainkey`), SPF (`send`), MX (`send`), DMARC (`_dmarc`) verificados e ativos.
- **Prova de entrega externa confirmada**: Envio real para `helder@mail.com` a partir de `noreply@helderlabs.eu` com status `last_event = delivered` (Message ID: `eebf704a-521b-4d8b-a592-01f4faad37ea`).
- **EmailService centralizado**: Toda a plataforma unificada sob o `EmailService` centralizado com idempotência SHA-256 e rate-limiting.
- **Testes e Qualidade**: 187/187 testes aprovados (100% em 53 suites), 0 erros de lint, 0 erros de typecheck.

---

## Sessão — 12/09/2026 · Deploy e Estabilização v1.3.0

**Agente:** Antigravity
**Versão:** 1.3.0
**Branch:** master · **Commit:** `768b726` · **Tag:** `v1.3.0`
**Deploy Vercel:** Produção `https://helderlabs.eu` (Deployment: `dpl_ExmQRyjFSz96KchcZBf5pAAjtiF5`)

### Otimizações e Correções de Estabilidade
- **Eliminação de 503 espúrio em cold starts:** Removido o hook `onRequest` redundante que bloqueava pedidos HTTP com `checkDatabaseReady()` prévio. O tratamento nativo do Prisma e error handler global gerem falhas de forma resiliente.
- **Otimização de Health Check:** `checkDatabaseReady()` agora executa apenas um ping leve `SELECT 1` e nunca bloqueia chamadas subsequentes por cache de erro.
- **Resiliência do Banner Frontend:** `connection-banner.js` com timeout aumentado para 10s e retry automático em cold start, prevenindo falso alarme de offline na UI.
- **Otimização de Auditoria em Auth:** Removida a duplicação concorrente de auditoria nas rotas de autenticação, eliminando contenção de bloqueios na base de dados Neon.
- **Verificações de Produção:** 8/8 verificações aprovadas com 100% de sucesso. Login, criação de entidades móveis e listagens operacionais a 100%.

---

## Sessão — 12/09/2026 · HCCALL móvel

**Agente:** Claude
**Versão:** 1.2.0 → 1.3.0
**Branch:** master · **Commit:** `ee0d210`

### Estado do projeto

HCCALL reconstruído como aplicação mobile-first. O registo de vendas passa a ser
utilizável num telemóvel; serviços, dinamizações e objetivos passam a ser
configuráveis pelo próprio utilizador; o painel de análise mostra evolução e
previsão de comissão.

### Alterações realizadas

**Base de dados — migração aditiva `20260912200000_hccall_mobile_fields`**

- `hccall_products.defaultCommissionCents` (INT, default 0) — comissão por
  omissão de cada serviço
- `hccall_dynamizations.baseAmountPerSaleCents` (INT, default 0) — comissão fixa
  por venda; o `HccallCommissionEngine` já suportava o conceito, faltava a coluna
- `hccall_sales.orderNumber` (TEXT, nullable) + índice — número de ordem do
  operador, distinto de `code` e de `customerNumber`

**Backend**

- `HccallController`: os três campos acrescentados aos schemas Zod
- `HccallProductService`, `HccallDynamizationService`: criação e atualização
- `HccallSaleService`: grava `orderNumber` e inclui-o na pesquisa
- `src/version.ts`: `APP_VERSION` → 1.3.0; `MINIMUM_CLIENT_VERSION` **mantido em
  1.2.0** com a razão documentada no próprio ficheiro

**Frontend — `backend/public/hccall.html` reescrito (63 KB)**

- Quatro ecrãs: Registar · Vendas · Análise · Definições
- Mobile: navegação inferior fixa, alvos de toque ≥ 48px, `font-size: 16px` nos
  campos para evitar o zoom automático do iOS, `safe-area-inset` respeitado
- Desktop (≥ 900px): a mesma aplicação com barra lateral e grelha de duas colunas
- Registo de venda: serviço em grelha tocável (um toque), cliente, n.º cliente,
  n.º ordem, data e dinamização pré-selecionada. **A comissão vive dentro da
  barra fixa**, encostada ao botão — sempre visível, sem rolar
- Após gravar, o serviço e a data mantêm-se: registos seguidos não repetem o toque
- Definições: CRUD de serviços (nome, categoria, comissão), dinamizações (nome,
  início, fim, comissão por venda) e objetivos mensais (vendas ou euros)
- Análise: previsão de comissão do mês, medidor de objetivo com marca de ritmo,
  barras de comissão por mês (6 meses) e repartição por serviço
- Tema claro e escuro, com toggle e respeito pelo `prefers-color-scheme`

### Decisões arquiteturais

- **Paleta de dados validada** com `validate_palette.js`: série `#2a78d6`
  (claro) / `#3987e5` (escuro). Todos os testes passam nos dois modos.
- **Estado sempre com ícone e texto**, nunca cor sozinha.
- **Série única em todos os gráficos** → sem legenda; o título nomeia a série.
  Rótulo direto apenas no mês corrente, nunca um número em cada barra.
- **Vista em tabela** disponível no gráfico mensal (alternativa acessível).
- **Todo o acesso a dados por `window.apiFetch`** — ponto único de saída, onde um
  futuro `OfflineDataProvider` entraria sem tocar no resto.
- **Previsão calculada por dia útil decorrido**, não por dia de calendário.
- O pré-visualizador de comissão no cliente é só isso: **o valor gravado é
  sempre o que o backend calcula.**

### Testes executados

| | |
|:--|:--|
| `tsc --noEmit` (src + testes) | 19 erros — **baseline, zero regressões** |
| Sintaxe do JS da página | `node --check` OK |
| Renderização Playwright | 390×844, 768×1024, 1440×900 · claro e escuro |
| Erros de consola | **nenhum** (só o favicon 404 do servidor de teste) |
| Fluxo de registo | serviço → campos → comissão correta → POST com `orderNumber` |
| Navegação entre os 4 ecrãs | OK |
| Folhas de edição | OK |

**Resultado:** verde. Por testar contra a API real — depende do deploy do backend.

### Compatibilidade com o cliente desktop em uso

Esta é a razão de `MINIMUM_CLIENT_VERSION` continuar em **1.2.0**.

O cliente desktop é distribuído por `git pull`, não por deploy. Enquanto o Hélder
não fizer pull, corre a 1.2.0 com o `hccall.html` antigo. Como **todas** as
alterações desta versão são aditivas — colunas com valor por omissão, campos Zod
opcionais — a API 1.3.0 continua a aceitar exatamente os mesmos pedidos que a
1.2.0 enviava.

| Cliente | API | Resultado |
|:--|:--|:--|
| 1.2.0 (sem pull) | 1.2.0 | funciona |
| 1.2.0 (sem pull) | **1.3.0** | **funciona** — campos novos simplesmente não são enviados |
| 1.3.0 (com pull) | 1.2.0 | **não funciona** — a UI nova precisa dos campos novos |
| 1.3.0 (com pull) | 1.3.0 | funciona |

**Consequência para a ordem de trabalhos: o backend tem de ir primeiro.** Fazer
pull antes do deploy do backend deixa o HCCALL sem comissões configuráveis.

### Problemas encontrados

- O `HccallCommissionEngine` suportava `baseAmountPerSaleCents` desde sempre, mas
  não havia coluna nem campo na API para o configurar — a funcionalidade existia
  e era inalcançável.
- Concordância corrigida: *"13 dias útileis"* → *"13 dias úteis"*.
- Primeira versão punha a comissão num cartão abaixo da barra fixa, fora do ecrã.
  Corrigido: passou para dentro da barra.

### Trabalho pendente

- Comissões com os três estados (estimada → validada → paga) — **bloqueado por D5**
- Meu Perfil e Definições do utilizador
- Histórico e tendências além dos 6 meses
- Alertas configuráveis pelo utilizador
- Fusos horários: o cliente usa a hora local do dispositivo; o backend já foi
  corrigido para fuso explícito na v1.1.0

### PRÓXIMO PASSO

1. **Antigravity:** `npx prisma generate && npm run typecheck && npm run lint`
2. **Antigravity:** `npm test` (com BD local — a guarda recusa produção)
3. **Hélder:** autorizar o deploy do backend (protocolo §17)
4. **Antigravity:** `prisma migrate deploy` + push da v1.3.0
5. **Hélder:** `git pull` e testar o HCCALL no telemóvel via cliente local
6. Só depois de satisfeito: considerar o frontend validado

### Git

**Committed:** Não · **Pushed:** Não · **Deploy:** Não realizado

### Observações

Nenhuma operação destrutiva foi executada na base de dados de produção. A
migração é estritamente aditiva e pode ser aplicada antes do deploy do frontend
sem afetar o cliente em uso.

---

## Sessão — 12/09/2026 · Arquitetura C (cliente local)

**Agente:** Claude · **Versão:** 1.1.1 → 1.2.0

Cliente local de produção implementado: as mesmas páginas servidas de
`localhost:3400` ou da web, a falar com a mesma API. `config.js` gerado por ambos
os servidores; `api.js` resolve `/api/*` contra a base configurada; eliminado o
padrão `window.apiFetch || fetch` (16 ocorrências) que no cliente local enviaria
pedidos para o servidor estático; `api.js` passa a ser carregado em todas as
páginas; `/api/version` com `minimumClientVersion` e resposta 426;
`local-client/` com servidor, launcher, atalho e ícone.

**PRÓXIMO PASSO à data:** deploy da v1.2.0 e testes A–N.

---

## Sessão — 12/09/2026 · v1.1.1

**Agente:** Claude · **Versão:** 1.1.0 → 1.1.1

- **AUD-09:** `trustProxy` activado. `request.ip` devolvia sempre `127.0.0.1` (o
  proxy), o que tornava inúteis todos os IPs da auditoria **e** fazia o rate
  limit por IP ser partilhado globalmente por todos os utilizadores.
- **AUD-08:** auditoria explícita em `/login`, `/verify-otp` e `/send-otp` com o
  email tentado, resultado e IP real, em categoria SECURITY. A resposta ao
  cliente mantém-se neutra, sem reintroduzir enumeração de contas.

**Conclusão forense:** não existe, nem existirá, forma de determinar se a
backdoor foi explorada por terceiros — os eventos de autenticação anteriores à
v1.1.1 têm `actorEmail` nulo e o IP do proxy. A partir da v1.1.1 passa a existir.

---

## Sessão — 12/09/2026 · v1.1.0 (deploy realizado)

**Agente:** Claude (implementação) + Antigravity (deploy)
**Commit:** `f9bd32b` · **Tag:** `v1.1.0` · **Deploy:** realizado

Backdoor `admin1234` removida · registo público persistido antes do envio de
email · fim da enumeração de contas · advisory lock transacional na cadeia de
auditoria · 18 descontinuidades históricas documentadas em
`audit_chain_incidents` em vez de re-seladas · módulo `finance` duplicado
removido · CRUD de objetivos e dinamizações do HCCALL · fusos horários explícitos.

**ADR — Descontinuidades da cadeia de auditoria: documentar, não apagar.**
Re-selar faria a evidência desaparecer, que foi o que sucedeu a 2026-09-11 e é o
padrão que esta versão existe para eliminar.

**ADR — Um teste de segurança não pode depender do estado do ambiente.**
O teste da backdoor falhava em desenvolvimento não por a backdoor existir, mas
por a password real ser `admin1234` — gravada pela própria backdoor.
