# Módulo: Faturação

**Estado:** ainda não implementado — apenas reservado no schema/estrutura.

## Escopo previsto
Separação clara entre documentos comerciais, faturação, pagamentos,
contabilidade e integrações fiscais.

## Decisão de arquitetura (das instruções do projeto)
Não assumir que o HelderLabs ERP deve substituir, desde já, um software de
faturação certificado. Este módulo deve ser pensado para futura integração
com sistemas de faturação certificados e/ou APIs externas (ex.: SAF-T,
faturação eletrónica), não para reimplementar essa certificação internamente
na primeira fase.

## Próximos passos sugeridos
1. Modelo `Invoice` / `InvoiceLine` como espelho de documentos emitidos
   externamente (referência ao documento certificado, não o documento em si).
2. Camada de integração (adapter) para o(s) sistema(s) de faturação
   certificados a escolher.
3. Ligação a `Order` (módulo Vendas) e a `Payment` (módulo Financeiro).
