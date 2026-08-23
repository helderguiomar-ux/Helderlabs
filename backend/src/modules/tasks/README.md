# Módulo: Tarefas e Processos

**Estado:** ainda não implementado — apenas reservado no schema/estrutura.

## Escopo previsto
Tarefas, responsáveis, prazos, prioridades, estados, dependências,
workflows, aprovações.

## Dependências de dados já existentes
- `User` (núcleo multi-tenant) como responsável por tarefas.
- Deve poder anexar-se a qualquer entidade de outro módulo (Lead,
  Opportunity, Customer, Invoice, ...) via referência polimórfica
  (`entityType` + `entityId`), para cumprir o princípio de reutilização de
  dados entre módulos.

## Próximos passos sugeridos
1. Modelo `Task` com `entityType`/`entityId` genéricos + `assignedUserId`.
2. Motor de workflow simples (estados + transições) antes de aprovações
   mais complexas.
