# DEFINIÇÕES CANÓNICAS — HCCALL TELECOM (`hccall`)

> **Módulo:** HCCALL Telecom · **Chave técnica:** `hccall`
> **Versão:** v0.5.0 · **Fonte Única de Verdade Matemática & Operacional**

---

## 1. HIERARQUIA & PAPÉIS

- **Papel Funcional no Módulo:** `hccall.user` (único; sem papéis de supervisor, gestor ou administrador dentro da ferramenta).
- **Âmbito de Visibilidade:**
  - `hccall.visibility = OWN` (por omissão): filtra `ownerUserId = request.user.sub`.
  - `hccall.visibility = TEAM`: permite visualização de todas as vendas do tenant.
- **Isolamento:** Strict multi-tenant via `request.user.tenantId` e `tenantScopedClient.ts`.

---

## 2. REGRAS DE NEGÓCIO CANÓNICAS

### 2.1 A Regra de Ouro da Comissão
1. `HccallPromotion.suggestedCommissionCents`: É **exclusivamente um valor sugerido** no momento da seleção da dinamização.
2. `HccallSale.commissionCents`: É o **valor efetivo** gravado na venda (cêntimos inteiros).
3. `HccallSale.promotionSnapshot`: Objeto JSON imutável que guarda o estado completo da regra da promoção à data da venda (`{ id, name, suggestedCommissionCents, promoValueCents, serviceId, version, startsAt, endsAt, capturedAt }`).
4. **Imutabilidade Histórica:** A alteração de uma dinamização (ex: de 35 € para 50 €) incrementa `version` na tabela de dinamizações e **não altera** nenhuma venda registada no passado.
5. **Mutação Explícita:** Qualquer edição manual à comissão ou estado da venda gera um registo em `HccallSaleChange` com os valores anterior e novo, autor, motivo e carimbo de data/hora.

### 2.2 Estados de Venda & Estados de Comissão
Os estados são configuráveis pelo utilizador na tabela `HccallSaleStatus`.
Cada estado possui um `commissionState` padronizado que alimenta os relatórios:
- `FORECAST`: Venda registada / pendente / em validação. Comissão prevista.
- `CONFIRMED`: Venda ativada / validada / comissionada. Comissão confirmada para recebimento.
- `PAID`: Comissão liquidada e paga ao operador.
- `VOID`: Venda cancelada ou rejeitada. Comissão anulada.

### 2.3 Offline-First & Idempotência
- **Escrita Local:** Geração de `clientUuid` (UUID v4) no telemóvel e armazenamento no IndexedDB (`hccall_local_db`).
- **Sincronização:** `POST /api/hccall/sync` protegido pela restrição única `@@unique([tenantId, clientUuid])`. O reenvio do mesmo lote não duplica vendas.
- **Resolução de Conflitos:** Se o registo no servidor for mais recente que o registo offline, o servidor prevalece e o cliente recebe estado `conflict`.
- **Sobrevivência da Fila a 401:** Se o token JWT (8h) expirar durante o período offline, a fila local permanece intacta no IndexedDB e solicita re-autenticação antes de disparar a sincronização.

### 2.4 RGPD & Minimização
- `hccall.customerRef.mode`: `FULL` (grava o número de cliente) ou `HASHED` (grava um derivado irreversível para agregação estatística).
- Anonimização direcionada por ID de cliente com mascaramento irreversível e registo em `AuditLog`.
