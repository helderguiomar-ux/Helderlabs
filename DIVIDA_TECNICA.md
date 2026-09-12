# DÍVIDA TÉCNICA & MELHORIAS FUTURAS — HELDERLABS ERP

> Registo de itens técnicos pendentes, otimizações e refactorings planeados.
> Atualizado a 2026-09-12 pós-auditoria adversarial.

---

## 🛑 Alta Prioridade (Bloqueadores & Arquitetura)
1. **Verificação DNS do Resend & Inversão no Registo (`public.routes.ts`)**: Publicar os registos DKIM/SPF do domínio `helderlabs.eu` e inverter o fluxo de registo para persistir o `AccountRequest` antes de tentar o envio de email (evitando erro 502 e perda de leads).
2. **Serialização de Auditoria Serverless & Advisory Lock**: Substituir a fila em memória `partitionQueues: Map` por `pg_advisory_xact_lock` em transação SQL e adicionar `@@unique([tenantId, prevHash])` no `schema.prisma`.
3. **Desacoplamento de `ensureSuperAdminUser` das Rotas Pré-Auth**: Mover a criação/verificação de super-admin para bootstrap de arranque para eliminar o pico de 9,8 s no endpoint `/api/auth/check-email`.
4. **Consolidação Definitiva do Módulo Financeiro (D1)**: Eliminada a rota `/api/finance` e o código órfão em `modules/finance/`. O suporte a exportação SAF-T PT e reconciliação bancária automática ficam registados para serem desenhados e construídos de raiz quando o módulo financeiro for reimplementado em `/api/financas`.
5. **Auditoria Explícita em Rotas Pré-Auth (AUD-08)**: O hook global `onResponse` (`app.ts`) regista `action = auth.post` e preenche `actorEmail` via `request.user?.email`. Como em rotas pré-autenticação não existe `request.user`, todos os eventos de login/OTP ficam com `actorEmail = NULL`, impedindo atribuição forense de tentativas de autenticação a contas específicas. A implementar na v1.1.1: auditoria explícita com o email submetido, resultado e IP em categoria SECURITY.

---

## 🟡 Média Prioridade (Funcionalidades & Robustez)
1. **Comissões HCCALL em Três Estados**: Implementar máquina de estados *Estimada → Validada → Paga* e registo de divergência face ao processado pela entidade patronal.
2. **Completude de CRUD no HCCALL**: Adicionar rotas `PUT` e `DELETE` em objetivos comerciais e `DELETE` em dinamizações.
3. **Correção de Fuso Horário em Objetivos HCCALL**: Substituir `getDay()` e `setHours(0,0,0,0)` locais por cálculo baseado no fuso explícito do utilizador (`Europe/Lisbon`).
4. **Endurecimento de CSP e Validação Zod**: Remover `'unsafe-eval'` e migrar scripts inline; exigir passwords de 12+ caracteres com confirmações obrigatórias no servidor.

---

## 🟢 Baixa Prioridade / Otimizações
1. **Otimização de Pacotes de CSS**: Consolidar ficheiros CSS num bundle minificado.
2. **Cache de Entitlements**: Implementar cache em memória para `EntitlementService.resolveForUser` no middleware `requireApp`.
3. **Suporte Adicional de Idiomas**: Preparar infraestrutura de tradução i18n para suporte a Espanhol (ES-ES).
