/**
 * Versão da aplicação — FONTE ÚNICA.
 *
 * A versão estava espalhada por quatro sítios que já divergiam entre si:
 * ESTADO.md dizia v0.5.0, ambos os package.json diziam 1.0.0, /api/health
 * usava o literal '1.0.0' e VersionController devolvia schemaVersion '1.0.0'
 * fixo no código. Passa a existir aqui, e os package.json acompanham.
 */
export const APP_VERSION = '1.1.1';
