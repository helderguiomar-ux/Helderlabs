# Módulo: Vendas

**Estado:** ainda não implementado — apenas reservado no schema/estrutura.

## Escopo previsto
Oportunidades, propostas, orçamentos, encomendas, produtos, serviços, preços,
descontos, comissões, vendedores, objetivos, desempenho comercial.

## Dependências de dados já existentes
- `Opportunity` (em `modules/crm`) já cobre o pipeline comercial básico
  (estado, valor estimado, probabilidade). Este módulo deve estender esse
  modelo com Propostas/Orçamentos e Encomendas, não duplicá-lo.
- `Customer` e `Contact` (em `modules/crm`) são o destino de qualquer
  encomenda/proposta gerada aqui.

## Próximos passos sugeridos
1. Modelos `Product`, `PriceList`, `Quote`, `QuoteItem`, `Order`, `OrderItem`.
2. Serviço de conversão Quote -> Order (paralelo ao que já existe para
   Lead -> Opportunity -> Customer).
3. Indicadores de desempenho comercial por vendedor.
