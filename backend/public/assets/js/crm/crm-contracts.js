/**
 * HELDERLABS ERP — CRM Contracts & Retainers Module (crm-contracts.js) v1.6.5
 * Gestão de Contratos de Avença, SLA, Previsão de MRR/ARR e Renovações Automáticas
 * 
 * Salvaguarda Legal Inviolável:
 * "Resumo de Contrato Comercial de Prestação de Serviços / Avença. Não serve de fatura nem de documento de quitação fiscal."
 */
(function (window, document) {
  'use strict';

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escAttr(str) {
    return esc(str);
  }

  function fmtEur(cents) {
    if (cents === null || cents === undefined || isNaN(cents)) return '€0,00';
    return `€${(Number(cents) / 100).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function formatDate(d) {
    if (!d) return '—';
    try {
      const dt = new Date(d);
      return dt.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (_) {
      return String(d);
    }
  }

  const STATUS_CONFIG = {
    ACTIVE: { label: 'Ativo', style: 'background: #dcfce7; color: #15803d;' },
    PENDING_SIGNATURE: { label: 'Aguarda Assinatura', style: 'background: #fef3c7; color: #b45309;' },
    EXPIRED: { label: 'Expirado', style: 'background: #fee2e2; color: #991b1b;' },
    SUSPENDED: { label: 'Suspenso', style: 'background: #e0f2fe; color: #0369a1;' },
    CANCELLED: { label: 'Cancelado / Rescindido', style: 'background: #f1f5f9; color: #64748b;' }
  };

  const SLA_CONFIG = {
    STANDARD: { label: 'Standard', color: '#64748b' },
    BRONZE: { label: 'Bronze', color: '#cd7f32' },
    SILVER: { label: 'Silver', color: '#94a3b8' },
    GOLD: { label: 'Gold', color: '#d97706' },
    PLATINUM: { label: 'Platinum', color: '#7c3aed' },
    CUSTOM: { label: 'Custom', color: '#2563eb' }
  };

  window.CRMContractsModule = {
    contracts: [],
    kpis: {
      totalCount: 0,
      activeCount: 0,
      mrrCents: 0,
      arrCents: 0,
      expiringIn30Days: 0,
      pendingSignatureCount: 0
    },
    currentFilter: {
      status: '',
      expiringDays: '',
      search: '',
      companyId: ''
    },
    companiesList: [],
    activeContractActionId: null,

    async init() {
      await Promise.all([
        this.loadContracts(),
        this.loadCompaniesForSelect()
      ]);
      this.renderView();
    },

    async loadCompaniesForSelect() {
      try {
        const res = await window.apiFetch('/api/crm/companies?limit=100');
        if (res.ok) {
          const data = await res.json();
          this.companiesList = data.items || [];
        }
      } catch (e) {
        console.warn('Erro ao carregar lista de empresas:', e);
      }
    },

    async loadContracts() {
      try {
        const params = new URLSearchParams();
        if (this.currentFilter.status) params.append('status', this.currentFilter.status);
        if (this.currentFilter.companyId) params.append('companyId', this.currentFilter.companyId);
        if (this.currentFilter.expiringDays) params.append('expiringDays', this.currentFilter.expiringDays);

        const qs = params.toString() ? `?${params.toString()}` : '';
        const res = await window.apiFetch(`/api/crm/contracts${qs}`);
        if (res.ok) {
          const data = await res.json();
          this.contracts = data.items || data.contracts || [];
          if (data.kpis) {
            this.kpis = data.kpis;
          } else {
            this.computeLocalKPIs(this.contracts);
          }
        }
      } catch (e) {
        console.error('Erro ao carregar contratos:', e);
      }
    },

    computeLocalKPIs(list) {
      let activeCount = 0;
      let mrrCents = 0;
      let expiringIn30Days = 0;
      let pendingSignatureCount = 0;

      const now = new Date();
      const in30Days = new Date();
      in30Days.setDate(now.getDate() + 30);

      list.forEach((c) => {
        if (c.status === 'ACTIVE') {
          activeCount += 1;
          mrrCents += c.monthlyValueCents || 0;
          if (c.endDate && !c.isIndefinite && new Date(c.endDate) >= now && new Date(c.endDate) <= in30Days) {
            expiringIn30Days += 1;
          }
        } else if (c.status === 'PENDING_SIGNATURE') {
          pendingSignatureCount += 1;
        }
      });

      this.kpis = {
        totalCount: list.length,
        activeCount,
        mrrCents,
        arrCents: mrrCents * 12,
        expiringIn30Days,
        pendingSignatureCount
      };
    },

    renderView() {
      const container = document.getElementById('crm-view-contracts');
      if (!container) return;

      const filtered = this.contracts.filter((c) => {
        if (!this.currentFilter.search) return true;
        const q = this.currentFilter.search.toLowerCase();
        return (
          (c.contractNumber && c.contractNumber.toLowerCase().includes(q)) ||
          (c.title && c.title.toLowerCase().includes(q)) ||
          (c.company?.tradeName && c.company.tradeName.toLowerCase().includes(q))
        );
      });

      container.innerHTML = `
        <div class="kpi-grid" style="grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); margin-bottom: 20px;">
          <div class="card kpi-card">
            <span class="kpi-label">Receita Recorrente Mensal (MRR)</span>
            <span class="kpi-value" style="color: #2563eb;">${fmtEur(this.kpis.mrrCents)}</span>
            <span style="font-size: 11px; color: var(--muted);">${this.kpis.activeCount} contrato(s) ativo(s)</span>
          </div>
          <div class="card kpi-card">
            <span class="kpi-label">Receita Anual Contratada (ARR)</span>
            <span class="kpi-value" style="color: #059669;">${fmtEur(this.kpis.arrCents)}</span>
            <span style="font-size: 11px; color: var(--muted);">Previsão de faturação anual</span>
          </div>
          <div class="card kpi-card">
            <span class="kpi-label">A Expirar nos Próximos 30 Dias</span>
            <span class="kpi-value" style="color: ${this.kpis.expiringIn30Days > 0 ? '#dc2626' : '#64748b'};">${this.kpis.expiringIn30Days}</span>
            <span style="font-size: 11px; color: ${this.kpis.expiringIn30Days > 0 ? '#dc2626' : 'var(--muted)'};">
              ${this.kpis.expiringIn30Days > 0 ? '⚠️ Requer atenção ou renovação' : 'Nenhuma expiração iminente'}
            </span>
          </div>
          <div class="card kpi-card">
            <span class="kpi-label">Aguardam Assinatura</span>
            <span class="kpi-value" style="color: #d97706;">${this.kpis.pendingSignatureCount}</span>
            <span style="font-size: 11px; color: var(--muted);">Em formalização</span>
          </div>
        </div>

        <div class="card" style="margin-bottom: 16px; padding: 16px;">
          <div style="display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap;">
            <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
              <input
                type="text"
                class="form-control"
                placeholder="Pesquisar por nº, título, empresa..."
                value="${escAttr(this.currentFilter.search)}"
                style="max-width: 250px;"
                oninput="window.CRMContractsModule.setSearchFilter(this.value)"
              />
              <select class="form-control" style="max-width: 170px;" onchange="window.CRMContractsModule.setStatusFilter(this.value)">
                <option value="" ${this.currentFilter.status === '' ? 'selected' : ''}>Todos os Estados</option>
                <option value="ACTIVE" ${this.currentFilter.status === 'ACTIVE' ? 'selected' : ''}>Ativos</option>
                <option value="PENDING_SIGNATURE" ${this.currentFilter.status === 'PENDING_SIGNATURE' ? 'selected' : ''}>Aguarda Assinatura</option>
                <option value="EXPIRED" ${this.currentFilter.status === 'EXPIRED' ? 'selected' : ''}>Expirados</option>
                <option value="CANCELLED" ${this.currentFilter.status === 'CANCELLED' ? 'selected' : ''}>Cancelados</option>
              </select>
              <select class="form-control" style="max-width: 170px;" onchange="window.CRMContractsModule.setExpiringFilter(this.value)">
                <option value="" ${this.currentFilter.expiringDays === '' ? 'selected' : ''}>Todas as Validades</option>
                <option value="30" ${this.currentFilter.expiringDays === '30' ? 'selected' : ''}>Expira em 30 dias</option>
                <option value="60" ${this.currentFilter.expiringDays === '60' ? 'selected' : ''}>Expira em 60 dias</option>
                <option value="90" ${this.currentFilter.expiringDays === '90' ? 'selected' : ''}>Expira em 90 dias</option>
              </select>
            </div>
            <button class="btn btn-primary" onclick="window.CRMContractsModule.openCreateContractModal()">
              + Novo Contrato de Avença
            </button>
          </div>
        </div>

        <div class="card" style="padding: 0; overflow: hidden;">
          <div class="table-responsive">
            <table class="table" style="margin-bottom: 0;">
              <thead>
                <tr>
                  <th>Nº Contrato</th>
                  <th>Título & Empresa</th>
                  <th style="text-align: right;">Valor MRR</th>
                  <th>SLA</th>
                  <th>Vigência & Prazos</th>
                  <th>Renovação</th>
                  <th>Estado</th>
                  <th style="text-align: right;">Ações</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.length === 0 ? `
                  <tr>
                    <td colspan="8" style="text-align: center; padding: 36px; color: var(--muted);">
                      Nenhum contrato de avença ou SLA encontrado com os filtros selecionados.
                    </td>
                  </tr>
                ` : filtered.map(c => {
                  const cfg = STATUS_CONFIG[c.status] || STATUS_CONFIG.ACTIVE;
                  const sla = SLA_CONFIG[c.slaLevel] || SLA_CONFIG.STANDARD;
                  const isExpiring = c.isExpiringSoon;

                  return `
                    <tr style="${isExpiring ? 'background: #fffdf5;' : ''}">
                      <td>
                        <strong style="color: var(--primary);">${esc(c.contractNumber)}</strong>
                      </td>
                      <td>
                        <div style="font-weight: 600;">${esc(c.title)}</div>
                        <div style="font-size: 12px; color: var(--muted);">
                          ${c.company ? `
                            <a href="javascript:void(0)" onclick="window.CRMModule.openCompany360('${escAttr(c.company.id)}')" style="color: var(--text-secondary);">
                              🏢 ${esc(c.company.tradeName)}
                            </a>
                          ` : '—'}
                          ${c.proposal ? ` • <span title="Gerado a partir da Proposta ${escAttr(c.proposal.proposalNumber)}">📋 Proposta vinculada</span>` : ''}
                        </div>
                      </td>
                      <td style="text-align: right; white-space: nowrap;">
                        <strong style="font-size: 14px; color: #0f172a;">${fmtEur(c.monthlyValueCents)}</strong>
                        <div style="font-size: 11px; color: var(--muted);">${esc(c.billingFrequency)}</div>
                      </td>
                      <td>
                        <span class="badge" style="border: 1px solid ${sla.color}; color: ${sla.color}; background: rgba(0,0,0,0.02);">
                          ${sla.label}
                        </span>
                        ${c.slaResponseHours ? `<div style="font-size: 11px; color: var(--muted); margin-top: 2px;">Resp: ${c.slaResponseHours}h</div>` : ''}
                      </td>
                      <td>
                        <div>${formatDate(c.startDate)} até ${c.isIndefinite ? '<span style="color: #2563eb; font-weight: 600;">Indeterminado</span>' : formatDate(c.endDate)}</div>
                        ${isExpiring ? `
                          <div style="font-size: 11px; color: #dc2626; font-weight: 600; margin-top: 2px;">
                            ⚠️ Expira em ${c.daysUntilEnd} dia(s)
                          </div>
                        ` : ''}
                      </td>
                      <td>
                        ${c.autoRenew ? `
                          <span style="color: #059669; font-weight: 600; font-size: 12px;">✓ Auto (${c.renewalNoticeDays}d)</span>
                        ` : '<span style="color: var(--muted); font-size: 12px;">Manual</span>'}
                      </td>
                      <td>
                        <span class="badge" style="${cfg.style}">${cfg.label}</span>
                      </td>
                      <td style="text-align: right; white-space: nowrap;">
                        <a href="/api/crm/contracts/${escAttr(c.id)}/summary" target="_blank" class="btn btn-sm" title="Imprimir Resumo de Contrato" style="margin-right: 4px;">
                          📄 Resumo
                        </a>
                        ${c.status === 'ACTIVE' ? `
                          <button class="btn btn-sm btn-info" onclick="window.CRMContractsModule.openRenewModal('${escAttr(c.id)}')" title="Renovar Contrato" style="margin-right: 4px;">
                            🔄 Renovar
                          </button>
                          <button class="btn btn-sm btn-danger" onclick="window.CRMContractsModule.openTerminateModal('${escAttr(c.id)}')" title="Rescindir ou Cancelar Contrato" style="margin-right: 4px;">
                            ✕ Rescindir
                          </button>
                        ` : ''}
                        <button class="btn btn-sm btn-neutral" onclick="window.CRMContractsModule.deleteContract('${escAttr(c.id)}')" title="Eliminar Contrato">
                          🗑️
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    },

    setSearchFilter(val) {
      this.currentFilter.search = val;
      this.renderView();
    },

    async setStatusFilter(val) {
      this.currentFilter.status = val;
      await this.loadContracts();
      this.renderView();
    },

    async setExpiringFilter(val) {
      this.currentFilter.expiringDays = val;
      await this.loadContracts();
      this.renderView();
    },

    openCreateContractModal(prefillCompanyId, prefillProposalId) {
      const modal = document.getElementById('modal-create-contract');
      if (!modal) return;

      const form = document.getElementById('form-create-contract');
      if (form) form.reset();

      const compSelect = document.getElementById('contract-create-company');
      if (compSelect) {
        compSelect.innerHTML = '<option value="">Selecione a Empresa / Cliente...</option>' +
          this.companiesList.map(c => `<option value="${escAttr(c.id)}" ${prefillCompanyId === c.id ? 'selected' : ''}>${esc(c.tradeName)} (${esc(c.taxNumber || 'Sem NIF')})</option>`).join('');
      }

      const propInput = document.getElementById('contract-create-proposal-id');
      if (propInput) propInput.value = prefillProposalId || '';

      const isIndefiniteCheckbox = document.getElementById('contract-create-indefinite');
      const endDateInput = document.getElementById('contract-create-end-date');
      if (isIndefiniteCheckbox && endDateInput) {
        endDateInput.disabled = isIndefiniteCheckbox.checked;
      }

      this.recalculateMRRPreview();

      modal.classList.add('active');
      modal.classList.add('show');
    },

    closeCreateModal() {
      const modal = document.getElementById('modal-create-contract');
      if (modal) {
        modal.classList.remove('active');
        modal.classList.remove('show');
      }
    },

    recalculateMRRPreview() {
      const valueInput = document.getElementById('contract-create-value');
      const freqSelect = document.getElementById('contract-create-frequency');
      const mrrPreview = document.getElementById('contract-preview-mrr');

      const val = parseFloat(valueInput?.value || '0');
      const freq = freqSelect?.value || 'MONTHLY';

      let mrr = 0;
      if (freq === 'MONTHLY') mrr = val;
      else if (freq === 'QUARTERLY') mrr = val / 3;
      else if (freq === 'SEMIANNUAL') mrr = val / 6;
      else if (freq === 'ANNUAL') mrr = val / 12;
      else mrr = 0;

      if (mrrPreview) {
        mrrPreview.innerText = `€${mrr.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / mês`;
      }
    },

    async submitCreateContract(event) {
      event.preventDefault();
      const form = event.target;
      const errorBox = document.getElementById('contract-create-error-box');
      if (errorBox) errorBox.hidden = true;

      const isIndefinite = form.isIndefinite.checked;
      const valEur = parseFloat(form.valueEur.value) || 0;

      const payload = {
        companyId: form.companyId.value,
        proposalId: form.proposalId.value || undefined,
        title: form.title.value.trim(),
        billingFrequency: form.billingFrequency.value,
        valueCents: Math.round(valEur * 100),
        startDate: form.startDate.value,
        endDate: isIndefinite ? null : (form.endDate.value || null),
        isIndefinite,
        autoRenew: form.autoRenew.checked,
        renewalNoticeDays: parseInt(form.renewalNoticeDays.value, 10) || 30,
        slaLevel: form.slaLevel.value,
        slaResponseHours: form.slaResponseHours.value ? parseInt(form.slaResponseHours.value, 10) : undefined,
        slaResolutionHours: form.slaResolutionHours.value ? parseInt(form.slaResolutionHours.value, 10) : undefined,
        termsAndConditions: form.termsAndConditions.value.trim() || undefined,
        notes: form.notes.value.trim() || undefined
      };

      try {
        const res = await window.apiFetch('/api/crm/contracts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || err.message || 'Falha ao criar contrato de avença.');
        }

        this.closeCreateModal();
        await this.loadContracts();
        this.renderView();

        if (window.showToast) window.showToast('Contrato de avença criado com sucesso!', 'success');
      } catch (e) {
        if (errorBox) {
          errorBox.innerText = e.message;
          errorBox.hidden = false;
        } else {
          alert(e.message);
        }
      }
    },

    openRenewModal(id) {
      const contract = this.contracts.find(c => c.id === id);
      if (!contract) return;

      this.activeContractActionId = id;
      const modal = document.getElementById('modal-renew-contract');
      if (!modal) return;

      const titleEl = document.getElementById('renew-contract-title');
      const errBox = document.getElementById('renew-contract-error-box');

      if (errBox) errBox.hidden = true;
      if (titleEl) titleEl.innerText = `${contract.contractNumber} — ${contract.title}`;

      const currMRREl = document.getElementById('renew-contract-current-mrr');
      if (currMRREl) currMRREl.innerText = fmtEur(contract.monthlyValueCents);

      modal.classList.add('active');
      modal.classList.add('show');
    },

    closeRenewModal() {
      const modal = document.getElementById('modal-renew-contract');
      if (modal) {
        modal.classList.remove('active');
        modal.classList.remove('show');
      }
    },

    async submitRenewContract(event) {
      event.preventDefault();
      if (!this.activeContractActionId) return;

      const form = event.target;
      const errorBox = document.getElementById('renew-contract-error-box');
      if (errorBox) errorBox.hidden = true;

      const payload = {
        extensionMonths: parseInt(form.extensionMonths.value, 10) || 12,
        adjustmentPercent: parseFloat(form.adjustmentPercent.value) || 0,
        notes: form.notes.value.trim() || undefined
      };

      try {
        const res = await window.apiFetch(`/api/crm/contracts/${this.activeContractActionId}/renew`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || err.message || 'Falha ao renovar contrato.');
        }

        this.closeRenewModal();
        await this.loadContracts();
        this.renderView();

        if (window.showToast) window.showToast('Contrato renovado com sucesso!', 'success');
      } catch (e) {
        if (errorBox) {
          errorBox.innerText = e.message;
          errorBox.hidden = false;
        } else {
          alert(e.message);
        }
      }
    },

    openTerminateModal(id) {
      const contract = this.contracts.find(c => c.id === id);
      if (!contract) return;

      this.activeContractActionId = id;
      const modal = document.getElementById('modal-terminate-contract');
      if (!modal) return;

      const titleEl = document.getElementById('terminate-contract-title');
      const errBox = document.getElementById('terminate-contract-error-box');

      if (errBox) errBox.hidden = true;
      if (titleEl) titleEl.innerText = `${contract.contractNumber} — ${contract.title}`;

      modal.classList.add('active');
      modal.classList.add('show');
    },

    closeTerminateModal() {
      const modal = document.getElementById('modal-terminate-contract');
      if (modal) {
        modal.classList.remove('active');
        modal.classList.remove('show');
      }
    },

    async submitTerminateContract(event) {
      event.preventDefault();
      if (!this.activeContractActionId) return;

      const form = event.target;
      const errorBox = document.getElementById('terminate-contract-error-box');
      if (errorBox) errorBox.hidden = true;

      const reason = form.reason.value.trim();
      const cancelledAt = form.cancelledAt.value || undefined;

      try {
        const res = await window.apiFetch(`/api/crm/contracts/${this.activeContractActionId}/terminate`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason, cancelledAt })
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || err.message || 'Falha ao rescindir contrato.');
        }

        this.closeTerminateModal();
        await this.loadContracts();
        this.renderView();

        if (window.showToast) window.showToast('Contrato rescindido com sucesso.', 'info');
      } catch (e) {
        if (errorBox) {
          errorBox.innerText = e.message;
          errorBox.hidden = false;
        } else {
          alert(e.message);
        }
      }
    },

    async deleteContract(id) {
      if (!confirm('Tem a certeza que deseja arquivar este contrato?')) return;

      try {
        const res = await window.apiFetch(`/api/crm/contracts/${id}`, {
          method: 'DELETE'
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Falha ao eliminar contrato.');
        }

        await this.loadContracts();
        this.renderView();

        if (window.showToast) window.showToast('Contrato arquivado com sucesso.', 'info');
      } catch (e) {
        alert(e.message);
      }
    }
  };
})(window, document);
