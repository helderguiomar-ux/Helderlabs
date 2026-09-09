/**
 * HELDERLABS ERP — CRM EMPRESA 360º (CRM.JS)
 * Gestão Centralizada de Clientes, Fornecedores, Parceiros e Contratos
 */

window.CRMModule = {
  companies: [],
  selectedCompany: null,
  active360Tab: 'overview',
  currentFilter: {
    status: '',
    search: '',
    sector: ''
  },

  async init() {
    await this.loadCompanies();
    this.render();
  },

  async loadCompanies() {
    try {
      const fetchFn = window.apiFetch || fetch;
      const res = await fetchFn('/api/crm/companies');
      const data = await res.json();
      if (data.success) {
        this.companies = data.companies;
      }
    } catch (err) {
      console.error('[CRM LOAD ERROR]', err);
    }
  },

  render() {
    this.renderMetrics();
    this.renderCompaniesGrid();
  },

  renderMetrics() {
    const container = document.getElementById('crm-metrics-container');
    if (!container) return;

    const total = this.companies.length;
    const leads = this.companies.filter(c => c.status === 'LEAD' || c.status === 'POTENTIAL').length;
    const customers = this.companies.filter(c => c.status === 'CUSTOMER').length;
    const suppliers = this.companies.filter(c => c.status === 'SUPPLIER').length;

    container.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-title">Total de Empresas</div>
        <div class="kpi-value primary">${total}</div>
        <div class="kpi-subtext">Registos ativos 360º</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Clientes Ativos</div>
        <div class="kpi-value positive">${customers}</div>
        <div class="kpi-subtext">Relações comerciais estabelecidas</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Leads & Prospetos</div>
        <div class="kpi-value warning">${leads}</div>
        <div class="kpi-subtext">Em qualificação ou proposta</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Fornecedores & Parceiros</div>
        <div class="kpi-value">${suppliers}</div>
        <div class="kpi-subtext">Rede de fornecimento e canais</div>
      </div>
    `;
  },

  renderCompaniesGrid() {
    const container = document.getElementById('companies-grid-container');
    if (!container) return;

    const filtered = this.companies.filter(c => {
      if (this.currentFilter.status && c.status !== this.currentFilter.status) return false;
      if (this.currentFilter.sector && c.sector !== this.currentFilter.sector) return false;
      if (this.currentFilter.search) {
        const s = this.currentFilter.search.toLowerCase();
        const matchName = c.tradeName?.toLowerCase().includes(s) || c.legalName?.toLowerCase().includes(s);
        const matchNif = c.taxNumber?.toLowerCase().includes(s);
        const matchEmail = c.email?.toLowerCase().includes(s);
        if (!matchName && !matchNif && !matchEmail) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--muted); padding: 32px;">Nenhuma empresa encontrada com os filtros aplicados.</div>';
      return;
    }

    container.innerHTML = filtered.map(c => {
      const score = c.completenessPercent || 30;
      const fillClass = score >= 80 ? 'fill-high' : score >= 50 ? 'fill-med' : 'fill-low';
      const statusClass = c.status === 'CUSTOMER' ? 'badge-customer' : c.status === 'LEAD' ? 'badge-lead' : 'badge-neutral';

      return `
        <div class="company-card" onclick="window.CRMModule.openCompany360('${c.id}')">
          <div class="company-card-header">
            <div>
              <h3 class="company-card-title">${c.tradeName}</h3>
              <p class="company-card-subtitle">${c.legalName || c.entityType || 'Empresa'}</p>
            </div>
            <span class="badge ${statusClass}">${c.status}</span>
          </div>

          <div style="margin: 12px 0;">
            <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">
              <span>Ficha 360º Completa</span>
              <span><strong>${score}%</strong></span>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill ${fillClass}" style="width: ${score}%;"></div>
            </div>
          </div>

          <div class="company-meta-row">
            <span>NIF: <strong>${c.taxNumber || 'S/NIF'}</strong></span>
            <span>Contactos: <strong>${c._count?.contacts || 0}</strong></span>
            <span>Contratos: <strong>${c._count?.contracts || 0}</strong></span>
          </div>
        </div>
      `;
    }).join('');
  },

  async openCompany360(id) {
    try {
      const fetchFn = window.apiFetch || fetch;
      const res = await fetchFn(`/api/crm/companies/${id}`);
      const data = await res.json();
      if (data.success) {
        this.selectedCompany = data.company;
        this.render360Modal();
        const modal = document.getElementById('modal-company-360');
        if (modal) modal.classList.add('show');
      }
    } catch (err) {
      console.error('[OPEN 360 ERROR]', err);
    }
  },

  set360Tab(tab) {
    this.active360Tab = tab;
    this.render360Modal();
  },

  render360Modal() {
    const c = this.selectedCompany;
    if (!c) return;

    const modalBody = document.getElementById('company-360-body');
    const modalTitle = document.getElementById('company-360-title');
    if (modalTitle) modalTitle.innerText = `${c.tradeName} — Perfil 360º`;

    if (!modalBody) return;

    modalBody.innerHTML = `
      <!-- Tabs Header -->
      <div style="display: flex; gap: 4px; border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 16px; overflow-x: auto;">
        <button class="btn btn-sm ${this.active360Tab === 'overview' ? 'btn-primary' : ''}" onclick="window.CRMModule.set360Tab('overview')">Visão Geral</button>
        <button class="btn btn-sm ${this.active360Tab === 'contacts' ? 'btn-primary' : ''}" onclick="window.CRMModule.set360Tab('contacts')">Contactos (${c.contacts?.length || 0})</button>
        <button class="btn btn-sm ${this.active360Tab === 'contracts' ? 'btn-primary' : ''}" onclick="window.CRMModule.set360Tab('contracts')">Contratos (${c.contracts?.length || 0})</button>
        <button class="btn btn-sm ${this.active360Tab === 'documents' ? 'btn-primary' : ''}" onclick="window.CRMModule.set360Tab('documents')">Documentos (${c.documents?.length || 0})</button>
        <button class="btn btn-sm ${this.active360Tab === 'finance' ? 'btn-primary' : ''}" onclick="window.CRMModule.set360Tab('finance')">Finanças & Faturas (${c.transactions?.length || 0})</button>
      </div>

      <!-- Tab Content -->
      <div id="company-360-tab-content">
        ${this.renderTabContent(c)}
      </div>
    `;
  },

  renderTabContent(c) {
    if (this.active360Tab === 'overview') {
      return `
        <div class="form-grid">
          <div class="form-group">
            <span class="form-label">Nome Comercial</span>
            <div><strong>${c.tradeName}</strong></div>
          </div>
          <div class="form-group">
            <span class="form-label">Firma / Nome Jurídico</span>
            <div>${c.legalName || '-'}</div>
          </div>
          <div class="form-group">
            <span class="form-label">NIF / Número Fiscal</span>
            <div><strong>${c.taxNumber || '-'}</strong></div>
          </div>
          <div class="form-group">
            <span class="form-label">Estado</span>
            <div><span class="badge badge-customer">${c.status}</span></div>
          </div>
          <div class="form-group">
            <span class="form-label">Email Geral</span>
            <div>${c.email || '-'}</div>
          </div>
          <div class="form-group">
            <span class="form-label">Telefone</span>
            <div>${c.phone || '-'}</div>
          </div>
          <div class="form-group">
            <span class="form-label">Setor de Atividade</span>
            <div>${c.sector || '-'}</div>
          </div>
          <div class="form-group">
            <span class="form-label">Condições de Pagamento</span>
            <div>${c.paymentTermsDays || 30} dias (${c.paymentMethod || 'Transferência'})</div>
          </div>
          <div class="form-group col-span-2">
            <span class="form-label">Morada Principal</span>
            <div>${c.address || ''} ${c.postalCode || ''} ${c.city || ''} (${c.country || 'Portugal'})</div>
          </div>
        </div>
      `;
    }

    if (this.active360Tab === 'contacts') {
      return `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <span style="font-weight: 600; font-size: 13px;">Pessoas de Contacto</span>
          <button class="btn btn-sm btn-primary" onclick="window.CRMModule.openAddContactModal()">+ Adicionar Contacto</button>
        </div>
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Cargo / Dept</th>
                <th>Email</th>
                <th>Telefone</th>
                <th>Papel</th>
              </tr>
            </thead>
            <tbody>
              ${(c.contacts || []).map(contact => `
                <tr>
                  <td><strong>${contact.name}</strong> ${contact.isPrimary ? '<span class="badge badge-paid">Principal</span>' : ''}</td>
                  <td>${contact.role || '-'} ${contact.department ? `(${contact.department})` : ''}</td>
                  <td>${contact.email || '-'}</td>
                  <td>${contact.phone || contact.mobile || '-'}</td>
                  <td><span class="badge badge-neutral">${contact.decisionPower || 'Influenciador'}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    if (this.active360Tab === 'contracts') {
      return `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <span style="font-weight: 600; font-size: 13px;">Contratos & SLAs</span>
          <button class="btn btn-sm btn-primary" onclick="window.CRMModule.openAddContractModal()">+ Novo Contrato</button>
        </div>
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Nº Contrato</th>
                <th>Título</th>
                <th>Valor Mensal</th>
                <th>Início</th>
                <th>Fim</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${(c.contracts || []).map(contract => `
                <tr>
                  <td><strong>${contract.contractNumber}</strong></td>
                  <td>${contract.title}</td>
                  <td>${contract.monthlyValueCents ? (contract.monthlyValueCents/100).toFixed(2) + ' €' : '-'}</td>
                  <td>${new Date(contract.startDate).toLocaleDateString('pt-PT')}</td>
                  <td>${contract.endDate ? new Date(contract.endDate).toLocaleDateString('pt-PT') : 'Indeterminado'}</td>
                  <td><span class="badge badge-paid">${contract.status}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    if (this.active360Tab === 'documents') {
      return `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <span style="font-weight: 600; font-size: 13px;">Documentação da Empresa</span>
          <button class="btn btn-sm btn-primary">+ Carregar Documento</button>
        </div>
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Categoria</th>
                <th>Validade</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${(c.documents || []).map(doc => `
                <tr>
                  <td><strong>${doc.name}</strong></td>
                  <td><span class="badge badge-neutral">${doc.category}</span></td>
                  <td>${doc.expiresAt ? new Date(doc.expiresAt).toLocaleDateString('pt-PT') : 'Vitalício'}</td>
                  <td><a href="${doc.fileUrl}" target="_blank" class="btn btn-sm">Abrir</a></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    if (this.active360Tab === 'finance') {
      return `
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrição</th>
                <th>Valor</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${(c.transactions || []).map(tx => `
                <tr>
                  <td>${new Date(tx.dueDate).toLocaleDateString('pt-PT')}</td>
                  <td><strong>${tx.description}</strong></td>
                  <td style="font-weight: 700;">${(tx.amountCents/100).toFixed(2)} €</td>
                  <td><span class="badge ${tx.status === 'PAID' ? 'badge-paid' : 'badge-planned'}">${tx.status}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    return '';
  },

  openCreateModal() {
    const modal = document.getElementById('modal-create-company');
    if (modal) modal.classList.add('show');
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('show');
  },

  async submitCreateCompany(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);

    const payload = {
      tradeName: formData.get('tradeName'),
      legalName: formData.get('legalName') || null,
      taxNumber: formData.get('taxNumber') || null,
      status: formData.get('status') || 'LEAD',
      email: formData.get('email') || null,
      phone: formData.get('phone') || null,
      sector: formData.get('sector') || null,
      address: formData.get('address') || null,
      city: formData.get('city') || null
    };

    try {
      const fetchFn = window.apiFetch || fetch;
      const res = await fetchFn('/api/crm/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        this.closeModal('modal-create-company');
        form.reset();
        await this.init();
      } else {
        const err = await res.json();
        alert('Erro ao criar empresa: ' + (err.message || 'Verifique os dados.'));
      }
    } catch (err) {
      console.error('[SUBMIT COMPANY ERROR]', err);
    }
  }
};
