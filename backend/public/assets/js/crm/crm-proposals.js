/**
 * HELDERLABS ERP — CRM Proposals Module (crm-proposals.js) v1.6.4
 * Gestão de Propostas Comerciais, Orçamentos com Impressão A4/PDF e Envio por Email do Tenant
 * 
 * Salvaguarda Legal Inviolável:
 * "Orçamento Comercial / Proposta de Honorários. Não serve de fatura nem de documento de quitação fiscal."
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
    DRAFT: { label: 'Rascunho', class: 'badge-neutral', style: 'background: #f1f5f9; color: #475569;' },
    SENT: { label: 'Enviada', class: 'badge-info', style: 'background: #e0f2fe; color: #0369a1;' },
    ACCEPTED: { label: 'Aceite / Adjudicada', class: 'badge-paid', style: 'background: #dcfce7; color: #15803d;' },
    REJECTED: { label: 'Recusada', class: 'badge-danger', style: 'background: #fee2e2; color: #b91c1c;' },
    EXPIRED: { label: 'Expirada', class: 'badge-warning', style: 'background: #fef3c7; color: #b45309;' }
  };

  window.CRMProposalsModule = {
    proposals: [],
    kpis: {
      totalCount: 0,
      totalCents: 0,
      acceptedCents: 0,
      draftCount: 0
    },
    currentFilter: {
      status: '',
      search: '',
      companyId: ''
    },
    companiesList: [],
    activeProposalForSend: null,

    async init() {
      await Promise.all([
        this.loadProposals(),
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

    async loadProposals() {
      try {
        const params = new URLSearchParams();
        if (this.currentFilter.status) params.append('status', this.currentFilter.status);
        if (this.currentFilter.companyId) params.append('companyId', this.currentFilter.companyId);

        const qs = params.toString() ? `?${params.toString()}` : '';
        const res = await window.apiFetch(`/api/crm/proposals${qs}`);
        if (res.ok) {
          const data = await res.json();
          this.proposals = data.items || [];
          this.computeKPIs(this.proposals);
        }
      } catch (e) {
        console.error('Erro ao carregar propostas:', e);
      }
    },

    computeKPIs(list) {
      let totalCents = 0;
      let acceptedCents = 0;
      let draftCount = 0;

      list.forEach((p) => {
        totalCents += p.totalCents || 0;
        if (p.status === 'ACCEPTED') acceptedCents += p.totalCents || 0;
        if (p.status === 'DRAFT') draftCount += 1;
      });

      this.kpis = {
        totalCount: list.length,
        totalCents,
        acceptedCents,
        draftCount
      };
    },

    renderView() {
      const container = document.getElementById('crm-view-proposals');
      if (!container) return;

      const filtered = this.proposals.filter((p) => {
        if (!this.currentFilter.search) return true;
        const q = this.currentFilter.search.toLowerCase();
        return (
          (p.proposalNumber && p.proposalNumber.toLowerCase().includes(q)) ||
          (p.title && p.title.toLowerCase().includes(q)) ||
          (p.company?.tradeName && p.company.tradeName.toLowerCase().includes(q))
        );
      });

      container.innerHTML = `
        <div class="kpi-grid" style="grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); margin-bottom: 20px;">
          <div class="card kpi-card">
            <span class="kpi-label">Volume Total Orçamentado</span>
            <span class="kpi-value" style="color: var(--primary);">${fmtEur(this.kpis.totalCents)}</span>
            <span style="font-size: 11px; color: var(--muted);">${this.kpis.totalCount} proposta(s) ativa(s)</span>
          </div>
          <div class="card kpi-card">
            <span class="kpi-label">Volume Aceite / Ganho</span>
            <span class="kpi-value" style="color: #10b981;">${fmtEur(this.kpis.acceptedCents)}</span>
            <span style="font-size: 11px; color: var(--muted);">Receita confirmada</span>
          </div>
          <div class="card kpi-card">
            <span class="kpi-label">Em Rascunho / Negociação</span>
            <span class="kpi-value" style="color: #f59e0b;">${this.kpis.draftCount}</span>
            <span style="font-size: 11px; color: var(--muted);">Aguardam envio ou decisão</span>
          </div>
        </div>

        <div class="card" style="margin-bottom: 16px; padding: 16px;">
          <div style="display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap;">
            <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
              <input
                type="text"
                class="form-control"
                placeholder="Pesquisar por nº, título, cliente..."
                value="${escAttr(this.currentFilter.search)}"
                style="max-width: 260px;"
                oninput="window.CRMProposalsModule.setSearchFilter(this.value)"
              />
              <select class="form-control" style="max-width: 180px;" onchange="window.CRMProposalsModule.setStatusFilter(this.value)">
                <option value="" ${this.currentFilter.status === '' ? 'selected' : ''}>Todos os Estados</option>
                <option value="DRAFT" ${this.currentFilter.status === 'DRAFT' ? 'selected' : ''}>Rascunho</option>
                <option value="SENT" ${this.currentFilter.status === 'SENT' ? 'selected' : ''}>Enviada</option>
                <option value="ACCEPTED" ${this.currentFilter.status === 'ACCEPTED' ? 'selected' : ''}>Aceite</option>
                <option value="REJECTED" ${this.currentFilter.status === 'REJECTED' ? 'selected' : ''}>Recusada</option>
              </select>
            </div>
            <button class="btn btn-primary" onclick="window.CRMProposalsModule.openCreateProposalModal()">
              + Nova Proposta Comercial
            </button>
          </div>
        </div>

        <div class="card" style="padding: 0; overflow: hidden;">
          <div class="table-responsive">
            <table class="table" style="margin-bottom: 0;">
              <thead>
                <tr>
                  <th>Nº Proposta</th>
                  <th>Título / Descrição</th>
                  <th>Cliente / Empresa</th>
                  <th>Data Emissão</th>
                  <th>Validade</th>
                  <th style="text-align: right;">Total Líquido</th>
                  <th>Estado</th>
                  <th style="text-align: right;">Ações</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.length === 0 ? `
                  <tr>
                    <td colspan="8" style="text-align: center; padding: 36px; color: var(--muted);">
                      Nenhuma proposta ou orçamento comercial encontrado com os filtros selecionados.
                    </td>
                  </tr>
                ` : filtered.map(p => {
                  const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.DRAFT;
                  return `
                    <tr>
                      <td>
                        <strong style="color: var(--primary);">${esc(p.proposalNumber)}</strong>
                      </td>
                      <td>
                        <div style="font-weight: 600;">${esc(p.title)}</div>
                        <small style="color: var(--muted);">${p.items ? p.items.length : 0} linha(s) de detalhe</small>
                      </td>
                      <td>
                        ${p.company ? `
                          <a href="javascript:void(0)" onclick="window.CRMModule.openCompany360('${escAttr(p.company.id)}')" style="font-weight: 500;">
                            ${esc(p.company.tradeName)}
                          </a>
                        ` : '<span style="color: var(--muted);">—</span>'}
                      </td>
                      <td>${formatDate(p.issueDate)}</td>
                      <td>${p.validUntil ? formatDate(p.validUntil) : '<span style="color: var(--muted);">Sem limite</span>'}</td>
                      <td style="text-align: right; font-weight: 700; font-size: 14px;">
                        ${fmtEur(p.totalCents)}
                      </td>
                      <td>
                        <span class="badge" style="${cfg.style}">${cfg.label}</span>
                      </td>
                      <td style="text-align: right; white-space: nowrap;">
                        <a href="/api/crm/proposals/${escAttr(p.id)}/print" target="_blank" class="btn btn-sm" title="Imprimir ou Guardar em PDF" style="margin-right: 4px;">
                          🖨️ PDF
                        </a>
                        <button class="btn btn-sm btn-info" onclick="window.CRMProposalsModule.openSendModal('${escAttr(p.id)}')" title="Enviar por Email" style="margin-right: 4px;">
                          ✉️ Enviar
                        </button>
                        ${p.status !== 'ACCEPTED' ? `
                          <button class="btn btn-sm btn-success" onclick="window.CRMProposalsModule.quickUpdateStatus('${escAttr(p.id)}', 'ACCEPTED')" title="Marcar como Aceite" style="margin-right: 4px;">
                            ✓
                          </button>
                        ` : ''}
                        ${p.status !== 'REJECTED' && p.status !== 'ACCEPTED' ? `
                          <button class="btn btn-sm btn-danger" onclick="window.CRMProposalsModule.quickUpdateStatus('${escAttr(p.id)}', 'REJECTED')" title="Marcar como Recusada" style="margin-right: 4px;">
                            ✕
                          </button>
                        ` : ''}
                        <button class="btn btn-sm btn-neutral" onclick="window.CRMProposalsModule.deleteProposal('${escAttr(p.id)}')" title="Eliminar proposta">
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
      await this.loadProposals();
      this.renderView();
    },

    openCreateProposalModal(prefillCompanyId, prefillOpportunityId) {
      const modal = document.getElementById('modal-create-proposal');
      if (!modal) return;

      const form = document.getElementById('form-create-proposal');
      if (form) form.reset();

      const itemsContainer = document.getElementById('proposal-items-container');
      if (itemsContainer) {
        itemsContainer.innerHTML = '';
        this.addProposalItemRow(); // Primeira linha
      }

      const compSelect = document.getElementById('proposal-create-company');
      if (compSelect) {
        compSelect.innerHTML = '<option value="">Selecione a Empresa / Cliente...</option>' +
          this.companiesList.map(c => `<option value="${escAttr(c.id)}" ${prefillCompanyId === c.id ? 'selected' : ''}>${esc(c.tradeName)} (${esc(c.taxNumber || 'Sem NIF')})</option>`).join('');
      }

      if (prefillOpportunityId) {
        const oppInput = document.getElementById('proposal-create-opportunity-id');
        if (oppInput) oppInput.value = prefillOpportunityId;
      }

      this.recalculateModalTotals();

      modal.classList.add('active');
      modal.classList.add('show');
    },

    closeCreateModal() {
      const modal = document.getElementById('modal-create-proposal');
      if (modal) {
        modal.classList.remove('active');
        modal.classList.remove('show');
      }
    },

    addProposalItemRow(item = {}) {
      const container = document.getElementById('proposal-items-container');
      if (!container) return;

      const rowIndex = container.children.length;
      const row = document.createElement('div');
      row.className = 'proposal-item-row';
      row.style = 'display: grid; grid-template-columns: 3fr 1fr 1.5fr 1fr 1fr 40px; gap: 8px; margin-bottom: 8px; align-items: center;';

      row.innerHTML = `
        <div>
          <input type="text" class="form-control item-desc" placeholder="Descrição do serviço ou produto" required value="${escAttr(item.description || '')}" />
        </div>
        <div>
          <input type="number" step="1" min="1" class="form-control item-qty" value="${item.quantity || 1}" oninput="window.CRMProposalsModule.recalculateModalTotals()" required />
        </div>
        <div>
          <input type="number" step="0.01" min="0" class="form-control item-price" placeholder="0.00" value="${item.unitPrice ? (item.unitPrice / 100).toFixed(2) : '0.00'}" oninput="window.CRMProposalsModule.recalculateModalTotals()" required />
        </div>
        <div>
          <input type="number" step="0.1" min="0" max="100" class="form-control item-discount" placeholder="0%" value="${item.discountPercent || 0}" oninput="window.CRMProposalsModule.recalculateModalTotals()" />
        </div>
        <div style="text-align: right; font-weight: 600; font-size: 13px; color: var(--primary);" class="item-line-total">
          €0,00
        </div>
        <div>
          <button type="button" class="btn btn-sm btn-danger" onclick="this.closest('.proposal-item-row').remove(); window.CRMProposalsModule.recalculateModalTotals();" title="Remover Linha">✕</button>
        </div>
      `;

      container.appendChild(row);
      this.recalculateModalTotals();
    },

    recalculateModalTotals() {
      const rows = document.querySelectorAll('#proposal-items-container .proposal-item-row');
      let subtotal = 0;

      rows.forEach((row) => {
        const qty = parseFloat(row.querySelector('.item-qty')?.value) || 0;
        const price = parseFloat(row.querySelector('.item-price')?.value) || 0;
        const discount = parseFloat(row.querySelector('.item-discount')?.value) || 0;

        const lineGross = qty * price;
        const lineNet = lineGross * (1 - discount / 100);
        subtotal += lineNet;

        const totalCell = row.querySelector('.item-line-total');
        if (totalCell) {
          totalCell.innerText = `€${lineNet.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
      });

      const vatSelect = document.getElementById('proposal-create-vat-rate');
      const vatRate = parseFloat(vatSelect?.value || '23');
      const vatVal = subtotal * (vatRate / 100);
      const total = subtotal + vatVal;

      const subtotalEl = document.getElementById('proposal-preview-subtotal');
      const vatEl = document.getElementById('proposal-preview-vat');
      const totalEl = document.getElementById('proposal-preview-total');

      if (subtotalEl) subtotalEl.innerText = `€${subtotal.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      if (vatEl) vatEl.innerText = `€${vatVal.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      if (totalEl) totalEl.innerText = `€${total.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    },

    async submitCreateProposal(event) {
      event.preventDefault();
      const form = event.target;
      const errorBox = document.getElementById('proposal-create-error-box');
      if (errorBox) errorBox.hidden = true;

      const rows = document.querySelectorAll('#proposal-items-container .proposal-item-row');
      const items = [];

      rows.forEach((r, idx) => {
        const desc = r.querySelector('.item-desc')?.value?.trim();
        const qty = parseFloat(r.querySelector('.item-qty')?.value) || 1;
        const price = parseFloat(r.querySelector('.item-price')?.value) || 0;
        const discount = parseFloat(r.querySelector('.item-discount')?.value) || 0;

        if (desc) {
          items.push({
            description: desc,
            quantity: qty,
            unitPriceCents: Math.round(price * 100),
            discountPercent: discount,
            sortOrder: idx + 1
          });
        }
      });

      if (items.length === 0) {
        if (errorBox) {
          errorBox.innerText = 'É obrigatório indicar pelo menos um item orçamentado.';
          errorBox.hidden = false;
        }
        return;
      }

      const payload = {
        title: form.title.value.trim(),
        companyId: form.companyId.value || undefined,
        opportunityId: form.opportunityId?.value || undefined,
        issueDate: form.issueDate.value || undefined,
        validUntil: form.validUntil.value || undefined,
        vatRatePercent: parseFloat(form.vatRatePercent.value) || 23,
        notes: form.notes.value.trim() || undefined,
        termsAndConditions: form.termsAndConditions.value.trim() || undefined,
        items
      };

      try {
        const res = await window.apiFetch('/api/crm/proposals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || err.message || 'Falha ao criar proposta comercial.');
        }

        this.closeCreateModal();
        await this.loadProposals();
        this.renderView();

        if (window.showToast) window.showToast('Proposta comercial criada com sucesso!', 'success');
      } catch (e) {
        if (errorBox) {
          errorBox.innerText = e.message;
          errorBox.hidden = false;
        } else {
          alert(e.message);
        }
      }
    },

    openSendModal(id) {
      const proposal = this.proposals.find(p => p.id === id);
      if (!proposal) return;

      this.activeProposalForSend = proposal;
      const modal = document.getElementById('modal-send-proposal');
      if (!modal) return;

      const recipientInput = document.getElementById('proposal-send-email');
      const titleSpan = document.getElementById('proposal-send-title');
      const errBox = document.getElementById('proposal-send-error-box');

      if (errBox) errBox.hidden = true;
      if (titleSpan) titleSpan.innerText = `${proposal.proposalNumber} — ${proposal.title}`;
      if (recipientInput) {
        recipientInput.value = proposal.contact?.email || proposal.company?.email || '';
      }

      modal.classList.add('active');
      modal.classList.add('show');
    },

    closeSendModal() {
      const modal = document.getElementById('modal-send-proposal');
      if (modal) {
        modal.classList.remove('active');
        modal.classList.remove('show');
      }
    },

    async submitSendProposal(event) {
      event.preventDefault();
      if (!this.activeProposalForSend) return;

      const form = event.target;
      const errorBox = document.getElementById('proposal-send-error-box');
      if (errorBox) errorBox.hidden = true;

      const recipient = form.recipientEmail.value.trim();
      const message = form.customMessage.value.trim();

      const btn = form.querySelector('button[type="submit"]');
      const origText = btn ? btn.innerText : 'Enviar';
      if (btn) {
        btn.disabled = true;
        btn.innerText = 'A enviar email...';
      }

      try {
        const res = await window.apiFetch(`/api/crm/proposals/${this.activeProposalForSend.id}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipientEmail: recipient, message })
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || err.message || 'Falha ao enviar proposta por email.');
        }

        this.closeSendModal();
        await this.loadProposals();
        this.renderView();

        if (window.showToast) {
          window.showToast(`Proposta enviada com sucesso para ${recipient}!`, 'success');
        } else {
          alert(`Proposta comercial enviada com sucesso para ${recipient}!`);
        }
      } catch (e) {
        if (errorBox) {
          errorBox.innerText = e.message;
          errorBox.hidden = false;
        } else {
          alert(e.message);
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerText = origText;
        }
      }
    },

    async quickUpdateStatus(id, newStatus) {
      const msg = newStatus === 'ACCEPTED'
        ? 'Deseja confirmar a adjudicação/aprovação desta proposta? Se tiver uma oportunidade associada, esta será marcada como GANHA.'
        : 'Deseja marcar esta proposta comercial como RECUSADA?';

      if (!confirm(msg)) return;

      try {
        const res = await window.apiFetch(`/api/crm/proposals/${id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Falha ao atualizar estado da proposta.');
        }

        await this.loadProposals();
        this.renderView();

        if (window.showToast) window.showToast(`Estado da proposta atualizado para ${newStatus}.`, 'success');
      } catch (e) {
        alert(e.message);
      }
    },

    async deleteProposal(id) {
      if (!confirm('Tem a certeza que deseja eliminar esta proposta comercial?')) return;

      try {
        const res = await window.apiFetch(`/api/crm/proposals/${id}`, {
          method: 'DELETE'
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Falha ao eliminar proposta.');
        }

        await this.loadProposals();
        this.renderView();

        if (window.showToast) window.showToast('Proposta comercial eliminada com sucesso.', 'info');
      } catch (e) {
        alert(e.message);
      }
    }
  };
})(window, document);
