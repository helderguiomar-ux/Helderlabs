-- =========================================================================
-- HELDERLABS ERP — SQL de Sanitização & Anonimização para Dumps Locais
-- Executado imediatamente após o restauro de um dump de produção em local
-- =========================================================================

BEGIN;

-- 1. Sanitizar Utilizadores (preservar apenas o Super Admin helderguiomar@gmail.com)
UPDATE "users"
SET 
  "name" = 'Utilizador Anonimizado ' || "id",
  "email" = 'user_' || "id" || '@exemplo.local',
  "passwordHash" = '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW' -- Hash de 'admin1234'
WHERE "email" != 'helderguiomar@gmail.com';

-- 2. Sanitizar Leads
UPDATE "leads"
SET 
  "name" = 'Contacto Lead ' || "id",
  "email" = 'lead_' || "id" || '@exemplo.local',
  "phone" = '+351 900 000 ' || LPAD(CAST("id" % 1000 AS text), 3, '0');

-- 3. Sanitizar Clientes & Contactos
UPDATE "customers"
SET 
  "companyName" = 'Empresa Anonimizada ' || "id",
  "email" = 'cliente_' || "id" || '@exemplo.local',
  "phone" = '+351 210 000 ' || LPAD(CAST("id" % 1000 AS text), 3, '0'),
  "taxNumber" = '999999990';

UPDATE "contacts"
SET 
  "name" = 'Contacto ' || "id",
  "email" = 'contacto_' || "id" || '@exemplo.local',
  "phone" = '+351 910 000 ' || LPAD(CAST("id" % 1000 AS text), 3, '0');

-- 4. Sanitizar Proprietários de Condomínios
UPDATE "owners"
SET 
  "name" = 'Proprietário ' || "id",
  "email" = 'proprietario_' || "id" || '@exemplo.local',
  "phone" = '+351 920 000 ' || LPAD(CAST("id" % 1000 AS text), 3, '0'),
  "taxNumber" = '999999990';

-- 5. Sanitizar Pedidos de Registo
UPDATE "account_requests"
SET 
  "name" = 'Requerente ' || "id",
  "email" = 'req_' || "id" || '@exemplo.local';

COMMIT;
