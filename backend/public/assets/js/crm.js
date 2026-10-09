/**
 * HELDERLABS ERP — CRM Facade (crm.js) v1.6.1
 * Ponto de entrada modular com compatibilidade total para window.CRMModule
 */
(function (window, document) {
  'use strict';

  window.CRMModule = {
    currentView: 'companies',

    async init() {
      if (window.CRMCompanies) {
        await window.CRMCompanies.init();
      }
    },

    async switchCRMView(view) {
      this.currentView = view;
      ['companies', 'pipeline', 'leads', 'activities', 'proposals'].forEach(v => {
        const btn = document.getElementById(`crm-btn-subview-${v}`);
        const panel = document.getElementById(`crm-view-${v}`);
        if (btn) btn.classList.toggle('active', v === view);
        if (panel) panel.style.display = v === view ? 'block' : 'none';
      });

      if (view === 'pipeline' && window.CRMPipelineModule) {
        await window.CRMPipelineModule.init();
      } else if (view === 'leads' && window.CRMLeadsModule) {
        await window.CRMLeadsModule.init();
      } else if (view === 'activities' && window.CRMActivitiesModule) {
        await window.CRMActivitiesModule.init();
      } else if (view === 'proposals' && window.CRMProposalsModule) {
        await window.CRMProposalsModule.init();
      } else if (view === 'companies' && window.CRMCompanies) {
        await window.CRMCompanies.loadCompanies();
      }
    },

    openCompany360(id) {
      if (window.CRMCompanies) {
        window.CRMCompanies.openCompany360(id);
      }
    },

    set360Tab(tab) {
      if (window.CRMCompanies) {
        window.CRMCompanies.set360Tab(tab);
      }
    },

    openCreateModal() {
      const modal = document.getElementById('modal-create-company');
      if (modal) {
        const errorBox = document.getElementById('company-create-error-box');
        if (errorBox) {
          errorBox.hidden = true;
          errorBox.innerHTML = '';
        }
        modal.classList.add('active');
        modal.classList.add('show');
      }
    },

    closeModal(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) {
        modal.classList.remove('active');
        modal.classList.remove('show');
      }
    },

    async submitCreateCompany(event) {
      if (window.CRMCompanies) {
        await window.CRMCompanies.submitCreateCompany(event);
      }
    },

    openAddContactModal(companyId) {
      const targetId = companyId || (window.CRMCompanies && window.CRMCompanies.selectedCompany?.id);
      if (targetId && window.CRMContacts) {
        window.CRMContacts.openAddModal(targetId);
      }
    },

    openCreateOpportunityModal(companyId) {
      if (window.CRMPipelineModule) {
        window.CRMPipelineModule.openCreateOpportunityModal(companyId);
      }
    }
  };

  // Filtros de busca no painel com debounce
  document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('crm-search-input');
    const statusSelect = document.getElementById('crm-status-filter');
    const sectorSelect = document.getElementById('crm-sector-filter');

    let debounceTimer;
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (window.CRMCompanies) {
            window.CRMCompanies.filters.search = e.target.value.trim();
            window.CRMCompanies.cursorStack = [];
            window.CRMCompanies.loadCompanies();
          }
        }, 300);
      });
    }

    if (statusSelect) {
      statusSelect.addEventListener('change', (e) => {
        if (window.CRMCompanies) {
          window.CRMCompanies.filters.status = e.target.value;
          window.CRMCompanies.cursorStack = [];
          window.CRMCompanies.loadCompanies();
        }
      });
    }

    if (sectorSelect) {
      sectorSelect.addEventListener('change', (e) => {
        if (window.CRMCompanies) {
          window.CRMCompanies.filters.sector = e.target.value;
          window.CRMCompanies.cursorStack = [];
          window.CRMCompanies.loadCompanies();
        }
      });
    }
  });
})(window, document);
