# Registos de Dívida Técnica — HELDERLABS ERP

> **Registo Oficial de Dívida Técnica e Decisões Arquiteturais Pendentes**
> Data: 2026-09-07 | Diretoria: `C:\Users\helde\Desktop\Dev\helderlabs-erp`

---

## 1. Dívidas Prioritárias Identificadas

### DT-01: Isolamento Nativo RLS com Papel Não-Owner em PostgreSQL (Erro E5)
- **Descrição**: Atualmente a aplicação liga-se à PostgreSQL com a credencial `DATABASE_URL` do utilizador `postgres` (dono/superuser das tabelas). O PostgreSQL por defeito ignora políticas RLS para o dono da tabela.
- **Mitigação Atual**: Regra ESLint `no-restricted-imports` + Prisma Extension `tenantScopedClient.ts` + teste automático AST e isolamento de tenant em `tests/security/tenantIsolationGuard.test.ts`.
- **Solução Definitiva**:
  1. Criar utilizador de BD `helderlabs_app` sem privilégios `BYPASSRLS` e sem propriedade sobre as tabelas.
  2. Aplicar `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY` em todas as tabelas com `tenant_id`.
  3. Aplicar políticas RLS com `USING` e `WITH CHECK`.
  4. Executar `SET LOCAL app.current_tenant_id = '...'` dentro de cada transação de pedido Fastify.
- **Custo Estimado**: 8 horas de engenharia (1 dia).
- **Impacto**: Transição do módulo `financas` de `beta` para `ativo`.

---

### DT-02: Armazenamento do Token de Sessão em `localStorage` (Erro E7)
- **Descrição**: O token JWT de sessão (`hl_token`) vive em `localStorage`, ficando vulnerável a extração em caso de qualquer falha de Cross-Site Scripting (XSS).
- **Mitigação Atual**: Validação estrita de cabeçalhos Helmet CSP, Sanitização de inputs Zod e imutabilidade de chaves (Ponto 16 do Contrato).
- **Solução Definitiva**:
  1. Migrar a emissão de tokens de autenticação para Cookies HTTP-Only (`Set-Cookie: hl_token=...; HttpOnly; Secure; SameSite=Strict`).
  2. Atualizar o plugin Fastify `@fastify/cookie` e descontinuar a leitura de `localStorage.hl_token` na camada de transporte REST API.
- **Custo Estimado**: 12 horas de engenharia (1.5 dias).
- **Impacto**: Proteção total da sessão contra exfiltração XSS.
