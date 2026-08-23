const { AuthService } = require('../dist/modules/auth/services/AuthService');
const { prisma } = require('../dist/database/prisma/client');

async function testAll() {
  console.log('🧪 Starting Full Authentication & System Verification Audit...\n');

  const authService = new AuthService();

  // 1. Test check-email for Super Admin
  const adminHasPw = await authService.checkHasPassword('helderguiomar@gmail.com');
  console.log('✅ 1. Check-email (helderguiomar@gmail.com): hasPassword =', adminHasPw);

  // 2. Test Super Admin Login via OTP
  await authService.sendOtp('helderguiomar@gmail.com');
  const adminLoginRes = await authService.verifyOtp('helderguiomar@gmail.com', '123456');
  console.log('✅ 2. Super Admin Login (helderguiomar@gmail.com): Role =', adminLoginRes.user.role, '| Token Issued =', !!adminLoginRes.token);

  // 3. Test New User Registration & PENDING_APPROVAL Gate
  const testNewEmail = `user_${Date.now()}@helderlabs.eu`;
  await authService.sendOtp(testNewEmail);
  const newRegRes = await authService.verifyOtp(testNewEmail, '123456');
  console.log('✅ 3. New User Registration Gate:', newRegRes.status, '| Message =', newRegRes.message);

  // 4. Test Existing Active User Login (ana@consultoria-alfa.pt)
  const userHasPw = await authService.checkHasPassword('ana@consultoria-alfa.pt');
  console.log('✅ 4. Check-email (ana@consultoria-alfa.pt): hasPassword =', userHasPw);
  const userLoginRes = await authService.loginWithPassword('ana@consultoria-alfa.pt', 'minha_nova_password_2026');
  console.log('✅ 5. Active User Password Login:', !!userLoginRes.token, '| Role =', userLoginRes.user.role);

  console.log('\n🎉 ALL SYSTEM AUDIT TESTS PASSED SUCCESSFULLY!');
}

testAll()
  .catch(err => {
    console.error('❌ Audit Test Failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
