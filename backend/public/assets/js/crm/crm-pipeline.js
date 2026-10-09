/**
 * CRM Pipeline & Funil de Vendas Kanban (Fase B2)
 * HelderLabs ERP — Interface moderna, segura (XSS-free) e reativa.
 */

(function () {
  'use strict';

  const esc = (s) => (window.CRMModule && window.CRMModule.esc ? window.CRMModule.esc(s) : String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  const formatCurrency = (centsOrUnits) => {
    const val = Number(centsOrUnits) || 0;
    return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(val);
  };
  const formatDate = (d) => {
    if (!d) return '';
    try {
      return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d));
    } catch {
      return '';
    }
  };

  const STAGE_LABELS = {
    QUALIFICATION: 'Qualificação',
    PROPOSAL: 'Proposta Apresentada',
    NEGOTIATION: 'Negociação & Fecho',
    WON: 'Ganho / Fechado',
    LOST: 'Perdido'
  };

  const STAGE_COLORS = {
    QUALIFICATION: '#3b82f6',
    PROPOSAL: '#8b5cf6',
    NEGOTIATION: '#f59e0b',
    WON: '#10b981',
    LOST: '#ef4444'
  };

  const CRMPipelineModule = {
    kanbanData: null,
    currentFilterUser: '',
    selectedOpportunityIdForLost: null,

    async init() {
      await this.loadKanban();
    },

    async loadKanban(assignedUserId) {
      if (assignedUserId !== undefined) {
        this.currentFilterUser = assignedUserId;
      }
      const container = document.getElementById('crm-pipeline-container');
      if (!container) return;

      container.innerHTML = `
        <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
          <div class="spinner" style="margin: 0 auto 12px auto;"></div>
          <span>A carregar pipeline comercial e métricas ponderadas...</span>
        </div>
      `;

      try {
        let url = '/api/crm/pipeline';
        if (this.currentFilterUser) {
          url += `?assignedUserId=${encodeURIComponent(this.currentFilterUser)}`;
        }
        const token = localStorage.getItem('token') || localStorage.getItem('auth_token');
        const res = await fetch(url, {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          }
        });

        if (!res.ok) {
          throw new Error(`Falha ao obter pipeline (${res.status})`);
        }

        this.kanbanData = await res.json();
        this.renderKanban();
      } catch (err) {
        console.error('Erro ao carregar kanban:', err);
        container.innerHTML = `
          <div class="alert alert-danger" style="margin: 20px;">
            Não foi possível carregar o pipeline comercial: ${esc(err.message)}
          </div>
        `;
      }
    },

    renderKanban() {
      const container = document.getElementById('crm-pipeline-container');
      if (!container || !this.kanbanData) return;

      const { columns, summary } = this.kanbanData;

      // 1. KPIs do Pipeline no Topo
      const summaryHtml = `
        <div class="kpi-grid" style="margin-bottom: 24px;">
          <div class="kpi-card">
            <span class="kpi-label">Pipeline Global</span>
            <div class="kpi-value">${esc(formatCurrency(summary.totalPipelineValue))}</div>
            <span class="kpi-subtext">${esc(summary.totalOpportunities)} oportunidades ativas</span>
          </div>
          <div class="kpi-card" style="border-left: 4px solid #8b5cf6;">
            <span class="kpi-label">Receita Ponderada (Forecast)</span>
            <div class="kpi-value" style="color: #8b5cf6;">${esc(formatCurrency(summary.totalWeightedValue))}</div>
            <span class="kpi-subtext">Ajustado pela probabilidade do estágio</span>
          </div>
          <div class="kpi-card" style="border-left: 4px solid #10b981;">
            <span class="kpi-label">Receita Ganha</span>
            <div class="kpi-value" style="color: #10b981;">${esc(formatCurrency(summary.wonValue))}</div>
            <span class="kpi-subtext">${esc(summary.wonCount)} negócios fechados</span>
          </div>
          <div class="kpi-card" style="border-left: 4px solid #f59e0b;">
            <span class="kpi-label">Taxa de Conversão</span>
            <div class="kpi-value">${esc(summary.conversionRate)}%</div>
            <span class="kpi-subtext">${esc(summary.wonCount)} ganhas / ${esc(summary.lostCount)} perdidas</span>
          </div>
        </div>
      `;

      // 2. Colunas do Kanban
      const stageKeys = ['QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'];
      const columnsHtml = `
        <div class="kanban-board">
          ${stageKeys.map(key => {
            const col = columns[key] || {
              stage: key,
              label: STAGE_LABELS[key] || key,
              count: 0,
              totalValue: 0,
              weightedValue: 0,
              opportunities: []
            };

            const headerColor = STAGE_COLORS[key] || 'var(--text-primary)';

            return `
              <div class="kanban-column" data-stage="${esc(key)}">
                <div class="kanban-column-header" style="border-top: 3px solid ${esc(headerColor)};">
                  <div class="kanban-column-title-row">
                    <span class="kanban-column-title">${esc(col.label)}</span>
                    <span class="kanban-badge">${esc(col.count)}</span>
                  </div>
                  <div class="kanban-column-metrics">
                    <span>${esc(formatCurrency(col.totalValue))}</span>
                    ${key !== 'LOST' && key !== 'WON' ? `<span style="font-size: 11px; opacity: 0.8;">Pond: ${esc(formatCurrency(col.weightedValue))}</span>` : ''}
                  </div>
                </div>

                <div class="kanban-cards-list" data-stage="${esc(key)}">
                  ${col.opportunities.map(opp => this.renderOpportunityCard(opp)).join('')}
                  ${col.opportunities.length === 0 ? `<div class="kanban-empty-hint">Sem oportunidades</div>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;

      container.innerHTML = summaryHtml + columnsHtml;
    },

    renderOpportunityCard(opp) {
      const companyName = opp.company?.tradeName || opp.lead?.company || 'Sem Empresa';
      const contactName = opp.contact?.name || opp.lead?.name || '';
      const closeDateStr = opp.expectedCloseDate ? formatDate(opp.expectedCloseDate) : '';

      return `
        <div class="kanban-card" data-opportunity-id="${esc(opp.id)}">
          <div class="kanban-card-header">
            <span class="kanban-card-title">${esc(opp.title)}</span>
            <span class="kanban-prob-badge" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6;">${esc(opp.probability)}%</span>
          </div>

          <div class="kanban-card-company">
            <strong>${esc(companyName)}</strong>
            ${contactName ? `<span class="kanban-card-contact">· ${esc(contactName)}</span>` : ''}
          </div>

          <div class="kanban-card-values">
            <span class="kanban-card-val-total">${esc(formatCurrency(opp.estimatedValue))}</span>
            ${opp.stage !== 'LOST' && opp.stage !== 'WON' ? `<span class="kanban-card-val-weighted">Pond: ${esc(formatCurrency(opp.estimatedValue * (opp.probability / 100)))}</span>` : ''}
          </div>

          ${opp.stage === 'LOST' && opp.lostReason ? `
            <div class="kanban-lost-reason">
              Motivo: <em>${esc(opp.lostReason)}</em>
            </div>
          ` : ''}

          ${closeDateStr ? `
            <div class="kanban-card-date">
              📅 Fecho previsto: ${esc(closeDateStr)}
            </div>
          ` : ''}

          <!-- Controles de Transição de Estágio -->
          <div class="kanban-card-actions">
            <select class="kanban-stage-select" onchange="window.CRMPipelineModule.onStageSelectChange('${esc(opp.id)}', this.value)">
              <option value="QUALIFICATION" ${opp.stage === 'QUALIFICATION' ? 'selected' : ''}>Qualificação (20%)</option>
              <option value="PROPOSAL" ${opp.stage === 'PROPOSAL' ? 'selected' : ''}>Proposta (50%)</option>
              <option value="NEGOTIATION" ${opp.stage === 'NEGOTIATION' ? 'selected' : ''}>Negociação (80%)</option>
              <option value="WON" ${opp.stage === 'WON' ? 'selected' : ''}>Ganho (100%)</option>
              <option value="LOST" ${opp.stage === 'LOST' ? 'selected' : ''}>Perdido</option>
            </select>
          </div>
        </div>
      `;
    },

    async onStageSelectChange(opportunityId, nextStage) {
      if (nextStage === 'LOST') {
        this.openDeclareLostModal(opportunityId);
        return;
      }
      await this.moveStage(opportunityId, nextStage);
    },

    async moveStage(opportunityId, nextStage, metadata = {}) {
      try {
        const token = localStorage.getItem('token') || localStorage.getItem('auth_token');
        const res = await fetch(`/api/crm/opportunities/${encodeURIComponent(opportunityId)}/stage`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            stage: nextStage,
            ...metadata
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Erro ao mudar estágio da oportunidade');
        }

        await this.loadKanban();

        if (window.CRMModule && window.CRMModule.renderCompaniesGrid) {
          window.CRMModule.renderCompaniesGrid();
        }
      } catch (err) {
        alert(`Erro ao atualizar estágio: ${err.message}`);
        await this.loadKanban();
      }
    },

    openCreateOpportunityModal(companyId = null) {
      const modal = document.getElementById('modal-create-opportunity');
      if (!modal) return;

      const form = modal.querySelector('form');
      if (form) {
        form.reset();
        if (companyId) {
          const companySelect = form.querySelector('[name="companyId"]');
          if (companySelect) companySelect.value = companyId;
        }
      }

      this.populateCompanyOptions();
      modal.classList.add('active');
    },

    populateCompanyOptions() {
      const select = document.getElementById('opp-company-select');
      if (!select || !window.CRMModule || !window.CRMModule.companiesCache) return;

      const companies = window.CRMModule.companiesCache || [];
      const opts = companies.map(c => `<option value="${esc(c.id)}">${esc(c.tradeName)} (${esc(c.taxNumber || 'S/NIF')})</option>`).join('');
      select.innerHTML = '<option value="">-- Nenhuma / Prospeto Avulso --</option>' + opts;
    },

    async submitCreateOpportunity(event) {
      event.preventDefault();
      const form = event.target;
      const formData = new FormData(form);

      const payload = {
        title: formData.get('title'),
        estimatedValue: Number(formData.get('estimatedValue')) || 0,
        stage: formData.get('stage') || 'QUALIFICATION',
        probability: formData.get('probability') ? Number(formData.get('probability')) : undefined,
        companyId: formData.get('companyId') || undefined,
        expectedCloseDate: formData.get('expectedCloseDate') || undefined,
        notes: formData.get('notes') || undefined
      };

      try {
        const token = localStorage.getItem('token') || localStorage.getItem('auth_token');
        const res = await fetch('/api/crm/opportunities', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Erro ao criar oportunidade');
        }

        this.closeModal('modal-create-opportunity');
        await this.loadKanban();
      } catch (err) {
        alert(`Erro: ${err.message}`);
      }
    },

    openDeclareLostModal(opportunityId) {
      this.selectedOpportunityIdForLost = opportunityId;
      const modal = document.getElementById('modal-declare-lost');
      if (!modal) return;
      const input = document.getElementById('lost-reason-input');
      if (input) input.value = '';
      modal.classList.add('active');
    },

    async submitDeclareLost(event) {
      event.preventDefault();
      const reason = document.getElementById('lost-reason-input')?.value || 'Não especificado';
      if (!this.selectedOpportunityIdForLost) return;

      const oppId = this.selectedOpportunityIdForLost;
      this.closeModal('modal-declare-lost');
      await this.moveStage(oppId, 'LOST', { lostReason: reason });
      this.selectedOpportunityIdForLost = null;
    },

    closeModal(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) modal.classList.remove('active');
    }
  };

  window.CRMPipelineModule = CRMPipelineModule;
})();
