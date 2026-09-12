const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BASE_URL = 'https://helderlabs.eu';

async function fetchJsonOrText(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    json = text;
  }
  return { status: res.status, body: json, raw: text };
}

async function main() {
  console.log('=== PASSO 7 — 15 VERIFICAÇÕES DE PRODUÇÃO ===\n');

  // PONTO 1: GET /api/health
  console.log('--- PONTO 1: GET /api/health ---');
  const health = await fetchJsonOrText(`${BASE_URL}/api/health`);
  console.log(`Status: ${health.status}`);
  console.log('Body:', JSON.stringify(health.body, null, 2));

  // PONTO 2: GET /api/version
  console.log('\n--- PONTO 2: GET /api/version ---');
  const version = await fetchJsonOrText(`${BASE_URL}/api/version`);
  console.log(`Status: ${version.status}`);
  console.log('Body:', JSON.stringify(version.body, null, 2));

  // PONTO 3: POST /api/auth/login (admin1234)
  console.log('\n--- PONTO 3: POST /api/auth/login (admin1234) ---');
  const loginAdmin1234 = await fetchJsonOrText(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'helderguiomar@gmail.com', password: 'admin1234' })
  });
  console.log(`Status: ${loginAdmin1234.status}`);
  console.log('Body:', JSON.stringify(loginAdmin1234.body, null, 2));

  // PONTO 4, 5, 6: POST /api/public/register
  console.log('\n--- PONTOS 4, 5, 6: POST /api/public/register (resiliência email + não-fuga) ---');
  const testRegEmail = `verif.passo7.${Date.now()}@helderlabs.pt`;
  const register = await fetchJsonOrText(`${BASE_URL}/api/public/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testRegEmail,
      emailConfirmation: testRegEmail,
      password: 'PasswordForte1234!',
      passwordConfirmation: 'PasswordForte1234!',
      fullName: 'Verificação Passo 7',
      organizationName: 'Verificação Labs',
      termsAccepted: true,
      privacyAccepted: true
    })
  });
  console.log(`Status: ${register.status}`);
  console.log('Body:', JSON.stringify(register.body, null, 2));
  console.log('Contém "resend.com"?:', register.raw.includes('resend.com'));
  console.log('Contém "not verified"?:', register.raw.includes('not verified'));

  // Consulta SQL da linha em account_requests
  const reqRow = await prisma.accountRequest.findUnique({
    where: { email: testRegEmail }
  });
  console.log('AccountRequest criada na BD:');
  console.log(JSON.stringify({
    id: reqRow?.id,
    email: reqRow?.email,
    emailDelivered: reqRow?.emailDelivered,
    emailDeliveryError: reqRow?.emailDeliveryError,
    status: reqRow?.status,
    createdAt: reqRow?.createdAt
  }, null, 2));

  // PONTO 7: POST /api/auth/check-email (anti-enumeração)
  console.log('\n--- PONTO 7: POST /api/auth/check-email (anti-enumeração) ---');
  const checkExist = await fetchJsonOrText(`${BASE_URL}/api/auth/check-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'helderguiomar@gmail.com' })
  });
  const checkNonExist = await fetchJsonOrText(`${BASE_URL}/api/auth/check-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `inexistente.${Date.now()}@helderlabs.pt` })
  });
  console.log(`Existente: HTTP ${checkExist.status}`, checkExist.body);
  console.log(`Inexistente: HTTP ${checkNonExist.status}`, checkNonExist.body);
  console.log('Respostas e estados idênticos?:', JSON.stringify(checkExist.body) === JSON.stringify(checkNonExist.body) && checkExist.status === checkNonExist.status);

  // PONTO 8: POST /api/auth/send-otp (anti-enumeração & sem poluição de BD)
  console.log('\n--- PONTO 8: POST /api/auth/send-otp ---');
  const ghostEmail = `fantasma.${Date.now()}@helderlabs.pt`;
  const otp = await fetchJsonOrText(`${BASE_URL}/api/auth/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ghostEmail })
  });
  console.log(`Status: ${otp.status}`);
  console.log('Body:', otp.body);
  const userGhost = await prisma.user.findUnique({ where: { email: ghostEmail } });
  console.log('Utilizador fantasma criado na BD?:', userGhost !== null);

  // PONTO 9: Validação estrita de password em /api/public/register
  console.log('\n--- PONTO 9: POST /api/public/register com password fraca (<12 chars) ---');
  const weakPass = await fetchJsonOrText(`${BASE_URL}/api/public/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `weak.${Date.now()}@helderlabs.pt`,
      emailConfirmation: `weak.${Date.now()}@helderlabs.pt`,
      password: 'fraca',
      passwordConfirmation: 'fraca',
      fullName: 'Weak Pass',
      termsAccepted: true,
      privacyAccepted: true
    })
  });
  console.log(`Status com password fraca: ${weakPass.status}`);
  console.log('Body:', JSON.stringify(weakPass.body, null, 2));

  // PONTO 10: GET /api/finance/transactions -> 404
  console.log('\n--- PONTO 10: GET /api/finance/transactions ---');
  const legacyFinance = await fetchJsonOrText(`${BASE_URL}/api/finance/transactions`);
  console.log(`Status /api/finance/transactions: ${legacyFinance.status}`);

  // PONTO 11: GET /api/financas/accounts
  console.log('\n--- PONTO 11: GET /api/financas/accounts ---');
  const financas = await fetchJsonOrText(`${BASE_URL}/api/financas/accounts`);
  console.log(`Status /api/financas/accounts: ${financas.status}`);

  // PONTO 12: Benchmark check-email (5 runs)
  console.log('\n--- PONTO 12: Benchmark check-email (5 runs) ---');
  const checkEmailDurations = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await fetch(`${BASE_URL}/api/auth/check-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'helderguiomar@gmail.com' })
    });
    const dur = performance.now() - t0;
    checkEmailDurations.push(dur);
    console.log(`Run ${i + 1}: ${dur.toFixed(2)} ms`);
  }
  checkEmailDurations.sort((a, b) => a - b);
  const p95CheckEmail = checkEmailDurations[Math.floor(checkEmailDurations.length * 0.95)];
  console.log(`check-email p95: ${p95CheckEmail.toFixed(2)} ms`);

  // PONTO 13: Benchmark autenticado
  console.log('\n--- PONTO 13: Benchmark de Latência Autenticada ---');
  let token = loginAdmin1234.body?.token;

  const endpoints = [
    '/api/me/workspace',
    '/api/financas/dashboard',
    '/api/hccall/dashboard',
    '/api/platform/audit/logs'
  ];

  if (token) {
    for (const ep of endpoints) {
      const times = [];
      let lastStatus = 0;
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        const res = await fetch(`${BASE_URL}${ep}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const dur = performance.now() - t0;
        lastStatus = res.status;
        times.push(dur);
      }
      times.sort((a, b) => a - b);
      const p50 = times[Math.floor(times.length * 0.5)];
      const p95 = times[Math.floor(times.length * 0.95)];
      console.log(`${ep} -> HTTP ${lastStatus} | p50: ${p50.toFixed(2)} ms | p95: ${p95.toFixed(2)} ms | min: ${times[0].toFixed(2)} ms | max: ${times[times.length - 1].toFixed(2)} ms`);
    }
  } else {
    console.log('Sem token válido para benchmark autenticado.');
  }

  // PONTO 14: Verificação de Audit Logs (atribuição & IP)
  console.log('\n--- PONTO 14: Consulta de Audit Logs (AUD-08 & AUD-09) ---');
  const recentAudit = await prisma.auditLog.findMany({
    orderBy: { timestamp: 'desc' },
    take: 8
  });
  console.log('8 registos de auditoria mais recentes:');
  console.log(JSON.stringify(recentAudit.map(a => ({
    id: a.id,
    action: a.action,
    actorEmail: a.actorEmail,
    ipAddress: a.ipAddress,
    status: a.status,
    timestamp: a.timestamp
  })), null, 2));

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Erro na execução:', err);
  process.exit(1);
});
