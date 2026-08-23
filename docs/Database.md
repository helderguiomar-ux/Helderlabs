# Documentação de Base de Dados - HELDERLABS ERP

Este documento detalha o modelo relacional de suporte às configurações de email da plataforma.

---

## 📋 Tabelas Adicionadas

### 1. `PlatformEmailConfiguration`
Armazena a parametrização do SMTP central do sistema.
- `id` (String, Primary Key)
- `host` (String)
- `port` (Int)
- `secure` (Boolean)
- `username` (String)
- `encryptedPassword` (String, Cifrada com AES-256)
- `fromName` (String)
- `fromEmail` (String)
- `enabled` (Boolean)

### 2. `SmtpConfiguration`
Armazena a parametrização de cada Tenant.
- `id` (String, Primary Key)
- `tenantId` (String, Unique Foreign Key a `Tenant.id`)
- `host` (String)
- `port` (Int)
- `secure` (Boolean)
- `username` (String)
- `encryptedPassword` (String, Cifrada com AES-256)
- `fromName` (String)
- `fromEmail` (String)
- `enabled` (Boolean)
