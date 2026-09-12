-- =============================================================================
-- HELDERLABS ERP — Migração 2026-09-12
-- Resiliência do onboarding + integridade real da cadeia de auditoria
--
-- LEIA ANTES DE APLICAR: esta migração FALHA DE PROPÓSITO, com mensagem
-- explícita, se encontrar dados que não pode corrigir sozinha. Uma migração
-- que "arranja" silenciosamente registos de auditoria é exatamente o problema
-- que esta alteração existe para eliminar. Corra primeiro o pre-flight em
-- prisma/migrations/PREFLIGHT_audit_integrity.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. AccountRequest: estado de entrega do email.
--    O pedido de acesso passa a ser SEMPRE persistido, mesmo quando o envio do
--    email falha. Estes campos dizem ao Super Admin o que precisa de reenvio.
-- -----------------------------------------------------------------------------
ALTER TABLE "account_requests"
  ADD COLUMN IF NOT EXISTS "emailDeliveryStatus" TEXT DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "emailDeliveryError"  TEXT,
  ADD COLUMN IF NOT EXISTS "emailLastAttemptAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "emailAttemptCount"   INTEGER NOT NULL DEFAULT 0;

-- Os pedidos que já existem e foram criados com sucesso tinham,
-- por construção, o email enviado (a rota antiga abortava caso contrário).
UPDATE "account_requests"
   SET "emailDeliveryStatus" = 'SENT'
 WHERE "emailDeliveryStatus" IS NULL OR "emailDeliveryStatus" = 'PENDING';

-- -----------------------------------------------------------------------------
-- 2. Registo imutável do estado da cadeia antes de cada re-selagem.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "audit_chain_reseals" (
  "id"            TEXT NOT NULL,
  "batchId"       TEXT NOT NULL,
  "tenantId"      TEXT,
  "reason"        TEXT NOT NULL,
  "performedBy"   TEXT NOT NULL,
  "performedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "affectedCount" INTEGER NOT NULL,
  "previousState" JSONB NOT NULL,
  "finalHash"     TEXT NOT NULL,
  CONSTRAINT "audit_chain_reseals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "audit_chain_reseals_batchId_key"
  ON "audit_chain_reseals" ("batchId");
CREATE INDEX IF NOT EXISTS "audit_chain_reseals_tenantId_performedAt_idx"
  ON "audit_chain_reseals" ("tenantId", "performedAt");

-- -----------------------------------------------------------------------------
-- 3. Marcação permanente de re-selagem nos registos de auditoria.
-- -----------------------------------------------------------------------------
ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "resealedAt"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "resealedBy"    TEXT,
  ADD COLUMN IF NOT EXISTS "resealBatchId" TEXT;

CREATE INDEX IF NOT EXISTS "audit_logs_resealBatchId_idx"
  ON "audit_logs" ("resealBatchId");
CREATE INDEX IF NOT EXISTS "audit_logs_tenantId_seq_idx"
  ON "audit_logs" ("tenantId", "seq");

-- -----------------------------------------------------------------------------
-- 3b. Reconstituição forense das 34 re-selagens de 2026-09-11T00:53:56Z.
--
--     Essas re-selagens reescreveram hashes sem deixar marca. Não é possível
--     recuperar o estado anterior — foi apagado. O que se pode, e deve, é
--     deixar de o esconder: os registos anteriores a essa data ficam marcados
--     como re-selados, com origem declarada como desconhecida.
-- -----------------------------------------------------------------------------
INSERT INTO "audit_chain_reseals"
  ("id", "batchId", "tenantId", "reason", "performedBy", "performedAt",
   "affectedCount", "previousState", "finalHash")
SELECT
  'reseal_forensic_20260911',
  'forensic-20260911-005356',
  NULL,
  'Reconstituição forense: 34 operações CHAIN_REPAIR executadas em 2026-09-11T00:53:56Z sem registo em DIARIO.md. O estado anterior dos hashes não foi preservado pela implementação da época e não é recuperável. Origem exata da execução não determinável.',
  'desconhecido',
  TIMESTAMP '2026-09-11 00:53:56',
  (SELECT COUNT(*)::int FROM "audit_logs" WHERE "timestamp" <= TIMESTAMP '2026-09-11 00:53:56'),
  '[]'::jsonb,
  'nao-preservado'
WHERE EXISTS (SELECT 1 FROM "audit_logs" WHERE "action" = 'CHAIN_REPAIR')
  AND NOT EXISTS (SELECT 1 FROM "audit_chain_reseals" WHERE "batchId" = 'forensic-20260911-005356');

UPDATE "audit_logs"
   SET "resealedAt"    = TIMESTAMP '2026-09-11 00:53:56',
       "resealedBy"    = 'desconhecido',
       "resealBatchId" = 'forensic-20260911-005356'
 WHERE "timestamp" <= TIMESTAMP '2026-09-11 00:53:56'
   AND "resealBatchId" IS NULL
   AND EXISTS (SELECT 1 FROM "audit_logs" WHERE "action" = 'CHAIN_REPAIR');

-- -----------------------------------------------------------------------------
-- 4. prevHash e hash passam a ser OBRIGATÓRIOS.
--    Um registo de auditoria sem hash não é auditável — e a coluna era nullable.
--    Falha em voz alta se existirem NULLs: a decisão de como os tratar é do
--    responsável do sistema, não desta migração.
-- -----------------------------------------------------------------------------
DO $$
DECLARE null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count
    FROM "audit_logs"
   WHERE "hash" IS NULL OR "prevHash" IS NULL;

  IF null_count > 0 THEN
    RAISE EXCEPTION
      'MIGRAÇÃO INTERROMPIDA: % registo(s) em audit_logs com hash ou prevHash NULL. Não são corrigidos automaticamente — inspecione-os (SELECT id, seq, "tenantId", action, timestamp FROM audit_logs WHERE hash IS NULL OR "prevHash" IS NULL) e decida antes de reaplicar.',
      null_count;
  END IF;
END $$;

ALTER TABLE "audit_logs" ALTER COLUMN "prevHash" SET NOT NULL;
ALTER TABLE "audit_logs" ALTER COLUMN "hash"     SET NOT NULL;

-- -----------------------------------------------------------------------------
-- 5. Descontinuidades históricas: DOCUMENTAR, não apagar.
--
--    O pre-flight encontrou 18 elos duplicados, com intervalos entre 2 ms e
--    181 ms — a assinatura inequívoca de escrita concorrente sem lock, não de
--    adulteração.
--
--    A tentação seria re-selar a cadeia para os fazer desaparecer. É
--    precisamente o que foi feito a 2026-09-11, e é o erro que esta versão
--    existe para eliminar: re-selar apaga a prova de que o defeito existiu.
--    Estes 18 registos SÃO a evidência de que a correção do lock era necessária.
--
--    Ficam onde estão, documentados e classificados. O verificador passa a
--    distinguir "descontinuidade conhecida por corrida de escrita" de
--    "adulteração de payload" — que continua a ser detetada por hash, registo
--    a registo, sem exceção.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "audit_chain_incidents" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT,
  "prevHash"       TEXT NOT NULL,
  "occurrences"    INTEGER NOT NULL,
  "firstSeenAt"    TIMESTAMP(3) NOT NULL,
  "lastSeenAt"     TIMESTAMP(3) NOT NULL,
  "spanMs"         INTEGER NOT NULL,
  "classification" TEXT NOT NULL,
  "notes"          TEXT,
  "documentedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_chain_incidents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "audit_chain_incidents_tenant_prevhash_key"
  ON "audit_chain_incidents" (COALESCE("tenantId",'__global__'), "prevHash");
CREATE INDEX IF NOT EXISTS "audit_chain_incidents_tenantId_classification_idx"
  ON "audit_chain_incidents" ("tenantId", "classification");

INSERT INTO "audit_chain_incidents"
  ("id", "tenantId", "prevHash", "occurrences", "firstSeenAt", "lastSeenAt",
   "spanMs", "classification", "notes")
SELECT
  'inc_' || substr(md5(COALESCE(d."tenantId",'__global__') || d."prevHash"), 1, 24),
  d."tenantId",
  d."prevHash",
  d.ocorrencias,
  d.primeiro,
  d.ultimo,
  GREATEST(0, (EXTRACT(EPOCH FROM (d.ultimo - d.primeiro)) * 1000)::int),
  CASE
    WHEN EXTRACT(EPOCH FROM (d.ultimo - d.primeiro)) <= 5
      THEN 'CONCURRENCY_RACE'
    ELSE 'UNCLASSIFIED'
  END,
  CASE
    WHEN EXTRACT(EPOCH FROM (d.ultimo - d.primeiro)) <= 5
      THEN 'Colisao de escrita concorrente anterior a v1.1.0: a serializacao da cadeia estava numa fila em memoria do processo (partitionQueues), inoperante em ambiente serverless multi-instancia. Corrigido em v1.1.0 com pg_advisory_xact_lock transacional. Registos preservados deliberadamente como evidencia.'
    ELSE 'Intervalo demasiado longo para ser explicado por concorrencia. Requer analise manual.'
  END
FROM (
  SELECT "tenantId",
         "prevHash",
         COUNT(*)::int          AS ocorrencias,
         MIN("timestamp")       AS primeiro,
         MAX("timestamp")       AS ultimo
    FROM "audit_logs"
   GROUP BY "tenantId", "prevHash"
  HAVING COUNT(*) > 1
) d
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6. Unicidade do elo da cadeia — daqui para a frente.
--
--    O indice e PARCIAL, a partir de um limiar calculado no momento da
--    migracao: protege toda a escrita futura sem exigir a reescrita de uma
--    unica linha de historico.
--
--    E sobre COALESCE("tenantId",'__global__') e NAO sobre "tenantId": em
--    PostgreSQL os NULLs sao distintos entre si num indice unico, pelo que um
--    indice sobre ("tenantId","prevHash") nao restringiria NADA na particao
--    global — que e exatamente a que usa tenantId NULL.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  cutoff    TIMESTAMP;
  dup_after INTEGER;
BEGIN
  SELECT COALESCE(MAX("timestamp"), CURRENT_TIMESTAMP) INTO cutoff FROM "audit_logs";
  IF cutoff < CURRENT_TIMESTAMP THEN
    cutoff := CURRENT_TIMESTAMP;
  END IF;
  cutoff := cutoff + INTERVAL '1 second';

  SELECT COUNT(*) INTO dup_after FROM (
    SELECT 1 FROM "audit_logs"
     WHERE "timestamp" >= cutoff
     GROUP BY COALESCE("tenantId",'__global__'), "prevHash"
    HAVING COUNT(*) > 1
  ) x;

  IF dup_after > 0 THEN
    RAISE EXCEPTION
      'MIGRAÇÃO INTERROMPIDA: % elo(s) duplicado(s) já depois do limiar de aplicação (%). Não deveria ser possível — investigue antes de reaplicar.',
      dup_after, cutoff;
  END IF;

  EXECUTE format(
    'CREATE UNIQUE INDEX IF NOT EXISTS "audit_logs_chain_link_unique" ' ||
    'ON "audit_logs" (COALESCE("tenantId", ''__global__''), "prevHash") ' ||
    'WHERE "timestamp" >= %L',
    cutoff
  );

  INSERT INTO "platform_settings" ("id", "key", "value", "category")
  VALUES ('setting_audit_chain_enforced_since',
          'audit.chain.enforced_since',
          to_char(cutoff AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'Audit')
  ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value";

  RAISE NOTICE 'Unicidade do elo da cadeia aplicada a partir de %', cutoff;
END $$;
