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
  financas: {
    key: 'financas',
    name: 'Gestão Financeira',
    description: 'Cockpit financeiro, tesouraria, projeções a 90 dias e controlo orçamental.',
    version: '2.0.0',
    color: '#059669',
    icon: 'dollar-sign',
    status: 'ACTIVE',
    aliases: ['finance'],
    routePrefix: '/api/financas',
    appUrl: '/app.html#/financas'
  },
  hccall: {
    key: 'hccall',
    name: 'HCCALL · Performance Comercial',
    description: 'Sistema pessoal de controlo e otimização de performance comercial: registo rápido de vendas e dinamizações, objetivos, ritmo de atingimento, simulador e comissões. Independente do setor e do local de trabalho.',
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
  sales: {
    key: 'sales',
    name: 'Sales & Gestão Comercial',
    description: 'Gestão de propostas, pipelines de vendas, metas comerciais e fecho de negócios.',
    version: '1.0.0',
    color: '#0284c7',
    icon: 'trending-up',
    status: 'ACTIVE',
    routePrefix: '/api/sales',
    appUrl: '/app.html#/sales'
  },
  tasks: {
    key: 'tasks',
    name: 'Tasks & Gestão de Tarefas',
    description: 'Organização de tarefas, projetos colaborativos, prazos e fluxo operacional.',
    version: '1.0.0',
    color: '#6366f1',
    icon: 'check-square',
    status: 'ACTIVE',
    routePrefix: '/api/tasks',
    appUrl: '/app.html#/tasks'
  },
  invoicing: {
    key: 'invoicing',
    name: 'Invoicing & Faturação',
    description: 'Emissão e certificação de faturas, recibos, notas de crédito e comunicação à AT.',
    version: '1.0.0',
    color: '#0d9488',
    icon: 'file-text',
    status: 'ACTIVE',
    routePrefix: '/api/invoicing',
    appUrl: '/app.html#/invoicing'
  },
  condominios: {
    key: 'condominios',
    name: 'Gestão de Condomínios',
    description: 'Administração de fracções, condomínios, balancetes e rateios.',
    version: '1.0.0',
    color: '#0891b2',
    icon: 'building',
    status: 'ACTIVE',
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
