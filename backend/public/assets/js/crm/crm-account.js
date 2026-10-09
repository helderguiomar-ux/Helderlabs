/**
 * CRM Account Entries & Statement Module (Fase B7)
 * Conta Corrente de Clientes, Extrato Progressivo, Alocação de Pagamentos e Análise de Antiguidade (Aging).
 * 
 * Salvaguarda Legal Inviolável:
 * Registo de documentos emitidos no software de faturação certificado.
 * O HelderLabs CRM não emite faturas nem serve de documento fiscal.
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

  function fmtEur(cents) {
    if (typeof cents !== 'number' || isNaN(cents)) return '€0,00';
    return '€' + (cents / 100).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  const ENTRY_TYPE_LABELS = {
    INVOICE: 'Fatura (Externa)',
    PAYMENT: 'Pagamento / Recibo',
    DEBIT_NOTE: 'Nota de Débito',
    CREDIT_NOTE: 'Nota de Crédito',
    OPENING_BALANCE: 'Saldo de Abertura',
    REFUND: 'Reembolso / Devolução',
    ADJUSTMENT: 'Ajuste de Saldo',
    REVERSAL: 'Estorno (Anulação)'
  };

  const ENTRY_TYPE_BADGES = {
    INVOICE: '<span class="crm-badge" style="background:#fee2e2; color:#991b1b; font-weight:600;">Fatura</span>',
    PAYMENT: '<span class="crm-badge" style="background:#dcfce7; color:#166534; font-weight:600;">Pagamento</span>',
    DEBIT_NOTE: '<span class="crm-badge" style="background:#fef3c7; color:#92400e; font-weight:600;">Nota Débito</span>',
    CREDIT_NOTE: '<span class="crm-badge" style="background:#e0f2fe; color:#075985; font-weight:600;">Nota Crédito</span>',
    OPENING_BALANCE: '<span class="crm-badge" style="background:#f3f4f6; color:#374151;">Saldo Abertura</span>',
    REFUND: '<span class="crm-badge" style="background:#fce7f3; color:#9d174d;">Reembolso</span>',
    ADJUSTMENT: '<span class="crm-badge" style="background:#ede9fe; color:#5b21b6;">Ajuste</span>',
    REVERSAL: '<span class="crm-badge" style="background:#f1f5f9; color:#475569; text-decoration:line-through;">Estorno</span>'
  };

  const PAYMENT_METHODS = {
    TRANSFER: 'Transferência Bancária',
    MBWAY: 'MB WAY',
    MULTIBANCO: 'Referência Multibanco',
    CARD: 'Cartão de Débito / Crédito',
    CASH: 'Numerário / Pronto',
    DIRECT_DEBIT: 'Débito Direto SEPA',
    OTHER: 'Outro Método'
  };

  const CRMAccount = {
    currentCompanyId: null,
    statement: null,
    balances: null,
    summary: null,
    filterStatus: 'ALL',

    init() {
      // Listener para sub-vista se existir
    },

    async loadCompanyAccount(companyId) {
      this.currentCompanyId = companyId;
      const container = document.getElementById('company-tab-account');
      if (!container) return;

      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #64748b;">
          <div class="spinner" style="display:inline-block; margin-bottom: 12px;"></div>
          <div>A carregar conta corrente e extrato contabilístico integrado...</div>
        </div>
      `;

      try {
        const [statementRes, balancesRes] = await Promise.all([
          window.appFetch(`/api/crm/companies/${companyId}/account/statement?status=${this.filterStatus}`),
          window.appFetch(`/api/crm/companies/${companyId}/account/balances`)
        ]);

        if (!statementRes.ok || !balancesRes.ok) {
          throw new Error('Falha ao carregar dados da conta corrente.');
        }

        this.statement = await statementRes.json();
        this.balances = await balancesRes.json();
        this.renderCompanyAccount(container);
      } catch (err) {
        console.error('Erro ao carregar conta corrente:', err);
        container.innerHTML = `
          <div class="empty-state" style="padding: 30px; text-align: center;">
            <p style="color: #ef4444; font-weight: 500;">Não foi possível carregar a conta corrente.</p>
            <p style="font-size: 13px; color: #64748b;">${esc(err.message)}</p>
            <button class="btn btn-secondary" onclick="CRMAccount.loadCompanyAccount('${esc(companyId)}')">Tentar novamente</button>
          </div>
        `;
      }
    },

    renderCompanyAccount(container) {
      const st = this.statement || {};
      const b = this.balances || {};
      const aging = b.aging || {};
      const entries = st.entries || [];

      const balanceColor = st.balanceCents > 0 ? '#b91c1c' : (st.balanceCents < 0 ? '#15803d' : '#0f172a');

      container.innerHTML = `
        <!-- Salvaguarda Legal Inviolável -->
        <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 4px; margin-bottom: 20px; font-size: 12px; color: #78350f;">
          <strong>Aviso Regulamentar Obrigatório:</strong> Registo de documentos emitidos no seu software de faturação certificado. O HelderLabs CRM não emite faturas nem serve de documento fiscal nos termos do artigo 36.º do CIVA.
        </div>

        <!-- Ações do Cabeçalho -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
          <div>
            <h3 style="margin: 0 0 4px 0; font-size: 18px; font-weight: 700; color: #0f172a;">Conta Corrente — ${esc(st.company?.tradeName)}</h3>
            <p style="margin: 0; font-size: 13px; color: #64748b;">Posição financeira e histórico integrado de documentos e liquidações.</p>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="btn btn-primary" onclick="CRMAccount.openNewEntryModal('${esc(this.currentCompanyId)}')">
              + Novo Lançamento
            </button>
            <button class="btn btn-secondary" onclick="CRMAccount.printStatement('${esc(this.currentCompanyId)}')">
              Imprimir Extrato A4
            </button>
            <button class="btn btn-secondary" onclick="CRMAccount.openSendEmailModal('${esc(this.currentCompanyId)}')">
              Enviar por Email
            </button>
          </div>
        </div>

        <!-- Painel de Indicadores de Saldo -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px;">
          <div class="card" style="padding: 16px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">Total Faturado / Débitos</div>
            <div style="font-size: 20px; font-weight: 800; color: #dc2626; margin-top: 4px;">${fmtEur(st.totalDebitCents)}</div>
          </div>
          <div class="card" style="padding: 16px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">Total Liquidado / Créditos</div>
            <div style="font-size: 20px; font-weight: 800; color: #16a34a; margin-top: 4px;">${fmtEur(st.totalCreditCents)}</div>
          </div>
          <div class="card" style="padding: 16px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">Saldo Atual do Cliente</div>
            <div style="font-size: 20px; font-weight: 800; color: ${balanceColor}; margin-top: 4px;">${fmtEur(st.balanceCents)}</div>
          </div>
          <div class="card" style="padding: 16px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">Saldo Vencido em Atraso</div>
            <div style="font-size: 20px; font-weight: 800; color: #ea580c; margin-top: 4px;">${fmtEur(st.overdueBalanceCents)}</div>
          </div>
        </div>

        <!-- Análise de Antiguidade da Dívida (Aging) -->
        <div class="card" style="padding: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 24px;">
          <div style="font-size: 13px; font-weight: 700; color: #1e293b; margin-bottom: 12px; display: flex; justify-content: space-between;">
            <span>Antiguidade dos Valores Pendentes (Aging)</span>
            <span style="font-size: 12px; font-weight: normal; color: #64748b;">Escalões de vencimento</span>
          </div>
          <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; text-align: center;">
            <div style="background: #fff; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0;">
              <div style="font-size: 11px; color: #64748b;">Corrente (Não Vencido)</div>
              <div style="font-size: 14px; font-weight: 700; color: #15803d; margin-top: 4px;">${fmtEur(aging.currentCents || 0)}</div>
            </div>
            <div style="background: #fff; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0;">
              <div style="font-size: 11px; color: #64748b;">1 a 30 dias</div>
              <div style="font-size: 14px; font-weight: 700; color: #ca8a04; margin-top: 4px;">${fmtEur(aging.overdue1to30Cents || 0)}</div>
            </div>
            <div style="background: #fff; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0;">
              <div style="font-size: 11px; color: #64748b;">31 a 60 dias</div>
              <div style="font-size: 14px; font-weight: 700; color: #ea580c; margin-top: 4px;">${fmtEur(aging.overdue31to60Cents || 0)}</div>
            </div>
            <div style="background: #fff; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0;">
              <div style="font-size: 11px; color: #64748b;">61 a 90 dias</div>
              <div style="font-size: 14px; font-weight: 700; color: #dc2626; margin-top: 4px;">${fmtEur(aging.overdue61to90Cents || 0)}</div>
            </div>
            <div style="background: #fff; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0;">
              <div style="font-size: 11px; color: #64748b;">> 90 dias (Crítico)</div>
              <div style="font-size: 14px; font-weight: 800; color: #991b1b; margin-top: 4px;">${fmtEur(aging.overdueOver90Cents || 0)}</div>
            </div>
          </div>
        </div>

        <!-- Tabela do Extrato de Lançamentos -->
        <div class="card" style="background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
          <div style="padding: 14px 16px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; background: #fafafa;">
            <div style="font-weight: 700; font-size: 14px; color: #0f172a;">Lançamentos de Conta Corrente</div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <select class="form-control" style="font-size: 12px; padding: 4px 8px; width: auto;" onchange="CRMAccount.changeStatusFilter(this.value)">
                <option value="ALL" ${this.filterStatus === 'ALL' ? 'selected' : ''}>Todos os Movimentos</option>
                <option value="OPEN" ${this.filterStatus === 'OPEN' ? 'selected' : ''}>Apenas em Aberto / Pendentes</option>
                <option value="SETTLED" ${this.filterStatus === 'SETTLED' ? 'selected' : ''}>Liquidados ou Estornados</option>
              </select>
            </div>
          </div>

          <div style="overflow-x: auto;">
            <table class="table" style="width: 100%; border-collapse: collapse; font-size: 13px;">
              <thead>
                <tr style="background: #f1f5f9; text-align: left; color: #475569; font-size: 11px; text-transform: uppercase;">
                  <th style="padding: 10px 12px;">Data</th>
                  <th style="padding: 10px 12px;">Tipo</th>
                  <th style="padding: 10px 12px;">Doc. / N.º Faturação</th>
                  <th style="padding: 10px 12px;">Vencimento</th>
                  <th style="padding: 10px 12px; text-align: right;">Débito</th>
                  <th style="padding: 10px 12px; text-align: right;">Crédito</th>
                  <th style="padding: 10px 12px; text-align: right;">Saldo Acum.</th>
                  <th style="padding: 10px 12px; text-align: center;">Pendente</th>
                  <th style="padding: 10px 12px; text-align: center;">Ações</th>
                </tr>
              </thead>
              <tbody>
                ${entries.length === 0 ? `
                  <tr>
                    <td colspan="9" style="text-align: center; padding: 30px; color: #94a3b8;">
                      Nenhum lançamento registado nesta conta corrente.
                    </td>
                  </tr>
                ` : entries.map(e => `
                  <tr style="${e.isReversed ? 'text-decoration: line-through; opacity: 0.6; background: #fdf2f2;' : ''} border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 10px 12px;">${fmtDate(e.entryDate)}</td>
                    <td style="padding: 10px 12px;">${ENTRY_TYPE_BADGES[e.type] || esc(e.type)}</td>
                    <td style="padding: 10px 12px; font-weight: 500;">
                      ${esc(e.externalDocumentNumber || e.reference || '—')}
                      ${e.notes ? `<div style="font-size: 11px; color: #64748b;">${esc(e.notes)}</div>` : ''}
                      ${e.reversesEntryId ? `<div style="font-size: 10px; color: #ef4444;">Estorno ref. #${esc(e.reversesEntryId.slice(-6))}</div>` : ''}
                    </td>
                    <td style="padding: 10px 12px;">${fmtDate(e.dueDate)}</td>
                    <td style="padding: 10px 12px; text-align: right; color: #dc2626; font-weight: ${e.debitCents > 0 ? '600' : 'normal'};">
                      ${e.debitCents > 0 ? fmtEur(e.debitCents) : '—'}
                    </td>
                    <td style="padding: 10px 12px; text-align: right; color: #16a34a; font-weight: ${e.creditCents > 0 ? '600' : 'normal'};">
                      ${e.creditCents > 0 ? fmtEur(e.creditCents) : '—'}
                    </td>
                    <td style="padding: 10px 12px; text-align: right; font-weight: 700; color: ${e.runningBalanceCents > 0 ? '#b91c1c' : '#15803d'};">
                      ${fmtEur(e.runningBalanceCents)}
                    </td>
                    <td style="padding: 10px 12px; text-align: center;">
                      ${e.isReversed ? '<span style="color:#64748b; font-size:11px;">Estornado</span>' : (
                        e.isSettled ? '<span style="color:#16a34a; font-size:11px; font-weight:600;">Liquidado</span>' : (
                          `<span style="color:#dc2626; font-weight:600; font-size:12px;">${fmtEur(e.pendingCents)}</span>`
                        )
                      )}
                    </td>
                    <td style="padding: 10px 12px; text-align: center; white-space: nowrap;">
                      ${!e.isReversed && e.type !== 'REVERSAL' ? `
                        <button class="btn btn-sm btn-outline-danger" title="Estornar lançamento" onclick="CRMAccount.openReverseModal('${esc(e.id)}', '${esc(e.externalDocumentNumber || e.type)}', ${e.amountCents})">
                          Estornar
                        </button>
                      ` : ''}
                      ${!e.isReversed && ['PAYMENT', 'CREDIT_NOTE'].includes(e.type) && e.pendingCents > 0 ? `
                        <button class="btn btn-sm btn-outline-primary" style="margin-left: 4px;" title="Alocar a faturas pendentes" onclick="CRMAccount.openAllocateModal('${esc(e.id)}', ${e.pendingCents})">
                          Alocar
                        </button>
                      ` : ''}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    },

    changeStatusFilter(status) {
      this.filterStatus = status;
      this.loadCompanyAccount(this.currentCompanyId);
    },

    openNewEntryModal(companyId) {
      const modal = document.getElementById('crm-account-entry-modal');
      if (!modal) {
        this.createModals();
      }
      document.getElementById('crm-entry-company-id').value = companyId;
      document.getElementById('crm-entry-type').value = 'INVOICE';
      document.getElementById('crm-entry-amount').value = '';
      document.getElementById('crm-entry-doc-number').value = '';
      document.getElementById('crm-entry-date').value = new Date().toISOString().split('T')[0];
      document.getElementById('crm-entry-due-date').value = '';
      document.getElementById('crm-entry-method').value = 'TRANSFER';
      document.getElementById('crm-entry-notes').value = '';
      document.getElementById('crm-entry-auto-allocate').checked = true;

      this.onEntryTypeChange('INVOICE');
      window.openModal('crm-account-entry-modal');
    },

    onEntryTypeChange(type) {
      const docWrap = document.getElementById('crm-entry-doc-number-wrap');
      const dueWrap = document.getElementById('crm-entry-due-date-wrap');
      const methodWrap = document.getElementById('crm-entry-method-wrap');
      const autoAllocWrap = document.getElementById('crm-entry-auto-allocate-wrap');

      const isDoc = ['INVOICE', 'DEBIT_NOTE', 'CREDIT_NOTE'].includes(type);
      const isPayment = type === 'PAYMENT';

      if (docWrap) {
        docWrap.style.display = isDoc ? 'block' : 'none';
        const docInput = document.getElementById('crm-entry-doc-number');
        if (docInput) docInput.required = isDoc;
      }
      if (dueWrap) {
        dueWrap.style.display = ['INVOICE', 'DEBIT_NOTE'].includes(type) ? 'block' : 'none';
      }
      if (methodWrap) {
        methodWrap.style.display = isPayment ? 'block' : 'none';
      }
      if (autoAllocWrap) {
        autoAllocWrap.style.display = isPayment ? 'block' : 'none';
      }
    },

    async submitEntry(e) {
      if (e) e.preventDefault();
      const companyId = document.getElementById('crm-entry-company-id').value;
      const type = document.getElementById('crm-entry-type').value;
      const amountEur = parseFloat(document.getElementById('crm-entry-amount').value || '0');
      const docNumber = document.getElementById('crm-entry-doc-number').value.trim();
      const entryDate = document.getElementById('crm-entry-date').value;
      const dueDate = document.getElementById('crm-entry-due-date').value;
      const method = document.getElementById('crm-entry-method').value;
      const notes = document.getElementById('crm-entry-notes').value.trim();
      const autoAllocate = document.getElementById('crm-entry-auto-allocate').checked;

      if (!amountEur || amountEur <= 0) {
        alert('Por favor, indique um montante válido superior a zero.');
        return;
      }

      if (['INVOICE', 'DEBIT_NOTE', 'CREDIT_NOTE'].includes(type) && !docNumber) {
        alert('O número do documento emitido no software de faturação é obrigatório.');
        return;
      }

      const payload = {
        type,
        amountCents: Math.round(amountEur * 100),
        externalDocumentNumber: docNumber || null,
        entryDate: entryDate || undefined,
        dueDate: dueDate || undefined,
        method: type === 'PAYMENT' ? method : undefined,
        notes: notes || undefined,
        autoAllocate: type === 'PAYMENT' && autoAllocate
      };

      try {
        const res = await window.appFetch(`/api/crm/companies/${companyId}/account/entries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Erro ao gravar lançamento de conta corrente.');
        }

        window.closeModal('crm-account-entry-modal');
        this.loadCompanyAccount(companyId);
      } catch (err) {
        alert(err.message);
      }
    },

    openReverseModal(entryId, docNumber, amountCents) {
      const modal = document.getElementById('crm-account-reverse-modal');
      if (!modal) {
        this.createModals();
      }
      document.getElementById('crm-reverse-entry-id').value = entryId;
      document.getElementById('crm-reverse-desc').innerText = `Lançamento ${docNumber} no valor de ${fmtEur(amountCents)}`;
      document.getElementById('crm-reverse-reason').value = '';
      window.openModal('crm-account-reverse-modal');
    },

    async submitReversal(e) {
      if (e) e.preventDefault();
      const entryId = document.getElementById('crm-reverse-entry-id').value;
      const reason = document.getElementById('crm-reverse-reason').value.trim();

      if (!reason) {
        alert('É obrigatório justificar o motivo do estorno para efeitos de auditoria.');
        return;
      }

      try {
        const res = await window.appFetch(`/api/crm/account/entries/${entryId}/reverse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Erro ao efetuar estorno.');
        }

        window.closeModal('crm-account-reverse-modal');
        this.loadCompanyAccount(this.currentCompanyId);
      } catch (err) {
        alert(err.message);
      }
    },

    openAllocateModal(paymentEntryId, availableCents) {
      const modal = document.getElementById('crm-account-allocate-modal');
      if (!modal) {
        this.createModals();
      }
      document.getElementById('crm-allocate-payment-id').value = paymentEntryId;
      document.getElementById('crm-allocate-max-cents').value = availableCents;
      document.getElementById('crm-allocate-available-desc').innerText = `Saldo disponível para alocação: ${fmtEur(availableCents)}`;

      // Povoar faturas abertas no select
      const select = document.getElementById('crm-allocate-doc-select');
      select.innerHTML = '';

      const openDocs = (this.statement?.entries || []).filter(
        e => ['INVOICE', 'DEBIT_NOTE', 'OPENING_BALANCE'].includes(e.type) && e.pendingCents > 0 && !e.isReversed
      );

      if (openDocs.length === 0) {
        select.innerHTML = '<option value="">Sem documentos em aberto para liquidar</option>';
      } else {
        openDocs.forEach(d => {
          const opt = document.createElement('option');
          opt.value = d.id;
          opt.innerText = `${d.externalDocumentNumber || d.type} (Pendente: ${fmtEur(d.pendingCents)})`;
          opt.dataset.pendingCents = d.pendingCents;
          select.appendChild(opt);
        });
        this.onAllocateDocChange();
      }

      window.openModal('crm-account-allocate-modal');
    },

    onAllocateDocChange() {
      const select = document.getElementById('crm-allocate-doc-select');
      const selected = select.options[select.selectedIndex];
      if (!selected || !selected.dataset.pendingCents) return;

      const pendingDoc = parseInt(selected.dataset.pendingCents, 10);
      const availablePayment = parseInt(document.getElementById('crm-allocate-max-cents').value, 10);

      const maxAllocatable = Math.min(pendingDoc, availablePayment);
      document.getElementById('crm-allocate-amount').value = (maxAllocatable / 100).toFixed(2);
    },

    async submitAllocation(e) {
      if (e) e.preventDefault();
      const paymentEntryId = document.getElementById('crm-allocate-payment-id').value;
      const documentEntryId = document.getElementById('crm-allocate-doc-select').value;
      const amountEur = parseFloat(document.getElementById('crm-allocate-amount').value || '0');

      if (!documentEntryId) {
        alert('Selecione um documento válido a liquidar.');
        return;
      }
      if (!amountEur || amountEur <= 0) {
        alert('Indique um montante válido para alocação.');
        return;
      }

      const payload = {
        paymentEntryId,
        documentEntryId,
        amountCents: Math.round(amountEur * 100)
      };

      try {
        const res = await window.appFetch(`/api/crm/companies/${this.currentCompanyId}/account/allocate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Erro ao alocar pagamento.');
        }

        window.closeModal('crm-account-allocate-modal');
        this.loadCompanyAccount(this.currentCompanyId);
      } catch (err) {
        alert(err.message);
      }
    },

    printStatement(companyId) {
      window.open(`/api/crm/companies/${companyId}/account/statement/print`, '_blank');
    },

    openSendEmailModal(companyId) {
      const modal = document.getElementById('crm-account-email-modal');
      if (!modal) {
        this.createModals();
      }
      const clientEmail = this.statement?.company?.email || '';
      document.getElementById('crm-email-target').value = clientEmail;
      document.getElementById('crm-email-notes').value = '';
      window.openModal('crm-account-email-modal');
    },

    async submitSendEmail(e) {
      if (e) e.preventDefault();
      const to = document.getElementById('crm-email-target').value.trim();
      const notes = document.getElementById('crm-email-notes').value.trim();

      if (!to || !to.includes('@')) {
        alert('Indique um endereço de email válido.');
        return;
      }

      try {
        const res = await window.appFetch(`/api/crm/companies/${this.currentCompanyId}/account/statement/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to, notes: notes || undefined })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'Erro ao enviar extrato por email.');
        }

        window.closeModal('crm-account-email-modal');
        alert('Extrato de conta corrente enviado com sucesso por email!');
      } catch (err) {
        alert(err.message);
      }
    },

    createModals() {
      if (document.getElementById('crm-account-modals-container')) return;

      const container = document.createElement('div');
      container.id = 'crm-account-modals-container';
      container.innerHTML = `
        <!-- Modal: Novo Lançamento -->
        <div id="crm-account-entry-modal" class="modal">
          <div class="modal-content" style="max-width: 550px;">
            <div class="modal-header">
              <h3>Novo Lançamento na Conta Corrente</h3>
              <button class="modal-close" onclick="window.closeModal('crm-account-entry-modal')">&times;</button>
            </div>
            <form onsubmit="CRMAccount.submitEntry(event)">
              <input type="hidden" id="crm-entry-company-id">
              
              <div style="background: #fffbeb; border: 1px solid #fef3c7; padding: 10px; border-radius: 4px; font-size: 11px; color: #92400e; margin-bottom: 16px;">
                <strong>Aviso:</strong> O HelderLabs CRM não emite faturas fiscais. Registe aqui os documentos emitidos no seu software de faturação certificado.
              </div>

              <div class="form-group">
                <label>Tipo de Lançamento *</label>
                <select id="crm-entry-type" class="form-control" onchange="CRMAccount.onEntryTypeChange(this.value)">
                  <option value="INVOICE">Fatura Emitida (Externa)</option>
                  <option value="PAYMENT">Pagamento Recebido</option>
                  <option value="DEBIT_NOTE">Nota de Débito</option>
                  <option value="CREDIT_NOTE">Nota de Crédito</option>
                  <option value="OPENING_BALANCE">Saldo de Abertura</option>
                  <option value="REFUND">Reembolso / Devolução</option>
                </select>
              </div>

              <div class="form-group" id="crm-entry-doc-number-wrap">
                <label>N.º do Documento Externo (ex.: FT 2026/104) *</label>
                <input type="text" id="crm-entry-doc-number" class="form-control" placeholder="FT 2026/001">
                <small style="color: #64748b; font-size: 11px;">Identificador emitido no seu software de faturação.</small>
              </div>

              <div class="form-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div class="form-group">
                  <label>Montante (€) *</label>
                  <input type="number" step="0.01" min="0.01" id="crm-entry-amount" class="form-control" placeholder="0.00" required>
                </div>
                <div class="form-group">
                  <label>Data do Movimento *</label>
                  <input type="date" id="crm-entry-date" class="form-control" required>
                </div>
              </div>

              <div class="form-group" id="crm-entry-due-date-wrap">
                <label>Data de Vencimento</label>
                <input type="date" id="crm-entry-due-date" class="form-control">
              </div>

              <div class="form-group" id="crm-entry-method-wrap" style="display: none;">
                <label>Método de Pagamento</label>
                <select id="crm-entry-method" class="form-control">
                  <option value="TRANSFER">Transferência Bancária</option>
                  <option value="MBWAY">MB WAY</option>
                  <option value="MULTIBANCO">Referência Multibanco</option>
                  <option value="CARD">Cartão</option>
                  <option value="CASH">Pronto / Numerário</option>
                  <option value="DIRECT_DEBIT">Débito Direto SEPA</option>
                  <option value="OTHER">Outro</option>
                </select>
              </div>

              <div class="form-group" id="crm-entry-auto-allocate-wrap" style="display: none;">
                <label style="display: flex; align-items: center; gap: 8px; font-weight: normal; font-size: 13px; cursor: pointer;">
                  <input type="checkbox" id="crm-entry-auto-allocate" checked>
                  Alocar automaticamente às faturas em aberto mais antigas (FIFO)
                </label>
              </div>

              <div class="form-group">
                <label>Notas / Descrição</label>
                <textarea id="crm-entry-notes" class="form-control" rows="2" placeholder="Observações opcionais..."></textarea>
              </div>

              <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
                <button type="button" class="btn btn-secondary" onclick="window.closeModal('crm-account-entry-modal')">Cancelar</button>
                <button type="submit" class="btn btn-primary">Gravar Lançamento</button>
              </div>
            </form>
          </div>
        </div>

        <!-- Modal: Estorno de Lançamento -->
        <div id="crm-account-reverse-modal" class="modal">
          <div class="modal-content" style="max-width: 480px;">
            <div class="modal-header">
              <h3>Estorno de Lançamento (Imutabilidade)</h3>
              <button class="modal-close" onclick="window.closeModal('crm-account-reverse-modal')">&times;</button>
            </div>
            <form onsubmit="CRMAccount.submitReversal(event)">
              <input type="hidden" id="crm-reverse-entry-id">
              
              <div style="background: #fef2f2; border: 1px solid #fee2e2; padding: 12px; border-radius: 6px; font-size: 12px; color: #991b1b; margin-bottom: 16px;">
                <strong>Atenção:</strong> Por razões de conformidade e auditoria, os lançamentos de conta corrente são estritamente imutáveis. O estorno criará um contra-lançamento e cancelará as alocações ativas.
              </div>

              <div style="margin-bottom: 14px; font-size: 13px; font-weight: 600;" id="crm-reverse-desc"></div>

              <div class="form-group">
                <label>Motivo do Estorno *</label>
                <textarea id="crm-reverse-reason" class="form-control" rows="3" placeholder="Indique a justificação comercial ou retificação necessária..." required></textarea>
              </div>

              <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
                <button type="button" class="btn btn-secondary" onclick="window.closeModal('crm-account-reverse-modal')">Cancelar</button>
                <button type="submit" class="btn btn-danger">Confirmar Estorno</button>
              </div>
            </form>
          </div>
        </div>

        <!-- Modal: Alocação Manual de Pagamento -->
        <div id="crm-account-allocate-modal" class="modal">
          <div class="modal-content" style="max-width: 500px;">
            <div class="modal-header">
              <h3>Alocar Pagamento a Documento Pendente</h3>
              <button class="modal-close" onclick="window.closeModal('crm-account-allocate-modal')">&times;</button>
            </div>
            <form onsubmit="CRMAccount.submitAllocation(event)">
              <input type="hidden" id="crm-allocate-payment-id">
              <input type="hidden" id="crm-allocate-max-cents">

              <div id="crm-allocate-available-desc" style="font-size: 13px; font-weight: 600; color: #166534; margin-bottom: 14px;"></div>

              <div class="form-group">
                <label>Fatura ou Documento Pendente *</label>
                <select id="crm-allocate-doc-select" class="form-control" onchange="CRMAccount.onAllocateDocChange()"></select>
              </div>

              <div class="form-group">
                <label>Montante a Alocar (€) *</label>
                <input type="number" step="0.01" min="0.01" id="crm-allocate-amount" class="form-control" required>
              </div>

              <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
                <button type="button" class="btn btn-secondary" onclick="window.closeModal('crm-account-allocate-modal')">Cancelar</button>
                <button type="submit" class="btn btn-primary">Efetuar Alocação</button>
              </div>
            </form>
          </div>
        </div>

        <!-- Modal: Enviar Extrato por Email -->
        <div id="crm-account-email-modal" class="modal">
          <div class="modal-content" style="max-width: 500px;">
            <div class="modal-header">
              <h3>Enviar Extrato de Conta Corrente</h3>
              <button class="modal-close" onclick="window.closeModal('crm-account-email-modal')">&times;</button>
            </div>
            <form onsubmit="CRMAccount.submitSendEmail(event)">
              <div class="form-group">
                <label>Destinatário (Email) *</label>
                <input type="email" id="crm-email-target" class="form-control" required placeholder="financeiro@empresa.pt">
              </div>

              <div class="form-group">
                <label>Mensagem / Observações (Opcional)</label>
                <textarea id="crm-email-notes" class="form-control" rows="3" placeholder="Informação adicional para o cliente..."></textarea>
              </div>

              <div style="font-size: 11px; color: #64748b; margin-top: 8px;">
                O email é expedido via motor configurado pelo tenant com salvaguarda fiscal automática.
              </div>

              <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
                <button type="button" class="btn btn-secondary" onclick="window.closeModal('crm-account-email-modal')">Cancelar</button>
                <button type="submit" class="btn btn-primary">Enviar Extrato</button>
              </div>
            </form>
          </div>
        </div>
      `;

      document.body.appendChild(container);
    }
  };

  window.CRMAccount = CRMAccount;
  document.addEventListener('DOMContentLoaded', () => CRMAccount.init());
})(window, document);
