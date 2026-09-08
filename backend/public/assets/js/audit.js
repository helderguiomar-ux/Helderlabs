/**
 * HELDERLABS ERP — AUDITORIA & RASTREABILIDADE (AUDIT.JS)
 * Visualizador de Integridade SHA-256, Logs Transversais e Diffs Antes/Depois
 */

window.AuditModule = {
  logs: [],
  dashboard: null,
  integrity: null,
  currentFilter: {
    module: '',
    category: '',
    action: ''
  },
  selectedLog: null,

  async init() {
    await this.loadInitialData();
    this.render();
  },

  async loadInitialData() {
    try {
      const [dashRes, logsRes, integRes] = await Promise.all([
        fetch('/api/platform/audit/dashboard').then(r => r.json()),
        fetch('/api/platform/audit/logs?limit=50').then(r => r.json()),
        fetch('/api/platform/audit-chain/verify').then(r => r.json())
      ]);

      if (dashRes.success) {
        this.dashboard = dashRes;
      }
      if (logsRes.logs) {
        this.logs = logsRes.logs;
      }
      this.integrity = integRes;
    } catch (err) {
      console.error('[AUDIT LOAD ERROR]', err);
    }
  },

  render() {
    this.renderIntegrityBanner();
    this.renderMetrics();
    this.renderLogsTable();
  },

  renderIntegrityBanner() {
    const container = document.getElementById('audit-integrity-banner');
    if (!container) return;

    const valid = this.integrity?.valid;
    const total = this.integrity?.totalLogs || this.logs.length;

    if (valid) {
      container.innerHTML = `
        <div style="background: var(--good-bg); border: 1px solid #a7f3d0; color: #065f46; padding: 12px 16px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <svg class="icon" viewBox="0 0 24 24" style="stroke: #059669;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <strong>Cadeia de Hashes SHA-256 Verificada</strong> — ${total} registos auditados sem adulteração.
          </div>
          <button class="btn btn-sm" onclick="window.AuditModule.reverifyChain()">Reverificar Agora</button>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div style="background: var(--danger-bg); border: 1px solid #fecaca; color: #991b1b; padding: 12px 16px; border-radius: var(--radius-md); display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <svg class="icon" viewBox="0 0 24 24" style="stroke: #dc2626;"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <strong>Alerta de Integridade!</strong> Falha na cadeia criptográfica SHA-256. (${this.integrity?.reason || 'Adulteração detetada'})
          </div>
          <button class="btn btn-sm btn-danger" onclick="window.AuditModule.reverifyChain()">Reverificar</button>
        </div>
      `;
    }
  },

  renderMetrics() {
    const container = document.getElementById('audit-metrics-container');
    if (!container || !this.dashboard) return;

    container.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-title">Eventos Totais</div>
        <div class="kpi-value primary">${this.dashboard.totalLogs}</div>
        <div class="kpi-subtext">Operações rastreadas</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Eventos de Segurança</div>
        <div class="kpi-value warning">${this.dashboard.securityLogs}</div>
        <div class="kpi-subtext">Autenticação, RBAC & ACESSO</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Módulos Auditados</div>
        <div class="kpi-value positive">${this.dashboard.moduleStats?.length || 0}</div>
        <div class="kpi-subtext">Fontes de mutação ativas</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Cadeia SHA-256</div>
        <div class="kpi-value positive">${this.integrity?.valid ? '100% Íntegra' : 'Comprometida'}</div>
        <div class="kpi-subtext">Hash chaining sequencial</div>
      </div>
    `;
  },

  renderLogsTable() {
    const tbody = document.getElementById('audit-table-body');
    if (!tbody) return;

    const filtered = this.logs.filter(l => {
      if (this.currentFilter.module && l.module !== this.currentFilter.module) return false;
      if (this.currentFilter.category && l.category !== this.currentFilter.category) return false;
      if (this.currentFilter.action && !l.action?.toLowerCase().includes(this.currentFilter.action.toLowerCase())) return false;
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--muted); padding: 24px;">Nenhum registo de auditoria encontrado.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(l => {
      const dateFormatted = new Date(l.timestamp).toLocaleString('pt-PT');
      const categoryBadge = l.category === 'SECURITY'
        ? '<span class="badge badge-warning">Segurança</span>'
        : l.category === 'DATABASE'
        ? '<span class="badge badge-danger">Base de Dados</span>'
        : '<span class="badge badge-neutral">Aplicação</span>';

      const shortHash = l.hash ? l.hash.substring(0, 8) + '...' : '-';

      return `
        <tr>
          <td><span style="font-family: monospace; font-size: 11px;">#${l.seq}</span></td>
          <td><strong>${dateFormatted}</strong></td>
          <td><span class="badge badge-neutral">${l.module || 'geral'}</span></td>
          <td>
            <div style="font-weight: 600;">${l.action}</div>
            <div style="font-size: 11px; color: var(--muted); font-family: monospace;">Hash: ${shortHash}</div>
          </td>
          <td>${l.actorEmail || l.actorId || 'Sistema'}</td>
          <td style="text-align: right;">
            <button class="btn btn-sm" onclick="window.AuditModule.openDiffModal('${l.id}')">Inspecionar Diff</button>
          </td>
        </tr>
      `;
    }).join('');
  },

  openDiffModal(logId) {
    const log = this.logs.find(l => l.id === logId);
    if (!log) return;

    this.selectedLog = log;
    const modal = document.getElementById('modal-audit-diff');
    const modalTitle = document.getElementById('audit-diff-title');
    const modalBody = document.getElementById('audit-diff-body');

    if (modalTitle) modalTitle.innerText = `Auditoria #${log.seq} — ${log.action}`;
    if (modalBody) {
      const diffContent = log.diff || (log.oldValue && log.newValue ? { oldValue: log.oldValue, newValue: log.newValue } : null);

      modalBody.innerHTML = `
        <div style="display: flex; gap: 16px; margin-bottom: 12px; font-size: 12px; color: var(--text-secondary);">
          <span>Data: <strong>${new Date(log.timestamp).toLocaleString('pt-PT')}</strong></span>
          <span>Utilizador: <strong>${log.actorEmail || 'Sistema'}</strong></span>
          <span>IP: <strong>${log.ipAddress || '127.0.0.1'}</strong></span>
        </div>
        <div style="margin-bottom: 12px;">
          <div style="font-size: 11px; color: var(--muted); font-family: monospace; word-break: break-all;">
            SHA-256 Hash: <strong>${log.hash}</strong><br>
            Prev Hash: ${log.prevHash || '0000000000000000000000000000000000000000000000000000000000000000'}
          </div>
        </div>
        <div class="diff-container">
          <div class="diff-col">
            <h4>Estado Anterior (Before)</h4>
            <pre class="diff-before">${JSON.stringify(log.oldValue || {}, null, 2)}</pre>
          </div>
          <div class="diff-col">
            <h4>Novo Estado (After)</h4>
            <pre class="diff-after">${JSON.stringify(log.newValue || log.diff || {}, null, 2)}</pre>
          </div>
        </div>
      `;
    }

    if (modal) modal.classList.add('show');
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('show');
  },

  async reverifyChain() {
    try {
      const integRes = await fetch('/api/platform/audit-chain/verify').then(r => r.json());
      this.integrity = integRes;
      this.renderIntegrityBanner();
      alert(integRes.valid ? 'Verificação concluída: Cadeia SHA-256 100% íntegra!' : 'Atenção: Adulteração detetada!');
    } catch (err) {
      console.error('[REVERIFY ERROR]', err);
    }
  }
};
