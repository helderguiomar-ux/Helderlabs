import { HccallSaleService } from './HccallSaleService';
import { HccallCustomerService } from './HccallCustomerService';

export interface SyncOperation {
  clientUuid: string;
  action: 'CREATE_SALE' | 'UPDATE_SALE' | 'CREATE_CONTACT';
  payload: any;
  occurredAt?: string;
}

export interface SyncResult {
  clientUuid: string;
  status: 'applied' | 'duplicate' | 'conflict' | 'error';
  record?: any;
  error?: string;
}

export class HccallSyncService {
  static async processBatch(
    db: any,
    tenantId: string,
    userId: string,
    operations: SyncOperation[]
  ): Promise<{ results: SyncResult[]; summary: { applied: number; duplicate: number; conflict: number; errors: number } }> {
    const results: SyncResult[] = [];
    let appliedCount = 0;
    let duplicateCount = 0;
    let conflictCount = 0;
    let errorCount = 0;

    for (const op of operations) {
      try {
        if (!op.clientUuid) {
          results.push({
            clientUuid: 'UNKNOWN',
            status: 'error',
            error: 'clientUuid é obrigatório para idempotência.'
          });
          errorCount++;
          continue;
        }

        if (op.action === 'CREATE_SALE') {
          const res = await HccallSaleService.createSale(db, tenantId, userId, {
            ...op.payload,
            clientUuid: op.clientUuid
          });

          if (res.isDuplicate) {
            results.push({
              clientUuid: op.clientUuid,
              status: 'duplicate',
              record: res.sale
            });
            duplicateCount++;
          } else {
            results.push({
              clientUuid: op.clientUuid,
              status: 'applied',
              record: res.sale
            });
            appliedCount++;
          }
        } else if (op.action === 'UPDATE_SALE') {
          const saleId = op.payload.id || op.payload.saleId;
          const existing = await db.hccallSale.findUnique({ where: { id: saleId } });

          if (!existing || existing.tenantId !== tenantId) {
            results.push({
              clientUuid: op.clientUuid,
              status: 'error',
              error: 'Venda a atualizar não encontrada no servidor.'
            });
            errorCount++;
            continue;
          }

          // Conflict resolution: if server has newer update than offline client occurredAt
          if (op.occurredAt && existing.updatedAt > new Date(op.occurredAt)) {
            results.push({
              clientUuid: op.clientUuid,
              status: 'conflict',
              record: existing,
              error: 'A venda foi atualizada no servidor entretanto. Prevalece o registo do servidor.'
            });
            conflictCount++;
          } else {
            const updated = await HccallSaleService.updateSale(db, tenantId, userId, saleId, op.payload);
            results.push({
              clientUuid: op.clientUuid,
              status: 'applied',
              record: updated
            });
            appliedCount++;
          }
        } else if (op.action === 'CREATE_CONTACT') {
          const contact = await HccallCustomerService.addContact(db, tenantId, userId, op.payload.customerId, op.payload);
          results.push({
            clientUuid: op.clientUuid,
            status: 'applied',
            record: contact
          });
          appliedCount++;
        } else {
          results.push({
            clientUuid: op.clientUuid,
            status: 'error',
            error: `Ação não suportada: ${op.action}`
          });
          errorCount++;
        }
      } catch (err: any) {
        results.push({
          clientUuid: op.clientUuid,
          status: 'error',
          error: err.message || 'Erro ao processar operação offline.'
        });
        errorCount++;
      }
    }

    return {
      results,
      summary: {
        applied: appliedCount,
        duplicate: duplicateCount,
        conflict: conflictCount,
        errors: errorCount
      }
    };
  }
}
