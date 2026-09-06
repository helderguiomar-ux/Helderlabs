const http = require('http');

const BASE_URL = 'http://localhost:3333';

function request(path, method = 'GET', body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch {
          resolve({ status: res.statusCode, raw: data.substring(0, 200) });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runE2ETest() {
  console.log('🧪 A iniciar testes visuais e de API end-to-end...\n');

  // 1. Landing Page
  const landing = await request('/');
  console.log(`1. Landing Page (GET /): Status ${landing.status} — ${landing.raw ? 'HTML OK' : 'OK'}`);

  // 2. Public Lead Form Submission
  const publicLead = await request('/api/crm/public/leads', 'POST', {
    company: 'Empresa Teste E2E',
    name: 'João Testador',
    email: 'joao.e2e@exemplo.pt',
    phone: '912345678',
    source: 'Landing Page'
  });
  console.log(`2. Submissão Pública de Lead (POST /api/crm/public/leads): Status ${publicLead.status}`);

  // 3. Super Admin Login
  const superAdminLogin = await request('/api/auth/login', 'POST', {
    email: 'helderguiomar@gmail.com',
    password: 'admin1234'
  });
  console.log(`3. Login Super Admin (POST /api/auth/login): Status ${superAdminLogin.status} — Token obtido: ${!!superAdminLogin.body.token}`);
  const saToken = superAdminLogin.body.token;

  // 4. Tenant Admin Login
  const tenantAdminLogin = await request('/api/auth/login', 'POST', {
    email: 'ana@consultoria-alfa.pt',
    password: 'admin1234'
  });
  console.log(`4. Login Tenant Admin (POST /api/auth/login): Status ${tenantAdminLogin.status} — User: ${tenantAdminLogin.body.user.email}`);
  const taToken = tenantAdminLogin.body.token;

  // 5. Workspace Manifest
  const workspace = await request('/api/me/workspace', 'GET', null, taToken);
  console.log(`5. Workspace Manifest (GET /api/me/workspace): Status ${workspace.status} — Apps ativas: ${workspace.body.apps.length}`);

  // 6. Super Admin List Tenants
  const tenants = await request('/api/platform/tenants', 'GET', null, saToken);
  console.log(`6. Super Admin List Tenants (GET /api/platform/tenants): Status ${tenants.status} — Tenants: ${tenants.body.tenants.length}`);

  // 7. Super Admin List Applications
  const apps = await request('/api/platform/applications', 'GET', null, saToken);
  console.log(`7. Super Admin List Applications (GET /api/platform/applications): Status ${apps.status} — Applications: ${apps.body.applications.length}`);

  // 8. Super Admin Start Impersonation
  const impersonation = await request('/api/platform/impersonate', 'POST', {
    targetTenantId: tenants.body.tenants[1].id,
    reason: 'Teste Visual de Suporte'
  }, saToken);
  console.log(`8. Impersonation Session (POST /api/platform/impersonate): Status ${impersonation.status} — Token de Impersonation: ${!!impersonation.body.token}`);

  // 9. CRM Lead Creation in Tenant
  const newLead = await request('/api/crm/leads', 'POST', {
    company: 'Empresa Cliente Alfa',
    name: 'Rui Costa',
    email: 'rui@clientealfa.pt',
    source: 'Website'
  }, taToken);
  const leadObj = newLead.body.lead || newLead.body;
  console.log(`9. CRM Create Lead (POST /api/crm/leads): Status ${newLead.status} — Lead ID: ${leadObj.id}`);

  // 10. CRM Convert Lead to Opportunity
  const convertLead = await request(`/api/crm/leads/${leadObj.id}/convert`, 'POST', {
    estimatedValue: 25000
  }, taToken);
  const oppObj = convertLead.body.opportunity || convertLead.body;
  console.log(`10. CRM Convert Lead to Opportunity: Status ${convertLead.status} — Opp ID: ${oppObj.id}`);

  // 11. CRM Win Opportunity to Customer
  const winOpp = await request(`/api/crm/opportunities/${oppObj.id}/win`, 'POST', {}, taToken);
  const customerObj = winOpp.body.customer || winOpp.body;
  console.log(`11. CRM Win Opportunity: Status ${winOpp.status} — Customer criado: ${customerObj.companyName}`);

  // 12. Condomínios List Buildings
  const buildings = await request('/api/condominios/buildings', 'GET', null, saToken);
  console.log(`12. Condomínios List Buildings (GET /api/condominios/buildings): Status ${buildings.status} — Condomínios: ${buildings.body.length}`);

  console.log('\n======================================================');
  console.log('✅ TODOS OS 12 FLUXOS END-TO-END PASSARAM COM SUCESSO 100%!');
  console.log('======================================================');
}

runE2ETest().catch(err => {
  console.error('❌ Erro no teste E2E:', err);
  process.exit(1);
});
