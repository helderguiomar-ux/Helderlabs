# Contrato de Não-Regressão Funcional — HELDERLABS ERP

> **Regras de Não-Regressão Funcional (Regra 2 — 16 Pontos de Validação)**
> Data: 2026-09-07 | Diretoria: `C:\Users\helde\Desktop\Dev\helderlabs-erp`

---

## 1. Testes de Contrato Público (Landing Page & Login)

1. **Alternância de Idioma PT/EN**: O botão `#lang-btn` alterna entre Português e Inglês com persistência em `localStorage.hl_lang` e atualização em tempo real de `html[lang]`, `#meta-title` e `#meta-description`.
2. **Alternância de Tema (Escuro / Claro / Sistema)**: O botão `#theme-btn` alterna entre `dark`, `light` e `system`, atualizando `html[data-theme]` e respeitando `prefers-color-scheme`.
3. **Âncoras de Navegação**: Todas as ligações do menu rolam suavemente até à secção alvo sem ficarem tapadas pelo cabeçalho fixo `.header-glass`.
4. **Estado do Botão de Acesso à Área de Cliente**: Redireciona diretamente para `/workspace.html` quando `hl_token` está presente, ou abre o modal de autenticação caso contrário.
5. **Validação do Formulário de Leads**: Exige Nome, Empresa, Email, Setor, Mensagem e Aceitação RGPD antes de submeter via `POST /api/public/leads`.
6. **Dev Banner Condicional**: Exibido apenas em ambientes locais (`localhost` / `127.0.0.1`).

---

## 2. Testes de Contrato de Autenticação

7. **Modal de Login & Fecho**: Abre via "Área de Cliente" e fecha com a tecla `Esc`, botão `X` ou clique no fundo escuro.
8. **Botões OAuth 2.0 Social**: Preservam os URLs de redirecionamento para Google, Microsoft e Apple.
9. **Fluxo OTP Passwordless**: Envio e verificação de códigos OTP por email funcionam em 2 passos sem perdas de sessão.

---

## 3. Testes de Contrato da Aplicação ERP

10. **Preservação de Dados de Módulos**: Módulos ativos e beta (`financas`, `crm`, `audit`, `super_admin`) mantêm a totalidade dos dados e endpoints de API.
11. **Ecrã de Engenharia Honesto**: Módulos `em_construcao` e `planeado` exibem o ecrã informativo transparente sem botões mortos ou dados estáticos falsos.
12. **Cálculo de Cêntimos Inteiros (Finanças PT v2)**: Todos os montantes são transacionados em cêntimos inteiros para evitar erros de arredondamento de vírgula flutuante.
13. **Alertas de Orçamento por Escalão**: Disparo automático de alertas aos 80%, 90% e 100%+ do limite orçamental.
14. **Exportação de Dados (CSV)**: Exportação limpa de movimentos com codificação UTF-8 e formato compatível com Excel/Sheets.
15. **Encadeamento de Auditoria SHA-256**: Validação matemática contínua da integridade de registos de auditoria em `AuditService`.
16. **Imutabilidade das Chaves de LocalStorage (`hl_token`, `hl_lang`, `hl_theme`, `hl_tenant_id`)**: É estritamente proibido renomear, remover ou alterar o formato das chaves no browser. Qualquer alteração a `hl_token` destrói as sessões ativas de todos os utilizadores simultaneamente; alterações em `hl_lang` ou `hl_theme` causam a perda de preferências dos clientes.
