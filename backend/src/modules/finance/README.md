# Módulo: Gestão Financeira

**Estado:** ainda não implementado — apenas reservado no schema/estrutura.

## Escopo previsto
Receitas, despesas, pagamentos, valores em aberto, contas a receber, contas
a pagar, cash-flow, previsões, indicadores financeiros.

## Dependências de dados já existentes
- Liga-se a `Invoice` (módulo Faturação) para contas a receber.
- Liga-se a `Customer` (módulo CRM) para saldo/histórico por cliente.

## Próximos passos sugeridos
1. Modelos `Payment`, `Expense`, `AccountReceivable`, `AccountPayable`.
2. Indicadores de cash-flow e previsões, seguindo o mesmo padrão de
   `getAdvancedDashboardMetrics` já usado no módulo CRM.
