import { AuditService } from 'C:/Users/helde/Desktop/Dev/helderlabs-erp/backend/src/modules/platform/services/AuditService';
import { prisma } from 'C:/Users/helde/Desktop/Dev/helderlabs-erp/backend/src/database/prisma/client';

async function main() {
  console.log('===============================================================');
  console.log('  RE-SELAGEM CANÓNICA DA CADEIA DE AUDITORIA (CHAIN_REPAIR)');
  console.log('===============================================================\n');

  const superAdmin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN' }
  });
  const adminId = superAdmin?.id || 'system_super_admin';

  // 1. Reparar partição global
  console.log('1. A reparar partição global (Plataforma)...');
  const globalRepair = await AuditService.repairChain(
    null,
    'Migração para serialização canónica determinística e isolamento de génese global',
    adminId
  );
  console.log(`✅ Partição Global re-selada com sucesso (${globalRepair.repairedCount} registos + 1 evento CHAIN_REPAIR gerado).`);

  // 2. Reparar cada tenant
  console.log('\n2. A reparar partições por Tenant...');
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true, slug: true } });
  for (const t of tenants) {
    const res = await AuditService.repairChain(
      t.id,
      `Re-selagem canónica de registos históricos do tenant ${t.name}`,
      adminId
    );
    console.log(`✅ Tenant "${t.name}" (${t.slug}): ${res.repairedCount} registos re-selados + 1 evento CHAIN_REPAIR gerado.`);
  }

  console.log('\n3. A validar integridade final pós-reparação com verifyAuditChain...');
  const finalVerif = await AuditService.verifyAuditChain();
  if (!finalVerif.valid) {
    console.error(`❌ Falha na verificação pós-reparação: ${finalVerif.reason}`);
    process.exit(1);
  }

  console.log(`\n🎉 SUCESSO ABSOLUTO: Todas as ${tenants.length + 1} partições re-seladas canonicamente. Total: ${finalVerif.totalLogs} registos íntegros.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
