import { z } from 'zod';

export const CreateTransactionSchema = z.object({
  type: z.enum(['REVENUE', 'EXPENSE', 'TRANSFER']),
  description: z.string().min(3, 'Descrição deve ter pelo menos 3 caracteres'),
  amount: z.number().positive('Valor deve ser positivo'),
  currency: z.string().default('EUR'),
  date: z.string(),
  dueDate: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  supplier: z.string().optional().nullable(),
  customer: z.string().optional().nullable(),
  invoiceNumber: z.string().optional().nullable(),
  costCenter: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

export const UpdateTransactionSchema = CreateTransactionSchema.partial();

export const CreateBudgetSchema = z.object({
  name: z.string().min(3, 'Nome do orçamento deve ter pelo menos 3 caracteres'),
  description: z.string().optional().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  year: z.number().int(),
  month: z.number().int().min(1).max(12).optional().nullable(),
  alertThreshold: z.number().int().min(1).max(100).default(90),
  budgetItems: z.array(z.object({
    category: z.string(),
    budgetAmount: z.number().positive('Valor orçado deve ser positivo')
  })).min(1, 'Pelo menos uma categoria orçamentada é obrigatória')
});

export const ReportSchema = z.object({
  reportType: z.enum(['P&L', 'BALANCE_SHEET', 'CASH_FLOW']),
  period: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']),
  startDate: z.string(),
  endDate: z.string()
});
