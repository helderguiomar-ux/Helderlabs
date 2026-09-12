/**
 * Versão da aplicação — FONTE ÚNICA.
 *
 * A versão estava espalhada por quatro sítios que já divergiam entre si:
 * ESTADO.md dizia v0.5.0, ambos os package.json diziam 1.0.0, /api/health
 * usava o literal '1.0.0' e VersionController devolvia schemaVersion '1.0.0'
 * fixo no código. Passa a existir aqui, e os package.json acompanham.
 */
export const APP_VERSION = '1.4.0';

/**
 * Versão mínima de cliente aceite pela API.
 *
 * O cliente local é distribuído e atualizado separadamente do backend, pelo que
 * pode ficar para trás. Quando uma alteração de API quebrar clientes antigos,
 * sobe-se este valor: os clientes abaixo dele passam a receber 426 com uma
 * mensagem clara em vez de falharem de forma incompreensível.
 *
 * Só se sobe quando existe uma incompatibilidade REAL. Subir por rotina
 * transforma isto num incómodo e ensina os utilizadores a ignorá-lo.
 */
export const MINIMUM_CLIENT_VERSION = '1.2.0';
// MANTIDO EM 1.2.0 DE PROPÓSITO na v1.4.0.
//
// O cliente desktop é distribuído por `git pull`, não por deploy. Um cliente
// que ainda esteja na 1.2.0 continua a funcionar: as alterações desta versão
// são ADITIVAS — dois endpoints novos de plataforma, nenhuma alteração de
// contrato. A API antiga e a nova aceitam os mesmos pedidos.
//
// Subir este valor trancaria à porta o cliente que o Hélder tem a correr
// neste momento. Só sobe quando existir uma incompatibilidade real.

/** Compara versões semânticas. -1 se a < b, 0 se iguais, 1 se a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}
