const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

async function test() {
  try {
    const res = await prisma.auditLog.findFirst({
      where: { tenantId: null },
      orderBy: { seq: 'desc' }
    });
    console.log('lastLog in DB:', res ? { id: res.id, seq: res.seq, hash: res.hash, prevHash: res.prevHash, action: res.action, tenantId: res.tenantId } : null);

    // Let's test creating an audit entry
    console.log('Testing creating an audit entry...');
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('__global__'))`;
      const last = await tx.auditLog.findFirst({
        where: { tenantId: null },
        orderBy: { seq: 'desc' },
        select: { hash: true }
      });
      const prevHash = last?.hash || '0'.repeat(64);
      const timestamp = new Date();
      const payload = `|||test.action||||null|null|${timestamp.toISOString()}|${prevHash}`;
      const hash = crypto.createHash('sha256').update(payload).digest('hex');

      const created = await tx.auditLog.create({
        data: {
          action: 'test.action',
          category: 'SECURITY',
          tenantId: null,
          prevHash,
          hash,
          timestamp
        }
      });
      console.log('Successfully created test auditLog:', created.id);
    });

  } catch (e) {
    console.error('Error:', e);
  } finally {
    await prisma.$disconnect();
  }
}
test();
