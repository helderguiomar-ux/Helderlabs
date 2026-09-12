# Arquitetura C — Auditoria e Plano de Implementação
**HelderLabs ERP · cliente local de produção**
Data: 2026-09-12 · Base: v1.1.1 · Estado: auditoria concluída, plano para aprovação

---

## 0. A conclusão primeiro

**A arquitetura que descreves já existe em 90%.** Não é preciso construí-la — é preciso terminá-la.

O ERP não é uma aplicação com build. É um conjunto de páginas HTML estáticas servidas pelo Fastify, que falam com `/api/*` por `fetch`. O "cliente" e o "servidor" já estão separados na prática; o que os prende um ao outro é **uma única coisa**: todos os URLs de API são relativos.

Torná-los configuráveis é o trabalho central. Tudo o resto — launcher, versionamento, compatibilidade — assenta nisso.

---

## 1. ARQUITETURA ATUAL (auditada, não presumida)

### 1.1 Como está montado hoje

```
Browser
  │  https://helderlabs.eu
  ▼
Vercel (um único deployment)
  ├── Fastify serve public/*.html estáticos   ← o "cliente"
  └── Fastify serve /api/*                    ← o "servidor"
        ▼
   PostgreSQL (Neon)
```

Cliente e API são o **mesmo deployment**. Não há bundler, não há framework de frontend, não há passo de build no cliente. As páginas são HTML com `<script>` inline e um punhado de ficheiros em `assets/js/`.

Isto, que podia parecer uma limitação, é a razão pela qual o que pedes é fácil: **não há nada para compilar de forma diferente.** Os mesmos ficheiros servem os dois modos.

### 1.2 A camada de acesso a dados — já existe

`public/assets/js/api.js` define `window.apiFetch`, e faz mais do que parece:

- injeta o `Authorization: Bearer <token>` a partir de `localStorage.erp_session`
- trata `401` → limpa sessão e redireciona para o login
- trata `403` → mostra banner de licenciamento sem deslogar
- serializa corpos JSON automaticamente
- migra chaves de sessão legadas

**Isto é, na prática, o `OnlineDataProvider` que o teu ponto 11 pede.** Já está escrito. Só não sabe falar com outro host.

### 1.3 Contagem exata das chamadas à API

| Padrão | Ocorrências | Onde |
|:--|--:|:--|
| `apiFetch('/api/...')` | 20 | app.html, hccall.html, super-admin.html, workspace.html |
| `const fetchFn = window.apiFetch \|\| fetch` | 16 | crm.js, finance.js, sellmais.js, audit.js, modules.js |
| `fetch('/api/...')` cru | 17 | login.html (7), index.html, app.html, workspace.html, finance.js (5) |

**Todas, sem exceção, usam caminhos relativos.** Não existe um único URL absoluto para a API em todo o frontend.

### 1.4 Os dois problemas concretos

**`api.js` não é carregado nas páginas públicas.**

| Carrega `api.js` | Não carrega |
|:--|:--|
| `app.html`, `hccall.html`, `super-admin.html`, `workspace.html` | **`index.html`, `login.html`** |

O padrão `window.apiFetch || fetch` é uma armadilha silenciosa: quando `api.js` não está carregado, cai no `fetch` nativo com um caminho relativo. Online funciona por acaso. **Em modo local, falha** — o pedido vai para `http://localhost:3333/api/...` em vez da produção. E o login é precisamente a primeira página que o utilizador abre.

**Não existe configuração de runtime.** Não há `config.js`, não há `API_URL`, não há forma de dizer à página onde está a API.

### 1.5 O que já está do lado certo

- **CORS** — `app.ts` já autoriza `http://localhost:3333`, `http://localhost:3000` e `http://127.0.0.1:3333`. O cliente local funciona sem alterar o backend.
- **Autenticação** — JWT em `localStorage`, enviado por header. Não depende de cookies nem de mesma-origem. Funciona cross-origin sem alterações.
- **Multi-tenant** — `authenticate.ts` extrai o `tenantId` do JWT e **nunca** o aceita do cliente. O `tenantScopedClient.forTenant()` reescreve as queries. O isolamento é estrutural, não confia no frontend, e é idêntico em qualquer cliente.
- **Auditoria** — acontece no backend, no hook `onResponse` e nos serviços. Um cliente local é auditado exatamente como o web, sem fazer nada.
- **`trustProxy`** — corrigido na v1.1.1. Sem isto, todos os clientes locais apareceriam na auditoria com o IP do proxy.

**Consequência importante:** os teus pontos 2, 4, 5 e 6 — nunca expor a BD ao cliente, isolamento multi-tenant validado no servidor, autenticação única, auditoria central — **já estão satisfeitos pela arquitetura existente.** Não há trabalho a fazer neles, apenas a verificar que continuam verdadeiros.

---

## 2. ARQUITETURA PROPOSTA

```
┌─────────────────────────┐     ┌─────────────────────────┐
│  CLIENTE LOCAL          │     │  CLIENTE WEB            │
│  (Windows, launcher)    │     │  (browser)              │
│                         │     │                         │
│  public/*.html          │     │  public/*.html          │
│  servidos de            │     │  servidos de            │
│  http://localhost:3400  │     │  https://helderlabs.eu  │
│                         │     │                         │
│  config.js:             │     │  config.js:             │
│   apiBaseUrl =          │     │   apiBaseUrl = ''       │
│    https://helderlabs.eu│     │   (relativo)            │
│   clientType = LOCAL    │     │   clientType = WEB      │
└───────────┬─────────────┘     └───────────┬─────────────┘
            │                                │
            └──────────── HTTPS ─────────────┘
                          ▼
            ┌──────────────────────────────┐
            │  API DE PRODUÇÃO             │
            │  autenticação → tenant →     │
            │  permissões → regras →       │
            │  escrita → auditoria         │
            └──────────────┬───────────────┘
                           ▼
                  PostgreSQL (Neon)
```

**Os mesmos ficheiros, servidos de dois sítios, a falar com a mesma API.** A única diferença é o conteúdo de `config.js`, gerado no arranque.

### 2.1 A peça central: `config.js` + `apiFetch` com base configurável

```js
// assets/js/config.js — gerado no arranque, nunca commitado
window.HELDERLABS_CONFIG = {
  apiBaseUrl: 'https://helderlabs.eu',   // '' no modo web
  clientType: 'LOCAL',                    // 'WEB' | 'LOCAL'
  appVersion: '1.2.0',
  buildId: 'a1b2c3d',
  environment: 'production'
};
```

E em `api.js`, uma função de resolução:

```js
function resolveUrl(url) {
  const base = window.HELDERLABS_CONFIG?.apiBaseUrl || '';
  if (!base || !url.startsWith('/api/')) return url;
  return base.replace(/\/$/, '') + url;
}
```

`apiFetch` passa a usar `resolveUrl`, e acrescenta headers de diagnóstico:

```
X-HelderLabs-Client: LOCAL
X-HelderLabs-Client-Version: 1.2.0
```

**Nunca usados para autorização** — só auditoria e compatibilidade, conforme o teu ponto 7.

### 2.2 Porque é que isto satisfaz o ponto 11 sem trabalho extra

Com `apiFetch` como único ponto de saída, o futuro fallback offline entra por substituição, não por reescrita:

```js
// hoje
window.apiFetch = OnlineDataProvider.fetch;

// futuro, sem tocar em crm.js, finance.js, sellmais.js, hccall.html...
window.apiFetch = navigator.onLine
  ? OnlineDataProvider.fetch
  : OfflineDataProvider.fetch;   // fila local + SyncEngine
```

As 36 chamadas espalhadas pelo ERP não sabem — nem precisam de saber — de onde vêm os dados. É esta a separação que pedes, e o custo de a garantir agora é praticamente zero.

---

## 3. DECISÃO TECNOLÓGICA DO LAUNCHER

Pediste avaliação séria, não preferência. Quatro hipóteses:

| Opção | Peso | Novo runtime | Mesmo código | Caminho para offline | Veredicto |
|:--|:--|:--|:--|:--|:--|
| **A · Atalho em modo app para helderlabs.eu** | 0 | não | sim | **não** | rejeitada |
| **B · Servidor estático local + browser em modo app** | ~0 | não | sim | sim | **escolhida** |
| **C · Empacotar B num `.exe`** | ~45 MB | não | sim | sim | fase 2 |
| **D · Electron / Tauri** | 150 MB / toolchain Rust | sim | parcial | sim | rejeitada |

### Porquê a B

**A rejeita-se por causa do teu ponto 11.** Um atalho para `helderlabs.eu` em modo aplicação daria o ícone, a janela sem barra de endereço e a experiência de app — em cinco minutos e zero código. Mas o HTML continuaria a vir da internet, e sem ficheiros locais **não há arranque possível sem rede**. Fecharia a porta ao fallback offline que dizes ser estratégico.

**D rejeita-se por desproporção.** O ERP é uma aplicação de browser. O Electron acrescenta 150 MB e um processo de atualização próprio; o Tauri exige a toolchain do Rust na máquina de build. Nenhum dos dois resolve um problema que exista aqui. Seria introduzi-los por preferência — que foi exatamente o que pediste para não acontecer.

**B dá o resultado de D sem o custo.** O truque está no modo aplicação do browser:

```
msedge.exe --app=http://localhost:3400/login.html
```

Abre uma janela **sem barra de endereço, sem separadores, sem menus** — indistinguível de uma aplicação nativa, com ícone próprio na barra de tarefas. O utilizador não vê um browser.

E o servidor local são ~60 linhas de Node que servem `public/` e geram o `config.js`. Nada de novo no projeto.

**C é a evolução natural** quando quiseres instalar noutras máquinas: `pkg` transforma o servidor local num `.exe` único, sem exigir Node instalado. Não é preciso agora — a tua máquina já tem Node.

---

## 4. FICHEIROS ENVOLVIDOS

### Novos

```
backend/public/assets/js/config.js          gerado no arranque (no .gitignore)
backend/public/assets/js/config.default.js  fallback para o modo web
local-client/server.mjs                     servidor estático local (~60 linhas)
local-client/launch.vbs                     arranque silencioso, sem janela de consola
local-client/install.ps1                    cria o atalho no Ambiente de Trabalho
local-client/README.md                      instruções
```

### Alterados

```
backend/public/assets/js/api.js       resolveUrl + headers de cliente + apiUrl() exportado
backend/public/login.html             passa a carregar api.js; 7 fetch crus → apiFetch
backend/public/index.html             passa a carregar api.js; 1 fetch cru → apiFetch
backend/public/app.html               1 fetch cru → apiFetch
backend/public/workspace.html         1 fetch cru → apiFetch
backend/public/assets/js/finance.js   5 fetch crus → apiFetch
backend/src/modules/platform/controllers/VersionController.ts   minimumClientVersion
backend/src/app.ts                    middleware de compatibilidade de cliente
backend/.gitignore                    config.js
```

### Já feitos (v1.1.1 e anteriores)

```
backend/package.json                  guarda de BD nos testes  ← Fase 4 concluída
backend/scripts/dev-online.mjs        modo de desenvolvimento contra BD online
backend/src/app.ts                    trustProxy (IP real dos clientes locais)
```

**Nenhuma alteração ao schema. Nenhuma migração. Nenhuma operação na BD de produção.**

---

## 5. RISCOS

| # | Risco | Gravidade | Mitigação |
|:--|:--|:--|:--|
| R1 | **Deriva cliente/API.** O cliente local fica numa versão antiga e chama endpoints que mudaram. | Alta | `minimumClientVersion` no `/api/version` + verificação no arranque (teus pontos 16/17) |
| R2 | **`window.apiFetch \|\| fetch` falha em silêncio.** Se `api.js` não carregar numa página, o fallback usa caminho relativo e o pedido vai para o servidor local, que não tem API. | **Alta** | Carregar `api.js` em todas as páginas **e** eliminar o padrão de fallback — se não houver `apiFetch`, falhar em voz alta |
| R3 | **CORS.** Um porto local fora da allowlist deixa o cliente sem acesso. | Média | Usar 3400 e acrescentá-lo à allowlist; erro explícito no arranque se o CORS recusar |
| R4 | **Token em `localStorage` de `localhost`.** Qualquer página servida em `localhost` na mesma porta poderia lê-lo. | Baixa | Porta dedicada (3400), servidor local ligado só a `127.0.0.1`, nunca `0.0.0.0` |
| R5 | **Dados reais sem rede de segurança.** Ao contrário do modo de desenvolvimento, isto escreve em produção — é o objetivo, mas engano custa. | Média | Indicador visual permanente do ambiente no cabeçalho: `PRODUÇÃO · cliente local` |
| R6 | **`config.js` commitado por engano** com o URL da API. | Baixa | `.gitignore` + gerado sempre no arranque |
| R7 | **Confusão entre os três ambientes.** | Média | Ponto 12 resolvido por construção: `npm run dev` (BD local), `npm run local` (API produção), web |

**Nota sobre R2:** é o risco mais provável de todos, porque falha em silêncio e só em modo local. O padrão `window.apiFetch || fetch` aparece 16 vezes. Vai ser eliminado, não contornado.

---

## 6. PLANO DE IMPLEMENTAÇÃO

| Fase | O quê | Estado |
|:--|:--|:--|
| 1 | Auditoria da arquitetura | ✅ **este documento** |
| 2 | Plano técnico | ✅ **este documento** |
| 4 | Guardas de teste | ✅ **feito** — `npm test` recusa BD não-local |
| 3 | `config.js` + `apiFetch` com base + limpar os 17 fetch crus | a fazer |
| 6 | `/api/version` com `minimumClientVersion` + verificação no cliente | a fazer |
| 5 | Servidor local + launcher + atalho no Desktop | a fazer |
| 7 | Teste local → API → BD online (testes A–G) | a fazer |
| 8 | Teste web → API → BD online (testes H–L) | a fazer |
| 9 | Teste de isolamento multi-tenant (teste M) | a fazer |
| 10 | Documentação e `DECISOES.md` | a fazer |

Ordem deliberada: **3 → 6 → 5**. A configuração antes do launcher, porque o launcher sem a configuração não serve para nada; e o versionamento antes do launcher, porque é ele que permite ao cliente dizer "preciso de atualizar" em vez de partir.

### Fase 14 — incidente dos testes

Investigação, **sem apagar nada**. As consultas de levantamento estão no `GUIA_ERP_LOCAL.md`. Reitero o que lá está: tenants e utilizadores de teste podem ser removidos com a tua confirmação; **registos de auditoria não** — apagar linhas da cadeia parte-a, e é o que esta versão existe para impedir.

---

## 7. O QUE PRECISO DE TI ANTES DE IMPLEMENTAR

Três decisões. As restantes tomo eu com base no que escreveste.

**D6 · Porta local.** Proponho **3400** — livre, e evita colidir com o `npm run dev` na 3333, o que permite ter os dois modos abertos ao mesmo tempo sem confusão. Implica acrescentar `http://localhost:3400` à allowlist de CORS em produção (uma linha, um deploy).

**D7 · Browser do modo aplicação.** Proponho **Edge**, por estar sempre presente no Windows, com fallback automático para Chrome e, em último caso, para o browser por omissão em janela normal.

**D8 · Nome e ícone.** O atalho fica `HelderLabs ERP`. Se tiveres um `.ico`, indica-me onde está; senão gero um a partir do `favicon.svg` do projeto.

---

## 8. UMA OBSERVAÇÃO SOBRE O PONTO 21

Escreveste que queres o HelderLabs pensado como *uma aplicação + uma API + uma base de dados centralizada, com múltiplos clientes*.

A auditoria mostra que **já é assim** — só que por acidente, não por desenho. O cliente e a API vivem no mesmo deployment porque nunca houve razão para os separar, e o acoplamento resume-se a URLs relativos.

O que este trabalho faz é tornar deliberado o que era acidental. Depois disto, um cliente móvel ou um segundo cliente web não exigem arquitetura nova: exigem um `config.js` diferente.

É, provavelmente, a melhor relação esforço/valor de tudo o que está no teu roadmap.
