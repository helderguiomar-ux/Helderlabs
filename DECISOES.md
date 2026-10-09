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

## ADR 005 · Descontinuidades Históricas da Cadeia de Auditoria: Documentar, Não Apagar
- **Data**: 2026-09-12
- **Decisão**: As 18 colisões de `prevHash` anteriores à v1.1.0 são consequência da serialização em memória (`partitionQueues`), inoperante em serverless, e estão confirmadas como corridas de escrita por intervalos de 2 a 181 ms. Optou-se por preservá-las e documentá-las na tabela `audit_chain_incidents`, aplicando o índice único como índice parcial apenas a partir do momento da migração (`platform_settings: audit.chain.enforced_since`).
- **Raciocínio**: Re-selar a cadeia faria a evidência desaparecer — que foi o que sucedeu a 2026-09-11 e é o padrão que esta versão existe para eliminar. Uma cadeia de auditoria cuja própria história de falhas é apagada não tem valor probatório.

## ADR 006 · Testes de Segurança Não Podem Depender do Estado do Ambiente
- **Data**: 2026-09-12
- **Decisão**: O teste da backdoor `admin1234` deve testar o mecanismo em isolamento: criar o seu próprio utilizador com password conhecida e verificar que uma tentativa falhada não autentica **e não reescreve o hash guardado**.
- **Raciocínio**: Corrigir o ambiente de desenvolvimento alterando passwords na base de dados para o teste passar esconde o facto de que remover código não altera dados já escritos. Um teste de segurança que pode ficar verde por alteração do ambiente não é um teste de segurança fiável.

## ADR 007 · CRM: Valores Monetários em Cêntimos Inteiros e Salvaguarda Fiscal Inviolável
- **Data**: 2026-10-09
- **Decisão**: Todos os montantes de orçamentos, propostas e contratos de avença são expressos em inteiros (`valueCents`, `monthlyValueCents`). Todos os documentos e minutas impressas A4 ou enviadas por email devem ostentar obrigatoriamente a advertência legal: *"Não serve de fatura nem de documento de quitação fiscal."*
- **Raciocínio**: Evita erros de arredondamento inerentes a números de vírgula flutuante (IEEE 754) e cumpre escrupulosamente a legislação fiscal portuguesa, deixando a emissão de documentos com eficácia tributária para software certificado ou registo de conta corrente exterior.

## ADR 008 · CRM: Controlo de Validades e Dossier Empresarial Resiliente em Serverless
- **Data**: 2026-10-09
- **Decisão**: A gestão de documentos empresariais (`CompanyDocument`) armazena ficheiros como Data URI base64 ou URL externo seguro, associando códigos de acesso online de certidões e motor dinâmico de prazos de caducidade (`computeDocumentStatus`).
- **Raciocínio**: Garante funcionamento 100% autónomo na Vercel Serverless sem requerer credenciais S3/R2 externas de terceiros, preservando integridade e rastreabilidade total no histórico 360º de cada cliente.

## ADR 009 · CRM: Conta Corrente Sem Faturação e Imutabilidade Contabilística Estrita
- **Data**: 2026-10-09
- **Decisão**: A Conta Corrente do CRM (`CrmAccountEntry`, `CrmAccountAllocation`) é estritamente de registo informativo de documentos emitidos em software de faturação certificado. É proibido qualquer `DELETE` ou alteração de dados estruturais na base de dados (garantido por triggers PostgreSQL). Qualquer correção de enganos é efetuada através de contrapartida de estorno (`REVERSAL`), cancelando as respetivas alocações. É expressamente proibida a emissão de faturas ou a inclusão de campos fiscais (ATCUD, hash ou certificado).
- **Raciocínio**: Garante conformidade absoluta com as regras da Autoridade Tributária portuguesa (CIVA Art. 36.º), blindagem contra adulteração de saldos comerciais e integridade temporal irrevogável na relação financeira com cada cliente.


