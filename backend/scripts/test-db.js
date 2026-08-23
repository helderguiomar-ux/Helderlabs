const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testConnection() {
  try {
    const result = await prisma.$queryRawUnsafe('SELECT 1 as result');
    console.log('✅ Prisma Database Connection SUCCESS:', result);
    
    // Check tables
    const tenantsCount = await prisma.tenant.count();
    const usersCount = await prisma.user.count();
    console.log(`📊 Current DB Stats: Tenants=${tenantsCount}, Users=${usersCount}`);
  } catch (error) {
    console.error('❌ Prisma Database Connection FAILED:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

testConnection();
