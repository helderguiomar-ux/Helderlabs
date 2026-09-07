import { z } from 'zod';

export const CreateTransactionSchema = z.object({
  type: z.enum(['REVENUE', 'EXPENSE', 'TRANSFER']),
  description: z.string().min(2, 'Descrição deve ter pelo menos 2 caracteres'),
  amount: z.coerce.number().positive('Valor deve ser positivo'),
  currency: z.string().optional().default('EUR'),
  date: z.string(),
  status: z.string().optional().default('PAID'),
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
  name: z.string().min(2, 'Nome do orçamento deve ter pelo menos 2 caracteres'),
  description: z.string().optional().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional().nullable(),
  alertThreshold: z.coerce.number().int().min(1).max(100).default(90),
  category: z.string().optional().nullable(),
  allocatedAmount: z.coerce.number().positive().optional(),
  period: z.string().optional(),
  budgetItems: z.array(z.object({
    category: z.string(),
    budgetAmount: z.coerce.number().positive()
  })).optional()
});

export const ReportSchema = z.object({
  reportType: z.enum(['P&L', 'BALANCE_SHEET', 'CASH_FLOW']),
  period: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']),
  startDate: z.string(),
  endDate: z.string()
});
