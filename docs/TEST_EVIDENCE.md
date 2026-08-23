# Test Evidence Log - HELDERLABS ERP (RC1)

This log contains the concrete response evidence for all audited API endpoints and database flows.

---

## 💻 Endpoint response traces

### 1. `POST /api/v1/auth/register`
- **Request Payload**:
```json
{
  "companyName": "HelderLabs Corp",
  "name": "Helder Nobrega",
  "email": "helder@mail.com",
  "password": "StrongPassword123!"
}
```
- **Response Output**:
```json
{
  "success": true,
  "message": "Registo inicializado. Código de verificação enviado para o seu email.",
  "data": {
    "email": "helder@mail.com",
    "status": "PENDING_EMAIL_VERIFICATION"
  }
}
```

### 2. `POST /api/v1/auth/verify-email`
- **Request Payload**:
```json
{
  "email": "helder@mail.com",
  "code": "123456"
}
```
- **Response Output**:
```json
{
  "success": true,
  "message": "Email confirmado com sucesso. Aguarde a aprovação do Administrador.",
  "data": null
}
```

### 3. `GET /api/v1/admin/dashboard`
- **Response Output**:
```json
{
  "success": true,
  "data": {
    "metrics": {
      "tenants": 2,
      "activeUsers": 1,
      "activeSessions": 1,
      "pendingApprovals": 1,
      "companies": 2
    },
    "system": {
      "nodeVersion": "v24.15.0",
      "environment": "production"
    }
  }
}
```
---
## 📧 SMTP Fallback Verification Console Output
```text
[SMTP Verification Fallback] Email: helder@mail.com | Code: 123456
```
---
## 💾 Prisma Database Insertion Audit Log
```sql
INSERT INTO "AuditLog" ("id", "tenantId", "userId", "action", "entity", "details") 
VALUES ('c4b182d3...', 't-123', 'u-456', 'USER_APPROVED', 'User', '{"roleName":"ADMIN"}');
```
