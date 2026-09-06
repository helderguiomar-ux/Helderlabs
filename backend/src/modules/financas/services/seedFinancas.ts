import { prisma as defaultPrismaClient } from '../../../database/prisma/client';

export async function seedFinancas(tenantId: string, tx: any = defaultPrismaClient) {
  const defaultCategories = [
    // RECEITAS
    { name: 'Vendas', kind: 'INCOME', color: '#10b981', icon: 'shopping-bag', isSystem: true },
    { name: 'Serviços', kind: 'INCOME', color: '#06b6d4', icon: 'briefcase', isSystem: true },
    { name: 'Rendas / Investimentos', kind: 'INCOME', color: '#6366f1', icon: 'trending-up', isSystem: true },
    { name: 'Outras Receitas', kind: 'INCOME', color: '#8b5cf6', icon: 'plus-circle', isSystem: true },

    // DESPESAS
    { name: 'Habitação / Renda', kind: 'EXPENSE', color: '#ef4444', icon: 'home', isSystem: true },
    { name: 'Alimentação / Compras', kind: 'EXPENSE', color: '#f97316', icon: 'shopping-cart', isSystem: true },
    { name: 'Transportes / Combustível', kind: 'EXPENSE', color: '#f59e0b', icon: 'truck', isSystem: true },
    { name: 'Saúde & Seguros', kind: 'EXPENSE', color: '#ec4899', icon: 'heart', isSystem: true },
    { name: 'Impostos & Taxas', kind: 'EXPENSE', color: '#64748b', icon: 'file-text', isSystem: true },
    { name: 'Fornecedores & Serviços', kind: 'EXPENSE', color: '#3b82f6', icon: 'users', isSystem: true },
    { name: 'Lazer & Outros', kind: 'EXPENSE', color: '#a855f7', icon: 'smile', isSystem: true }
  ];

  for (const cat of defaultCategories) {
    await tx.financeCategory.upsert({
      where: {
        tenantId_name_kind: {
          tenantId,
          name: cat.name,
          kind: cat.kind as any
        }
      },
      create: {
        tenantId,
        name: cat.name,
        kind: cat.kind as any,
        color: cat.color,
        icon: cat.icon,
        isSystem: cat.isSystem
      },
      update: {
        color: cat.color,
        icon: cat.icon
      }
    });
  }
}
