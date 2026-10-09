/**
 * CRM Leads & Prospeção Comercial (Fase B2)
 * HelderLabs ERP — Interface moderna, segura (XSS-free) e conversão para Oportunidade/Empresa.
 */

(function () {
  'use strict';

  const esc = (s) => (window.CRMModule && window.CRMModule.esc ? window.CRMModule.esc(s) : String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  const formatDate = (d) => {
    if (!d) return '';
    try {
      return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d));
    } catch {
      return '';
    }
  };

  const LEAD_STATUS_LABELS = {
    NEW: 'Nova / Por Contactar',
    CONTACTED: 'Contactada',
    QUALIFICATION: 'Em Qualificação',
    CONVERTED: 'Convertida em Negócio',
    LOST: 'Perdida'
  };

  const LEAD_STATUS_CLASSES = {
    NEW: 'badge-info',
    CONTACTED: 'badge-warning',
    QUALIFICATION: 'badge-primary',
    CONVERTED: 'badge-success',
    LOST: 'badge-danger'
  };

  const CRMLeadsModule = {
    leadsList: [],
    selectedLeadIdForConvert: null,

    async init() {
      await this.loadLeads();
    },

    async loadLeads() {
      const container = document.getElementById('crm-leads-container');
      if (!container) return;

      container.innerHTML = `
        <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
          <div class="spinner" style="margin: 0 auto 12px auto;"></div>
          <span>A carregar lista de prospetos e leads...</span>
        </div>
      `;

      try {
        const token = localStorage.getItem('token') || localStorage.getItem('auth_token');
        const res = await fetch('/api/crm/leads', {
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          }
        });

        if (!res.ok) {
          throw new Error(`Falha ao carregar leads (${res.status})`);
        }

        this.leadsList = await res.json();
        this.renderLeads();
      } catch (err) {
        console.error('Erro ao carregar leads:', err);
        container.innerHTML = `
          <div class="alert alert-danger" style="margin: 20px;">
            Não foi possível carregar as leads: ${esc(err.message)}
          </div>
        `;
      }
    },

    renderLeads() {
      const container = document.getElementById('crm-leads-container');
      if (!container) return;

      if (!this.leadsList || this.leadsList.length === 0) {
        container.innerHTML = `
          <div style="padding: 48px; text-align: center; color: var(--text-secondary);">
            <svg style="width: 48px; height: 48px; margin: 0 auto 12px auto; opacity: 0.5;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
            </svg>
            <p style="font-size: 15px; font-weight: 500;">Nenhum prospeto ou lead registado</p>
            <button class="btn btn-primary" onclick="window.CRMLeadsModule.openCreateLeadModal()">+ Criar Primeira Lead</button>
          </div>
        `;
        return;
      }

      const rows = this.leadsList.map(l => {
        const statusLabel = LEAD_STATUS_LABELS[l.status] || l.status;
        const statusClass = LEAD_STATUS_CLASSES[l.status] || 'badge-secondary';
        const isConverted = l.status === 'CONVERTED';

        return `
          <tr>
            <td>
              <div style="font-weight: 600; color: var(--text-primary);">${esc(l.company)}</div>
              <span style="font-size: 12px; color: var(--text-secondary);">Criado a ${esc(formatDate(l.createdAt))}</span>
            </td>
            <td>
              <div>${esc(l.name)}</div>
              ${l.role ? `<span style="font-size: 11px; color: var(--text-secondary);">${esc(l.role)}</span>` : ''}
            </td>
            <td>
              <div>${l.email ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : '—'}</div>
              <div style="font-size: 12px; color: var(--text-secondary);">${esc(l.phone || l.mobile || '')}</div>
            </td>
            <td>
              <span class="badge" style="background: rgba(148, 163, 184, 0.15); color: var(--text-secondary);">${esc(l.source)}</span>
            </td>
            <td>
              <span class="badge ${esc(statusClass)}">${esc(statusLabel)}</span>
            </td>
            <td style="text-align: right;">
              ${!isConverted ? `
                <button class="btn btn-sm btn-primary" onclick="window.CRMLeadsModule.openConvertModal('${esc(l.id)}', '${esc(l.company)}')">
                  ⚡ Converter em Negócio
                </button>
              ` : `
                <span style="font-size: 12px; color: #10b981; font-weight: 500;">✓ Convertida</span>
              `}
              <button class="btn btn-sm btn-danger" style="margin-left: 6px;" onclick="window.CRMLeadsModule.deleteLead('${esc(l.id)}')">
                ✕
              </button>
            </td>
          </tr>
        `;
      }).join('');

      container.innerHTML = `
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Empresa / Organização</th>
                <th>Contacto</th>
                <th>Comunicação</th>
                <th>Origem</th>
                <th>Estado</th>
                <th style="text-align: right;">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      `;
    },

    openCreateLeadModal() {
      const modal = document.getElementById('modal-create-lead');
      if (!modal) return;
      const form = modal.querySelector('form');
      if (form) form.reset();
      modal.classList.add('active');
    },

    async submitCreateLead(event) {
      event.preventDefault();
      const form = event.target;
      const formData = new FormData(form);

      const payload = {
        company: formData.get('company'),
        name: formData.get('name'),
        email: formData.get('email') || undefined,
        phone: formData.get('phone') || undefined,
        source: formData.get('source') || 'Prospeção Direta'
      };

      try {
        const token = localStorage.getItem('token') || localStorage.getItem('auth_token');
        const res = await fetch('/api/crm/leads', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Erro ao gravar lead');
        }

        this.closeModal('modal-create-lead');
        await this.loadLeads();
      } catch (err) {
        alert(`Erro: ${err.message}`);
      }
    },

    openConvertModal(leadId, companyName) {
      this.selectedLeadIdForConvert = leadId;
      const modal = document.getElementById('modal-convert-lead');
      if (!modal) return;

      const titleInput = document.getElementById('convert-opp-title');
      if (titleInput) titleInput.value = `Oportunidade Comercial — ${companyName}`;

      const valInput = document.getElementById('convert-opp-value');
      if (valInput) valInput.value = '1000';

      modal.classList.add('active');
    },

    async submitConvertLead(event) {
      event.preventDefault();
      if (!this.selectedLeadIdForConvert) return;

      const title = document.getElementById('convert-opp-title')?.value;
      const estimatedValue = Number(document.getElementById('convert-opp-value')?.value) || 0;
      const createCompany = document.getElementById('convert-create-company')?.checked ?? true;

      try {
        const token = localStorage.getItem('token') || localStorage.getItem('auth_token');
        const res = await fetch(`/api/crm/leads/${encodeURIComponent(this.selectedLeadIdForConvert)}/convert`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            estimatedValue,
            title,
            createCompany
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Erro ao converter lead');
        }

        this.closeModal('modal-convert-lead');
        this.selectedLeadIdForConvert = null;

        await this.loadLeads();
        if (window.CRMPipelineModule) {
          await window.CRMPipelineModule.loadKanban();
        }
        if (window.CRMModule && window.CRMModule.loadCompanies) {
          await window.CRMModule.loadCompanies();
        }

        alert('Lead convertida com sucesso em Oportunidade no Pipeline!');
      } catch (err) {
        alert(`Erro na conversão: ${err.message}`);
      }
    },

    async deleteLead(leadId) {
      if (!confirm('Tem a certeza que deseja arquivar este prospeto?')) return;

      try {
        const token = localStorage.getItem('token') || localStorage.getItem('auth_token');
        const res = await fetch(`/api/crm/leads/${encodeURIComponent(leadId)}`, {
          method: 'DELETE',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          }
        });

        if (!res.ok && res.status !== 204) {
          throw new Error('Falha ao remover lead');
        }

        await this.loadLeads();
      } catch (err) {
        alert(`Erro: ${err.message}`);
      }
    },

    closeModal(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) modal.classList.remove('active');
    }
  };

  window.CRMLeadsModule = CRMLeadsModule;
})();
