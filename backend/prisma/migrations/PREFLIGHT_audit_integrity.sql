-- Pre-flight — CORRER ANTES da migração 20260912120000.
-- Apenas leituras. Diz se a migração vai passar ou onde vai parar.

\echo '--- 1. Registos de auditoria sem hash (bloqueiam o passo 4) ---'
SELECT COUNT(*) AS registos_sem_hash
  FROM audit_logs WHERE hash IS NULL OR "prevHash" IS NULL;

\echo '--- 2. Elos duplicados (DOCUMENTADOS na v1.1.0 — ja nao bloqueiam) ---'
\echo '    Sao preservados como evidencia da corrida de escrita; o indice unico'
\echo '    passa a ser aplicado apenas a partir do momento da migracao.'
SELECT COALESCE("tenantId",'__global__') AS particao,
       "prevHash",
       COUNT(*) AS ocorrencias,
       MIN("timestamp") AS primeiro,
       MAX("timestamp") AS ultimo
  FROM audit_logs
 GROUP BY 1, 2
HAVING COUNT(*) > 1
 ORDER BY ocorrencias DESC
 LIMIT 50;

\echo '--- 3. Corrida vs adulteração: duplicados quase simultâneos indicam corrida ---'
SELECT COALESCE("tenantId",'__global__') AS particao,
       "prevHash",
       MAX("timestamp") - MIN("timestamp") AS intervalo
  FROM audit_logs
 GROUP BY 1, 2
HAVING COUNT(*) > 1
 ORDER BY intervalo ASC
 LIMIT 20;

\echo '--- 4. Histórico de re-selagens já registadas ---'
SELECT id, seq, "actorEmail", timestamp, description
  FROM audit_logs WHERE action = 'CHAIN_REPAIR' ORDER BY timestamp DESC;

\echo '--- 5. Volume por particao ---'
SELECT COALESCE("tenantId",'__global__') AS particao, COUNT(*) AS registos
  FROM audit_logs GROUP BY 1 ORDER BY 2 DESC;

\echo '--- 6. POS-MIGRACAO: incidentes documentados e limiar de aplicacao ---'
SELECT COALESCE("tenantId",'__global__') AS particao, classification, COUNT(*) AS incidentes
  FROM audit_chain_incidents GROUP BY 1, 2 ORDER BY 1;
SELECT key, value FROM platform_settings WHERE key = 'audit.chain.enforced_since';
SELECT indexname FROM pg_indexes
 WHERE tablename = 'audit_logs' AND indexname = 'audit_logs_chain_link_unique';
