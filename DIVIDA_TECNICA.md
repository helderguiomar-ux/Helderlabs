# DÍVIDA TÉCNICA & MELHORIAS FUTURAS — HELDERLABS ERP

> Registo de itens técnicos pendentes, otimizações e refactorings planeados.

---

## 🛑 Alta Prioridade
1. **Refatoração do Module Manifest do Frontend**: Alinhar na totalidade a importação de `modules.js` em todos os ecrãs HTML para garantir que o render de módulos não licenciados seja consistente.
2. **Cobertura E2E de Amortização**: Adicionar cenários de teste automatizado Playwright para simular fluxos completos de empréstimos e pagamentos parcelados no módulo de Finanças.

---

## 🟡 Média Prioridade
1. **Otimização de Pacotes de CSS**: Consolidar `tokens.css`, `typography.css`, `components.css` num único bundle minificado para o ambiente de produção na Vercel.
2. **Rate Limit granular por IP/Tenant**: Refinar limites de pedido no Fastify para separar endpoints públicos de autenticação dos endpoints internos de relatórios.

---

## 🟢 Baixa Prioridade / Otimizações
1. **Suporte Adicional de Idiomas**: Preparar infraestrutura de tradução i18n para suporte a Espanhol (ES-ES).
