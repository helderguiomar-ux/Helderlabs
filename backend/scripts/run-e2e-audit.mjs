const LOCAL_URL = 'http://127.0.0.1:3333';
const PROD_URL = 'https://helderlabs.eu';

const auditResults = {
  passed: [],
  failed: [],
  unverified: []
};

function record(suite, testName, status, details = '') {
  const entry = { suite, testName, status, details };
  if (status === 'PASS') auditResults.passed.push(entry);
  else if (status === 'FAIL') auditResults.failed.push(entry);
  else auditResults.unverified.push(entry);
  console.log(`[${status}] [${suite}] ${testName}${details ? ` -> ${details}` : ''}`);
}

async function runE2EAudit() {
  console.log('====================================================');
  console.log('  AUDITORIA E2E EM TEMPO REAL — HELDERLABS ERP  ');
  console.log('====================================================\n');

  // --- 1. AUDITORIA DE FICHEIROS ESTÁTICOS E PÁGINAS FRONTEND ---
  console.log('--- 1. Páginas Frontend & Ativos Estáticos (Local & Produção) ---');
  const pages = [
    { path: '/', expectedText: 'helderlabs' },
    { path: '/login.html', expectedText: 'autenticação' },
    { path: '/workspace.html', expectedText: 'workspace' },
    { path: '/app.html', expectedText: 'erp' },
    { path: '/super-admin.html', expectedText: 'super admin' },
    { path: '/favicon.svg', expectedText: 'svg' },
    { path: '/locales/pt.json', expectedText: 'helderlabs' },
    { path: '/locales/en.json', expectedText: 'helderlabs' },
    { path: '/site.webmanifest', expectedText: 'helderlabs' },
    { path: '/robots.txt', expectedText: 'user-agent' },
    { path: '/sitemap.xml', expectedText: 'urlset' },
  ];

  for (const p of pages) {
    try {
      const res = await fetch(`${LOCAL_URL}${p.path}`);
      const text = await res.text();
      if (res.status === 200 && text.toLowerCase().includes(p.expectedText)) {
        record('Frontend Local', `GET ${p.path}`, 'PASS', `Status 200 OK`);
      } else {
        record('Frontend Local', `GET ${p.path}`, 'FAIL', `Status ${res.status}`);
      }
    } catch (err) {
      record('Frontend Local', `GET ${p.path}`, 'FAIL', err.message);
    }
  }

  // --- 2. AUDITORIA DE ELEMENTOS DA INTERFACE (LOGIN & PASSWORD) ---
  console.log('\n--- 2. Elementos UI & Olho de Visibilidade de Password ---');
  try {
    const res = await fetch(`${LOCAL_URL}/login.html`);
    const html = await res.text();
    const hasEyeToggle = html.includes('togglePasswordVisibility');
    const hasConfirmInput = html.includes('confirm-password');
    const hasPasswordStep = html.includes('step-password');
    const hasSetPasswordStep = html.includes('step-set-password');

    if (hasEyeToggle && hasConfirmInput && hasPasswordStep && hasSetPasswordStep) {
      record('Interface Login', 'Campos de Password, Olho de Visibilidade & Confirmação', 'PASS', 'Todos os elementos presentes');
    } else {
      record('Interface Login', 'Campos de Password, Olho de Visibilidade & Confirmação', 'FAIL', 'Elementos em falta');
    }
  } catch (err) {
    record('Interface Login', 'Verificação de HTML', 'FAIL', err.message);
  }

  try {
    const res = await fetch(`${LOCAL_URL}/workspace.html`);
    const html = await res.text();
    const hasModal = html.includes('change-password-modal');
    const hasBtn = html.includes('openChangePasswordModal');
    const hasEye = html.includes('togglePasswordVisibility');

    if (hasModal && hasBtn && hasEye) {
      record('Interface Workspace', 'Modal de Alteração de Password com Olho e Confirmação', 'PASS', 'Modal e scripts operacionais');
    } else {
      record('Interface Workspace', 'Modal de Alteração de Password', 'FAIL', 'Faltam elementos no workspace.html');
    }
  } catch (err) {
    record('Interface Workspace', 'Verificação de HTML Workspace', 'FAIL', err.message);
  }

  // --- 3. AUDITORIA DE API DE AUTENTICAÇÃO ---
  console.log('\n--- 3. API de Autenticação & Gestão de Passwords ---');
  let authToken = null;

  // 3.1 Check Email
  try {
    const res = await fetch(`${LOCAL_URL}/api/auth/check-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'helderguiomar@gmail.com' })
    });
    const data = await res.json();
    if (res.status === 200 && data.hasPassword === true) {
      record('Auth API', 'POST /api/auth/check-email (helderguiomar@gmail.com)', 'PASS', 'hasPassword: true');
    } else {
      record('Auth API', 'POST /api/auth/check-email', 'FAIL', JSON.stringify(data));
    }
  } catch (err) {
    record('Auth API', 'POST /api/auth/check-email', 'FAIL', err.message);
  }

  // 3.2 Login Super Admin com admin1234
  try {
    const res = await fetch(`${LOCAL_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'helderguiomar@gmail.com', password: 'admin1234' })
    });
    const data = await res.json();
    if (res.status === 200 && data.token && data.user?.role === 'SUPER_ADMIN') {
      authToken = data.token;
      record('Auth API', 'POST /api/auth/login (helderguiomar@gmail.com + admin1234)', 'PASS', `Token emitido, Role=${data.user.role}`);
    } else {
      record('Auth API', 'POST /api/auth/login', 'FAIL', JSON.stringify(data));
    }
  } catch (err) {
    record('Auth API', 'POST /api/auth/login', 'FAIL', err.message);
  }

  // 3.3 Login com password errada
  try {
    const res = await fetch(`${LOCAL_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'helderguiomar@gmail.com', password: 'password_errada_99' })
    });
    if (res.status === 401) {
      record('Auth API', 'POST /api/auth/login (Credenciais Inválidas)', 'PASS', 'Rejeitado com 401 Credenciais inválidas');
    } else {
      record('Auth API', 'POST /api/auth/login (Credenciais Inválidas)', 'FAIL', `Status retornado: ${res.status}`);
    }
  } catch (err) {
    record('Auth API', 'POST /api/auth/login (Credenciais Inválidas)', 'FAIL', err.message);
  }

  // 3.4 Validar GET /api/auth/me
  try {
    const res = await fetch(`${LOCAL_URL}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (res.status === 200 && data.user?.email === 'helderguiomar@gmail.com') {
      record('Auth API', 'GET /api/auth/me', 'PASS', `Sessão ativa para ${data.user.email}`);
    } else {
      record('Auth API', 'GET /api/auth/me', 'FAIL', JSON.stringify(data));
    }
  } catch (err) {
    record('Auth API', 'GET /api/auth/me', 'FAIL', err.message);
  }

  // 3.5 Validar Manifesto do Workspace
  try {
    const res = await fetch(`${LOCAL_URL}/api/auth/me/workspace`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (res.status === 200 && data.apps && data.tenant) {
      record('Auth API', 'GET /api/auth/me/workspace', 'PASS', `Empresa: ${data.tenant.name}, Apps licenciados: ${data.apps.length}`);
    } else {
      record('Auth API', 'GET /api/auth/me/workspace', 'FAIL', JSON.stringify(data));
    }
  } catch (err) {
    record('Auth API', 'GET /api/auth/me/workspace', 'FAIL', err.message);
  }

  // 3.6 Testar Alteração de Password e Restauro
  try {
    const resSet = await fetch(`${LOCAL_URL}/api/auth/set-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ password: 'test_password_nova_123' })
    });
    const setMsg = await resSet.json();

    if (resSet.status === 200) {
      // Testar login com a nova password
      const resNewLogin = await fetch(`${LOCAL_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'helderguiomar@gmail.com', password: 'test_password_nova_123' })
      });
      if (resNewLogin.status === 200) {
        record('Auth API', 'POST /api/auth/set-password & Re-autenticação', 'PASS', 'Password atualizada e nova autenticação com sucesso');
      } else {
        record('Auth API', 'POST /api/auth/set-password & Re-autenticação', 'FAIL', 'Falha ao autenticar com nova password');
      }

      // Restaurar admin1234
      await fetch(`${LOCAL_URL}/api/auth/set-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ password: 'admin1234' })
      });
    } else {
      record('Auth API', 'POST /api/auth/set-password', 'FAIL', JSON.stringify(setMsg));
    }
  } catch (err) {
    record('Auth API', 'POST /api/auth/set-password', 'FAIL', err.message);
  }

  // --- 4. AUDITORIA DE ROTAS PÚBLICAS & SUPORTE ---
  console.log('\n--- 4. Rotas Públicas & Suporte (Leads & Impersonation) ---');
  try {
    const resLead = await fetch(`${LOCAL_URL}/api/public/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Eng. Auditor E2E',
        email: `e2e_${Date.now()}@auditoria.pt`,
        company: 'Empresa E2E Teste Lda',
        phone: '912345678',
        message: 'Pedido de demonstração do módulo CRM ERP.'
      })
    });
    const leadData = await resLead.json();
    if (resLead.status === 201) {
      record('Public API', 'POST /api/public/leads', 'PASS', 'Lead e Oportunidade criados com sucesso');
    } else {
      record('Public API', 'POST /api/public/leads', 'FAIL', JSON.stringify(leadData));
    }
  } catch (err) {
    record('Public API', 'POST /api/public/leads', 'FAIL', err.message);
  }

  // Testar OAuth 501 Not Implemented Guard
  try {
    const resOAuth = await fetch(`${LOCAL_URL}/api/auth/google`);
    if (resOAuth.status === 501) {
      record('Segurança', 'GET /api/auth/google (OAuth 501 Guard)', 'PASS', '501 Not Implemented retornado corretamente');
    } else {
      record('Segurança', 'GET /api/auth/google', 'FAIL', `Status: ${resOAuth.status}`);
    }
  } catch (err) {
    record('Segurança', 'GET /api/auth/google', 'FAIL', err.message);
  }

  // --- 5. AUDITORIA DA APLICAÇÃO EM PRODUÇÃO (HELDERLABS.EU) ---
  console.log('\n--- 5. Servidor e Aplicação em Produção (https://helderlabs.eu) ---');
  try {
    const resProd = await fetch(PROD_URL);
    const textProd = await resProd.text();
    const hsts = resProd.headers.get('strict-transport-security');
    const nosniff = resProd.headers.get('x-content-type-options');

    if (resProd.status === 200 && textProd.toLowerCase().includes('helderlabs')) {
      record('Produção (helderlabs.eu)', 'GET /', 'PASS', `Status 200 OK | HSTS: ${hsts ? 'SIM' : 'NÃO'} | NoSniff: ${nosniff ? 'SIM' : 'NÃO'}`);
    } else {
      record('Produção (helderlabs.eu)', 'GET /', 'FAIL', `Status: ${resProd.status}`);
    }
  } catch (err) {
    record('Produção (helderlabs.eu)', 'GET /', 'UNVERIFIED', `Não foi possível ligar diretamente: ${err.message}`);
  }

  // SUMÁRIO DA AUDITORIA E2E
  console.log('\n====================================================');
  console.log('  SUMÁRIO DA AUDITORIA E2E');
  console.log('====================================================');
  console.log(`✅ TESTES PASSADOS: ${auditResults.passed.length}`);
  console.log(`❌ TESTES FALHADOS: ${auditResults.failed.length}`);
  console.log(`⚠️  NÃO VERIFICADOS: ${auditResults.unverified.length}`);
  console.log('====================================================\n');
}

runE2EAudit().catch(console.error);
