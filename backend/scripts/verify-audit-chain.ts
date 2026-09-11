import { AuditService } from 'C:/Users/helde/Desktop/Dev/helderlabs-erp/backend/src/modules/platform/services/AuditService';
import { prisma } from 'C:/Users/helde/Desktop/Dev/helderlabs-erp/backend/src/database/prisma/client';

async function main() {
  console.log('===============================================================');
  console.log('  VERIFICADOR INDEPENDENTE DE CADEIA DE AUDITORIA SHA-256');
  console.log('===============================================================\n');

  console.log('1. A verificar partição global (Plataforma)...');
  const globalResult = await AuditService.verifyAuditChainForPartition(null);
  if (!globalResult.valid) {
    console.error(`❌ [FALHA NA PARTIÇÃO GLOBAL] ${globalResult.reason} (Log ID: ${globalResult.invalidAtId})`);
    process.exit(1);
  }
  console.log(`✅ Partição Global Válida (${globalResult.totalLogs} registos verificados).`);

  console.log('\n2. A verificar partições por Tenant...');
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' }
  });

  let totalTenantLogs = 0;
  let failedTenants = 0;

  for (const tenant of tenants) {
    const res = await AuditService.verifyAuditChainForPartition(tenant.id);
    if (!res.valid) {
      console.error(`❌ [FALHA] Tenant "${tenant.name}" (${tenant.id}): ${res.reason} (Log ID: ${res.invalidAtId})`);
      failedTenants++;
    } else {
      console.log(`✅ Tenant "${tenant.name}" (${tenant.slug}): ${res.totalLogs} registos verificados.`);
      totalTenantLogs += res.totalLogs;
    }
  }

  const grandTotal = globalResult.totalLogs + totalTenantLogs;
  console.log('\n===============================================================');
  if (failedTenants > 0) {
    console.error(`❌ AUDITORIA FALHOU: ${failedTenants} tenant(s) com adulteração ou quebra de cadeia.`);
    process.exit(1);
  } else {
    console.log(`✅ CADEIA 100% VÁLIDA E ÍNTEGRA: ${grandTotal} registos verificados em ${tenants.length + 1} partições.`);
    console.log('===============================================================\n');
  }
}

main().catch((err) => {
  console.error('[ERRO CRÍTICO NO VERIFICADOR]:', err);
  process.exit(1);
}).finally(() => prisma.$disconnect());
