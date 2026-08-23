# Arquitetura de Referência - HELDERLABS ERP

Este documento apresenta a arquitetura da fundação empresarial do HELDERLABS ERP.

---

## 🏗️ Camadas do Sistema

1. **Frontend Landing (Vanilla HTML/CSS/JS)**:
   - Apresentação institucional de alto impacto focada em CEOs, CFOs e gestores.
   - Painéis dinâmicos de administração acoplados via SSE (Server-Sent Events) para monitorização e parametrizações avançadas.

2. **Backend Express API (TypeScript)**:
   - **Controllers**: Validação de parâmetros, regras de autenticação e delegação a serviços.
   - **Middlewares**: Gestão de RequestID, CORS de segurança, Security Headers e multi-tenancy dinâmico.
   - **Kernel**: Módulos centrais como `EmailDispatcher`, `EventBus` e `CryptoUtils`.

3. **Database (Prisma ORM & PostgreSQL)**:
   - Esquemas relacionais isolados por `TenantID` garantindo a segurança de dados corporativos.
