# REGISTO DE DECISÕES DE ARQUITETURA (ADR) — HELDERLABS ERP

> Este ficheiro documenta decisões técnicas estruturantes para garantir consistência entre equipa e agentes IA.

---

## ADR 001 · Multi-Tenancy com `tenantScopedClient.ts`
- **Data**: 2026-08-15
- **Decisão**: Proibir importações diretas de `PrismaClient` cru fora do `tenantScopedClient.ts`.
- **Raciocínio**: Garantir que todas as consultas contêm filtro automático por `tenantId` a nível de middleware/ORM, eliminando o risco de data leaks inter-tenant.

## ADR 002 · Transição de `db push` para `prisma migrate deploy`
- **Data**: 2026-09-07
- **Decisão**: Substituição do comando de build na Vercel por `node scripts/deploy-build.mjs`, que executa `prisma migrate deploy`.
- **Raciocínio**: Prevenir perda acidental de dados em produção derivada do uso de `--accept-data-loss`.

## ADR 003 · Persistência Única de Sessão (`erp_session`)
- **Data**: 2026-09-08
- **Decisão**: Padronizar a chave de sessão do utilizador como `erp_session` contendo JSON `{ token, user }` no `localStorage`, mantendo leituras resilientes por fallback (`hl_token`, `auth_token`).
- **Raciocínio**: Prevenirloops de redirecionamento entre a landing page, login e app SPA unificada.

## ADR 004 · Governança de Agentes IA (`AGENTS.md`)
- **Data**: 2026-09-08
- **Decisão**: Adotar a especificação `AGENTS.md` na raiz como fonte canónica de contexto global para Antigravity, Claude e ChatGPT.
- **Raciocínio**: Assegurar memória persistente e padronização de commits, tarefas e documentação do projeto.
