import { HccallScopeService } from './HccallScopeService';

export class HccallCustomerService {
  /**
   * Finds or creates a customer by customerNumber.
   */
  static async findOrCreateCustomer(
    db: any,
    tenantId: string,
    userId: string,
    data: {
      customerNumber: string;
      name?: string;
      phone?: string;
      notes?: string;
    }
  ) {
    const customerNumber = data.customerNumber.trim();
    let customer = await db.hccallCustomer.findUnique({
      where: {
        tenantId_customerNumber: {
          tenantId,
          customerNumber
        }
      }
    });

    if (!customer) {
      customer = await db.hccallCustomer.create({
        data: {
          tenantId,
          ownerUserId: userId,
          customerNumber,
          name: data.name?.trim() || null,
          phone: data.phone?.trim() || null,
          notes: data.notes || null
        }
      });
    } else if (data.name || data.phone || data.notes) {
      customer = await db.hccallCustomer.update({
        where: { id: customer.id },
        data: {
          ...(data.name && { name: data.name.trim() }),
          ...(data.phone && { phone: data.phone.trim() }),
          ...(data.notes && { notes: data.notes })
        }
      });
    }

    return customer;
  }

  static async listCustomers(
    db: any,
    tenantId: string,
    userId: string,
    query: {
      search?: string;
      limit?: number;
      offset?: number;
    }
  ) {
    const scope = await HccallScopeService.getVisibilityScope(db, tenantId, userId);
    const take = Math.min(query.limit ? Number(query.limit) : 50, 200);
    const skip = query.offset ? Number(query.offset) : 0;

    const where: any = {
      tenantId,
      deletedAt: null,
      ...scope
    };

    if (query.search) {
      const q = query.search.trim();
      where.OR = [
        { customerNumber: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } }
      ];
    }

    const [items, total] = await Promise.all([
      db.hccallCustomer.findMany({
        where,
        take,
        skip,
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: {
            select: { contacts: true }
          }
        }
      }),
      db.hccallCustomer.count({ where })
    ]);

    return {
      items,
      total,
      limit: take,
      offset: skip
    };
  }

  static async getCustomerDetails(db: any, tenantId: string, userId: string, id: string) {
    const customer = await db.hccallCustomer.findUnique({
      where: { id },
      include: {
        contacts: {
          where: { deletedAt: null },
          orderBy: { occurredAt: 'desc' }
        }
      }
    });

    if (!customer || customer.tenantId !== tenantId) {
      throw new Error('Cliente não encontrado.');
    }

    // Also fetch sales for this customer
    const sales = await db.hccallSale.findMany({
      where: {
        tenantId,
        customerNumber: customer.customerNumber,
        deletedAt: null
      },
      orderBy: { soldAt: 'desc' }
    });

    const totalSales = sales.length;
    const totalCommissionCents = sales.reduce((acc: number, s: any) => acc + (s.commissionCents || 0), 0);

    return {
      customer,
      sales,
      metrics: {
        totalSales,
        totalCommissionCents
      }
    };
  }

  static async addContact(
    db: any,
    tenantId: string,
    userId: string,
    customerId: string,
    data: {
      kind: 'CALL' | 'STORE' | 'MESSAGE' | 'NOTE';
      summary: string;
      occurredAt?: string | Date;
    }
  ) {
    return db.hccallContact.create({
      data: {
        tenantId,
        ownerUserId: userId,
        customerId,
        kind: data.kind || 'CALL',
        summary: data.summary.trim(),
        occurredAt: data.occurredAt ? new Date(data.occurredAt) : new Date()
      }
    });
  }

  static async anonymizeCustomer(
    db: any,
    tenantId: string,
    userId: string,
    customerId: string
  ) {
    const customer = await db.hccallCustomer.findUnique({ where: { id: customerId } });
    if (!customer || customer.tenantId !== tenantId) {
      throw new Error('Cliente não encontrado.');
    }

    return db.hccallCustomer.update({
      where: { id: customerId },
      data: {
        name: 'ANONIMIZADO_RGPD',
        phone: null,
        notes: 'Dados anonimizados ao abrigo do RGPD.'
      }
    });
  }
}
