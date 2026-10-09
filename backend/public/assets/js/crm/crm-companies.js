/**
 * HELDERLABS ERP — CRM Companies Module (crm-companies.js) v1.6.1
 * Grelha de empresas, métricas agregadas, paginação no servidor e perfil 360º
 */
(function (window, document) {
  'use strict';

  const esc = window.CRMCore.esc;
  const escAttr = window.CRMCore.escAttr;
  const fmtCurrency = window.CRMCore.fmtCurrency;
  const fmtDate = window.CRMCore.fmtDate;

  const CRMCompanies = {
    companies: [],
    total: 0,
    nextCursor: null,
    cursorStack: [],
    currentCursor: null,
    selectedCompany: null,
    active360Tab: 'overview',
    pendingForcePayload: null,

    filters: {
      status: '',
      sector: '',
      search: '',
      limit: 20
    },

    async init() {
      await Promise.all([this.loadMetrics(), this.loadCompanies()]);
    },

    async loadMetrics() {
      const container = document.getElementById('crm-metrics-container');
      if (!container) return;

      const res = await window.CRMCore.api('/api/crm/companies/metrics');
      if (res.ok && res.data.metrics) {
        const m = res.data.metrics;
        container.innerHTML = `
          <div class="kpi-card">
            <div class="kpi-title">Total de Empresas</div>
            <div class="kpi-value primary">${esc(m.total)}</div>
            <div class="kpi-subtext">Registos ativos 360º</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-title">Clientes Ativos</div>
            <div class="kpi-value positive">${esc(m.customers)}</div>
            <div class="kpi-subtext">Relações comerciais estabelecidas</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-title">Leads & Prospetos</div>
            <div class="kpi-value warning">${esc(m.leads)}</div>
            <div class="kpi-subtext">Em qualificação ou proposta</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-title">Fornecedores & Parceiros</div>
            <div class="kpi-value">${esc(m.suppliers)}</div>
            <div class="kpi-subtext">Rede de canais e fornecedores</div>
          </div>
        `;
      }
    },

    async loadCompanies(cursor = null) {
      const container = document.getElementById('companies-grid-container');
      if (!container) return;

      container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--muted); padding: 32px;">A carregar empresas...</div>';

      const params = new URLSearchParams();
      if (this.filters.status) params.set('status', this.filters.status);
      if (this.filters.sector) params.set('sector', this.filters.sector);
      if (this.filters.search) params.set('search', this.filters.search);
      params.set('limit', String(this.filters.limit));
      if (cursor) params.set('cursor', cursor);

      const res = await window.CRMCore.api(`/api/crm/companies?${params.toString()}`);
      if (res.ok && res.data.companies) {
        this.companies = res.data.companies;
        this.total = res.data.total ?? this.companies.length;
        this.nextCursor = res.data.nextCursor ?? null;
        this.currentCursor = cursor;
        this.renderGrid();
      } else {
        container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--danger); padding: 32px;">Erro ao carregar empresas.</div>';
      }
    },

    renderGrid() {
      const container = document.getElementById('companies-grid-container');
      if (!container) return;

      if (!this.companies || this.companies.length === 0) {
        container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--muted); padding: 32px;">Nenhuma empresa encontrada com os filtros aplicados.</div>';
        return;
      }

      const cardsHtml = this.companies.map(c => {
        const score = Number(c.completenessPercent) || 30;
        const fillClass = score >= 80 ? 'fill-high' : score >= 50 ? 'fill-med' : 'fill-low';
        const statusClass = c.status === 'CUSTOMER' ? 'badge-customer' : c.status === 'LEAD' ? 'badge-lead' : 'badge-neutral';

        return `
          <div class="company-card" data-company-id="${escAttr(c.id)}">
            <div class="company-card-header">
              <div>
                <h3 class="company-card-title">${esc(c.tradeName)}</h3>
                <p class="company-card-subtitle">${esc(c.legalName || c.entityType || 'Empresa')}</p>
              </div>
              <span class="badge ${statusClass}">${esc(c.status)}</span>
            </div>

            <div style="margin: 12px 0;">
              <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">
                <span>Ficha 360º Completa</span>
                <span><strong>${esc(score)}%</strong></span>
              </div>
              <div class="progress-bar-bg">
                <div class="progress-bar-fill ${fillClass}" style="width: ${Math.min(100, Math.max(0, score))}%;"></div>
              </div>
            </div>

            <div class="company-meta-row">
              <span>NIF: <strong>${esc(c.taxNumber || 'S/NIF')}</strong></span>
              <span>Contactos: <strong>${esc(c._count?.contacts || 0)}</strong></span>
              <span>Contratos: <strong>${esc(c._count?.contracts || 0)}</strong></span>
            </div>
          </div>
        `;
      }).join('');

      // Paginação
      const hasNext = Boolean(this.nextCursor);
      const hasPrev = this.cursorStack.length > 0;
      const paginationHtml = `
        <div style="grid-column: 1/-1;" class="crm-pagination">
          <span style="font-size: 12px; color: var(--text-secondary);">
            Total: <strong>${esc(this.total)}</strong> empresas
          </span>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-sm" id="crm-page-prev" ${hasPrev ? '' : 'disabled'}>Anterior</button>
            <button class="btn btn-sm" id="crm-page-next" ${hasNext ? '' : 'disabled'}>Seguinte</button>
          </div>
        </div>
      `;

      container.innerHTML = cardsHtml + paginationHtml;

      // Event delegation para abrir ficha 360º
      container.querySelectorAll('.company-card').forEach(card => {
        card.addEventListener('click', () => {
          const id = card.getAttribute('data-company-id');
          if (id) this.openCompany360(id);
        });
      });

      // Handlers de paginação
      const prevBtn = document.getElementById('crm-page-prev');
      if (prevBtn && hasPrev) {
        prevBtn.addEventListener('click', () => {
          const prevCursor = this.cursorStack.pop();
          this.loadCompanies(prevCursor);
        });
      }
      const nextBtn = document.getElementById('crm-page-next');
      if (nextBtn && hasNext) {
        nextBtn.addEventListener('click', () => {
          this.cursorStack.push(this.currentCursor);
          this.loadCompanies(this.nextCursor);
        });
      }
    },

    async openCompany360(id) {
      const res = await window.CRMCore.api(`/api/crm/companies/${id}`);
      if (res.ok && res.data.company) {
        this.selectedCompany = res.data.company;
        this.render360Modal();
        const modal = document.getElementById('modal-company-360');
        if (modal) modal.classList.add('show');
      } else {
        alert(res.data.message || 'Erro ao carregar detalhes da empresa.');
      }
    },

    set360Tab(tab) {
      this.active360Tab = tab;
      this.render360Modal();
    },

    render360Modal() {
      const c = this.selectedCompany;
      if (!c) return;

      const modalTitle = document.getElementById('company-360-title');
      if (modalTitle) modalTitle.innerText = `${c.tradeName} — Perfil 360º`;

      const modalBody = document.getElementById('company-360-body');
      if (!modalBody) return;

      modalBody.innerHTML = `
        <div style="display: flex; gap: 4px; border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 16px; overflow-x: auto;">
          <button class="btn btn-sm ${this.active360Tab === 'overview' ? 'btn-primary' : ''}" onclick="window.CRMCompanies.set360Tab('overview')">Visão Geral</button>
          <button class="btn btn-sm ${this.active360Tab === 'activities' ? 'btn-primary' : ''}" onclick="window.CRMCompanies.set360Tab('activities')">Atividades & Histórico (${c.communications?.length || 0})</button>
          <button class="btn btn-sm ${this.active360Tab === 'opportunities' ? 'btn-primary' : ''}" onclick="window.CRMCompanies.set360Tab('opportunities')">Oportunidades (${c.opportunities?.length || 0})</button>
          <button class="btn btn-sm ${this.active360Tab === 'proposals' ? 'btn-primary' : ''}" onclick="window.CRMCompanies.set360Tab('proposals')">Orçamentos & Propostas (${c.proposals?.length || 0})</button>
          <button class="btn btn-sm ${this.active360Tab === 'contacts' ? 'btn-primary' : ''}" onclick="window.CRMCompanies.set360Tab('contacts')">Contactos (${c.contacts?.length || 0})</button>
          <button class="btn btn-sm ${this.active360Tab === 'contracts' ? 'btn-primary' : ''}" onclick="window.CRMCompanies.set360Tab('contracts')">Contratos (${c.contracts?.length || 0})</button>
          <button class="btn btn-sm ${this.active360Tab === 'documents' ? 'btn-primary' : ''}" onclick="window.CRMCompanies.set360Tab('documents')">Documentos (${c.documents?.length || 0})</button>
          <button class="btn btn-sm ${this.active360Tab === 'finance' ? 'btn-primary' : ''}" onclick="window.CRMCompanies.set360Tab('finance')">Finanças & Faturas (${c.transactions?.length || 0})</button>
        </div>
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
              <div><strong>${esc(c.tradeName)}</strong></div>
            </div>
            <div class="form-group">
              <span class="form-label">Firma / Nome Jurídico</span>
              <div>${esc(c.legalName || '—')}</div>
            </div>
            <div class="form-group">
              <span class="form-label">NIF / Número Fiscal</span>
              <div><strong>${esc(c.taxNumber || '—')}</strong></div>
            </div>
            <div class="form-group">
              <span class="form-label">Estado</span>
              <div><span class="badge badge-customer">${esc(c.status)}</span></div>
            </div>
            <div class="form-group">
              <span class="form-label">Email Geral</span>
              <div>${esc(c.email || '—')}</div>
            </div>
            <div class="form-group">
              <span class="form-label">Telefone</span>
              <div>${esc(c.phone || '—')}</div>
            </div>
            <div class="form-group">
              <span class="form-label">Setor de Atividade</span>
              <div>${esc(c.sector || '—')}</div>
            </div>
            <div class="form-group">
              <span class="form-label">Condições de Pagamento</span>
              <div>${esc(c.paymentTermsDays || 30)} dias (${esc(c.paymentMethod || 'Transferência')})</div>
            </div>
            <div class="form-group col-span-2">
              <span class="form-label">Morada Principal</span>
              <div>${esc(c.address || '')} ${esc(c.postalCode || '')} ${esc(c.city || '')} (${esc(c.country || 'Portugal')})</div>
            </div>
          </div>
        `;
      }

      if (this.active360Tab === 'contacts') {
        const contacts = c.contacts || [];
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <span style="font-weight: 600; font-size: 13px;">Pessoas de Contacto</span>
            <button class="btn btn-sm btn-primary" onclick="window.CRMContacts && window.CRMContacts.openAddModal('${escAttr(c.id)}')">+ Adicionar Contacto</button>
          </div>
          <div class="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Cargo / Dept</th>
                  <th>Email</th>
                  <th>Telefone</th>
                  <th>Poder de Decisão</th>
                </tr>
              </thead>
              <tbody>
                ${contacts.length === 0 ? '<tr><td colspan="5" style="text-align: center; color: var(--muted);">Sem contactos registados.</td></tr>' : contacts.map(ct => `
                  <tr>
                    <td><strong>${esc(ct.name)}</strong> ${ct.isPrimary ? '<span class="badge badge-paid">Principal</span>' : ''}</td>
                    <td>${esc(ct.role || '—')} ${ct.department ? `(${esc(ct.department)})` : ''}</td>
                    <td>${esc(ct.email || '—')}</td>
                    <td>${esc(ct.phone || ct.mobile || '—')}</td>
                    <td><span class="badge badge-neutral">${esc(ct.decisionPower || '—')}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      if (this.active360Tab === 'contracts') {
        const contracts = c.contracts || [];
        return `
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
                ${contracts.length === 0 ? '<tr><td colspan="6" style="text-align: center; color: var(--muted);">Sem contratos registados.</td></tr>' : contracts.map(ct => `
                  <tr>
                    <td><strong>${esc(ct.contractNumber)}</strong></td>
                    <td>${esc(ct.title)}</td>
                    <td>${fmtCurrency(ct.monthlyValueCents || ct.valueCents)}</td>
                    <td>${fmtDate(ct.startDate)}</td>
                    <td>${ct.endDate ? fmtDate(ct.endDate) : 'Indeterminado'}</td>
                    <td><span class="badge badge-paid">${esc(ct.status)}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      if (this.active360Tab === 'documents') {
        const docs = c.documents || [];
        return `
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
                ${docs.length === 0 ? '<tr><td colspan="4" style="text-align: center; color: var(--muted);">Sem documentos registados.</td></tr>' : docs.map(d => `
                  <tr>
                    <td><strong>${esc(d.name)}</strong></td>
                    <td><span class="badge badge-neutral">${esc(d.docType || d.category || 'OTHER')}</span></td>
                    <td>${d.expiryDate ? fmtDate(d.expiryDate) : 'Vitalício'}</td>
                    <td>${d.fileUrl ? `<a href="${escAttr(d.fileUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm">Abrir</a>` : '—'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      if (this.active360Tab === 'finance') {
        const txs = c.transactions || [];
        return `
          <div class="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Data Vencimento</th>
                  <th>Descrição</th>
                  <th>Valor</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                ${txs.length === 0 ? '<tr><td colspan="4" style="text-align: center; color: var(--muted);">Sem transações registadas.</td></tr>' : txs.map(tx => `
                  <tr>
                    <td>${fmtDate(tx.dueDate)}</td>
                    <td><strong>${esc(tx.description)}</strong></td>
                    <td style="font-weight: 700;">${fmtCurrency(tx.amountCents)}</td>
                    <td><span class="badge ${tx.status === 'PAID' ? 'badge-paid' : 'badge-planned'}">${esc(tx.status)}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      if (this.active360Tab === 'activities') {
        const comms = c.communications || [];
        const timelineHtml = window.CRMActivitiesModule
          ? window.CRMActivitiesModule.renderTimeline(comms, { companyId: c.id })
          : '<p style="color: var(--text-secondary); padding: 12px;">Histórico de atividades disponível.</p>';

        return `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;">
            <span style="font-size: 13px; color: var(--text-secondary);">Histórico cronológico de reuniões, chamadas, tarefas e notas</span>
            <button class="btn btn-primary btn-sm" onclick="window.CRMActivitiesModule.openCreateModal('${esc(c.id)}')">
              + Registar Atividade
            </button>
          </div>
          ${timelineHtml}
        `;
      }

      if (this.active360Tab === 'opportunities') {
        const opps = c.opportunities || [];
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;">
            <span style="font-size: 13px; color: var(--text-secondary);">Oportunidades e negócios em curso com esta empresa</span>
            <button class="btn btn-primary btn-sm" onclick="window.CRMPipelineModule.openCreateOpportunityModal('${esc(c.id)}')">
              + Nova Oportunidade
            </button>
          </div>
          <div class="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Título da Oportunidade</th>
                  <th>Estágio</th>
                  <th style="text-align: right;">Valor Estimado</th>
                  <th style="text-align: right;">Probabilidade</th>
                  <th>Data Prevista</th>
                </tr>
              </thead>
              <tbody>
                ${opps.length === 0 ? '<tr><td colspan="5" style="text-align: center; color: var(--muted); padding: 20px;">Sem oportunidades registadas para esta empresa.</td></tr>' : opps.map(opp => `
                  <tr>
                    <td><strong>${esc(opp.title)}</strong></td>
                    <td><span class="badge ${opp.stage === 'WON' ? 'badge-paid' : (opp.stage === 'LOST' ? 'badge-danger' : 'badge-planned')}">${esc(opp.stage)}</span></td>
                    <td style="text-align: right; font-weight: 700;">€${esc(opp.estimatedValue?.toLocaleString('pt-PT', { minimumFractionDigits: 2 }))}</td>
                    <td style="text-align: right;">${esc(opp.probability)}%</td>
                    <td>${fmtDate(opp.expectedCloseDate)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      if (this.active360Tab === 'proposals') {
        const props = c.proposals || [];
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;">
            <span style="font-size: 13px; color: var(--text-secondary);">Propostas comerciais e orçamentos emitidos para esta empresa</span>
            <button class="btn btn-primary btn-sm" onclick="window.CRMProposalsModule ? window.CRMProposalsModule.openCreateProposalModal('${esc(c.id)}') : null">
              + Nova Proposta / Orçamento
            </button>
          </div>
          <div class="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Nº Proposta</th>
                  <th>Título / Descrição</th>
                  <th>Data Emissão</th>
                  <th>Validade</th>
                  <th style="text-align: right;">Total Líquido</th>
                  <th>Estado</th>
                  <th style="text-align: right;">Ações</th>
                </tr>
              </thead>
              <tbody>
                ${props.length === 0 ? '<tr><td colspan="7" style="text-align: center; color: var(--muted); padding: 20px;">Sem propostas ou orçamentos registados para esta empresa.</td></tr>' : props.map(p => `
                  <tr>
                    <td><strong>${esc(p.proposalNumber)}</strong></td>
                    <td>${esc(p.title)}</td>
                    <td>${fmtDate(p.issueDate)}</td>
                    <td>${p.validUntil ? fmtDate(p.validUntil) : '—'}</td>
                    <td style="text-align: right; font-weight: 700;">${fmtCurrency(p.totalCents)}</td>
                    <td><span class="badge ${p.status === 'ACCEPTED' ? 'badge-paid' : (p.status === 'REJECTED' ? 'badge-danger' : 'badge-planned')}">${esc(p.status)}</span></td>
                    <td style="text-align: right;">
                      <a href="/api/crm/proposals/${escAttr(p.id)}/print" target="_blank" class="btn btn-sm" style="margin-right: 4px;">🖨️ PDF</a>
                      <button class="btn btn-sm btn-info" onclick="window.CRMProposalsModule ? window.CRMProposalsModule.openSendModal('${escAttr(p.id)}') : null">✉️ Enviar</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      return '';
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

      const errorBox = document.getElementById('company-create-error-box');
      if (errorBox) {
        errorBox.hidden = true;
        errorBox.innerHTML = '';
      }

      const res = await window.CRMCore.api('/api/crm/companies', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        window.CRMModule.closeModal('modal-create-company');
        form.reset();
        await this.init();
      } else if (res.status === 409) {
        // Deteção de duplicados com 409
        this.pendingForcePayload = payload;
        const existingId = res.data.existingCompanyId;
        if (errorBox) {
          errorBox.hidden = false;
          errorBox.innerHTML = `
            <div class="duplicate-alert">
              <strong>Atenção:</strong> Já existe uma empresa registada com este NIF ou email.
              <div class="duplicate-alert-actions">
                ${existingId ? `<button type="button" class="btn btn-sm btn-primary" onclick="window.CRMCompanies.openExistingDuplicate('${escAttr(existingId)}')">Abrir existente</button>` : ''}
                <button type="button" class="btn btn-sm btn-danger" onclick="window.CRMCompanies.confirmForceCreate()">Criar mesmo assim</button>
              </div>
            </div>
          `;
        }
      } else {
        alert(res.data.message || 'Erro ao criar empresa.');
      }
    },

    openExistingDuplicate(existingId) {
      window.CRMModule.closeModal('modal-create-company');
      this.openCompany360(existingId);
    },

    async confirmForceCreate() {
      if (!this.pendingForcePayload) return;
      const payload = { ...this.pendingForcePayload, force: true };

      const res = await window.CRMCore.api('/api/crm/companies', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        window.CRMModule.closeModal('modal-create-company');
        this.pendingForcePayload = null;
        await this.init();
      } else {
        alert(res.data.message || 'Erro ao forçar criação de empresa.');
      }
    }
  };

  window.CRMCompanies = CRMCompanies;
})(window, document);
