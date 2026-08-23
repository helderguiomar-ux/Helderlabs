const fs = require('fs');
const path = require('path');

const content = \<!DOCTYPE html>
<html lang="pt-PT">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HelderLabs ERP - Super Admin</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0d1117; color: #c9d1d9; display: flex; height: 100vh; overflow: hidden; }
    .sidebar { width: 250px; background-color: #161b22; border-right: 1px solid #30363d; display: flex; flex-direction: column; }
    .sidebar-header { padding: 20px; font-size: 18px; font-weight: 600; color: #58a6ff; border-bottom: 1px solid #30363d; }
    .nav { padding: 15px 0; flex-grow: 1; }
    .nav-item { padding: 12px 20px; display: block; color: #c9d1d9; text-decoration: none; font-size: 14px; transition: background 0.2s; cursor: pointer; }
    .nav-item:hover { background-color: #21262d; }
    .nav-item.active { background-color: #1f6feb; color: #ffffff; border-left: 3px solid #58a6ff; }
    
    .main-content { flex-grow: 1; display: flex; flex-direction: column; overflow: hidden; }
    .topbar { height: 60px; background-color: #161b22; border-bottom: 1px solid #30363d; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; }
    .db-status { font-size: 12px; color: #3fb950; display: flex; align-items: center; gap: 6px; }
    .db-status::before { content: ''; width: 8px; height: 8px; background-color: #3fb950; border-radius: 50%; display: inline-block; }
    .user-menu { display: flex; align-items: center; gap: 15px; font-size: 14px; }
    .btn-logout { background: #da3633; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600; }
    
    .content-area { padding: 30px; overflow-y: auto; flex-grow: 1; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    /* Tabelas */
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #30363d; font-size: 14px; }
    th { background-color: #1f6feb; color: white; font-weight: 600; }
    tr:hover { background-color: #21262d; }

    /* Grelha Users Online */
    .users-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; margin-top: 20px; }
    .user-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; display: flex; flex-direction: column; gap: 15px; position: relative; }
    .user-card.online::after { content: ''; position: absolute; top: 15px; right: 15px; width: 10px; height: 10px; background: #3fb950; border-radius: 50%; box-shadow: 0 0 8px #3fb950; }
    .user-info { display: flex; flex-direction: column; gap: 5px; }
    .user-info h3 { margin: 0; font-size: 16px; color: #58a6ff; }
    .user-info .email { margin: 0; font-size: 13px; color: #8b949e; }
    .user-avatar { width: 40px; height: 40px; border-radius: 50%; background: #238636; display: flex; align-items: center; justify-content: center; font-size: 18px; color: white; font-weight: bold; }
    .user-actions { display: flex; gap: 10px; margin-top: auto; }
    .btn-monitor { flex: 1; background: #21262d; border: 1px solid #8b949e; color: #c9d1d9; padding: 6px; border-radius: 4px; cursor: pointer; transition: all 0.2s; }
    .btn-monitor:hover { background: #8b949e; color: #0d1117; }
    .btn-suspend { flex: 1; background: transparent; border: 1px solid #da3633; color: #da3633; padding: 6px; border-radius: 4px; cursor: pointer; transition: all 0.2s; }
    .btn-suspend:hover { background: #da3633; color: white; }

    /* Feed Monitorização */
    .monitoring-panel { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; height: calc(100vh - 200px); margin-top: 20px; }
    .screen-feed { background: #000; border: 1px solid #30363d; border-radius: 8px; display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; }
    .screen-feed span { color: #8b949e; font-size: 14px; }
    .activity-log { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 15px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
    .activity-item { display: flex; align-items: flex-start; gap: 10px; font-size: 13px; border-bottom: 1px solid #21262d; padding-bottom: 8px; }
    .activity-item .time { color: #8b949e; font-family: monospace; }
    .activity-item .action { color: #c9d1d9; }
  </style>
</head>
<body>

  <div class="sidebar">
    <div class="sidebar-header">
      Platform Core
    </div>
    <div class="nav">
      <a href="#" class="nav-item active" onclick="switchTab('tenants', this); return false;">?? Gestão de Empresas</a>
      <a href="#" class="nav-item" onclick="switchTab('users', this); return false;">?? Utilizadores Online</a>
      <a href="#" class="nav-item" onclick="switchTab('monitoring', this); return false;">?? Monitorização</a>
      <a href="#" class="nav-item" onclick="switchTab('roles', this); return false;">?? Perfis e Permissões</a>
    </div>
  </div>

  <div class="main-content">
    <div class="topbar">
      <div class="db-status">Base de Dados: ONLINE</div>
      <div class="user-menu">
        <span id="admin-name">Super Admin</span>
        <button class="btn-logout" onclick="logout()">Sair</button>
      </div>
    </div>

    <div class="content-area">
      <!-- TAB 1: Gestão de Empresas -->
      <section id="tenants-section" class="tab-content active">
        <h2>Gestão de Empresas</h2>
        <div style="margin-top: 20px;">
          <input type="text" placeholder="?? Pesquisar empresa..." id="search-tenants" style="padding: 8px 12px; border-radius: 4px; border: 1px solid #30363d; background: #0d1117; color: white; width: 300px;">
        </div>
        <table>
          <thead>
            <tr>
              <th>Nome da Empresa</th>
              <th>Utilizadores</th>
              <th>Online Agora</th>
              <th>Estado</th>
              <th>Criada em</th>
            </tr>
          </thead>
          <tbody id="tenants-list">
            <!-- Render via JS -->
          </tbody>
        </table>
      </section>

      <!-- TAB 2: Utilizadores Online -->
      <section id="users-section" class="tab-content">
        <h2>Utilizadores Online / Ativos</h2>
        <p style="color: #8b949e;">Acompanhe os utilizadores ligados em tempo real.</p>
        <div class="users-grid" id="users-grid">
          <!-- Render via JS -->
        </div>
      </section>

      <!-- TAB 4: Perfis e Permissões -->
      <section id="roles-section" class="tab-content">
        <h2>Perfis e Permissões</h2>
        <p style="color: #8b949e; margin-bottom: 20px;">Defina os perfis e o que cada um pode fazer dentro da aplicação.</p>
        <div style="display: flex; gap: 20px;">
            <div style="flex: 1; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;">
                <h3 style="color: #58a6ff; margin-bottom: 15px;">Perfis (Roles)</h3>
                <ul style="list-style: none; padding: 0; margin: 0;">
                    <li style="padding: 10px; border-bottom: 1px solid #30363d; display: flex; justify-content: space-between;"><strong>SUPER_ADMIN</strong> <span>Todas as permissões</span></li>
                    <li style="padding: 10px; border-bottom: 1px solid #30363d; display: flex; justify-content: space-between;"><strong>ADMIN</strong> <span>Gestão de Empresa</span></li>
                    <li style="padding: 10px; border-bottom: 1px solid #30363d; display: flex; justify-content: space-between;"><strong>USER</strong> <span>Acesso Base</span></li>
                </ul>
                <button style="margin-top: 15px; padding: 8px 16px; background: #0d419f; border: none; color: white; border-radius: 4px; cursor: pointer;">+ Novo Perfil</button>
            </div>
            <div style="flex: 1; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px;">
                <h3 style="color: #58a6ff; margin-bottom: 15px;">Permissões do Perfil: ADMIN</h3>
                <label style="display: block; margin-bottom: 10px; cursor: pointer;"><input type="checkbox" checked> Gerir Utilizadores da Empresa</label>
                <label style="display: block; margin-bottom: 10px; cursor: pointer;"><input type="checkbox" checked> Ver Relatórios Financeiros</label>
                <label style="display: block; margin-bottom: 10px; cursor: pointer;"><input type="checkbox"> Aceder a Configurações Globais</label>
                <label style="display: block; margin-bottom: 10px; cursor: pointer;"><input type="checkbox" checked> Criar Clientes</label>
                <button style="margin-top: 15px; padding: 8px 16px; background: #238636; border: none; color: white; border-radius: 4px; cursor: pointer;">Guardar Permissões</button>
            </div>
        </div>
      </section>

      <!-- TAB 3: Monitorização -->
      <section id="monitoring-section" class="tab-content">
        <h2>Monitorização e Assistência</h2>
        <p style="color: #8b949e;">Selecione um utilizador na aba "Utilizadores Online" para iniciar a monitorização.</p>
        
        <div class="monitoring-panel" id="monitoring-panel" style="display: none;">
          <div class="screen-feed">
            <span id="monitoring-target-name">A aguardar conexão de ecrã...</span>
          </div>
          <div class="activity-log" id="activity-list">
            <!-- Render via JS Socket.IO -->
          </div>
        </div>
      </section>

    </div>
  </div>

<script src="/socket.io/socket.io.js"></script>
<script>
  const erpSessionStr = localStorage.getItem('erp_session');
  if (!erpSessionStr) window.location.href = '/login.html';
  let session;
  try {
    session = JSON.parse(erpSessionStr);
    if (session.user.role !== 'SUPER_ADMIN' && session.user.role !== 'PLATFORM_ADMIN') window.location.href = '/login.html';
    document.getElementById('admin-name').textContent = session.user.email;
  } catch(e) {
    localStorage.removeItem('erp_session');
    window.location.href = '/login.html';
  }

  function logout() {
    localStorage.removeItem('erp_session');
    window.location.href = '/login.html';
  }

  function switchTab(tab, el) {
    document.querySelectorAll('.tab-content').forEach(e => e.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
    const section = document.getElementById(tab + '-section');
    if (section) section.classList.add('active');
    
    if (el) {
        el.classList.add('active');
    } else {
        const link = document.querySelector(\[onclick*="\"]\);
        if (link) link.classList.add('active');
    }
    
    if (tab === 'tenants') loadTenants();
    if (tab === 'users') loadOnlineUsers();
  }

  async function api(path, options = {}) {
    options.headers = { ...options.headers, 'Authorization': 'Bearer ' + session.token };
    const res = await fetch(path, options);
    if (!res.ok) { if (res.status === 401) logout(); throw new Error('Erro API'); }
    return res.json();
  }

  async function loadTenants() {
    try {
      const data = await api('/api/platform/tenants');
      document.getElementById('tenants-list').innerHTML = data.tenants.map(t => 
        '<tr>' +
          '<td>' + t.name + '</td><td>' + t.userCount + '</td><td>' + t.onlineCount + '</td><td>' + t.status + '</td>' +
          '<td>' + new Date(t.createdAt).toLocaleDateString('pt-PT') + '</td>' +
        '</tr>'
      ).join('');
    } catch(e) {}
  }

  async function loadOnlineUsers() {
    try {
      const data = await api('/api/platform/users?online=true');
      document.getElementById('users-grid').innerHTML = data.users.map(u => 
        '<div class="user-card ' + (u.isOnline ? 'online' : '') + '">' +
          '<div class="user-avatar">' + (u.name ? u.name.charAt(0).toUpperCase() : '?') + '</div>' +
          '<div class="user-info">' +
            '<h3>' + u.name + '</h3>' +
            '<p class="email">' + u.email + ' (' + (u.tenant ? u.tenant.name : 'N/A') + ')</p>' +
          '</div>' +
          '<div class="user-actions">' +
            '<button class="btn-monitor" onclick="startMonitoring(\'' + u.id + '\')">??? Monitorizar</button>' +
            '<button class="btn-suspend" onclick="suspendUser(\'' + u.id + '\')">?? Suspender</button>' +
          '</div>' +
        '</div>'
      ).join('');
    } catch(e) {}
  }

  async function suspendUser(userId) {
    if(!confirm('Suspender utilizador?')) return;
    try {
      await api('/api/platform/users/' + userId + '/status', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'SUSPENDED' })
      });
      loadOnlineUsers();
    } catch(e) {}
  }

  let socket = null;
  if (window.io) {
    socket = io({ auth: { token: session.token } });
    socket.on('connect', () => { loadTenants(); loadOnlineUsers(); });
    socket.on('user:online', () => { loadOnlineUsers(); });
    socket.on('user:offline', () => { loadOnlineUsers(); });
    socket.on('user:activity', (activity) => {
      if (document.getElementById('monitoring-panel').style.display !== 'none') {
        const list = document.getElementById('activity-list');
        const item = document.createElement('div');
        item.className = 'activity-item';
        item.innerHTML = '<span class="time">' + new Date().toLocaleTimeString() + '</span><span class="action">' + activity.description + '</span>';
        list.prepend(item);
      }
    });
  }

  function startMonitoring(userId) {
    switchTab('monitoring');
    document.getElementById('monitoring-panel').style.display = 'grid';
    document.getElementById('activity-list').innerHTML = '';
    if (socket) socket.emit('monitoring:start', { userId });
  }

  loadTenants();
</script>
</body>
</html>
\;

fs.writeFileSync(path.join(__dirname, 'backend', 'public', 'super-admin.html'), content, 'utf8');
