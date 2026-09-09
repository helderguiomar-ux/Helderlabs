/**
 * HELDERLABS ERP — Catálogo Canónico e Registo Único de Módulos
 * Fonte da Verdade para módulos ativos, permissões e licenciamento.
 */

export interface SystemModuleDefinition {
  key: string;
  name: string;
  description: string;
  version: string;
  color: string;
  icon: string;
  status: 'ACTIVE' | 'DORMANT' | 'BETA';
  aliases?: string[];
  routePrefix: string;
  appUrl: string;
}

export const SYSTEM_MODULES: Record<string, SystemModuleDefinition> = {
  crm: {
    key: 'crm',
    name: 'CRM & Gestão 360º',
    description: 'Gestão integrada de clientes, fornecedores, parceiros e contratos.',
    version: '2.0.0',
    color: '#2563eb',
    icon: 'users',
    status: 'ACTIVE',
    routePrefix: '/api/crm',
    appUrl: '/app.html#/crm'
  },
  finance: {
    key: 'finance',
    name: 'Gestão Financeira',
    description: 'Cockpit financeiro, tesouraria, projeções a 90 dias e controlo orçamental.',
    version: '2.0.0',
    color: '#059669',
    icon: 'dollar-sign',
    status: 'ACTIVE',
    aliases: ['financas'],
    routePrefix: '/api/financas',
    appUrl: '/app.html#/financas'
  },
  hccall: {
    key: 'hccall',
    name: 'HCCALL · Call Center Telecom & Energia',
    description: 'Registo de vendas, tracking de comissões, motor offline PWA e histórico de alterações.',
    version: '2.1.0',
    color: '#d97706',
    icon: 'phone-call',
    status: 'ACTIVE',
    routePrefix: '/api/hccall',
    appUrl: '/hccall.html'
  },
  sellmais: {
    key: 'sellmais',
    name: 'SellMais · Inventário & Força de Vendas',
    description: 'Gestão comercial, inventário de peças e artigos com margens e ficha técnica.',
    version: '1.0.0',
    color: '#7c3aed',
    icon: 'shopping-bag',
    status: 'ACTIVE',
    routePrefix: '/api/sellmais',
    appUrl: '/app.html#/sellmais'
  },
  condominios: {
    key: 'condominios',
    name: 'Gestão de Condomínios',
    description: 'Administração de fracções, condomínios, balancetes e rateios.',
    version: '1.0.0',
    color: '#0891b2',
    icon: 'building',
    status: 'DORMANT',
    aliases: ['condo'],
    routePrefix: '/api/condominios',
    appUrl: '/app.html#/condominios'
  }
};

/**
 * Normaliza qualquer chave ou alias de módulo para a chave canónica correspondente.
 */
export function resolveCanonicalModuleKey(key: string): string {
  const normalized = (key || '').toLowerCase().trim();
  if (SYSTEM_MODULES[normalized]) return normalized;

  for (const [canonicalKey, mod] of Object.entries(SYSTEM_MODULES)) {
    if (mod.aliases && mod.aliases.includes(normalized)) {
      return canonicalKey;
    }
  }

  return normalized;
}

/**
 * Verifica se um módulo pertence ao catálogo registado.
 */
export function isModuleRegistered(key: string): boolean {
  const canonical = resolveCanonicalModuleKey(key);
  return Boolean(SYSTEM_MODULES[canonical]);
}

/**
 * Retorna todos os módulos registados.
 */
export function getAllRegisteredModules(): SystemModuleDefinition[] {
  return Object.values(SYSTEM_MODULES);
}
