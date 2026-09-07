import { TransactionType, FinancialTransactionStatus, ExpenseCategory, BudgetStatus } from '@prisma/client';

export interface FinancialTransactionDTO {
  id: string;
  type: TransactionType;
  status: FinancialTransactionStatus;
  description: string;
  amount: number;
  currency: string;
  date: Date | string;
  dueDate?: Date | string | null;
  category?: ExpenseCategory | null;
  supplier?: string | null;
  customer?: string | null;
  invoiceNumber?: string | null;
  costCenter?: string | null;
  notes?: string | null;
  approvedAt?: Date | string | null;
  reconciliationStatus: string;
  attachments?: number;
}

export interface BudgetDTO {
  id: string;
  name: string;
  description?: string | null;
  status: BudgetStatus;
  period: string;
  year: number;
  month?: number | null;
  totalBudgeted: number;
  totalActual?: number;
  itemsCount: number;
  approvedAt?: Date | string | null;
}

export interface CashFlowProjectionItem {
  month: string;
  openingBalance: number;
  inflows: number;
  outflows: number;
  closingBalance: number;
  scenario: string;
}

export interface FinancialReportData {
  revenues: number;
  expenses: number;
  grossProfit: number;
  profitMargin: string;
  expenseBreakdown: Array<{
    category: string;
    amount: number;
    percentage: string;
  }>;
}
