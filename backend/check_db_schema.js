require('dotenv').config({ path: 'backend/.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const migrations = await prisma.$queryRaw`SELECT id, migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC`;
  console.log('Applied migrations in DB:');
  console.log(migrations);

  const colsAudit = await prisma.$queryRaw`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'audit_logs'`;
  console.log('audit_logs columns:', colsAudit.map(c => c.column_name));

  const colsAccountReq = await prisma.$queryRaw`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'account_requests'`;
  console.log('account_requests columns:', colsAccountReq.map(c => c.column_name));

  await prisma.$disconnect();
}
check().catch(console.error);
