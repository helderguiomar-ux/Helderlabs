/**
 * HELDERLABS ERP — MÓDULO FINANCEIRO (FINANCE.JS)
 * Fonte Única de Interface e Ações do Cockpit Financeiro
 */

window.FinanceModule = {
  kpis: null,
  projections: null,
  categories: [],
  accounts: [],
  transactions: [],
  currentFilter: {
    kind: '',
    status: '',
    accountId: '',
    categoryId: '',
    search: ''
  },

  async init() {
    await this.loadInitialData();
    this.render();
  },

  async loadInitialData() {
    try {
      const [dashRes, projRes, accRes, catRes, txRes] = await Promise.all([
        fetch('/api/financas/dashboard').then(r => r.json()),
        fetch('/api/financas/projections?days=90').then(r => r.json()),
        fetch('/api/financas/accounts').then(r => r.json()),
        fetch('/api/financas/categories').then(r => r.json()),
        fetch('/api/financas/transactions').then(r => r.json())
      ]);

      if (dashRes.success) {
        this.kpis = dashRes.kpis;
        this.burnRate = dashRes.burnRate;
        this.budgetStatus = dashRes.budgetStatus;
      }
      if (projRes.success) {
        this.projections = projRes;
      }
      if (accRes.success) {
        this.accounts = accRes.accounts;
      }
      if (catRes.success) {
        this.categories = catRes.categories;
      }
      if (txRes.success) {
        this.transactions = txRes.transactions;
      }
    } catch (err) {
      console.error('[FINANCE INIT ERROR]', err);
    }
  },

  formatEUR(cents) {
    if (cents === undefined || cents === null) return '0,00 €';
    const euros = cents / 100;
    return euros.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
  },

  render() {
    this.renderKPIs();
    this.renderCashFlowChart();
    this.renderBudgets();
    this.renderAccounts();
    this.renderTransactions();
  },

  renderKPIs() {
    const k = this.kpis || {
      currentBalanceCents: 0,
      totalIncomeCents: 0,
      totalExpenseCents: 0,
      netResultCents: 0,
      committedCents: 0,
      overdueCents: 0,
      availableBalanceCents: 0
    };

    const container = document.getElementById('finance-kpi-container');
    if (!container) return;

    container.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-title">
          <span>Saldo Real em Caixa</span>
          <svg class="icon" viewBox="0 0 24 24"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
        </div>
        <div class="kpi-value ${k.currentBalanceCents >= 0 ? 'positive' : 'negative'}">
          ${this.formatEUR(k.currentBalanceCents)}
        </div>
        <div class="kpi-subtext">Total consolidado nas contas</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-title">
          <span>Receitas Realizadas</span>
          <svg class="icon" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
        </div>
        <div class="kpi-value positive">
          ${this.formatEUR(k.totalIncomeCents)}
        </div>
        <div class="kpi-subtext">Entradas efetivas no período</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-title">
          <span>Despesas Realizadas</span>
          <svg class="icon" viewBox="0 0 24 24"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>
        </div>
        <div class="kpi-value negative">
          ${this.formatEUR(k.totalExpenseCents)}
        </div>
        <div class="kpi-subtext">Saídas pagas no período</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-title">
          <span>Resultado Líquido</span>
          <svg class="icon" viewBox="0 0 24 24"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
        <div class="kpi-value ${k.netResultCents >= 0 ? 'positive' : 'negative'}">
          ${this.formatEUR(k.netResultCents)}
        </div>
        <div class="kpi-subtext">Margem operacional real</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-title">
          <span>Comprometido / Pendente</span>
          <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div class="kpi-value warning">
          ${this.formatEUR(k.committedCents)}
        </div>
        <div class="kpi-subtext">Despesas futuras agendadas</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-title">
          <span>Saldo Disponível</span>
          <svg class="icon" viewBox="0 0 24 24"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
        <div class="kpi-value primary">
          ${this.formatEUR(k.availableBalanceCents)}
        </div>
        <div class="kpi-subtext">Saldo livre após compromissos</div>
      </div>
    `;
  },

  renderCashFlowChart() {
    const container = document.getElementById('cashflow-chart-container');
    if (!container || !this.projections || !this.projections.dailyPoints) return;

    const points = this.projections.dailyPoints;
    if (points.length === 0) {
      container.innerHTML = '<p class="kpi-subtext">Sem dados de projeção disponíveis.</p>';
      return;
    }

    const width = 800;
    const height = 180;
    const padding = 30;

    let minVal = Math.min(0, ...points.map(p => p.projectedBalanceCents));
    let maxVal = Math.max(1000, ...points.map(p => p.projectedBalanceCents));
    const range = (maxVal - minVal) || 1;

    const getX = (idx) => padding + (idx / (points.length - 1)) * (width - 2 * padding);
    const getY = (val) => height - padding - ((val - minVal) / range) * (height - 2 * padding);

    const zeroY = getY(0);

    let pathD = `M ${getX(0)} ${getY(points[0].projectedBalanceCents)}`;
    for (let i = 1; i < points.length; i++) {
      pathD += ` L ${getX(i)} ${getY(points[i].projectedBalanceCents)}`;
    }

    const startValStr = this.formatEUR(this.projections.startingBalanceCents);
    const endValStr = this.formatEUR(this.projections.endingBalanceCents);
    const lowestValStr = this.formatEUR(this.projections.lowestProjectedBalanceCents);

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span class="kpi-subtext">Hoje (${this.projections.startDate}): <strong>${startValStr}</strong></span>
        <span class="kpi-subtext">Mínimo Previsto: <strong style="color: var(--warning);">${lowestValStr} (${this.projections.lowestProjectedDate})</strong></span>
        <span class="kpi-subtext">Projeção 90 dias (${this.projections.endDate}): <strong>${endValStr}</strong></span>
      </div>
      <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: 180px; overflow: visible;">
        <!-- Linha Zero -->
        <line x1="${padding}" y1="${zeroY}" x2="${width - padding}" y2="${zeroY}" stroke="var(--border)" stroke-dasharray="4" stroke-width="1" />
        
        <!-- Linha da Projeção -->
        <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        
        <!-- Ponto Inicial -->
        <circle cx="${getX(0)}" cy="${getY(points[0].projectedBalanceCents)}" r="5" fill="var(--accent)" />
        
        <!-- Ponto Final -->
        <circle cx="${getX(points.length - 1)}" cy="${getY(points[points.length - 1].projectedBalanceCents)}" r="5" fill="var(--accent)" />
      </svg>
    `;
  },

  renderBudgets() {
    const container = document.getElementById('finance-budgets-container');
    if (!container || !this.budgetStatus) return;

    if (this.budgetStatus.length === 0) {
      container.innerHTML = '<p class="kpi-subtext">Sem orçamentos definidos para este mês.</p>';
      return;
    }

    container.innerHTML = this.budgetStatus.map(b => {
      const fillClass = b.percentageUsed > 100 ? 'fill-low' : b.percentageUsed > 80 ? 'fill-med' : 'fill-high';
      return `
        <div style="margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px;">
            <span><strong>${b.categoryName}</strong></span>
            <span>${this.formatEUR(b.totalSpentCents)} / ${this.formatEUR(b.budgetAmountCents)} (${b.percentageUsed}%)</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill ${fillClass}" style="width: ${Math.min(100, b.percentageUsed)}%;"></div>
          </div>
        </div>
      `;
    }).join('');
  },

  renderAccounts() {
    const container = document.getElementById('finance-accounts-container');
    if (!container) return;

    if (this.accounts.length === 0) {
      container.innerHTML = '<p class="kpi-subtext">Nenhuma conta bancária registada.</p>';
      return;
    }

    container.innerHTML = `
      <div style="display: flex; gap: 12px; flex-wrap: wrap;">
        ${this.accounts.map(a => `
          <div style="background: var(--page-plane); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 12px 16px; min-width: 200px; flex: 1;">
            <div style="font-size: 12px; color: var(--text-secondary); font-weight: 600;">${a.name} ${a.isDefault ? '<span class="badge badge-neutral">Padrão</span>' : ''}</div>
            <div style="font-size: 18px; font-weight: 700; margin-top: 4px;">${this.formatEUR(a.currentBalanceCents)}</div>
            ${a.iban ? `<div style="font-size: 11px; color: var(--muted); margin-top: 2px;">${a.iban}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  },

  renderTransactions() {
    const tbody = document.getElementById('transactions-table-body');
    if (!tbody) return;

    const filtered = this.transactions.filter(t => {
      if (this.currentFilter.kind && t.kind !== this.currentFilter.kind) return false;
      if (this.currentFilter.status && t.status !== this.currentFilter.status) return false;
      if (this.currentFilter.accountId && t.accountId !== this.currentFilter.accountId) return false;
      if (this.currentFilter.categoryId && t.categoryId !== this.currentFilter.categoryId) return false;
      if (this.currentFilter.search) {
        const s = this.currentFilter.search.toLowerCase();
        const matchDesc = t.description?.toLowerCase().includes(s);
        const matchParty = t.counterpartyName?.toLowerCase().includes(s);
        if (!matchDesc && !matchParty) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--muted); padding: 24px;">Nenhuma transação encontrada.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(t => {
      const isPaid = t.status === 'PAID' || t.paidDate !== null;
      const statusBadge = isPaid
        ? '<span class="badge badge-paid">Pago</span>'
        : '<span class="badge badge-planned">Agendado</span>';

      const kindColor = t.kind === 'INCOME' ? 'color: var(--good);' : 'color: var(--text-primary);';
      const kindSign = t.kind === 'INCOME' ? '+' : '-';

      const dateFormatted = t.dueDate ? new Date(t.dueDate).toLocaleDateString('pt-PT') : '-';

      return `
        <tr>
          <td><strong>${dateFormatted}</strong></td>
          <td>
            <div style="font-weight: 600;">${t.description}</div>
            ${t.counterpartyName ? `<div style="font-size: 11px; color: var(--text-secondary);">${t.counterpartyName}</div>` : ''}
          </td>
          <td><span class="badge badge-neutral">${t.category?.name || 'Geral'}</span></td>
          <td>${t.account?.name || '-'}</td>
          <td style="font-weight: 700; ${kindColor}">
            ${kindSign} ${this.formatEUR(t.amountCents)}
          </td>
          <td>${statusBadge}</td>
          <td style="text-align: right; white-space: nowrap;">
            ${!isPaid ? `
              <button class="btn btn-sm btn-primary" onclick="window.FinanceModule.markAsPaid('${t.id}')">Liquidar</button>
            ` : ''}
            <button class="btn btn-sm" onclick="window.FinanceModule.editTransaction('${t.id}')">Editar</button>
            <button class="btn btn-sm btn-danger" onclick="window.FinanceModule.deleteTransaction('${t.id}')">Eliminar</button>
          </td>
        </tr>
      `;
    }).join('');
  },

  async markAsPaid(id) {
    try {
      const res = await fetch(`/api/financas/transactions/${id}/pay`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPaid: true })
      });
      if (res.ok) {
        await this.init();
      }
    } catch (err) {
      console.error('[MARK AS PAID ERROR]', err);
    }
  },

  async deleteTransaction(id) {
    if (!confirm('Deseja arquivar esta transação? (Poderá recuperá-la mais tarde)')) return;
    try {
      const res = await fetch(`/api/financas/transactions/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await this.init();
      }
    } catch (err) {
      console.error('[DELETE TRANSACTION ERROR]', err);
    }
  },

  openCreateModal() {
    const modal = document.getElementById('modal-create-transaction');
    if (modal) {
      modal.classList.add('show');
    }
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('show');
    }
  },

  async submitCreateTransaction(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);

    const payload = {
      description: formData.get('description'),
      kind: formData.get('kind'),
      amountCents: Math.round(parseFloat(formData.get('amount')) * 100),
      dueDate: formData.get('dueDate'),
      status: formData.get('status') || 'PLANNED',
      accountId: formData.get('accountId') || null,
      categoryId: formData.get('categoryId') || null,
      counterpartyName: formData.get('counterpartyName') || null,
      notes: formData.get('notes') || null
    };

    try {
      const res = await fetch('/api/financas/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        this.closeModal('modal-create-transaction');
        form.reset();
        await this.init();
      } else {
        const errData = await res.json();
        alert('Erro ao criar transação: ' + (errData.message || 'Verifique os dados.'));
      }
    } catch (err) {
      console.error('[SUBMIT TRANSACTION ERROR]', err);
    }
  }
};
