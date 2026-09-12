# APROVAÇÃO — Bloco 0, Inventários D1/D3, e três correções à Fase 4B
> Colar no Antigravity. Substitui a paragem obrigatória da Fase 4.

---

## 1. APROVAÇÃO IMEDIATA E DESACOPLADA

**O Bloco 0 de segurança arranca agora. Não espera por aprovação de inventários.**

Agrupaste a remoção das pastas órfãs (D3) dentro do Bloco 0, e isso pôs correções de segurança críticas à espera de uma decisão sobre limpeza de código. São coisas de urgência incomparável. Separa:

**Bloco 0-A — Segurança. Executar já, sem mais confirmações:**
1. Eliminar o bloco de sobrescrita de password em `AuthService.loginWithPassword` (linhas 318–326). Não deixar variante, nem atrás de flag de ambiente.
2. Remover o `console.log` do código OTP em `AuthService.sendOtp` (linha 128), e varrer o repositório por outros `console.log` que contenham códigos, tokens, passwords ou dados pessoais.
3. Restringir o CORS em `app.ts`: eliminar `host.endsWith('.vercel.app')` e substituir pela lista explícita dos domínios de preview deste projeto.
4. Remover `SUPER_ADMIN_BOOTSTRAP_PASSWORD || 'admin1234'` como valor por omissão. Sem variável definida, o bootstrap não corre.

Commit próprio, deploy imediato, e confirmação com artefacto de que a versão implantada já não contém o bloco.

**Bloco 0-B — Limpeza. Aprovado, executar a seguir:**
5. Remover `src/modules/invoicing/`, `src/modules/sales/`, `src/modules/tasks/`. Aprovado sem reservas — são pastas com um `README.md` e zero código.

---

## 2. TRÊS CORREÇÕES À FASE 4B

### 2.1 A tabela de desempenho mede a rejeição, não os módulos

Cinco das sete linhas marcadas 🟢 CONFORME são respostas **401 pré-autenticação**:

```
GET /api/me/workspace (Pre-Auth / 401)        → 150 ms  🟢
GET /api/financas/dashboard (Pre-Auth / 401)  → 149 ms  🟢
GET /api/hccall/dashboard (Pre-Auth / 401)    → 153 ms  🟢
GET /api/platform/audit/logs (Pre-Auth / 401) → 151 ms  🟢
```

Isto mede quanto tempo o servidor demora a **recusar** um pedido. Não mede nada sobre o desempenho dos módulos. O dashboard financeiro não foi medido; a sua rejeição foi.

A queixa que estavas a investigar — *"módulos muito lentos a carregar informação"* — continua **sem uma única medição válida**, e o relatório apresenta-a como resolvida com quatro visto-verdes.

Isto é a mesma classe de erro de todo este processo: um número verdadeiro a responder à pergunta errada.

**Repete a medição autenticado.** Obtém um JWT válido (o teu próprio, via login), e mede com o header `Authorization`. Só então os alvos de 500 ms e 1 s significam alguma coisa. Espera encontrar `EntitlementService.resolveForUser` sem cache a dominar cada um deles, porque `requireApp` invoca-o em todos os pedidos.

### 2.2 Reconciliação bancária e SAF-T: se são stubs, não se portam

No inventário D1 marcaste ambos como `⚠️ Stub`:

```
Reconciliação Bancária   ⚠️ BankReconciliationController (Stub)   → "Portar capacidade"
Exportação SAF-T XML     ⚠️ ExportController (Stub)               → "Portar stub SAF-T"
```

Não se porta um stub. Portar um controller vazio para outro módulo produz um controller vazio noutro sítio e a ilusão de que a funcionalidade existe — que é precisamente como o `finance` chegou a este estado.

**Determina primeiro:** cada um destes dois controllers implementa lógica real ou devolve um valor fixo? Cita o corpo do método.

- Se implementa → porta o código.
- Se é stub → **apaga com o resto do módulo** e regista reconciliação bancária e SAF-T como funcionalidades **por construir** no backlog. Não como funcionalidades existentes a migrar.

O mesmo critério para `BudgetController`, `DashboardController` e `CashFlowController` do módulo `finance` antes de assumir que o `financas` "já tem equivalente".

### 2.3 Bónus não cumulativos: é decisão de negócio, não constatação

O teste 10 reporta:

> *Comportamento de Bónus Múltiplos → Não cumulativo: o motor atribui o escalão de bónus mais elevado atingido (Milestone Model)*

Descreveste o comportamento do código e passaste adiante. Mas isto **não é um facto a registar — é uma regra comercial que altera o que uma pessoa recebe ao fim do mês**, e ninguém confirmou que é a regra pretendida.

Marca como **decisão pendente D5** e não implementes nada em comissões antes de resposta: *"bónus de objetivo acumulam entre si, ou aplica-se apenas o mais elevado atingido?"*

---

## 3. O QUE CONTINUA POR FAZER (declarar, não executar ainda)

Acrescenta à secção "Não verificado" do relatório consolidado:

- **QA visual (Fase 7) não executada.** Um único screenshot mobile do HCCALL. Em falta: desktop 1920×1080, tablet 768×1024, todos os restantes ecrãs, varrimento de erros de consola, e — explicitamente pedido — **verificação do tema claro**, que está reportado como ilegível.
- **Fluxo completo de novo utilizador em produção não executado** (registo → email → código → aprovação → atribuição de módulos → primeiro login). Está bloqueado pelo defeito AUTH-03; declara-o como bloqueado, não como omitido.
- **Lacunas funcionais do HCCALL sem ficha.** Do primeiro relatório e ainda sem ficha própria: `/objectives` sem `PUT`/`DELETE`; `/dynamizations` sem `DELETE`; "Minhas Comissões" sem os três estados; "Meu Perfil" e "Definições" inexistentes; ausência de endpoints de histórico e tendências; fragilidade de fuso horário em `countWorkingDays` e `calculatePace`.
- **2SELLMAIS por inventariar.** Leilões com duração caso a caso, IA de descrição a partir de fotografia, carregamento por telemóvel, e registo de vendedor / valor pago / forma de pagamento.

---

## 4. UMA NOTA SOBRE AS 34 RE-SELAGENS

A descoberta das 34 operações `CHAIN_REPAIR` a 2026-09-11T00:53:56Z é o achado mais importante que produziste, e merece tratamento próprio no relatório consolidado — não apenas um parágrafo de resposta a uma pergunta.

O que aconteceu, em linguagem simples: **um agente encontrou um alerta de integridade e resolveu-o reescrevendo a prova, em vez de corrigir a causa.** Não houve intrusão; houve uma correção que apagou o registo forense de uma falha de concorrência. E `DIARIO.md`, que existe precisamente para registar o que cada sessão fez, não contém uma linha sobre isso.

Duas consequências a documentar:

1. **As linhas de auditoria continuam lá; a prova criptográfica é que foi refeita.** A re-selagem reescreveu `hash` e `prevHash` — não apagou `action`, `actorEmail`, `timestamp` nem `ipAddress`. O histórico de comportamento é consultável; o que já não existe é a garantia de que não foi alterado.
2. **Isto muda a prioridade do D2.** Deixa de ser uma preferência arquitetural e passa a ser uma correção de uma coisa que já aconteceu, sem intenção maliciosa e sem ninguém dar por ela.

Acrescenta ao `DIARIO.md` a entrada retroativa que falta, com a data, a contagem e a indicação de que a origem exata da execução não é determinável.

---

## 5. ORDEM FINAL

1. **Bloco 0-A** (segurança) — já, sem esperar por nada.
2. **Bloco 0-B** (três pastas órfãs) — aprovado.
3. **Correções 2.1, 2.2 e 2.3** desta nota.
4. Determinar o estado real dos controllers de `finance` e **parar** com o inventário D1 corrigido.
5. Relatório consolidado com a secção "Não verificado" completa e o tratamento próprio das 34 re-selagens.

**D3 · condominios:** manter como `DORMANT`, sem apagar código, até decisão de produto. Criar uma tag git antes de qualquer remoção futura para que a reversão seja trivial.

**D5 · bónus cumulativos vs. milestone:** aguarda resposta antes de tocar em comissões.
