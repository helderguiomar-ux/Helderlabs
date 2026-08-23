# HELDERLABS ERP - Enterprise Foundation (v0.1.0)

Este é o **Kernel e Fundação Empresarial** oficial do HELDERLABS ERP.
Construído sobre princípios de Clean Architecture, segurança robusta de nível empresarial e total isolamento multiempresa (multi-tenant).

## Estrutura do Projeto

- `/frontend`: Aplicação SPA estática leve e de alto desempenho utilizando HTML5, CSS3, e Vanilla JavaScript (ES2023).
- `/backend`: Servidor API empresarial com Node.js, Express, TypeScript, e Prisma ORM.

## Requisitos
- **Node.js** v18+
- **Docker** e **Docker Compose**
- **PostgreSQL** 15+ (incluso no compose)
- **Redis** 7+ (incluso no compose)

## Instalação Rápida
Execute o ficheiro automatizado de instalação:
```bash
./setup.bat
```

Consulte `/docs/Architecture.md` para documentação detalhada da infraestrutura.
