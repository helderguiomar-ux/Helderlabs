# PROMPT — Auditoria Adversarial HELDERLABS ERP
> Colar integralmente no Antigravity, na raiz de `C:\Users\helde\Desktop\Dev\helderlabs-erp`.
> Preparado a 2026-09-12. Acompanha o relatório `AUDITORIA_INDEPENDENTE_2026-09-12.md`.

---

## CONTEXTO E MANDATO

És auditor, não implementador. A tua tarefa nesta sessão é **produzir evidência**, não produzir código.

Uma auditoria anterior a este mesmo sistema declarou **122/122 testes verdes e 100% de conformidade** enquanto a aplicação em produção estava demonstravelmente partida. O ficheiro `ESTADO.md` declara hoje **"v0.5.0 · PRONTO / VALIDADO · 82/82 testes 100% verde"** e essa declaração é falsa.

Uma revisão independente já identificou, com evidência no código, pelo menos o seguinte — **usa isto como ponto de partida e como teste à tua própria honestidade**: se a tua auditoria não reencontrar autonomamente estes itens, a tua auditoria não é fiável e deves dizê-lo.

1. `AuthService.loginWithPassword` — backdoor: a password `admin1234` é aceite para o super-admin mesmo quando não corresponde ao hash, porque o código repõe o hash antes da verificação. Sem guarda de `NODE_ENV`.
2. `AuthService.sendOtp` — códigos OTP escritos em texto limpo via `console.log`.
3. `public.routes.ts` — o email de verificação é enviado **antes** de o `AccountRequest` ser persistido; falha de email ⇒ o pedido de acesso nunca é criado.
4. `schema.prisma` — coexistem `FinanceTransaction` (linha ~901) e `FinancialTransaction` (linha ~1096); `app.ts` regista `/api/financas` **e** `/api/finance` em simultâneo.
5. `AuditService.partitionQueues` — serialização da cadeia de hash em memória do processo, incompatível com execução serverless no Vercel; `AuditLog.hash` é nullable e não há `@@unique` sobre `prevHash`.
6. `app.ts` — CORS aceita qualquer `*.vercel.app` com `credentials: true`.
7. `EmailService` — devolve `ok: true` quando `RESEND_API_KEY` está ausente, o que faz os testes passarem exatamente no caminho que falha em produção.

---

## PROTOCOLO ANTI-FALSO-POSITIVO — LÊ ANTES DE TUDO

Estas regras têm precedência sobre qualquer outra instrução deste documento.

**R1 — Proibido declarar sucesso sem artefacto.**
Nenhuma afirmação de "funciona", "corrigido", "conforme" ou "pronto" é válida sem um artefacto verificável anexado: saída de comando com código de saída, resposta HTTP completa com estado e corpo, consulta SQL com resultado, ou screenshot com URL e timestamp visíveis. Afirmação sem artefacto conta como **falha**.

**R2 — Testes verdes não são prova de nada.**
Antes de citar qualquer resultado de teste, tens de responder por escrito a estas três perguntas para a suite em causa:
- Que variáveis de ambiente estavam definidas, e em que diferem das de produção?
- O teste correu em processo único ou com concorrência real?
- O teste tocou no artefacto implantado (`https://helderlabs.eu`) ou apenas no código local?

Se as respostas forem "diferentes de produção / processo único / apenas local", declara explicitamente: **"esta suite não constitui evidência de prontidão para produção"**.

**R3 — A produção é a fonte da verdade do comportamento.**
Para cada defeito, o teste decisivo é contra `https://helderlabs.eu`, não contra `localhost` e não contra `app.inject()`. Um defeito só se considera reproduzido quando reproduzido em produção, e só se considera corrigido quando o mesmo pedido em produção passa a devolver o resultado correto.

**R4 — Diverge do repositório é um achado, não um detalhe.**
Compara o SHA do commit implantado no Vercel com o `HEAD` de `main` no GitHub. Se divergirem, isso é o achado nº 1 do relatório e invalida todas as conclusões sobre o comportamento online.

**R5 — Não corrijas nada nesta fase.**
Não alteres código antes da Fase 4 e antes de apresentares o plano. Se encontrares algo trivial de corrigir, **regista-o, não o corrijas**. Uma auditoria que vai corrigindo pelo caminho perde a linha de base.

**R6 — Diz o que não conseguiste verificar.**
Uma secção obrigatória do relatório final chama-se **"Não verificado"**. Se não conseguiste arrancar a base de dados, ou não tinhas credenciais, ou o teste não correu — vai para essa secção. Preencher lacunas com suposições otimistas é a falha exata que esta auditoria existe para corrigir.

**R7 — Contradiz o que encontrares nos documentos.**
`ESTADO.md`, `CHANGELOG.md` e `DIVIDA_TECNICA.md` foram escritos pelo agente que escreveu o código, sem contraditório. Trata-os como **alegações a verificar**, nunca como factos.

---

## FASE 1 — COMPREENSÃO

Sem alterar nada, produz:

1.1 Inventário da arquitetura: stack, versões, entrypoints, modo de deploy, onde corre o backend (Vercel? Render? ambos? `render.yaml` e `vercel.json` coexistem — explica qual está ativo).

1.2 Mapa completo de rotas registadas em `src/app.ts`, com, para cada uma: prefixo, ficheiro de rotas, guardas aplicados (`authenticate`, `requireApp`, `requirePermission`), e módulo do catálogo a que corresponde.

1.3 Inventário dos 87 modelos do `schema.prisma`, agrupados por módulo, **assinalando explicitamente pares de modelos que representem o mesmo conceito de negócio**.

1.4 Confronto entre `src/config/modules.ts` (catálogo canónico) e as rotas realmente registadas. Lista: módulos no catálogo sem rotas; rotas sem entrada no catálogo; discrepâncias de `routePrefix`.

1.5 Estado do deploy: SHA implantado no Vercel vs `HEAD` de `main`; data do último deploy com sucesso; variáveis de ambiente definidas em produção (**nomes apenas, nunca valores**).

1.6 Inventário de módulos mortos: pastas em `src/modules/` que contenham apenas `README.md` ou nenhum código executável.

---

## FASE 2 — DIAGNÓSTICO

Para **cada** achado, usa rigorosamente esta ficha:

```
ID:            [AUTH-01, FIN-03, AUD-02, HCC-05, SELL-01, PLAT-04...]
Severidade:    CRÍTICO | ALTO | MÉDIO | BAIXO
Ficheiro:linha
Evidência:     excerto de código citado
Cenário de falha: entradas concretas → resultado errado concreto
Reprodução em produção: pedido exato + resposta obtida (ou "NÃO VERIFICADO: <porquê>")
Impacto de negócio: uma frase
Correção proposta: uma frase (NÃO implementar)
```

Cobre obrigatoriamente:

**2.1 Autenticação e autorização**
Caminhos de login (password, OTP, OAuth), backdoors, segredos por omissão no código, enumeração de contas, escritas na base de dados em caminhos anteriores à autenticação, rate limiting efetivo, expiração e revogação de JWT, impersonation.

**2.2 Isolamento multi-tenant**
Verifica a ADR-001. Para **cada** `src/modules/**/*.ts`, determina se usa `forTenant()` ou o `prisma` cru. Produz a lista dos que usam o cru e, para cada um, se filtra manualmente por `tenantId`. Tenta uma fuga real entre tenants em produção com dois utilizadores de tenants distintos.

**2.3 Módulo financeiro — prioridade máxima**
Determina qual dos dois sistemas (`financas` / `finance`) o frontend usa em cada ecrã. Conta as linhas em `FinanceTransaction` e em `FinancialTransaction` na base de dados de produção. Identifica cada KPI e cada gráfico de `app.html` e qual a tabela que o alimenta. **Responde à pergunta: existem dados de negócio reais em ambas as tabelas?** Verifica se `POST`/`PUT` de operações financeiras funcionam ponta a ponta em produção (o utilizador reporta que não consegue editar operações — reproduz isso).

**2.4 Auditoria e integridade**
Executa `scripts/verify-audit-chain.ts` contra produção. Se a cadeia estiver partida, determina **se a causa é concorrência ou adulteração** — compara `createdAt` das linhas com o mesmo `prevHash`; linhas quase simultâneas indicam corrida, não intrusão. Quantifica: quantas linhas, quantos tenants, desde quando. Verifica que operações **não** deixam rasto (leituras, operações que falham antes do `onResponse`).

**2.5 CRUD por módulo**
Para CRM, Finanças, HCCALL e 2SELLMAIS, constrói uma matriz: entidade × (Create, Read, Update, Delete) × (rota existe? / controller implementa? / funciona em produção?). O utilizador reporta "CRUD não funcional em vários módulos" — esta matriz é a resposta factual a essa queixa.

**2.6 Desempenho**
Mede tempos reais em produção para: login, `/api/me/workspace`, dashboard financeiro, dashboard HCCALL, listagem de auditoria. Para cada um acima de 1 s, identifica a causa (N+1, ausência de índice, resolução de entitlements sem cache, escrita de auditoria síncrona). O utilizador reporta "módulos muito lentos" — quantifica.

**2.7 Gestão de tenants e licenciamento**
Verifica os requisitos declarados: ficha por tenant com módulos licenciados, valor mensal e data de renovação; bloqueio efetivo de acesso sem licença válida; pedidos de acesso visíveis e aprováveis; desativação e eliminação de tenants com backup automático; perfis e autorizações CRUD por funcionalidade; tenant HelderLabs com acesso a todas as aplicações. Para cada um: **existe / parcial / não existe**, com evidência.

**2.8 Segurança aplicacional**
CSP, CORS, validação de entradas, injeção SQL, XSS, CSRF, gestão de segredos (verifica se `.env.production` está sob controlo de versões), cabeçalhos, exposição de erros de terceiros em endpoints públicos.

---

## FASE 3 — HCCALL: AUDITORIA FUNCIONAL DEDICADA

O HCCALL deixou de ser um sistema de gestão de equipas comerciais e passou a ser **um sistema pessoal de performance comercial**, que uma organização pode depois adotar. Audita contra esta especificação, não contra a implementação existente.

### Especificação de referência — HCCALL 2.0

**Princípio central:** cada vendedor/operador tem o seu próprio espaço e acompanha autonomamente objetivos, vendas, dinamizações e evolução. A comparação é sobretudo com o próprio desempenho anterior, não com uma equipa. Funciona em loja, call center, comercial externo ou qualquer contexto de venda — **não é um sistema para a NOS nem para call centers**.

**Módulos:** Meu Dashboard · Meu Perfil · Minhas Vendas · Meus Objetivos · Minhas Dinamizações · Minhas Comissões · Minha Performance · Definições

**Conceito de dinamização:** regra comercial temporária com escalões, bónus de objetivo e condições. O motor separa venda → produto → dinamização → regra → comissão.

**Comissões em três estados:** estimada · validada · paga. A estimativa do HCCALL pode divergir do processado pela entidade empregadora, e o sistema tem de suportar essa divergência de forma explícita.

**Mobile-first:** telemóvel para registo rápido (poucos campos, mínimo de passos, utilizável durante o trabalho) e consulta rápida do desempenho. Desktop para análise, configuração, relatórios e gestão. **Uma aplicação responsiva, não duas aplicações.**

**Ciclo de valor:** registar → medir → analisar → identificar desvios → sugerir ação → acompanhar evolução. O sistema não é um sítio onde se introduzem dados; é um sistema que interpreta os dados e chama a atenção para o que interessa.

**Funcionalidades diferenciadoras:** simulador "e se…" · ritmo e previsão de atingimento · calendário de produção · alertas orientados para ação.

### O que tens de produzir

3.1 **Matriz de conformidade**: os 8 módulos × (API existe / implementada / testada / funciona em produção / conforme à especificação). Uma linha por módulo, veredicto explícito.

3.2 **Lacunas de CRUD.** Já sabemos que `/objectives` só tem `GET` e `POST`, e que `/dynamizations` não tem `DELETE`. Confirma e encontra as restantes.

3.3 **Comissões.** `GET /reports/commissions` é hoje um alias de `getDashboard`. Determina: onde se registam os três estados? Existe transição estimada→validada→paga? Onde se regista a divergência face ao processado pela entidade empregadora? Se não existir, é uma lacuna funcional de primeira ordem, não um detalhe.

3.4 **Histórico e evolução.** Procura suporte para: evolução de vendas e produtividade, melhores períodos, tendências, comparação com períodos anteriores, desempenho por produto/serviço, evolução da taxa de conversão. Para cada um: existe endpoint? existe modelo de dados que o suporte?

3.5 **Fusos horários.** `HccallObjectiveService.countWorkingDays` e `calculatePace` usam `getDay()` e `setHours()` — hora local do servidor. Determina o fuso do servidor de produção e calcula o erro real para um utilizador em Europe/Lisbon durante o horário de verão. Num sistema cujo indicador central é "quantas vendas fiz hoje", um deslocamento de dia é um erro de domínio.

3.6 **Mobile-first, medido.** Conta os passos e campos necessários para registar uma venda em ecrã de 390×844. Mede o tempo do primeiro toque até à confirmação. O objetivo declarado é registo em menos de 20 segundos — confirma ou desmente com screenshots e timestamps.

3.7 **Identidade do módulo.** `config/modules.ts` chama-lhe `'HCCALL · Call Center Telecom & Energia'`. Isto contradiz por escrito o reposicionamento. Regista como achado e propõe o nome e descrição corretos.

3.8 **Motor de comissões.** É a melhor peça do repositório. Não o reescrevas. Testa-o nas fronteiras: escalão mínimo exato, limite superior `null`, quantidade zero, quantidades negativas, valores de cêntimos que gerem arredondamento, `RETROACTIVE` vs `MARGINAL` com os mesmos dados, bónus acumulados, ausência de dinamização. Confirma determinismo (mesma entrada, mesma saída, 100 execuções) e idempotência.

---

## FASE 4 — PLANO (APRESENTAR E PARAR)

Não implementes nada antes de apresentares isto e receberes aprovação.

Ordena todos os achados numa tabela única por **(severidade × esforço)**. Para cada bloco de trabalho: problema, solução proposta, ficheiros afetados, dependências, riscos, o que pode partir, e como se valida que ficou corrigido.

Trata separadamente as **decisões que não te competem** e que exigem resposta do Hélder:

- **D1.** `financas` vs `finance`: qual sobrevive? A migração de dados é destrutiva e irreversível. Apresenta a contagem de registos reais em cada tabela antes de perguntar.
- **D2.** `AuditService.repairChain` reescreve toda a cadeia de hashes. Uma cadeia que o administrador pode re-selar não prova nada contra o administrador. Manter (é um detetor de erros) ou remover (é uma prova)? Não podem ser as duas coisas.
- **D3.** Remoção dos módulos `condominios`, `invoicing`, `sales`, `tasks`: apresenta inventário do que existe e o que se perde, **antes** de apagar qualquer linha.
- **D4.** Modo `TEAM` do `HccallScopeService` dá visibilidade total do tenant sem verificação de papel. É intencional?

---

## FASE 5 — IMPLEMENTAÇÃO (só após aprovação)

Ordem obrigatória, um bloco por commit, sem misturar blocos.

**Bloco 0 — Segurança, imediato**
1. Remover a backdoor `admin1234` de `loginWithPassword` inteiramente. O bootstrap de password só pode existir sob `NODE_ENV !== 'production'` **e** variável explícita.
2. Remover o `console.log` do código OTP. Auditar todos os `console.log` que contenham dados pessoais ou segredos.
3. Restringir o CORS aos domínios do projeto; eliminar o `*.vercel.app` aberto.
4. Confirmar que `.env.production` não está sob controlo de versões; se estiver, rodar **todos** os segredos.

**Bloco 1 — Email e onboarding**
5. Publicar os registos DNS do Resend para `helderlabs.eu` (região `eu-west-1`) — usar `scripts/ovh-configure-dns.mjs` se aplicável, e depois disparar a verificação:
   - TXT `resend._domainkey` = `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDm4h/ZDaglIhKbPlrZBh71wyY4ra9ldOg5q86y5ldvAqwokJ7s8ivCtTWkRJYGQ5cQVHlU+HrQFsBVeFFn/QCaTxmzIpau7t1czZxFiOe6HhXkHBHnFzVXyKpZWy1GYRCsv39V+21e9KOlB4NJbXFvDU4G1o2Enscyt7xNGS90TQIDAQAB`
   - MX `send` = `feedback-smtp.eu-west-1.amazonses.com` (prioridade 10)
   - TXT `send` = `v=spf1 include:amazonses.com ~all`
6. **Independentemente do DNS**, inverter a ordem em `POST /api/public/register`: persistir o `AccountRequest` primeiro, enviar depois. Se o envio falhar, o pedido fica gravado com a falha marcada, o utilizador recebe uma mensagem honesta ("o teu pedido ficou registado; não conseguimos enviar o código — tenta reenviar") e o super-admin vê-o na lista com botão de reenvio. **Nunca perder um pedido de acesso por falha de um fornecedor externo.**
7. Deixar de expor mensagens de erro do fornecedor em endpoints públicos. Registar o detalhe internamente, devolver um código estável.
8. Tornar `emailConfirmation` e `passwordConfirmation` obrigatórias no schema Zod. Mínimo de 12 caracteres para a password.
9. Fazer `AuthService.sendOtp` verificar o resultado do envio e deixar de afirmar que enviou quando não enviou.
10. Uniformizar as respostas de `sendOtp` para eliminar a enumeração de contas.
11. Retirar `ensureSuperAdminUser` dos caminhos não autenticados; passar para um script de bootstrap executado no arranque.

**Bloco 2 — Financeiro** (depende de D1)

**Bloco 3 — Auditoria**
12. `hash` obrigatório; `@@unique([tenantId, prevHash])`; `@@unique([tenantId, seq])`.
13. Escrita de auditoria dentro de transação com `pg_advisory_xact_lock(hashtext(tenantId))`, substituindo o `partitionQueues` em memória. Colisão passa a ser erro recuperável com retry, não cadeia partida.
14. Auditar leituras; incluir `oldValue`/`newValue` nas escritas com diff.
15. Paginar `verifyAuditChain`.
16. Falha de auditoria deixa de ser silenciosa em categoria `SECURITY`.

**Bloco 4 — HCCALL 2.0** (conforme o plano da Fase 4)

---

## FASE 6 — TESTES (é aqui que a auditoria anterior falhou)

**6.1 Testes que faltam e que são obrigatórios**

- Registo público com `RESEND_API_KEY` **presente** e envio a falhar → o `AccountRequest` **tem de existir** na base de dados. *Este é o teste cuja ausência tornou a suite inútil.*
- Escrita concorrente na cadeia de auditoria: 50 pedidos em paralelo → a cadeia mantém-se íntegra.
- Fuga entre tenants: utilizador do tenant A tenta ler cada recurso do tenant B em cada módulo → 403 ou 404 em todos.
- `loginWithPassword` com `admin1234` e hash diferente → **tem de falhar**.
- Uma operação financeira criada via API aparece em todos os KPIs e gráficos que a devem refletir.
- Motor de comissões: os casos de fronteira da secção 3.8.

**6.2 Condições de execução**

Todos os testes correm com as **mesmas variáveis de ambiente que a produção** (com segredos de teste, mas as mesmas chaves definidas). Se um teste só passa porque uma variável está ausente, esse teste está a testar o ambiente e não o sistema — marca-o como inválido.

**6.3 Smoke test contra produção**

Suite separada que corre contra `https://helderlabs.eu` e verifica: health, versão implantada = SHA de `main`, login real, um pedido autenticado por módulo, integridade da cadeia de auditoria.

---

## FASE 7 — QA VISUAL

Com Playwright, em **390×844 (telemóvel)**, **768×1024 (tablet)** e **1920×1080 (desktop)**, para cada ecrã (`index`, `login`, `workspace`, `app` com cada módulo, `hccall`, `super-admin`, `/loja`):

Screenshot com URL e timestamp visíveis. Consola do browser capturada — **qualquer erro em consola é um achado**. Verifica: alinhamento, responsividade, legibilidade em **tema claro e escuro** (o tema claro está reportado como ilegível — confirma e corrige), estados vazios, estados de carregamento, estados de erro, navegação, acessibilidade (contraste, foco, navegação por teclado, `aria`).

Testa o **fluxo completo de novo utilizador** em produção, do zero: registo → email → código → aprovação pelo super-admin → atribuição de módulos → primeiro login → workspace. Screenshot de cada passo. É este fluxo que está partido hoje; é este fluxo que tem de ficar demonstrado.

---

## FASE 8 — RELATÓRIO FINAL

Estrutura obrigatória:

1. **Sumário executivo** — cinco frases, sem adjetivos.
2. **Veredicto de prontidão por módulo** — CRM / Finanças / HCCALL / 2SELLMAIS / Plataforma. Para cada um: **PRONTO** ou **NÃO PRONTO**, e se não estiver, os bloqueadores enumerados. Não existe "quase pronto".
3. **Achados** — tabela completa, ordenada por severidade, com o ID de cada ficha.
4. **Corrigido nesta sessão** — com o artefacto de verificação de cada correção.
5. **Não corrigido** — com a razão.
6. **🔴 NÃO VERIFICADO** — tudo o que não conseguiste confirmar, e porquê. *Secção obrigatória. Um relatório sem esta secção é rejeitado.*
7. **Decisões pendentes do Hélder** — D1 a D4 e quaisquer outras.
8. **Estado da suite de testes** — quantos testes, o que cobrem, **o que demonstravelmente não cobrem**, e a resposta às três perguntas da regra R2.
9. **Divergência repositório ↔ produção** — SHA implantado vs `HEAD`.
10. **Recomendações**, ordenadas por (impacto ÷ esforço).

Atualiza `ESTADO.md`, `DIARIO.md`, `DECISOES.md` e `DIVIDA_TECNICA.md` com a realidade. Em particular: **`ESTADO.md` não pode voltar a dizer "PRONTO / VALIDADO" enquanto existir um único bloqueador CRÍTICO em aberto**, e `DIVIDA_TECNICA.md` tem de refletir a dívida real (hoje lista consolidação de CSS como alta prioridade enquanto o sistema tem uma backdoor de autenticação).

---

## REGRA FINAL

Se ao fim desta auditoria a tua conclusão for que o sistema está bem, uma de duas coisas é verdade: ou a revisão independente que te foi entregue está errada e tens de o demonstrar item a item com evidência — ou a tua auditoria repetiu o erro da anterior.

**Um relatório que diz "está tudo bem" não é um bom resultado. É um resultado suspeito.**

Preferimos um relatório honesto que diga "não consegui verificar seis dos doze pontos" a um relatório que declara conformidade total.
