# Security Framework

## Práticas Implementadas
- **Refresh Token Rotation**: Prevenção de roubo de sessões com expiração automática em caso de reutilização.
- **Middlewares**: Helmet (headers HTTP seguros), CSP restritivo, CORS configurável, Rate Limiting por IP.
- **Sanitização**: Proteção ativa contra XSS e injeção de SQL.
- **Criptografia**: Passwords cifradas com Bcrypt (12 rounds).
