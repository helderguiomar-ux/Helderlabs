import { prisma as basePrisma } from './client';

// -----------------------------------------------------------------------------
// Isolamento multi-tenant ao nível dos dados (defesa em profundidade)
// -----------------------------------------------------------------------------
// Isto é a segunda camada de proteção contra fugas entre tenants — a primeira
// é o middleware de autenticação (src/plugins/authenticate.ts), que extrai o
// tenantId do JWT e nunca o aceita vindo do cliente (query/body).
//
// Mesmo assim, um service novo (Vendas, Faturação, Financeiro, Tarefas...)
// pode um dia esquecer-se de filtrar por tenantId numa query. Esta Prisma
// Client Extension torna isso estruturalmente difícil: qualquer query feita
// através do client devolvido por `forTenant(tenantId)` é reescrita para
// incluir sempre `tenantId` — em leituras, updates, deletes e creates.
//
// Uso (dentro de um service, com o client já "amarrado" a um tenant):
//   const db = forTenant(request.user.tenantId);
//   await db.lead.findMany();                 // -> where: { tenantId }
//   await db.lead.create({ data: { ... } });   // -> data.tenantId injetado
//
// Nota importante: isto exige `prisma generate` correr com acesso à rede
// (binaries.prisma.sh) para gerar o client real — não é possível validar o
// comportamento do $extends contra uma base de dados real dentro desta
// sandbox. A lógica está isolada aqui e coberta por um teste que verifica a
// *forma* dos argumentos reescritos (ver tests/database/tenantScopedClient.test.ts),
// mas o teste de integração completo (com Postgres real) fica como próximo
// passo a correr fora da sandbox.

// Modelos que têm tenantId direto e devem ser sempre filtrados/carimbados.
// Contact e Building ficam de fora de propósito: não têm tenantId próprio
// (Contact só tem customerId; Unit/Owner/Fee/Assembly/Vote/Expense só têm
// buildingId/unitId/assemblyId) — o isolamento desses é transitivo via
// Customer/Building. Isolar diretamente exigiria reescrever `where` para um
// filtro relacional (`customer: { tenantId }` / `building: { tenantId }`),
// o que fica como TODO para quando cada módulo crescer para além do CRUD
// mínimo de hoje. Entretanto, o service layer (EnterpriseCRMService,
// EnterpriseCondominiosService) confirma a posse do registo pai antes de
// ler/escrever nesses modelos — ver comentários nesses ficheiros.
const TENANT_SCOPED_MODELS = new Set([
  'Lead',
  'Opportunity',
  'Customer',
  'Company',
  'Contract',
  'Communication',
  'Building',
  'FinanceAccount',
  'CostCenter',
  'FinanceCategory',
  'FinanceTransaction',
  'RecurringRule',
  'Loan',
  'LoanPayment',
  'Budget',
  'Role',
  'FinancialTransaction',
  'FinancialAttachment',
  'BudgetItem',
  'CashFlowProjection',
  'BankReconciliation',
  'FinancialReport',
  'HccallCustomer',
  'HccallService',
  'HccallPromotion',
  'HccallSaleStatus',
  'HccallSale',
  'HccallSaleChange',
  'HccallContact',
  'HccallCounter',
  'SellItemType',
  'SellItem',
  'SellItemCost',
  'SellItemMedia',
  'SellProvenance',
  'SellRestoration',
  'SellLocation',
  'SellItemEvent',
  'SellConsignment',
  'SellConsignmentItem',
  'SellChannel',
  'SellChannelListing',
  'SellChannelJob',
  'SellAuction',
  'SellAuctionLot',
  'SellBid',
  'SellCounter'
]);

const READ_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy'
]);

const WRITE_OPERATIONS_WITH_WHERE = new Set(['update', 'updateMany', 'delete', 'deleteMany']);

/**
 * Reescreve os argumentos de UMA operação Prisma para carimbar/filtrar por
 * tenantId. É uma função pura (sem I/O), de propósito — assim conseguimos
 * testar exaustivamente a lógica de isolamento (tests/database/tenantScopedClient.test.ts)
 * sem precisar de um Prisma Client gerado nem de uma base de dados real.
 */
export function buildTenantScopedArgs(model: string | undefined, operation: string, args: any, tenantId: string) {
  const nextArgs = { ...(args ?? {}) };

  if (!model || !TENANT_SCOPED_MODELS.has(model)) {
    return nextArgs;
  }

  if (READ_OPERATIONS.has(operation) || WRITE_OPERATIONS_WITH_WHERE.has(operation)) {
    nextArgs.where = { ...(nextArgs.where ?? {}), tenantId };
  }

  if (operation === 'create') {
    nextArgs.data = { ...(nextArgs.data ?? {}), tenantId };
  }

  if (operation === 'createMany') {
    const data = nextArgs.data;
    nextArgs.data = Array.isArray(data)
      ? data.map((item: any) => ({ ...item, tenantId }))
      : { ...data, tenantId };
  }

  if (operation === 'upsert') {
    nextArgs.where = { ...(nextArgs.where ?? {}), tenantId };
    nextArgs.create = { ...(nextArgs.create ?? {}), tenantId };
  }

  return nextArgs;
}

export function forTenant(tenantId: string) {
  if (!tenantId) {
    throw new Error('forTenant() foi chamado sem tenantId — isto nunca deve acontecer depois do middleware de autenticação.');
  }

  return basePrisma.$extends({
    name: `tenant-scope:${tenantId}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(buildTenantScopedArgs(model, operation, args, tenantId));
        }
      }
    }
  });
}

export type TenantScopedPrismaClient = ReturnType<typeof forTenant>;
