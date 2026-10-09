/**
 * CRM Documents & Compliance Module (Fase B6)
 * Gestão de Documentos Empresariais, Códigos de Acesso, Validades e Verificação de Conformidade.
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
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleDateString('pt-PT');
    } catch {
      return '—';
    }
  }

  const DOC_TYPE_LABELS = {
    CERTIDAO_PERMANENTE: 'Certidão Permanente',
    RCBE: 'Beneficiário Efetivo (RCBE)',
    DECLARACAO_NIF: 'Cartão de NIF / Registo',
    PROCURACAO: 'Procuração / Poderes',
    ALVARA_LICENCA: 'Alvará / Licença',
    SEGURO_RC: 'Seguro de Resp. Civil',
    NON_DEBT_AT: 'Não Dívida (AT / Finanças)',
    NON_DEBT_SS: 'Não Dívida (Seg. Social)',
    CONTRATO_ASSINADO: 'Contrato Assinado',
    NDA_CONFIDENCIALIDADE: 'Acordo Confidencialidade (NDA)',
    COMPROVATIVO_IBAN: 'Comprovativo IBAN',
    RGPD_CONSENTIMENTO: 'Consentimento RGPD',
    OTHER: 'Outro Documento'
  };

  const CRMDocuments = {
    documents: [],
    kpis: {},
    currentCompanyId: null,
    filterExpiringOnly: false,
    filterStatus: '',
    filterDocType: '',
    searchTerm: '',

    init() {
      // Event listener para filtros e botões
      const searchInput = document.getElementById('docs-search-input');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          this.searchTerm = e.target.value.trim();
          this.renderDocumentsTable();
        });
      }

      const statusSelect = document.getElementById('docs-filter-status');
      if (statusSelect) {
        statusSelect.addEventListener('change', (e) => {
          this.filterStatus = e.target.value;
          this.loadDocuments();
        });
      }

      const typeSelect = document.getElementById('docs-filter-type');
      if (typeSelect) {
        typeSelect.addEventListener('change', (e) => {
          this.filterDocType = e.target.value;
          this.loadDocuments();
        });
      }

      const expiringCheck = document.getElementById('docs-filter-expiring');
      if (expiringCheck) {
        expiringCheck.addEventListener('change', (e) => {
          this.filterExpiringOnly = e.target.checked;
          this.loadDocuments();
        });
      }
    },

    async loadDocuments() {
      const container = document.getElementById('crm-view-documents');
      if (!container) return;

      try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        if (!token) return;

        let queryParams = [];
        if (this.filterExpiringOnly) queryParams.push('expiringOnly=true');
        if (this.filterStatus) queryParams.push(`status=${encodeURIComponent(this.filterStatus)}`);
        if (this.filterDocType) queryParams.push(`docType=${encodeURIComponent(this.filterDocType)}`);
        if (this.searchTerm) queryParams.push(`search=${encodeURIComponent(this.searchTerm)}`);

        const url = `/api/crm/documents${queryParams.length > 0 ? '?' + queryParams.join('&') : ''}`;
        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
          throw new Error('Falha ao carregar documentos.');
        }

        const data = await res.json();
        this.documents = data.documents || [];
        this.kpis = data.kpis || {};

        this.renderKPIs();
        this.renderDocumentsTable();
      } catch (err) {
        console.error('Erro ao carregar documentos:', err);
        const tableBody = document.getElementById('docs-table-body');
        if (tableBody) {
          tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger, #ef4444); padding: 20px;">Erro ao carregar documentos: ${esc(err.message)}</td></tr>`;
        }
      }
    },

    renderKPIs() {
      const k = this.kpis;
      const elTotal = document.getElementById('docs-kpi-total');
      const elValid = document.getElementById('docs-kpi-valid');
      const elExpiring = document.getElementById('docs-kpi-expiring');
      const elExpired = document.getElementById('docs-kpi-expired');
      const elPending = document.getElementById('docs-kpi-pending');

      if (elTotal) elTotal.textContent = k.totalDocuments || 0;
      if (elValid) elValid.textContent = k.validCount || 0;
      if (elExpiring) elExpiring.textContent = k.expiringSoonCount || 0;
      if (elExpired) elExpired.textContent = k.expiredCount || 0;
      if (elPending) elPending.textContent = k.pendingVerificationCount || 0;
    },

    renderDocumentsTable() {
      const tbody = document.getElementById('docs-table-body');
      if (!tbody) return;

      let list = this.documents;
      if (this.searchTerm) {
        const q = this.searchTerm.toLowerCase();
        list = list.filter(d =>
          (d.name && d.name.toLowerCase().includes(q)) ||
          (d.accessCode && d.accessCode.toLowerCase().includes(q)) ||
          (d.company && d.company.tradeName && d.company.tradeName.toLowerCase().includes(q)) ||
          (d.company && d.company.taxNumber && d.company.taxNumber.toLowerCase().includes(q))
        );
      }

      if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--muted); padding: 30px;">Nenhum documento empresarial encontrado para os critérios selecionados.</td></tr>`;
        return;
      }

      tbody.innerHTML = list.map(d => {
        const typeLabel = DOC_TYPE_LABELS[d.docType] || d.docTypeLabel || d.docType || 'Outro';
        
        // Status Badge
        let statusBadge = '<span class="badge badge-doc-valid">Válido</span>';
        if (d.computedStatus === 'EXPIRED' || d.isExpired) {
          const daysAgo = Math.abs(d.daysUntilExpiry || 0);
          statusBadge = `<span class="badge badge-doc-expired" title="Caducou há ${daysAgo} dias">⚠️ Caducado (${daysAgo}d)</span>`;
        } else if (d.computedStatus === 'EXPIRING_SOON' || d.isExpiringSoon) {
          statusBadge = `<span class="badge badge-doc-expiring" title="Caduca em ${d.daysUntilExpiry} dias">⏰ Expira em ${d.daysUntilExpiry}d</span>`;
        } else if (!d.expiryDate) {
          statusBadge = '<span class="badge badge-doc-permanent">Permanente</span>';
        }

        // Verification Badge
        let verifBadge = '<span class="badge badge-verification-pending">Pendente</span>';
        if (d.verificationStatus === 'VERIFIED') {
          verifBadge = '<span class="badge badge-verification-verified" title="Documento validado e conforme">✓ Conforme</span>';
        } else if (d.verificationStatus === 'REJECTED') {
          verifBadge = '<span class="badge badge-verification-rejected" title="Documento rejeitado">✕ Rejeitado</span>';
        }

        // Access Code Pill
        const accessCodeHtml = d.accessCode
          ? `<span class="access-code-pill" onclick="window.CRMDocuments.copyAccessCode('${escAttr(d.accessCode)}')" title="Clique para copiar código de acesso">🔑 ${esc(d.accessCode)}</span>`
          : '—';

        // Company Link
        const companyHtml = d.company
          ? `<a href="javascript:void(0)" onclick="window.CRMCompanies && window.CRMCompanies.open360Modal('${d.company.id}')" style="font-weight: 600; color: var(--primary);">
              ${esc(d.company.tradeName || 'Empresa')}
             </a>
             ${d.company.taxNumber ? `<div style="font-size: 11px; color: var(--muted);">NIF: ${esc(d.company.taxNumber)}</div>` : ''}`
          : '—';

        return `
          <tr>
            <td>
              <div style="font-weight: 600;">${esc(d.name)}</div>
              ${d.fileName ? `<div style="font-size: 11px; color: var(--muted);">${esc(d.fileName)}</div>` : ''}
            </td>
            <td>${companyHtml}</td>
            <td><span class="badge badge-neutral">${esc(typeLabel)}</span></td>
            <td>${accessCodeHtml}</td>
            <td>
              <div>${fmtDate(d.expiryDate)}</div>
              <div style="margin-top: 4px;">${statusBadge}</div>
            </td>
            <td>${verifBadge}</td>
            <td>
              <div style="display: flex; gap: 6px; align-items: center;">
                ${d.fileUrl ? `<a href="${escAttr(d.fileUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-primary" title="Abrir/Descarregar">Abrir</a>` : ''}
                <button class="btn btn-sm" onclick="window.CRMDocuments.openVerifyModal('${d.id}', '${escAttr(d.name)}')" title="Conformidade">Verificar</button>
                <button class="btn btn-sm btn-danger-ghost" onclick="window.CRMDocuments.deleteDocument('${d.id}', '${escAttr(d.name)}')" title="Remover">✕</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    },

    copyAccessCode(code) {
      if (!code) return;
      navigator.clipboard.writeText(code).then(() => {
        if (window.toast) {
          window.toast('Código de acesso copiado!', 'success');
        } else {
          alert(`Código copiado: ${code}`);
        }
      }).catch(() => {
        prompt('Copie o código de acesso:', code);
      });
    },

    async openUploadModal(companyId) {
      const modal = document.getElementById('modal-upload-document');
      const form = document.getElementById('form-upload-document');
      if (!modal || !form) return;

      form.reset();
      document.getElementById('upload-doc-error-box').style.display = 'none';

      // Carregar lista de empresas se não for especificada
      const companySelect = document.getElementById('upload-doc-company');
      if (companySelect) {
        if (companyId) {
          companySelect.value = companyId;
          companySelect.disabled = true;
        } else {
          companySelect.disabled = false;
          await this.populateCompaniesSelect(companySelect);
        }
      }

      this.currentCompanyId = companyId || null;
      modal.style.display = 'flex';
    },

    async populateCompaniesSelect(selectEl) {
      try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const res = await fetch('/api/crm/companies?limit=100', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          const comps = data.items || [];
          selectEl.innerHTML = '<option value="">Selecione a empresa...</option>' +
            comps.map(c => `<option value="${c.id}">${esc(c.tradeName || c.legalName)} (${c.taxNumber || 'Sem NIF'})</option>`).join('');
        }
      } catch (e) {
        console.error('Erro ao listar empresas:', e);
      }
    },

    closeUploadModal() {
      const modal = document.getElementById('modal-upload-document');
      if (modal) modal.style.display = 'none';
    },

    async handleUploadSubmit(e) {
      e.preventDefault();
      const form = e.target;
      const errorBox = document.getElementById('upload-doc-error-box');
      errorBox.style.display = 'none';

      const companyId = this.currentCompanyId || document.getElementById('upload-doc-company')?.value;
      if (!companyId) {
        errorBox.textContent = 'É obrigatório selecionar a empresa.';
        errorBox.style.display = 'block';
        return;
      }

      const name = document.getElementById('upload-doc-name').value.trim();
      const docType = document.getElementById('upload-doc-type').value;
      const accessCode = document.getElementById('upload-doc-access-code').value.trim() || null;
      const issueDate = document.getElementById('upload-doc-issue-date').value || null;
      const isPermanent = document.getElementById('upload-doc-permanent').checked;
      const expiryDate = isPermanent ? null : (document.getElementById('upload-doc-expiry-date').value || null);
      const notes = document.getElementById('upload-doc-notes').value.trim() || null;

      const fileInput = document.getElementById('upload-doc-file');
      let fileUrl = document.getElementById('upload-doc-url').value.trim() || null;
      let fileName = null;
      let fileSizeBytes = null;
      let mimeType = null;

      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      try {
        // Se houver ficheiro local selecionado, converte para Data URI (base64)
        if (fileInput && fileInput.files && fileInput.files[0]) {
          const file = fileInput.files[0];
          fileName = file.name;
          fileSizeBytes = file.size;
          mimeType = file.type;

          if (file.size > 8 * 1024 * 1024) {
            throw new Error('O ficheiro excede o tamanho máximo permitido de 8MB.');
          }

          fileUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Falha ao ler o ficheiro no navegador.'));
            reader.readAsDataURL(file);
          });
        }

        const payload = {
          name,
          docType,
          fileUrl,
          fileName,
          fileSizeBytes,
          mimeType,
          accessCode,
          issueDate,
          expiryDate,
          notes
        };

        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const res = await fetch(`/api/crm/companies/${companyId}/documents`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || 'Falha ao guardar documento.');
        }

        if (window.toast) window.toast('Documento guardado com sucesso!', 'success');
        this.closeUploadModal();
        this.loadDocuments();

        // Se estiver com modal 360 aberto, atualiza a empresa
        if (window.CRMCompanies && window.CRMCompanies.activeCompanyId === companyId) {
          window.CRMCompanies.loadCompany360(companyId);
        }
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.style.display = 'block';
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    },

    openVerifyModal(docId, docName) {
      const modal = document.getElementById('modal-verify-document');
      const titleEl = document.getElementById('verify-doc-title');
      const idInput = document.getElementById('verify-doc-id');
      const errBox = document.getElementById('verify-doc-error-box');

      if (!modal) return;
      if (titleEl) titleEl.textContent = `Verificação: ${docName}`;
      if (idInput) idInput.value = docId;
      if (errBox) errBox.style.display = 'none';

      document.getElementById('form-verify-document').reset();
      modal.style.display = 'flex';
    },

    closeVerifyModal() {
      const modal = document.getElementById('modal-verify-document');
      if (modal) modal.style.display = 'none';
    },

    async handleVerifySubmit(status) {
      const docId = document.getElementById('verify-doc-id').value;
      const notes = document.getElementById('verify-doc-notes').value.trim();
      const errBox = document.getElementById('verify-doc-error-box');

      try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const res = await fetch(`/api/crm/documents/${docId}/verify`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ status, notes })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Erro ao atualizar verificação.');

        if (window.toast) {
          window.toast(`Documento marcado como ${status === 'VERIFIED' ? 'Conforme' : 'Rejeitado'}.`, 'success');
        }
        this.closeVerifyModal();
        this.loadDocuments();

        if (window.CRMCompanies && window.CRMCompanies.activeCompanyId) {
          window.CRMCompanies.loadCompany360(window.CRMCompanies.activeCompanyId);
        }
      } catch (err) {
        if (errBox) {
          errBox.textContent = err.message;
          errBox.style.display = 'block';
        }
      }
    },

    async deleteDocument(docId, docName) {
      if (!confirm(`Tem a certeza que deseja arquivar/remover o documento "${docName}"?`)) {
        return;
      }

      try {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        const res = await fetch(`/api/crm/documents/${docId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.message || 'Erro ao remover documento.');
        }

        if (window.toast) window.toast('Documento removido com sucesso.', 'success');
        this.loadDocuments();

        if (window.CRMCompanies && window.CRMCompanies.activeCompanyId) {
          window.CRMCompanies.loadCompany360(window.CRMCompanies.activeCompanyId);
        }
      } catch (err) {
        alert(err.message);
      }
    }
  };

  window.CRMDocuments = CRMDocuments;

  document.addEventListener('DOMContentLoaded', () => {
    CRMDocuments.init();
  });
})(window, document);
