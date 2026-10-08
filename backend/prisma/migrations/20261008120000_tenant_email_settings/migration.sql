-- v1.6.0 — Configuração de envio de email por tenant + registo de envios.
-- Migração apenas aditiva (CREATE TYPE / CREATE TABLE / CREATE INDEX):
-- retrocompatível com o código anterior, segura para Instant Rollback.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "EmailProvider" AS ENUM ('PLATFORM', 'SMTP');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "tenant_email_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "EmailProvider" NOT NULL DEFAULT 'PLATFORM',
    "preset" TEXT,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT true,
    "smtpUser" TEXT,
    "smtpPasswordEnc" TEXT,
    "fromName" TEXT,
    "fromEmail" TEXT,
    "replyTo" TEXT,
    "dailyLimit" INTEGER NOT NULL DEFAULT 300,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_email_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "email_send_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "fromEmail" TEXT,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "messageId" TEXT,
    "error" TEXT,
    "context" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "sentByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_send_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_email_settings_tenantId_key" ON "tenant_email_settings"("tenantId");
CREATE INDEX IF NOT EXISTS "email_send_logs_tenantId_createdAt_idx" ON "email_send_logs"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "email_send_logs_tenantId_status_idx" ON "email_send_logs"("tenantId", "status");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "tenant_email_settings" ADD CONSTRAINT "tenant_email_settings_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "email_send_logs" ADD CONSTRAINT "email_send_logs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Row Level Security (mesmo padrão das tabelas HCCALL)
ALTER TABLE "tenant_email_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_send_logs" ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation_policy ON "tenant_email_settings";
  CREATE POLICY tenant_isolation_policy ON "tenant_email_settings"
    USING (
      current_setting('app.current_tenant', true) IS NULL OR
      current_setting('app.current_tenant', true) = '' OR
      "tenantId" = current_setting('app.current_tenant', true)
    )
    WITH CHECK (
      current_setting('app.current_tenant', true) IS NULL OR
      current_setting('app.current_tenant', true) = '' OR
      "tenantId" = current_setting('app.current_tenant', true)
    );

  DROP POLICY IF EXISTS tenant_isolation_policy ON "email_send_logs";
  CREATE POLICY tenant_isolation_policy ON "email_send_logs"
    USING (
      current_setting('app.current_tenant', true) IS NULL OR
      current_setting('app.current_tenant', true) = '' OR
      "tenantId" = current_setting('app.current_tenant', true)
    )
    WITH CHECK (
      current_setting('app.current_tenant', true) IS NULL OR
      current_setting('app.current_tenant', true) = '' OR
      "tenantId" = current_setting('app.current_tenant', true)
    );
END $$;
