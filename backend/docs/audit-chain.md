# Especificação Técnica — Cadeia Criptográfica de Auditoria SHA-256

## 1. Princípios e Garantias
1. **Imutabilidade e Integridade**: Cada registo de auditoria está encadeado criptograficamente ao registo anterior através de um hash SHA-256 (`prevHash`).
2. **Determinismo Absoluto**: O digest de cada registo é gerado por uma função de serialização canónica pura (`CanonicalJson.stringify`), garantindo que objetos JSON com chaves em ordens distintas produzam rigorosamente o mesmo digest e o mesmo hash.
3. **Isolamento de Partição por Tenant**: Cada tenant possui uma cadeia independente iniciada pelo bloco génese do tenant. A plataforma global possui a sua própria cadeia para ações de sistema (`tenantId: null` ou `tenantId: 'platform'`).

---

## 2. Convenção do Génese
- O primeiro registo de uma cadeia (quando não existe registo anterior para o tenant) utiliza obrigatoriamente como `prevHash`:
  ```text
  0000000000000000000000000000000000000000000000000000000000000000 (64 zeros em hexadecimal)
  ```
- O verificador valida que o primeiro registo tem exatamente este `prevHash`. Registos subsequentes devem ter `log.prevHash === previousLog.hash`.

---

## 3. Algoritmo de Serialização Canónica (`CanonicalJson`)
Para resolver a não-determinação introduzida pelo armazenamento em colunas `jsonb` do PostgreSQL (que reordenam chaves internamente):
1. **Ordenação Recursiva de Chaves**: Todas as chaves de objetos são ordenadas lexicograficamente em ordem ascendente de bytes UTF-8 (`keys.sort()`).
2. **Tratamento de Arrays**: A ordem dos elementos em arrays é preservada, com serialização canónica recursiva de cada elemento.
3. **Datas**: Representadas estritamente em string UTC ISO-8601 (`YYYY-MM-DDTHH:mm:ss.sssZ`).
4. **Valores Monetários**: Representados como inteiros em cêntimos (`*Cents`), sem números em vírgula flutuante.
5. **Tipos Primitivos**: `null`, `boolean`, `number`, `string` sem espaços em branco redundantes.

---

## 4. Estrutura do Digest Canónico
O digest antes do cálculo SHA-256 é composto pelos seguintes 10 campos delimitados pelo caractere `|`:

```text
[actorId]|[onBehalfOfId]|[tenantId]|[action]|[resource]|[resourceId]|[canonicalOldValue]|[canonicalNewValue]|[timestampIsoUtc]|[prevHash]
```

### Regras de Formatação dos Campos:
- `actorId`: ID do utilizador autor ou `""` (string vazia).
- `onBehalfOfId`: ID de personificação de suporte ou `""`.
- `tenantId`: ID do tenant ou `""`.
- `action`: Código da ação (ex.: `sale.create`, `tenant.update`). Obrigatório.
- `resource`: Nome do recurso (ex.: `HccallSale`, `Tenant`).
- `resourceId`: Identificador único do recurso.
- `canonicalOldValue`: `CanonicalJson.stringify(oldValue)` ou `"null"`.
- `canonicalNewValue`: `CanonicalJson.stringify(newValue)` ou `"null"`.
- `timestampIsoUtc`: Timestamp exato em formato ISO-8601 UTC.
- `prevHash`: Hash SHA-256 do registo anterior ou os 64 zeros no génese.

---

## 5. Evento de Reparação Explícito (`CHAIN_REPAIR`)
Se a cadeia de um tenant necessitar de re-selagem (devido a migração de formato legado ou auditoria histórica):
- **É proibido reescrever a história silenciosamente.**
- Deve ser gravado um evento especial `action: 'CHAIN_REPAIR'`, contendo:
  - `oldValue`: Lista de hashes antigos antes da reparação.
  - `newValue`: Novos hashes calculados canonicamente e data da intervenção.
  - `description`: Motivo explícito e utilizador SUPER_ADMIN responsável pela execução.

---

## 6. Verificador Independente
O comando `npm run audit:verify` executa a validação de todas as cadeias por tenant e reporta:
- `valid: true | false`
- `totalLogs`: Número total de registos auditados.
- `invalidAtId`: ID do registo corrompido (se houver).
- `reason`: Descrição do erro (adulteração de `prevHash` ou adulteração de `payload`).
