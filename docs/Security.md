# Security Framework — HELDERLABS ERP

Este documento detalha o modelo e as práticas de segurança implementados na plataforma **HELDERLABS ERP (v0.2.0)**.

---

## 🛡️ 1. Proteção de Autenticação & OTP

- **Cifragem de OTP com Bcrypt**: Os códigos OTP de 6 dígitos gerados para autenticação são cifrados com `bcrypt` antes de serem armazenados na base de dados (`OtpCode.codeHash`). O código em plain-text nunca é guardado em disco ou base de dados.
- **Expiração & Controlo de Tentativas**:
  - Validade estrita de **15 minutos** (`expiresAt`).
  - Limite máximo de **5 tentativas falhadas** (`attempts <= 5`), bloqueando automaticamente o código após 5 erros.
  - Códigos expirados ou invalidados são automaticamente limpos da BD.
- **Ambiente de Desenvolvimento Controlado**: O código mestre dev (`123456`) é estritamente restrito a ambientes não-produção via flag explícita `ALLOW_DEV_MASTER_OTP=true` e `NODE_ENV !== 'production'`.
- **Eliminação do Demo Login**: Endpoints inseguros de teste como `/demo-login` e `/demo-status` foram permanentemente removidos.

---

## 🔒 2. Cabeçalhos de Segurança & Proteção de Rede

- **`@fastify/helmet` (v11)**:
  - **Content Security Policy (CSP)** restritiva.
  - **HTTP Strict Transport Security (HSTS)** forçado em ambientes de produção.
  - **X-Frame-Options: DENY** prevenindo ataques de Clickjacking.
  - **X-Content-Type-Options: nosniff** prevenindo sniffing de MIME types.
- **`@fastify/rate-limit` (v8)**:
  - Limitação de pedidos por IP (máximo de 100 pedidos por minuto globalmente, com limites mais estritos em endpoints de autenticação como `/send-otp` e `/verify-otp`).
- **Sanitização de Input**: Validações estritas de schema via **Zod** em todos os endpoints de escrita, prevenindo injeção de SQL ou payloads maliciosos.

---

## 🔑 3. Gestão de Sessões & Entitlements

- **JWT Tokens (JSON Web Tokens)**:
  - Assinados com `JWT_SECRET` com validade padrão de **8 horas**.
  - Payload contém `userId`, `email`, `role`, `tenantId` e `companyId`.
- **Integridade de Entitlements (HMAC-SHA256)**:
  - O manifesto do utilizador (`GET /api/me/workspace`) inclui um campo `signature` gerado por `HMAC-SHA256(userId + tenantId + JSON.stringify(entitlements), SECRET)`.
  - Impede a alteração local de permissões ou módulos no browser do utilizador.
- **Impersonation Auditada (Sessões de Suporte)**:
  - Iniciadas exclusivamente por utilizadores `SUPER_ADMIN`.
  - Tokens de impersonation contêm o claim `isImpersonating: true`.
  - **Read-Only Enforcement**: O plugin de autenticação interseta todas as mutações (`POST`, `PUT`, `DELETE`) de uma sessão de impersonation e rejeita com `403 IMPERSONATION_READ_ONLY`.
  - Todas as ações de impersonation geram eventos dedicados no `AuditLog`.

---

## 📜 4. Audit Trail Tamper-Evident (SHA-256 Hash Chain)

- **Audit Logging por Tenant**:
  - Todos os eventos críticos (alterações de conta, logins, mutações em dados, acessos de suporte) são registados no modelo `AuditLog`.
- **Cadeia de Hash Criptográfica**:
  - Cada entrada calcula:
    `hash = SHA256(tenantId + sequenceNum + previousHash + action + payload)`
  - O campo `previousHash` encadeia cada registo ao registo anterior do mesmo tenant.
- **Verificação de Integridade**:
  - O método `AuditService.verifyAuditChain(tenantId)` recalcula a cadeia desde o bloco génese. Qualquer alteração, eliminação ou inserção direta na BD é detetada instantaneamente.
