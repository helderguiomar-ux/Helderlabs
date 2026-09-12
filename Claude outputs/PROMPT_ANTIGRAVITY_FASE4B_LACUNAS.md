# PROMPT DE SEGUIMENTO — Fase 4B: Lacunas da Auditoria + Decisões D1–D4
> Colar no Antigravity, na mesma sessão ou numa nova na raiz de `helderlabs-erp`.
> Sequência: este documento vem **depois** de `PROMPT_ANTIGRAVITY_AUDITORIA.md` e do relatório que produziste a 2026-09-12.

---

## RECONHECIMENTO

O relatório que produziste é substancialmente melhor do que a auditoria anterior. Em concreto, e isto é mérito real:

- Reproduziste o 502 em produção com corpo de resposta completo — prova, não alegação.
- Contaste as linhas reais na base de dados (`FinanceTransaction` = 11, `FinancialTransaction` = 0) — isso transformou a decisão D1 de uma migração destrutiva numa eliminação trivial.
- Confirmaste o alinhamento do SHA implantado com `master` — a queixa de divergência entre repositório e produção fica formalmente encerrada.
- Reproduziste a enumeração de contas em produção via `/api/auth/check-email`.
- Encontraste quatro pares de modelos duplicados que a revisão independente não tinha apanhado (`RolePermission`/`RolePermissionLink`, `Company`/`Customer`/`HccallCustomer`, `CompanyContact`/`Contact`/`HccallContact`, `HccallService`/`HccallProduct`).
- Identificaste corretamente `render.yaml` como artefacto órfão.

Isto é evidência a sério. A crítica que se segue não a apaga.

---

## A FALHA A CORRIGIR: OMISSÃO SILENCIOSA

A regra **R6** exige que tudo o que não foi verificado apareça na secção "Não verificado". A tua secção lista três itens — todos eles coisas que **escolheste** não fazer por prudência. Não lista **nenhuma** das secções obrigatórias que simplesmente não executaste.

Isto é o mesmo padrão da auditoria anterior num formato novo: o relatório parece completo porque as secções ausentes não se anunciam. Um leitor que não tenha o prompt ao lado não consegue saber o que falta.

**Secções obrigatórias não executadas e não declaradas:**

| Ref. | Secção | Estado real |
|:--|:--|:--|
| §2.6 | Desempenho | **Zero medições.** Nenhum tempo de resposta em produção. A queixa "módulos muito lentos" continua por quantificar |
| §2.7 | Gestão de tenants e licenciamento | **Ausente por completo.** Nove requisitos explícitos, nenhum respondido |
| §3.6 | Mobile-first medido | **Não executado.** Nenhum screenshot, nenhuma contagem de passos, nenhum tempo |
| §3.8 | Motor de comissões nas fronteiras | **Não executado.** Nenhum caso de fronteira, nenhuma verificação de determinismo |
| §2.4 (parcial) | Operações sem rasto de auditoria | **Não abordado.** A pergunta "que operações não deixam rasto" ficou sem resposta |

**Achados conhecidos ausentes do relatório, sem ficha e sem menção:**

- `AuditService` audita apenas `request.method !== 'GET'` — **as leituras nunca são auditadas**. Esta é uma queixa explícita do Hélder ("auditoria transversal não regista todas as interações") e não aparece no teu relatório.
- O hook genérico de auditoria não grava `oldValue`/`newValue` — não existe "qual era o estado anterior" para a maioria das operações.
- `AuditService.audit()` envolve tudo em `try/catch` com `console.error` — falhas de auditoria são silenciosas e a operação de negócio tem sucesso à mesma.
- `verifyAuditChain` faz `findMany` sem paginação — carrega todos os registos em memória e é chamado por `getDashboardMetrics`.
- `repairChain` reescreve os hashes de todos os registos — aparece em D2 como decisão, mas nunca como achado com severidade.
- `modules/finance/services/` contém quatro serviços que somam 2,4 KB (`BudgetService` 392 B, `ReportService` 329 B, `CashFlowService` 708 B, `FinanceService` 985 B) enquanto `FinancasController.ts` tem 34,5 KB — a lógica de negócio vive nos controllers.
- CSP com `'unsafe-inline'` e `'unsafe-eval'` em `scriptSrc`.
- `PublicRegisterSchema`: `password: z.string().min(4)`, com `emailConfirmation` e `passwordConfirmation` ambos `.optional()` — a validação é opcional **ao nível do servidor**, não apenas do formulário.

---

## VIOLAÇÃO DE PROTOCOLO A NOMEAR

**AUTH-01** — o achado mais grave do relatório — tem no campo *Reprodução em produção*: `"Verificado estaticamente no código implantado"`.

A regra **R1** diz que uma leitura estática não é um artefacto de reprodução. Não testares a backdoor em produção é **defensável** — o teste sobrescreveria a password real do super-admin, que é um efeito destrutivo. Mas então pertence à secção "Não verificado" com essa razão escrita.

Declarar conformidade com R1 no topo e depois assentar o achado CRÍTICO numa leitura estática é exatamente o hábito que o protocolo existe para quebrar. Corrige o campo, não o achado.

---

## PERGUNTA POR RESPONDER

Concluis que a cadeia de auditoria está íntegra: 1974 registos em 19 partições.

O Hélder observou anteriormente, na própria aplicação, o alerta: *"falha na cadeia criptográfica SHA-256, adulteração detetada em prevHash na linha seq=1"*.

Ambas as coisas não podem ser verdade ao mesmo tempo sem uma explicação. Há três hipóteses e tens de determinar qual:

1. **`repairChain` ou `scripts/repair-audit-chain.ts` foi executado** entretanto — nesse caso a cadeia foi re-selada e a evidência do erro original foi apagada. `DIARIO.md` não contém qualquer registo de uma re-selagem.
2. **O fallback de payload legado** em `verifyAuditChainForPartition` está a aceitar registos que o verificador canónico rejeitaria — duas definições de "íntegro" significam nenhuma.
3. **O alerta era de outro ambiente** (local, ou uma base de dados anterior).

**Para responder, executa:**

```sql
SELECT id, seq, action, "actorEmail", timestamp, description
FROM audit_logs
WHERE action = 'CHAIN_REPAIR'
ORDER BY timestamp DESC;
```

E quantifica quantos dos 1974 registos passam pelo **digest canónico** e quantos só passam pelo **fallback legado**. Se algum passar apenas pelo fallback, isso é um achado com ficha própria.

"A cadeia está íntegra" sem esta resposta é uma conclusão reconfortante, não uma conclusão verificada.

---

## TAREFAS DESTA FASE (ainda sem implementar)

### T1 — Completar §2.6: Desempenho, com números

Mede em produção (`https://helderlabs.eu`), 5 execuções cada, reporta mediana e p95:

| Endpoint | Alvo |
|:--|:--|
| `POST /api/auth/check-email` | < 300 ms |
| `POST /api/auth/login` | < 800 ms |
| `GET /api/me/workspace` | < 500 ms |
| `GET /api/financas/dashboard` | < 1 s |
| `GET /api/hccall/dashboard` | < 1 s |
| `GET /api/platform/audit/logs` | < 1 s |

Para cada um acima do alvo, identifica a causa com evidência: N+1, índice em falta, `EntitlementService.resolveForUser` sem cache (é chamado em **todos** os pedidos por `requireApp`), escrita de auditoria síncrona no hook `onResponse`, ou `ensureSuperAdminUser` a escrever na base de dados em caminhos pré-autenticação.

### T2 — Completar §2.7: Gestão de tenants e licenciamento

Para cada requisito: **existe / parcial / não existe**, com ficheiro:linha ou resposta HTTP.

1. Ficha por tenant com módulos licenciados
2. Valor mensal por tenant
3. Data de renovação por tenant
4. Bloqueio **efetivo** de acesso quando não há licença válida (testa: suspende um módulo e confirma o 403)
5. Pedidos de acesso visíveis no super-admin
6. Aprovação de pedidos com atribuição de módulos
7. Desativação de tenant
8. Eliminação de tenant com geração automática de ficheiro de backup migrável
9. Definição de perfis e autorizações CRUD por funcionalidade de cada aplicativo
10. Tenant HelderLabs com acesso a todas as aplicações (confirma na base de dados, não no código)

### T3 — Completar §3.8: Motor de comissões nas fronteiras

`HccallCommissionEngine` é a melhor peça do repositório. Não o alteres — prova-o.

Casos obrigatórios: quantidade 0 · quantidade negativa · escalão mínimo exato (`minQuantity` = quantidade) · `maxQuantity: null` · sem escalões definidos · sem dinamização · valores de cêntimos com arredondamento · `RETROACTIVE` vs `MARGINAL` com os mesmos dados de entrada (têm de divergir, e a divergência tem de ser explicável) · bónus múltiplos acumulados · limiar de bónus exato.

Determinismo: 100 execuções com a mesma entrada, asserção de igualdade byte a byte da saída. Idempotência: recalcular sobre o resultado não altera o resultado.

### T4 — Completar §3.6: Mobile-first, medido

Playwright a 390×844, contra produção. Screenshot de cada passo com URL e timestamp visíveis. Conta **campos** e **toques** do início ao registo confirmado de uma venda. Mede o tempo total. O objetivo declarado é menos de 20 segundos — confirma ou desmente.

### T5 — Fichas em falta

Cria ficha completa (formato da Fase 2) para cada um dos oito achados conhecidos listados na secção "Achados conhecidos ausentes" acima.

### T6 — Corrigir o relatório

Republica o relatório com: o campo de reprodução de AUTH-01 corrigido; uma secção "Não verificado" que inclua **todas** as secções não executadas com a razão de cada uma; e as severidades revistas — em particular **SEC-02** (a simulação de email que mascarou a falha em toda a suite de testes) não é MÉDIO: é a causa raiz de uma auditoria anterior ter declarado 122/122 verde sobre um sistema partido.

---

## DECISÕES D1–D4 — RESPOSTAS DO HÉLDER

### D1 · Unificação financeira — **DECIDIDO: consolidar em `financas`**

Confirmado pelos teus próprios números: 11 registos em `FinanceTransaction`, 0 em `FinancialTransaction`. **Não há migração de dados a fazer.**

Antes de apagar seja o que for, produz um **inventário de capacidades**: para cada funcionalidade servida por `/api/finance` (dashboard, orçamentos, fluxo de caixa, relatórios P&L e balanço, reconciliação bancária, exportação SAF-T e CSV), determina se existe equivalente em `/api/financas`. O que existir **apenas** em `finance` tem de ser portado antes da remoção — caso contrário a consolidação apaga funcionalidades.

Entrega esse inventário como tabela e **para**. Só depois de aprovado se remove `src/modules/finance/`, a rota `/api/finance` em `app.ts`, e os modelos `FinancialTransaction`, `FinancialAttachment`, `FinancialReport`, `BudgetItem`, `CashFlowProjection` e `BankReconciliation` que fiquem órfãos.

### D2 · `repairChain` — **DECIDIDO: manter, mas deixar de a poder usar em silêncio**

A recuperação operacional tem valor real; o que não pode existir é uma re-selagem que fique indistinguível de uma cadeia nunca partida. Implementa as quatro condições:

1. **Registo integral do antes.** Hoje guarda `sampleOldHashes` com apenas as 5 primeiras entradas. Passa a gravar a totalidade dos hashes antigos num registo imutável separado.
2. **Marca permanente.** Toda a extensão re-selada fica marcada. `verifyAuditChain` nunca mais pode devolver um simples "íntegra" para essa partição — devolve `"íntegra desde re-selagem de <data> por <ator>; <n> registos anteriores re-selados"`.
3. **Motivo obrigatório**, com mínimo de caracteres, sem valor por omissão.
4. **Visível na interface.** O painel de auditoria mostra o estado de re-selagem, não só o booleano de integridade.

Assim a cadeia continua a detetar erros e deixa de fingir que é prova contra quem a pode reescrever.

### D3 · Módulos órfãos — **DECIDIDO, com uma distinção**

- `src/modules/invoicing/`, `src/modules/sales/`, `src/modules/tasks/` — apenas `README.md`, zero código executável. **Elimina já**, sem inventário.
- `src/modules/condominios/` — **é diferente e não entra nesta decisão.** Tem controller, rotas e `EnterpriseCondominiosService` (~9 KB de código real), modelos no schema e testes. Segue o método de inventário-e-aprovação: produz o inventário do que existe e do que se perde, e **para**.

### D4 · Modo `TEAM` do `HccallScopeService` — **DECIDIDO: restringir**

Hoje `mode === 'TEAM'` devolve `{}`, ou seja, visibilidade total do tenant **sem qualquer verificação de papel**: qualquer utilizador de um tenant nesse modo vê as vendas e comissões de todos os outros. Num sistema que se reposicionou para autocontrolo individual, isso é o oposto do princípio.

`TEAM` passa a exigir papel explícito de supervisão (`TENANT_ADMIN`, `TENANT_OWNER` ou `SUPER_ADMIN`). Um utilizador sem esse papel num tenant em modo `TEAM` continua a ver apenas os seus próprios dados.

---

## ORDEM DE EXECUÇÃO

1. Responder à **pergunta da cadeia de auditoria** (é a que tem prazo de validade — se houve re-selagem, cada dia que passa afasta-a).
2. T1, T2 (as duas secções da Fase 2 em falta).
3. T3, T4 (as duas secções da Fase 3 em falta).
4. T5, T6 (fichas e republicação do relatório).
5. Inventário de capacidades de D1 e inventário de `condominios` de D3 — **e parar** para aprovação.
6. Só depois: **Bloco 0** de implementação (backdoor, OTP em logs, CORS), que não depende de nenhuma decisão pendente e devia arrancar em paralelo com tudo o resto.

**O Bloco 0 não precisa de esperar por nada.** A backdoor `admin1234` está ativa em produção neste momento.

---

## NOTA FINAL

O teu relatório melhorou porque foste ao ambiente real buscar factos. Mantém isso. O que falta é a disciplina simétrica: **declarar com a mesma clareza o que não foste verificar**.

Um relatório que diz "não executei quatro das doze secções, por estas razões" vale mais do que um relatório que parece completo. O protocolo não te pede infalibilidade — pede que o mapa das lacunas seja tão fiável quanto o mapa dos achados.
