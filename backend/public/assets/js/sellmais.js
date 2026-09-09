/**
 * HELDERLABS ERP — 2SELLMAIS (SELLMAIS.JS)
 * Gestão de Inventário, Antiguidades, Custos de Restauro, Consignações e Leilões
 */

window.SellmaisModule = {
  items: [],
  types: [],
  locations: [],
  valuation: null,
  selectedItem: null,
  currentFilter: {
    status: '',
    search: '',
    typeId: '',
    acquisitionType: ''
  },

  async init() {
    await Promise.all([
      this.loadTypes(),
      this.loadItems(),
      this.loadValuation()
    ]);
    this.render();
  },

  async loadTypes() {
    try {
      const fetchFn = window.apiFetch || fetch;
      const res = await fetchFn('/api/sellmais/types');
      const data = await res.json();
      if (data.success) {
        this.types = data.types || data.itemTypes || [];
      }
    } catch (err) {
      console.error('[SELLMAIS LOAD TYPES ERROR]', err);
    }
  },

  async loadItems() {
    try {
      const params = new URLSearchParams();
      if (this.currentFilter.status) params.append('status', this.currentFilter.status);
      if (this.currentFilter.typeId) params.append('typeId', this.currentFilter.typeId);
      if (this.currentFilter.acquisitionType) params.append('acquisitionType', this.currentFilter.acquisitionType);
      if (this.currentFilter.search) params.append('search', this.currentFilter.search);

      const fetchFn = window.apiFetch || fetch;
      const res = await fetchFn(`/api/sellmais/items?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        this.items = data.items || [];
      }
    } catch (err) {
      console.error('[SELLMAIS LOAD ITEMS ERROR]', err);
    }
  },

  async loadValuation() {
    try {
      const fetchFn = window.apiFetch || fetch;
      const res = await fetchFn('/api/sellmais/valuation');
      const data = await res.json();
      if (data.success) {
        this.valuation = data;
      }
    } catch (err) {
      console.error('[SELLMAIS LOAD VALUATION ERROR]', err);
    }
  },

  render() {
    this.renderMetrics();
    this.renderItemsTable();
    this.populateTypeDropdowns();
  },

  renderMetrics() {
    const container = document.getElementById('sellmais-metrics-container');
    if (!container) return;

    const v = this.valuation || {
      totalItems: this.items.length,
      availableCount: this.items.filter(i => i.status === 'AVAILABLE').length,
      totalAcquisitionCents: 0,
      totalExtraCostsCents: 0,
      totalCostCents: 0,
      potentialRevenueCents: 0
    };

    const costEur = (v.totalCostCents / 100).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const revenueEur = (v.potentialRevenueCents / 100).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    container.innerHTML = `
      <div class="kpi-card">
        <div class="kpi-title">Total de Artigos</div>
        <div class="kpi-value primary">${v.totalItems || this.items.length}</div>
        <div class="kpi-subtext">${v.availableCount || 0} disponíveis para venda</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Custo Materializado em Stock</div>
        <div class="kpi-value">${costEur} €</div>
        <div class="kpi-subtext">Aquisições + Restauros</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Valor Potencial de Venda</div>
        <div class="kpi-value positive">${revenueEur} €</div>
        <div class="kpi-subtext">PVP de catálogo ativo</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Catálogo Público SSR</div>
        <div class="kpi-value warning"><a href="/loja" target="_blank" style="color:inherit; text-decoration:none;">/loja ↗</a></div>
        <div class="kpi-subtext">SEO + JSON-LD Schema.org</div>
      </div>
    `;
  },

  renderItemsTable() {
    const tbody = document.getElementById('sellmais-items-tbody');
    if (!tbody) return;

    if (this.items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:32px; color:var(--text-secondary);">Nenhum artigo encontrado no inventário.</td></tr>`;
      return;
    }

    tbody.innerHTML = this.items.map(it => {
      const askEur = it.askingPriceCents ? `${(it.askingPriceCents / 100).toFixed(2)} €` : '—';
      const costEur = it.totalCostCents !== undefined ? `${(it.totalCostCents / 100).toFixed(2)} €` : 'Confidencial';
      const statusBadge = this.getStatusBadge(it.status);

      return `
        <tr>
          <td><strong style="font-family:'IBM Plex Mono',monospace; color:var(--primary);">${it.code}</strong></td>
          <td>
            <div style="font-weight:600; color:var(--text);">${it.title}</div>
            <div style="font-size:11px; color:var(--text-secondary);">${it.type?.name || 'Geral'} · ${it.period || it.era || 'Época Indefinida'}</div>
          </td>
          <td>${statusBadge}</td>
          <td style="font-family:'IBM Plex Mono',monospace; text-align:right;">${costEur}</td>
          <td style="font-family:'IBM Plex Mono',monospace; text-align:right; font-weight:700; color:var(--success);">${askEur}</td>
          <td style="font-size:12px; color:var(--text-secondary);">${it.acquisitionType === 'CONSIGNMENT' ? 'Consignação' : 'Compra Direta'}</td>
          <td style="text-align:right;">
            <div class="btn-group" style="display:inline-flex; gap:6px;">
              <button class="btn btn-sm" onclick="window.SellmaisModule.openItemDetail('${it.id}')">Ficha</button>
              <button class="btn btn-sm" onclick="window.SellmaisModule.openAddCostModal('${it.id}')">+ Custo</button>
              <button class="btn btn-sm btn-primary" onclick="window.SellmaisModule.openTransitionModal('${it.id}')">Mudar Estado</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  getStatusBadge(status) {
    const map = {
      DRAFT: '<span class="badge" style="background:#374151; color:#9ca3af;">Rascunho</span>',
      AVAILABLE: '<span class="badge" style="background:rgba(16,185,129,0.15); color:#10b981;">Disponível</span>',
      RESERVED: '<span class="badge" style="background:rgba(245,158,11,0.15); color:#f59e0b;">Reservado</span>',
      IN_RESTORATION: '<span class="badge" style="background:rgba(99,102,241,0.15); color:#818cf8;">Em Restauro</span>',
      IN_AUCTION: '<span class="badge" style="background:rgba(139,92,246,0.15); color:#a78bfa;">Em Leilão</span>',
      SOLD: '<span class="badge" style="background:rgba(59,130,246,0.15); color:#60a5fa;">Vendido</span>',
      RETURNED: '<span class="badge" style="background:rgba(239,68,68,0.15); color:#f87171;">Devolvido</span>',
      UNAVAILABLE: '<span class="badge" style="background:#4b5563; color:#d1d5db;">Indisponível</span>',
      WRITTEN_OFF: '<span class="badge" style="background:#1f2937; color:#6b7280;">Abatido</span>'
    };
    return map[status] || `<span class="badge">${status}</span>`;
  },

  populateTypeDropdowns() {
    const select = document.getElementById('sellmais-type-select');
    const filterSelect = document.getElementById('sellmais-filter-type');
    if (!select && !filterSelect) return;

    const optionsHtml = this.types.map(t => `<option value="${t.id}">${t.name}</option>`).join('');

    if (select) {
      select.innerHTML = '<option value="">Selecione o tipo de artigo...</option>' + optionsHtml;
    }
    if (filterSelect) {
      filterSelect.innerHTML = '<option value="">Todos os Tipos</option>' + optionsHtml;
    }
  },

  onTypeChanged(typeId) {
    const container = document.getElementById('dynamic-fields-container');
    if (!container) return;

    const type = this.types.find(t => t.id === typeId);
    if (!type || !type.fields || type.fields.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <h4 style="font-size:12px; text-transform:uppercase; color:var(--text-secondary); margin:12px 0 8px;">Atributos Específicos (${type.name})</h4>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        ${type.fields.map(f => {
          if (f.type === 'boolean') {
            return `
              <label style="display:flex; align-items:center; gap:8px; font-size:13px; color:var(--text); cursor:pointer;">
                <input type="checkbox" name="attr_${f.key}" value="true"> ${f.label}
              </label>
            `;
          } else if (f.type === 'enum' && f.options) {
            return `
              <div>
                <label style="font-size:12px; color:var(--text-secondary); display:block; margin-bottom:4px;">${f.label}</label>
                <select name="attr_${f.key}" class="form-control" style="width:100%;">
                  <option value="">Selecione...</option>
                  ${f.options.map(opt => `<option value="${opt}">${opt}</option>`).join('')}
                </select>
              </div>
            `;
          } else {
            const inputType = f.type === 'number' || f.type === 'integer' || f.type === 'money' ? 'number' : 'text';
            return `
              <div>
                <label style="font-size:12px; color:var(--text-secondary); display:block; margin-bottom:4px;">${f.label}</label>
                <input type="${inputType}" name="attr_${f.key}" class="form-control" placeholder="${f.label}" style="width:100%;">
              </div>
            `;
          }
        }).join('')}
      </div>
    `;
  },

  openCreateItemModal() {
    const modal = document.getElementById('modal-create-sell-item');
    if (modal) modal.classList.add('active');
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
  },

  async submitCreateItem(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);

    const typeId = formData.get('typeId');
    const type = this.types.find(t => t.id === typeId);

    const attributes = {};
    if (type && type.fields) {
      for (const f of type.fields) {
        if (f.type === 'boolean') {
          attributes[f.key] = form.elements[`attr_${f.key}`]?.checked || false;
        } else {
          const val = formData.get(`attr_${f.key}`);
          if (val !== null && val !== '') {
            attributes[f.key] = f.type === 'number' || f.type === 'integer' || f.type === 'money' ? Number(val) : val;
          }
        }
      }
    }

    const payload = {
      typeId,
      title: formData.get('title'),
      shortDescription: formData.get('shortDescription') || undefined,
      description: formData.get('description') || undefined,
      acquisitionType: formData.get('acquisitionType') || 'PURCHASE',
      acquisitionCents: Math.round(Number(formData.get('acquisitionEur') || 0) * 100),
      askingPriceCents: formData.get('askingPriceEur') ? Math.round(Number(formData.get('askingPriceEur')) * 100) : null,
      minPriceCents: formData.get('minPriceEur') ? Math.round(Number(formData.get('minPriceEur')) * 100) : null,
      conditionGrade: formData.get('conditionGrade') || undefined,
      period: formData.get('period') || undefined,
      attributes
    };

    try {
      const fetchFn = window.apiFetch || fetch;
      const res = await fetchFn('/api/sellmais/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok && data.success) {
        this.closeModal('modal-create-sell-item');
        form.reset();
        await this.init();
      } else {
        alert(data.message || 'Erro ao criar artigo de inventário.');
      }
    } catch (err) {
      alert('Erro de comunicação com o servidor.');
    }
  },

  openAddCostModal(itemId) {
    const item = this.items.find(i => i.id === itemId);
    if (!item) return;

    document.getElementById('cost-item-id').value = item.id;
    document.getElementById('cost-item-title').innerText = `${item.code} — ${item.title}`;
    const modal = document.getElementById('modal-add-cost');
    if (modal) modal.classList.add('active');
  },

  async submitAddCost(event) {
    event.preventDefault();
    const form = event.target;
    const itemId = document.getElementById('cost-item-id').value;
    const formData = new FormData(form);

    const payload = {
      category: formData.get('category'),
      description: formData.get('description'),
      amountCents: Math.round(Number(formData.get('amountEur')) * 100),
      supplierName: formData.get('supplierName') || undefined
    };

    try {
      const fetchFn = window.apiFetch || fetch;
      const res = await fetchFn(`/api/sellmais/items/${itemId}/costs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok && data.success) {
        this.closeModal('modal-add-cost');
        form.reset();
        await this.init();
      } else {
        alert(data.message || 'Erro ao adicionar custo de restauro.');
      }
    } catch (err) {
      alert('Erro de comunicação com o servidor.');
    }
  },

  openTransitionModal(itemId) {
    const item = this.items.find(i => i.id === itemId);
    if (!item) return;

    document.getElementById('trans-item-id').value = item.id;
    document.getElementById('trans-item-title').innerText = `${item.code} — ${item.title} (Estado Atual: ${item.status})`;
    const modal = document.getElementById('modal-transition-state');
    if (modal) modal.classList.add('active');
  },

  async submitTransition(event) {
    event.preventDefault();
    const form = event.target;
    const itemId = document.getElementById('trans-item-id').value;
    const formData = new FormData(form);

    const targetState = formData.get('targetState');
    const soldEur = formData.get('soldPriceEur');

    const payload = {
      targetState,
      soldPriceCents: soldEur ? Math.round(Number(soldEur) * 100) : undefined,
      buyerCompanyId: formData.get('buyerName') || undefined,
      reason: formData.get('reason') || undefined
    };

    try {
      const fetchFn = window.apiFetch || fetch;
      const res = await fetchFn(`/api/sellmais/items/${itemId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok && data.success) {
        this.closeModal('modal-transition-state');
        form.reset();
        await this.init();
      } else {
        alert(data.message || 'Transição de estado inválida para o fluxo deste artigo.');
      }
    } catch (err) {
      alert('Erro de comunicação com o servidor.');
    }
  },

  async openItemDetail(itemId) {
    try {
      const fetchFn = window.apiFetch || fetch;
      const res = await fetchFn(`/api/sellmais/items/${itemId}`);
      const data = await res.json();
      if (!data.success) return;

      const item = data.item;
      const body = document.getElementById('item-detail-body');
      if (!body) return;

      const askEur = item.askingPriceCents ? `${(item.askingPriceCents / 100).toFixed(2)} €` : 'Sob Consulta';
      const costEur = item.totalCostCents !== undefined ? `${(item.totalCostCents / 100).toFixed(2)} €` : 'Confidencial';
      const acqEur = item.acquisitionCents !== undefined ? `${(item.acquisitionCents / 100).toFixed(2)} €` : 'Confidencial';
      const extraEur = item.extraCostsCents !== undefined ? `${(item.extraCostsCents / 100).toFixed(2)} €` : 'Confidencial';

      const costsListHtml = item.costs && item.costs.length > 0
        ? item.costs.map(c => `
            <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border); font-size:13px;">
              <div><strong>[${c.category}]</strong> ${c.description} ${c.supplierCompanyId ? `<span style="color:var(--text-secondary);">(${c.supplierCompanyId})</span>` : ''}</div>
              <div style="font-family:'IBM Plex Mono',monospace; font-weight:600;">${(c.amountCents / 100).toFixed(2)} €</div>
            </div>
          `).join('')
        : '<div style="font-size:13px; color:var(--text-secondary); padding:8px 0;">Sem custos adicionais registados.</div>';

      const attrsHtml = item.attributes && Object.keys(item.attributes).length > 0
        ? Object.entries(item.attributes).map(([k, v]) => `<div><strong style="text-transform:capitalize; color:var(--text-secondary);">${k}:</strong> ${v}</div>`).join('')
        : '<div>Sem atributos dinâmicos.</div>';

      body.innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:20px;">
          <div>
            <h3 style="margin:0 0 4px; font-size:18px;">${item.title}</h3>
            <div style="font-family:'IBM Plex Mono',monospace; color:var(--primary); font-weight:700; margin-bottom:12px;">${item.code}</div>
            <p style="font-size:13px; color:var(--text-secondary); line-height:1.5;">${item.description || item.shortDescription || 'Sem descrição.'}</p>
            <div style="margin-top:12px; font-size:13px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
              ${attrsHtml}
            </div>
          </div>
          <div style="background:var(--bg-surface); padding:16px; border-radius:8px; border:1px solid var(--border);">
            <h4 style="margin:0 0 12px; font-size:13px; text-transform:uppercase; color:var(--text-secondary);">Métricas Financeiras & Custos</h4>
            <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:13px;">
              <span>Preço de Venda (PVP):</span> <strong style="color:var(--success);">${askEur}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:13px;">
              <span>Custo de Aquisição:</span> <span style="font-family:'IBM Plex Mono',monospace;">${acqEur}</span>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:13px;">
              <span>Custos de Restauro/Peritagem:</span> <span style="font-family:'IBM Plex Mono',monospace;">${extraEur}</span>
            </div>
            <div style="display:flex; justify-content:space-between; padding-top:8px; border-top:1px solid var(--border); font-size:14px;">
              <strong>Custo Materializado Total:</strong> <strong style="font-family:'IBM Plex Mono',monospace;">${costEur}</strong>
            </div>
            ${item.marginCents !== null && item.marginCents !== undefined ? `
              <div style="display:flex; justify-content:space-between; padding-top:8px; margin-top:8px; border-top:1px solid var(--border); font-size:14px; color:var(--primary);">
                <strong>Margem Real de Lucro:</strong> <strong style="font-family:'IBM Plex Mono',monospace;">${(item.marginCents / 100).toFixed(2)} €</strong>
              </div>
            ` : ''}
          </div>
        </div>
        <div style="margin-top:20px;">
          <h4 style="margin:0 0 8px; font-size:13px; text-transform:uppercase; color:var(--text-secondary);">Histórico de Custos e Intervenções</h4>
          ${costsListHtml}
        </div>
      `;

      const modal = document.getElementById('modal-item-detail');
      if (modal) modal.classList.add('active');
    } catch (err) {
      console.error(err);
    }
  }
};
