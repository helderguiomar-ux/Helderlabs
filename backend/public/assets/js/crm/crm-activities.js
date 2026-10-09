/**
 * HELDERLABS ERP — CRM Activities Module (crm-activities.js) v1.6.3
 * Gestão de Atividades, Tarefas, Histórico Comercial, Follow-ups e Timeline 360º
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

  function formatDate(d) {
    if (!d) return '—';
    try {
      const dt = new Date(d);
      return dt.toLocaleDateString('pt-PT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return String(d);
    }
  }

  const TYPE_CONFIG = {
    task: { label: 'Tarefa', icon: '⏰', color: '#2563eb', bg: '#eff6ff' },
    call: { label: 'Chamada', icon: '📞', color: '#059669', bg: '#ecfdf5' },
    meeting: { label: 'Reunião', icon: '📅', color: '#7c3aed', bg: '#f5f3ff' },
    email: { label: 'Email', icon: '✉️', color: '#0284c7', bg: '#f0f9ff' },
    note: { label: 'Nota', icon: '📝', color: '#d97706', bg: '#fffbeb' },
    whatsapp: { label: 'WhatsApp', icon: '💬', color: '#16a34a', bg: '#f0fdf4' }
  };

  const PRIORITY_CONFIG = {
    URGENT: { label: 'Urgente', class: 'badge-danger', style: 'background: #fee2e2; color: #991b1b;' },
    HIGH: { label: 'Alta', class: 'badge-warning', style: 'background: #ffedd5; color: #9a3412;' },
    NORMAL: { label: 'Normal', class: 'badge-info', style: 'background: #e0f2fe; color: #075985;' },
    LOW: { label: 'Baixa', class: 'badge-neutral', style: 'background: #f3f4f6; color: #4b5563;' }
  };

  window.CRMActivitiesModule = {
    activities: [],
    pendingSummary: {
      totalPending: 0,
      overdueCount: 0,
      dueTodayCount: 0,
      upcomingCount: 0
    },
    currentFilter: {
      type: '',
      status: '',
      overdueOnly: false,
      search: ''
    },

    async init() {
      await Promise.all([
        this.loadPendingSummary(),
        this.loadActivities()
      ]);
      this.renderView();
    },

    async loadPendingSummary() {
      try {
        const res = await window.apiFetch('/api/crm/activities/pending');
        if (res.ok) {
          const data = await res.json();
          this.pendingSummary = {
            totalPending: data.totalPending || 0,
            overdueCount: data.overdueCount || 0,
            dueTodayCount: data.dueTodayCount || 0,
            upcomingCount: data.upcomingCount || 0
          };
        }
      } catch (e) {
        console.error('Erro ao carregar resumo de atividades:', e);
      }
    },

    async loadActivities() {
      try {
        const params = new URLSearchParams();
        if (this.currentFilter.type) params.append('type', this.currentFilter.type);
        if (this.currentFilter.status) params.append('status', this.currentFilter.status);
        if (this.currentFilter.overdueOnly) params.append('overdueOnly', 'true');

        const qs = params.toString() ? `?${params.toString()}` : '';
        const res = await window.apiFetch(`/api/crm/activities${qs}`);
        if (res.ok) {
          this.activities = await res.json();
        } else {
          this.activities = [];
        }
      } catch (e) {
        console.error('Erro ao listar atividades:', e);
        this.activities = [];
      }
    },

    setFilter(filterUpdate) {
      Object.assign(this.currentFilter, filterUpdate);
      this.loadActivities().then(() => this.renderView());
    },

    renderView() {
      const container = document.getElementById('crm-activities-container');
      if (!container) return;

      const overdueBadge = this.pendingSummary.overdueCount > 0
        ? `<span class="badge" style="background: #dc2626; color: #fff; font-weight: 700; margin-left: 6px;">${this.pendingSummary.overdueCount} atrasados</span>`
        : '';

      container.innerHTML = `
        <!-- KPI Cards -->
        <div class="kpi-grid" style="margin-bottom: 20px;">
          <div class="kpi-card" style="border-left: 4px solid #2563eb;">
            <span class="kpi-label">Follow-ups Pendentes</span>
            <span class="kpi-value">${esc(this.pendingSummary.totalPending)}</span>
            <span class="kpi-subtext">Tarefas e contactos agendados</span>
          </div>
          <div class="kpi-card" style="border-left: 4px solid #dc2626;">
            <span class="kpi-label">Follow-ups Atrasados</span>
            <span class="kpi-value" style="color: #dc2626;">${esc(this.pendingSummary.overdueCount)}</span>
            <span class="kpi-subtext">Exigem contacto prioritário</span>
          </div>
          <div class="kpi-card" style="border-left: 4px solid #d97706;">
            <span class="kpi-label">Agendados para Hoje</span>
            <span class="kpi-value" style="color: #d97706;">${esc(this.pendingSummary.dueTodayCount)}</span>
            <span class="kpi-subtext">Compromissos do dia</span>
          </div>
          <div class="kpi-card" style="border-left: 4px solid #059669;">
            <span class="kpi-label">Próximos Dias</span>
            <span class="kpi-value">${esc(this.pendingSummary.upcomingCount)}</span>
            <span class="kpi-subtext">Planeados a médio prazo</span>
          </div>
        </div>

        <!-- Filtros e Barra de Ações -->
        <div class="panel-card" style="margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <button class="btn btn-sm ${!this.currentFilter.status && !this.currentFilter.overdueOnly && !this.currentFilter.type ? 'btn-primary' : ''}" 
                onclick="window.CRMActivitiesModule.setFilter({ status: '', type: '', overdueOnly: false })">
                Todas
              </button>
              <button class="btn btn-sm ${this.currentFilter.status === 'PENDING' && !this.currentFilter.overdueOnly ? 'btn-primary' : ''}" 
                onclick="window.CRMActivitiesModule.setFilter({ status: 'PENDING', overdueOnly: false })">
                Pendentes
              </button>
              <button class="btn btn-sm ${this.currentFilter.overdueOnly ? 'btn-primary' : ''}" style="${this.pendingSummary.overdueCount > 0 ? 'border-color: #dc2626; color: #dc2626;' : ''}"
                onclick="window.CRMActivitiesModule.setFilter({ overdueOnly: true, status: '' })">
                Atrasadas ${overdueBadge}
              </button>
              <button class="btn btn-sm ${this.currentFilter.status === 'COMPLETED' ? 'btn-primary' : ''}" 
                onclick="window.CRMActivitiesModule.setFilter({ status: 'COMPLETED', overdueOnly: false })">
                Concluídas
              </button>
            </div>

            <div style="display: flex; gap: 8px; align-items: center;">
              <select onchange="window.CRMActivitiesModule.setFilter({ type: this.value })" style="padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); font-size: 13px;">
                <option value="">Todos os Tipos</option>
                <option value="task" ${this.currentFilter.type === 'task' ? 'selected' : ''}>⏰ Tarefas</option>
                <option value="call" ${this.currentFilter.type === 'call' ? 'selected' : ''}>📞 Chamadas</option>
                <option value="meeting" ${this.currentFilter.type === 'meeting' ? 'selected' : ''}>📅 Reuniões</option>
                <option value="email" ${this.currentFilter.type === 'email' ? 'selected' : ''}>✉️ Emails</option>
                <option value="note" ${this.currentFilter.type === 'note' ? 'selected' : ''}>📝 Notas</option>
                <option value="whatsapp" ${this.currentFilter.type === 'whatsapp' ? 'selected' : ''}>💬 WhatsApp</option>
              </select>

              <button class="btn btn-primary" onclick="window.CRMActivitiesModule.openCreateModal()">
                + Registar Atividade
              </button>
            </div>
          </div>
        </div>

        <!-- Feed da Timeline -->
        <div id="crm-activities-timeline-feed">
          ${this.renderTimeline(this.activities)}
        </div>
      `;
    },

    renderTimeline(items, options = {}) {
      if (!items || items.length === 0) {
        return `
          <div class="panel-card" style="text-align: center; padding: 48px 24px; color: var(--text-secondary);">
            <div style="font-size: 32px; margin-bottom: 8px;">📋</div>
            <p style="margin: 0; font-size: 14px; font-weight: 500;">Nenhuma atividade comercial registada para estes filtros.</p>
            <p style="margin: 4px 0 16px 0; font-size: 12px;">Registe chamadas, reuniões, tarefas ou notas para manter o histórico 360º atualizado.</p>
            <button class="btn btn-primary btn-sm" onclick="window.CRMActivitiesModule.openCreateModal(${options.companyId ? `'${esc(options.companyId)}'` : ''})">
              + Registar Atividade
            </button>
          </div>
        `;
      }

      return `
        <div class="crm-timeline">
          ${items.map(item => this.renderActivityCard(item, options)).join('')}
        </div>
      `;
    },

    renderActivityCard(item, options = {}) {
      const typeCfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.task;
      const priorityCfg = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.NORMAL;
      const isCompleted = item.status === 'COMPLETED';
      const isOverdue = Boolean(item.isOverdue);

      let statusBadge = '';
      if (isCompleted) {
        statusBadge = `<span class="badge" style="background: #dcfce7; color: #15803d;">✔ Concluída</span>`;
      } else if (isOverdue) {
        statusBadge = `<span class="badge" style="background: #fee2e2; color: #b91c1c; font-weight: 700;">⚠️ Atrasado</span>`;
      } else {
        statusBadge = `<span class="badge" style="background: #fef3c7; color: #b45309;">⏳ Pendente</span>`;
      }

      const priorityBadge = `<span class="badge" style="${priorityCfg.style}">${esc(priorityCfg.label)}</span>`;

      // Relacionamentos visíveis
      const companyPill = item.company ? `
        <span class="crm-tag" onclick="window.CRMModule.openCompany360('${esc(item.company.id)}')" style="cursor: pointer;" title="Abrir Ficha 360º">
          🏢 <strong>${esc(item.company.tradeName)}</strong>
        </span>
      ` : '';

      const contactPill = item.contact ? `
        <span class="crm-tag">
          👤 ${esc(item.contact.name)} ${item.contact.phone ? `(${esc(item.contact.phone)})` : ''}
        </span>
      ` : '';

      const oppPill = item.opportunity ? `
        <span class="crm-tag" style="background: #f3e8ff; color: #6b21a8;">
          💼 ${esc(item.opportunity.title)}
        </span>
      ` : '';

      const leadPill = item.lead ? `
        <span class="crm-tag" style="background: #ecfeff; color: #0e7490;">
          🎯 Lead: ${esc(item.lead.name || item.lead.company)}
        </span>
      ` : '';

      return `
        <div class="crm-timeline-card ${isOverdue ? 'overdue' : ''} ${isCompleted ? 'completed' : ''}" id="activity-card-${esc(item.id)}">
          <div class="crm-timeline-icon" style="background: ${typeCfg.bg}; color: ${typeCfg.color};" title="${esc(typeCfg.label)}">
            ${typeCfg.icon}
          </div>

          <div class="crm-timeline-body">
            <div class="crm-timeline-header">
              <div>
                <h4 class="crm-timeline-title">
                  ${esc(item.subject)}
                </h4>
                <div class="crm-timeline-meta">
                  <span>${esc(typeCfg.label)}</span>
                  <span>•</span>
                  <span>Prazo: <strong>${formatDate(item.dueDate || item.occurredAt)}</strong></span>
                  ${item.completedAt ? `<span>• Concluído em: ${formatDate(item.completedAt)}</span>` : ''}
                </div>
              </div>

              <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                ${priorityBadge}
                ${statusBadge}
              </div>
            </div>

            <!-- Tags contextuais 360º -->
            <div class="crm-tags-row" style="margin: 8px 0;">
              ${companyPill}
              ${contactPill}
              ${oppPill}
              ${leadPill}
            </div>

            <!-- Descrição e Conteúdo -->
            ${item.content ? `
              <div class="crm-timeline-content">
                ${esc(item.content).replace(/\n/g, '<br>')}
              </div>
            ` : ''}

            <!-- Ações Rápidas -->
            <div class="crm-timeline-actions">
              ${!isCompleted ? `
                <button class="btn btn-sm btn-primary" onclick="window.CRMActivitiesModule.promptComplete('${esc(item.id)}')">
                  ✔ Marcar Concluída
                </button>
              ` : `
                <span style="font-size: 11px; color: var(--text-secondary);">Registo arquivado no histórico 360º</span>
              `}
              <button class="btn btn-sm btn-danger" style="margin-left: auto;" onclick="window.CRMActivitiesModule.deleteActivity('${esc(item.id)}')">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      `;
    },

    async openCreateModal(defaultCompanyId = null, defaultOppId = null) {
      const modal = document.getElementById('modal-create-activity');
      if (!modal) return;

      const form = document.getElementById('form-create-activity');
      if (form) form.reset();

      // Data de amanhã por defeito
      const tomorrow = new Date(Date.now() + 86400000);
      tomorrow.setHours(10, 0, 0, 0);
      const isoLocal = new Date(tomorrow.getTime() - (tomorrow.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
      const dueDateInput = document.getElementById('activity-due-date');
      if (dueDateInput) dueDateInput.value = isoLocal;

      // Carregar empresas para o seletor
      await this.populateCompanySelect(defaultCompanyId);

      // Pre-selecionar se fornecido
      if (defaultCompanyId) {
        const select = document.getElementById('activity-company-select');
        if (select) {
          select.value = defaultCompanyId;
          await this.loadCompanyContactsAndOpps(defaultCompanyId, defaultOppId);
        }
      }

      modal.classList.add('active');
      modal.classList.add('show');
    },

    async populateCompanySelect(selectedId = null) {
      const select = document.getElementById('activity-company-select');
      if (!select) return;

      try {
        const res = await window.apiFetch('/api/crm/companies?limit=100');
        if (res.ok) {
          const data = await res.json();
          const companies = data.companies || [];
          select.innerHTML = '<option value="">— Nenhuma / Geral —</option>' + companies.map(c => `
            <option value="${esc(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.tradeName)}</option>
          `).join('');
        }
      } catch (e) {
        console.error('Erro ao popular empresas:', e);
      }
    },

    async onCompanySelected(companyId) {
      await this.loadCompanyContactsAndOpps(companyId);
    },

    async loadCompanyContactsAndOpps(companyId, selectedOppId = null) {
      const oppSelect = document.getElementById('activity-opportunity-select');
      const contactSelect = document.getElementById('activity-contact-select');

      if (!companyId) {
        if (oppSelect) oppSelect.innerHTML = '<option value="">— Sem oportunidade —</option>';
        if (contactSelect) contactSelect.innerHTML = '<option value="">— Sem contacto —</option>';
        return;
      }

      try {
        const res = await window.apiFetch(`/api/crm/companies/${companyId}`);
        if (res.ok) {
          const c = await res.json();
          if (oppSelect) {
            const opps = c.opportunities || [];
            oppSelect.innerHTML = '<option value="">— Sem oportunidade —</option>' + opps.map(o => `
              <option value="${esc(o.id)}" ${o.id === selectedOppId ? 'selected' : ''}>${esc(o.title)} (€${esc(o.estimatedValue)})</option>
            `).join('');
          }
          if (contactSelect) {
            const contacts = c.contacts || [];
            contactSelect.innerHTML = '<option value="">— Sem contacto —</option>' + contacts.map(ct => `
              <option value="${esc(ct.id)}">${esc(ct.name)} ${ct.role ? `(${esc(ct.role)})` : ''}</option>
            `).join('');
          }
        }
      } catch (e) {
        console.error('Erro ao carregar relações da empresa:', e);
      }
    },

    async submitCreateActivity(event) {
      event.preventDefault();
      const form = event.target;
      const formData = new FormData(form);

      const payload = {
        type: formData.get('type') || 'task',
        subject: String(formData.get('subject') || '').trim(),
        content: String(formData.get('content') || '').trim() || null,
        priority: formData.get('priority') || 'NORMAL',
        dueDate: formData.get('dueDate') || null,
        companyId: formData.get('companyId') || null,
        contactId: formData.get('contactId') || null,
        opportunityId: formData.get('opportunityId') || null
      };

      if (!payload.subject) {
        alert('Por favor, indique o assunto da atividade.');
        return;
      }

      try {
        const res = await window.apiFetch('/api/crm/activities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          this.closeModal('modal-create-activity');
          await this.init();
          // Se estivermos dentro da ficha 360º de empresa, recarrega a ficha
          if (payload.companyId && window.CRMCompanies && window.CRMCompanies.activeCompanyId === payload.companyId) {
            window.CRMCompanies.openCompany360(payload.companyId);
          }
        } else {
          const err = await res.json();
          alert('Erro ao registar atividade: ' + (err.message || 'Falha na submissão.'));
        }
      } catch (e) {
        console.error('Erro ao registar atividade:', e);
        alert('Erro ao comunicar com o servidor.');
      }
    },

    async promptComplete(activityId) {
      const notes = prompt('Notas de conclusão do follow-up (opcional):', '');
      if (notes === null) return; // cancelado

      try {
        const res = await window.apiFetch(`/api/crm/activities/${activityId}/complete`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes: notes.trim() || undefined })
        });

        if (res.ok) {
          await this.init();
          // Atualiza se estiver num modal de empresa
          if (window.CRMCompanies && window.CRMCompanies.activeCompanyId) {
            window.CRMCompanies.openCompany360(window.CRMCompanies.activeCompanyId);
          }
        } else {
          const err = await res.json();
          alert('Erro ao concluir atividade: ' + (err.message || 'Falha no servidor.'));
        }
      } catch (e) {
        console.error('Erro ao concluir atividade:', e);
      }
    },

    async deleteActivity(activityId) {
      if (!confirm('Tem a certeza de que deseja eliminar esta atividade?')) return;

      try {
        const res = await window.apiFetch(`/api/crm/activities/${activityId}`, {
          method: 'DELETE'
        });

        if (res.ok) {
          await this.init();
          if (window.CRMCompanies && window.CRMCompanies.activeCompanyId) {
            window.CRMCompanies.openCompany360(window.CRMCompanies.activeCompanyId);
          }
        } else {
          alert('Erro ao eliminar atividade.');
        }
      } catch (e) {
        console.error('Erro ao eliminar atividade:', e);
      }
    },

    closeModal(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) {
        modal.classList.remove('show');
        modal.classList.remove('active');
      }
    }
  };

})(window, document);
