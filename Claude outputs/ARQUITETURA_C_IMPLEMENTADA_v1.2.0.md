# Arquitetura C — implementada · v1.2.0
> Fases 3, 5 e 6 concluídas. Ficheiros escritos no repositório.
> Falta: deploy (Antigravity) e os testes funcionais A–N.

---

## O que passa a existir

```
Ícone no Ambiente de Trabalho
   ↓  wscript launch.vbs   (sem consola)
launcher.mjs               (verifica, arranca, espera, deteta browser)
   ↓
server.mjs                 (localhost:3400, só 127.0.0.1)
   ↓  serve backend/public/*  +  gera config.js
Edge --app=                (janela sem barra de endereço)
   ↓  HTTPS
https://helderlabs.eu/api/*
   ↓
PostgreSQL (Neon)
```

O cliente local **não conhece a base de dados**. Não tem `DATABASE_URL`, não tem credenciais, não sabe que o PostgreSQL existe. Serve ficheiros e nada mais — tudo o resto acontece na API.

---

## Fase 3 · Configuração de runtime

### A peça central

`api.js` ganhou `resolveUrl()`. Caminhos `/api/*` passam a ser prefixados pela base configurada; tudo o resto fica relativo:

| Pedido | Cliente web | Cliente local |
|:--|:--|:--|
| `/api/crm/companies` | `/api/crm/companies` | `https://helderlabs.eu/api/crm/companies` |
| `/login.html` | `/login.html` | `/login.html` |
| `/locales/pt.json` | `/locales/pt.json` | `/locales/pt.json` |

Verificado nos dois modos, incluindo o caso da barra final duplicada na base.

### O risco R2, eliminado

O padrão `window.apiFetch || fetch` aparecia **16 vezes**. Era a armadilha mais perigosa do plano: sem o `api.js` carregado, caía no `fetch` nativo com caminho relativo, e no cliente local o pedido iria para o servidor estático em vez da API — falhando em silêncio, só em modo local, e precisamente no login.

Eliminado, não contornado. Sem `apiFetch`, o código falha em voz alta.

O `hccall.html` tinha um caminho alternativo próprio, com a mesma armadilha. Também removido.

### Contagem

| | Antes | Depois |
|:--|--:|--:|
| `window.apiFetch \|\| fetch` | 16 | **0** |
| `fetch('/api/...')` cru | 17 | **0** |
| Páginas sem `api.js` | 2 (`login`, `index`) | **0** |

Os três `fetch` que subsistem são corretos: o interno do `api.js` (já resolvido), e o de `/locales/*.json`, que é um ficheiro estático e deve mesmo ficar local.

### `config.js` gerado, nunca commitado

Não existe como ficheiro. **Ambos os servidores o geram**:

- produção — rota em `app.ts`, com o commit real do Vercel;
- cliente local — `server.mjs`, com `apiBaseUrl` a apontar para produção.

Assim não há hipótese de um `config.js` com valores errados ficar no repositório, e o `buildId` está sempre correto sem passo de build. Se por alguma razão não carregar, o `api.js` assume o comportamento web — degrada para o correto.

### Identificação do cliente

Cada pedido leva `X-HelderLabs-Client` e `X-HelderLabs-Client-Version`. **Diagnóstico apenas** — a autorização continua a vir do JWT e do tenant que lhe está associado, conforme o teu ponto 7.

### Ponto 11 satisfeito

Com `apiFetch` como único ponto de saída, o fallback offline futuro entra por substituição:

```js
window.apiFetch = navigator.onLine ? OnlineDataProvider : OfflineDataProvider;
```

As 36 chamadas espalhadas pelo ERP não sabem de onde vêm os dados. O `api.js` já emite `erp:offline` numa falha de rede — o gancho para o `SyncEngine` está lá.

---

## Fase 6 · Versão e compatibilidade

`/api/version` passa a devolver:

```json
{
  "version": "1.2.0",
  "commitSha": "...",
  "build": "f9bd32b",
  "builtAt": "...",
  "environment": "production",
  "minimumClientVersion": "1.2.0",
  "latestMigration": "...",
  "serverTime": "..."
}
```

Um cliente que se identifique com versão abaixo de `minimumClientVersion` recebe **426** com mensagem explícita:

> *É necessária uma atualização do HelderLabs ERP.*

O `api.js` apanha o 426 e emite `erp:client-outdated`. **Não quebra em silêncio** — era esse o teu ponto 17.

Três cuidados deliberados: `/api/version` e `/api/health` estão isentos, senão um cliente antigo não conseguiria sequer descobrir que está antigo; um cliente que não se identifica é tratado como atual, porque o cabeçalho nunca pode ser um mecanismo de bloqueio; e `MINIMUM_CLIENT_VERSION` só sobe quando há incompatibilidade **real** — subir por rotina ensina as pessoas a ignorar o aviso.

`compareVersions` testada: `1.10.0 > 1.9.0` (comparação numérica, não lexicográfica), `1.2` equivale a `1.2.0`.

---

## Fase 5 · Launcher

| Ficheiro | Linhas | Função |
|:--|--:|:--|
| `server.mjs` | 135 | Servidor estático + `config.js`, só em `127.0.0.1` |
| `launcher.mjs` | 157 | Verifica, arranca, espera, deteta browser, encerra |
| `launch.vbs` | 30 | Corre sem janela de consola |
| `install.ps1` | — | Cria o atalho |
| `helderlabs-erp.ico` | — | 256/128/64/48/32/16 px |

### Detalhes que fazem a diferença

**Sem consola.** O `.vbs` corre o Node com a janela oculta. Erros aparecem em caixa de diálogo, não num terminal que ninguém lê.

**Janela de aplicação.** `--app=` abre sem barra de endereço, sem separadores, sem menus. Edge primeiro, Chrome a seguir, browser por omissão em último caso.

**Perfil próprio.** `--user-data-dir` em `%LOCALAPPDATA%\HelderLabsERP\browser` isola a sessão do teu browser pessoal, mantém-na entre arranques, e faz o processo viver exatamente o tempo da janela — o que permite encerrar o servidor quando fechas.

**Já a correr?** O launcher deteta pelo `/__client/health` e abre só uma janela nova, em vez de falhar com a porta ocupada.

**Falhas explicadas.** Node em falta, ficheiros no sítio errado, porta ocupada, arranque sem resposta — cada uma com a sua mensagem e o que fazer.

**Fechado à rede.** O servidor escuta em `127.0.0.1`, nunca em `0.0.0.0`. Não é acessível da rede local. Travessia de caminho bloqueada e testada.

---

## Testado neste ambiente

| | |
|:--|:--|
| `tsc --noEmit` com todos os testes | 19 erros — **baseline, zero regressões** |
| Servidor local arranca e serve | ✅ |
| `config.js` gerado com `apiBaseUrl` correto | ✅ |
| `/__client/health` responde | ✅ |
| `/` serve `login.html` | ✅ 28918 bytes |
| Travessia de caminho | ✅ bloqueada |
| Ordem `config.js` → `api.js` nas 6 páginas | ✅ |
| `resolveUrl` nos dois modos | ✅ |
| `compareVersions` | ✅ |

**Por testar**: o launcher em Windows real (Edge, atalho, ícone) e os testes A–N contra produção. Ambos precisam da tua máquina e do deploy.

---

## Instruções para o deploy — Antigravity

```bash
cd backend
npx prisma generate && npm run typecheck && npm run lint
npm test                     # com a BD local — a guarda recusa produção

cd .. && git add -A
git commit -m "feat(v1.2.0): cliente local de producao com API online partilhada

Arquitetura C: as mesmas paginas servidas localmente ou pela web, a falar
com a mesma API de producao. Nenhuma base de dados local, nenhuma
credencial no cliente.

- config.js gerado por ambos os servidores (nunca commitado)
- api.js resolve /api/* contra a base configurada
- eliminado o padrao 'window.apiFetch || fetch' (16 ocorrencias) que no
  cliente local enviaria pedidos para o servidor estatico em silencio
- api.js passa a ser carregado em todas as paginas (faltava em login e index)
- 17 fetch crus encaminhados pelo apiFetch
- /api/version com minimumClientVersion; 426 CLIENT_UPDATE_REQUIRED
- CORS aceita localhost:3400
- local-client/: servidor, launcher, atalho e icone"
git tag -a v1.2.0 -m "v1.2.0"
git push origin master --follow-tags
```

**Sem migração. Sem alteração ao schema. Nenhuma operação na BD.**

### Verificar depois do deploy

```bash
curl -s https://helderlabs.eu/api/version | jq
curl -s https://helderlabs.eu/assets/js/config.js
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "X-HelderLabs-Client-Version: 1.0.0" \
  https://helderlabs.eu/api/me/workspace     # esperado: 426
```

O terceiro é o que prova a Fase 6.

---

## Instalar o cliente na tua máquina

```
1. git pull
2. Clique direito em local-client\install.ps1 → Executar com o PowerShell
3. Duplo clique no ícone HelderLabs ERP
```

---

## Testes A–N (fases 7, 8 e 9)

| | Teste | Como |
|:--|:--|:--|
| A | Abrir pelo launcher | duplo clique |
| B | Login | ecrã de login na janela local |
| C | Selecionar tenant | workspace |
| D | Criar um registo | um cliente no CRM |
| E | POST chega à API de produção | F12 → Network → URL absoluto `helderlabs.eu` |
| F | Backend valida o tenant | criar com token do Tenant A → só aparece no A |
| G | Gravado na BD online | `SELECT` na produção |
| H–I | Abrir `helderlabs.eu` e ver o mesmo registo | browser |
| J–L | Alterar online, recarregar no local | ambos |
| M | Utilizador do A tenta aceder ao B | esperado 403/404 |
| N | `npm test` com `DATABASE_URL` de produção | esperado: abortar |

O **M** é o mais importante. Vale a pena notar que o isolamento não depende de nada que a Fase 3 tenha alterado: o `tenantId` vem do JWT, o `forTenant()` reescreve as queries, e o cliente nunca o envia. O teste confirma que continua verdadeiro, não introduz a garantia.

---

## O que ficou de fora, e porquê

| | |
|:--|:--|
| **Indicador visual de ambiente** (R5) | Vale a pena, mas mexe no cabeçalho de 6 páginas. Fica para uma iteração de UI própria |
| **Empacotar em `.exe`** (opção C) | Só faz sentido para instalar noutras máquinas. A tua já tem Node |
| **Auto-update** | Ponto 18 pede a arquitetura preparada, não implementada. `minimumClientVersion` é essa preparação |
| **`OfflineDataProvider`** | Ponto 11 pede que não seja impedido. Não é: o ponto de substituição existe e o evento `erp:offline` já é emitido |

---

## Fase 14 — o incidente dos testes continua por investigar

Não foi tocado. As consultas de levantamento estão no `GUIA_ERP_LOCAL.md`. Continua a valer: tenants e utilizadores de teste podem sair com a tua confirmação; **registos de auditoria não**.
