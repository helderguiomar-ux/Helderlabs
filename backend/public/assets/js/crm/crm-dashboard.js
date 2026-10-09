/**
 * CRM Executive Dashboard & Native SVG Charts Module (Fase B8)
 * Painel Executivo, Gráficos SVG Puros (Funil, Barras, Donut), Alertas e Exportações CSV.
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

  const STAGE_LABELS = {
    QUALIFICATION: 'Qualificação',
    PROPOSAL: 'Proposta',
    NEGOTIATION: 'Negociação',
    WON: 'Ganha',
    LOST: 'Perdida'
  };

  const STAGE_COLORS = {
    QUALIFICATION: '#3b82f6',
    PROPOSAL: '#8b5cf6',
    NEGOTIATION: '#f59e0b',
    WON: '#10b981',
    LOST: '#ef4444'
  };

  const DONUT_COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b'
  ];

  const CRMDashboard = {
    metrics: null,
    isLoading: false,

    async init() {
      await this.loadDashboard();
    },

    async loadDashboard() {
      this.isLoading = true;
      const container = document.getElementById('crm-view-dashboard');
      if (!container) return;

      container.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #64748b;">
          <div class="spinner" style="display:inline-block; margin-bottom: 12px;"></div>
          <div>A calcular métricas executivas, agregações e gráficos SVG...</div>
        </div>
      `;

      try {
        const res = await window.appFetch('/api/crm/dashboard/executive');
        if (!res.ok) throw new Error('Falha ao carregar métricas do painel executivo.');
        this.metrics = await res.json();
        this.renderDashboard(container);
      } catch (err) {
        console.error('Erro no Painel Executivo:', err);
        container.innerHTML = `
          <div class="empty-state" style="padding: 30px; text-align: center;">
            <p style="color: #ef4444; font-weight: 500;">Não foi possível carregar o Painel Executivo.</p>
            <p style="font-size: 13px; color: #64748b;">${esc(err.message)}</p>
            <button class="btn btn-secondary" onclick="CRMDashboard.loadDashboard()">Tentar novamente</button>
          </div>
        `;
      } finally {
        this.isLoading = false;
      }
    },

    renderDashboard(container) {
      const m = this.metrics || {};
      const pipe = m.pipeline || {};
      const eff = m.efficiency || {};
      const prop = m.proposals || {};
      const tasks = m.tasks || {};
      const acc = m.account || {};
      const noStep = m.dealsWithoutNextStep || { count: 0, items: [] };

      container.innerHTML = `
        <div class="toolbar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
          <div>
            <h2 style="margin: 0; font-size: 20px; font-weight: 800; color: #0f172a;">Painel Executivo do CRM</h2>
            <span class="kpi-subtext">Visão estratégica de vendas, previsão de fecho, eficácia comercial e risco financeiro</span>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary" onclick="CRMDashboard.loadDashboard()">Atualizar Indicadores</button>
          </div>
        </div>

        <!-- Linha 1: Cartões de KPI Executivo -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 24px;">
          <div class="card" style="padding: 16px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">Pipeline Aberto (Nominal)</div>
            <div style="font-size: 22px; font-weight: 800; color: #1e293b; margin-top: 4px;">${fmtEur(pipe.totalOpenValueCents)}</div>
            <div style="font-size: 12px; color: #3b82f6; margin-top: 4px;">Ponderado: <strong>${fmtEur(pipe.totalWeightedValueCents)}</strong></div>
          </div>

          <div class="card" style="padding: 16px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">Taxa de Ganho (Win Rate)</div>
            <div style="font-size: 22px; font-weight: 800; color: #10b981; margin-top: 4px;">${eff.winRatePercent || 0}%</div>
            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">${eff.wonCount || 0} ganhos / ${(eff.wonCount || 0) + (eff.lostCount || 0)} fechados</div>
          </div>

          <div class="card" style="padding: 16px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">Ciclo Médio de Venda</div>
            <div style="font-size: 22px; font-weight: 800; color: #6366f1; margin-top: 4px;">${eff.avgSalesCycleDays || 0} dias</div>
            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Tempo médio até estágio WON</div>
          </div>

          <div class="card" style="padding: 16px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">Propostas Adjudicadas</div>
            <div style="font-size: 22px; font-weight: 800; color: #059669; margin-top: 4px;">${fmtEur(prop.acceptedVolumeCents)}</div>
            <div style="font-size: 12px; color: #059669; margin-top: 4px;">Taxa Aceitação: <strong>${prop.acceptanceRatePercent || 0}%</strong></div>
          </div>

          <div class="card" style="padding: 16px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">Conta Corrente / A Receber</div>
            <div style="font-size: 22px; font-weight: 800; color: #dc2626; margin-top: 4px;">${fmtEur(acc.totalReceivableCents)}</div>
            <div style="font-size: 12px; color: #ea580c; margin-top: 4px;">Vencido: <strong>${fmtEur(acc.totalOverdueCents)}</strong></div>
          </div>

          <div class="card" style="padding: 16px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">Tarefas em Atraso</div>
            <div style="font-size: 22px; font-weight: 800; color: ${tasks.overdueCount > 0 ? '#dc2626' : '#10b981'}; margin-top: 4px;">
              ${tasks.overdueCount || 0}
            </div>
            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Hoje: <strong>${tasks.todayCount || 0}</strong> pendentes</div>
          </div>
        </div>

        <!-- Linha 2: Gráficos SVG Nativos (Funil do Pipeline & Previsão Mensal) -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 20px; margin-bottom: 24px;">
          <!-- Gráfico 1: Funil do Pipeline SVG -->
          <div class="card" style="padding: 20px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
              <div>
                <h4 style="margin: 0; font-size: 15px; font-weight: 700; color: #0f172a;">Funil Comercial por Fases</h4>
                <span style="font-size: 12px; color: #64748b;">Volume nominal e contagem por estágio do funil</span>
              </div>
            </div>
            <div style="min-height: 220px; display: flex; align-items: center; justify-content: center;">
              ${this.renderPipelineFunnelSvg(pipe.stages || [])}
            </div>
          </div>

          <!-- Gráfico 2: Previsão Mensal de Fecho SVG -->
          <div class="card" style="padding: 20px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
              <div>
                <h4 style="margin: 0; font-size: 15px; font-weight: 700; color: #0f172a;">Previsão de Fecho por Mês</h4>
                <span style="font-size: 12px; color: #64748b;">Oportunidades em aberto por data esperada</span>
              </div>
            </div>
            <div style="min-height: 220px; display: flex; align-items: center; justify-content: center;">
              ${this.renderMonthlyForecastSvg(m.forecast || [])}
            </div>
          </div>
        </div>

        <!-- Linha 3: Gráficos SVG Nativos (Origens de Leads & Antiguidade de Dívida) -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 20px; margin-bottom: 24px;">
          <!-- Gráfico 3: Origem dos Clientes (Donut SVG) -->
          <div class="card" style="padding: 20px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
              <div>
                <h4 style="margin: 0; font-size: 15px; font-weight: 700; color: #0f172a;">Distribuição por Origem (Canal)</h4>
                <span style="font-size: 12px; color: #64748b;">Origem das empresas e volume de negócios</span>
              </div>
            </div>
            <div style="min-height: 220px; display: flex; align-items: center; justify-content: center;">
              ${this.renderDonutSvg(m.leadSources || [])}
            </div>
          </div>

          <!-- Gráfico 4: Aging da Conta Corrente SVG -->
          <div class="card" style="padding: 20px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
              <div>
                <h4 style="margin: 0; font-size: 15px; font-weight: 700; color: #0f172a;">Risco & Antiguidade da Conta Corrente</h4>
                <span style="font-size: 12px; color: #64748b;">Faturas e saldos a receber por escalões de atraso</span>
              </div>
            </div>
            <div style="min-height: 220px; display: flex; align-items: center; justify-content: center;">
              ${this.renderAgingBarsSvg(acc)}
            </div>
          </div>
        </div>

        <!-- Linha 4: Negócios Sem Próximo Passo (Atenção Executiva) -->
        <div class="card" style="padding: 20px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 24px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;">
            <div>
              <h4 style="margin: 0; font-size: 15px; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 8px;">
                <span>⚠️ Negócios Sem Próximo Passo</span>
                <span class="badge" style="background: #fee2e2; color: #dc2626;">${noStep.count || 0} em risco</span>
              </h4>
              <span style="font-size: 12px; color: #64748b;">Oportunidades ativas sem qualquer reunião, chamada ou tarefa pendente agendada</span>
            </div>
          </div>

          ${noStep.items && noStep.items.length > 0 ? `
            <div style="overflow-x: auto;">
              <table class="table" style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <thead>
                  <tr style="background: #f8fafc; text-align: left; font-size: 11px; text-transform: uppercase; color: #64748b;">
                    <th style="padding: 8px 10px;">Negócio / Título</th>
                    <th style="padding: 8px 10px;">Empresa</th>
                    <th style="padding: 8px 10px;">Fase Atual</th>
                    <th style="padding: 8px 10px; text-align: right;">Valor</th>
                    <th style="padding: 8px 10px; text-align: center;">Ação Rápida</th>
                  </tr>
                </thead>
                <tbody>
                  ${noStep.items.map(deal => `
                    <tr style="border-bottom: 1px solid #f1f5f9;">
                      <td style="padding: 8px 10px; font-weight: 600;">${esc(deal.title)}</td>
                      <td style="padding: 8px 10px;">${esc(deal.companyName)}</td>
                      <td style="padding: 8px 10px;">
                        <span class="badge" style="background:#e0f2fe; color:#0369a1;">${STAGE_LABELS[deal.stage] || esc(deal.stage)}</span>
                      </td>
                      <td style="padding: 8px 10px; text-align: right; font-weight: 700;">${fmtEur(deal.valueCents)}</td>
                      <td style="padding: 8px 10px; text-align: center;">
                        <button class="btn btn-sm btn-primary" onclick="window.CRMActivitiesModule && window.CRMActivitiesModule.openCreateModal(null, '${esc(deal.id)}')">
                          + Agendar Próximo Passo
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : `
            <div style="text-align: center; padding: 20px; color: #10b981; font-size: 13px;">
              ✓ Excelente! Todas as oportunidades ativas possuem um próximo passo comercial agendado.
            </div>
          `}
        </div>

        <!-- Linha 5: Exportações Oficiais do CRM (Proteção Contra Formula Injection) -->
        <div class="card" style="padding: 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h4 style="margin: 0 0 6px 0; font-size: 15px; font-weight: 700; color: #0f172a;">Exportação de Relatórios Oficiais (CSV)</h4>
          <p style="margin: 0 0 16px 0; font-size: 12px; color: #64748b;">
            Exportações certificadas com codificação UTF-8 (BOM) e blindagem contra ataques de injeção de fórmulas CSV.
          </p>
          <div style="display: flex; gap: 12px; flex-wrap: wrap;">
            <a href="/api/crm/reports/export/companies" class="btn btn-secondary" download>
              📊 Exportar Empresas (CSV)
            </a>
            <a href="/api/crm/reports/export/deals" class="btn btn-secondary" download>
              📈 Exportar Negócios / Pipeline (CSV)
            </a>
            <a href="/api/crm/reports/export/proposals" class="btn btn-secondary" download>
              📑 Exportar Propostas (CSV)
            </a>
            <a href="/api/crm/reports/export/account" class="btn btn-secondary" download>
              💰 Exportar Conta Corrente (CSV)
            </a>
          </div>
        </div>
      `;
    },

    // =========================================================================
    // GERADORES DE GRÁFICOS SVG NATIVOS (PUROS, SEM BIBLIOTECAS)
    // =========================================================================

    renderPipelineFunnelSvg(stages) {
      if (!stages || stages.length === 0) {
        return '<div style="color: #94a3b8; font-size: 12px;">Sem dados de pipeline</div>';
      }

      const activeStages = stages.filter(s => ['QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'WON'].includes(s.stage));
      const maxValue = Math.max(...activeStages.map(s => s.totalValueCents), 100);

      const width = 400;
      const height = 180;
      const barHeight = 32;
      const gap = 10;

      const svgBars = activeStages.map((s, idx) => {
        const y = idx * (barHeight + gap);
        const barWidth = Math.max(20, Math.round((s.totalValueCents / maxValue) * (width - 150)));
        const color = STAGE_COLORS[s.stage] || '#3b82f6';
        const label = STAGE_LABELS[s.stage] || s.stage;

        return `
          <g>
            <text x="0" y="${y + 20}" font-size="12" fill="#475569" font-weight="600">${label}</text>
            <rect x="110" y="${y + 4}" width="${barWidth}" height="${barHeight - 8}" rx="4" fill="${color}" opacity="0.9" />
            <text x="${110 + barWidth + 8}" y="${y + 20}" font-size="11" fill="#1e293b" font-weight="700">
              ${fmtEur(s.totalValueCents)} (${s.count})
            </text>
          </g>
        `;
      }).join('');

      return `
        <svg viewBox="0 0 ${width} ${height}" style="width: 100%; max-width: 440px; height: auto;" role="img" aria-label="Funil de Vendas">
          <title>Funil de Vendas por Fases</title>
          ${svgBars}
        </svg>
      `;
    },

    renderMonthlyForecastSvg(forecast) {
      if (!forecast || forecast.length === 0) {
        return '<div style="color: #94a3b8; font-size: 12px;">Sem oportunidades com fecho previsto</div>';
      }

      const width = 380;
      const height = 180;
      const maxVal = Math.max(...forecast.map(f => f.totalValueCents), 100);
      const barW = Math.max(24, Math.floor((width - 40) / forecast.length) - 16);

      const bars = forecast.map((f, idx) => {
        const x = 30 + idx * (barW + 16);
        const hNominal = Math.max(4, Math.round((f.totalValueCents / maxVal) * 110));
        const hWeighted = Math.max(2, Math.round((f.weightedValueCents / maxVal) * 110));
        const yNominal = 140 - hNominal;
        const yWeighted = 140 - hWeighted;

        const labelMonth = f.month ? f.month.split('-')[1] + '/' + f.month.split('-')[0].slice(2) : '';

        return `
          <g>
            <!-- Barra Nominal -->
            <rect x="${x}" y="${yNominal}" width="${barW}" height="${hNominal}" rx="3" fill="#93c5fd" opacity="0.7">
              <title>${f.month}: Nominal ${fmtEur(f.totalValueCents)}</title>
            </rect>
            <!-- Barra Ponderada -->
            <rect x="${x}" y="${yWeighted}" width="${barW}" height="${hWeighted}" rx="3" fill="#2563eb">
              <title>${f.month}: Ponderado ${fmtEur(f.weightedValueCents)}</title>
            </rect>
            <!-- Label Mês -->
            <text x="${x + barW / 2}" y="160" font-size="10" fill="#64748b" text-anchor="middle">${labelMonth}</text>
          </g>
        `;
      }).join('');

      return `
        <svg viewBox="0 0 ${width} ${height}" style="width: 100%; max-width: 420px; height: auto;" role="img" aria-label="Previsão Mensal">
          <title>Previsão de Fecho por Mês</title>
          <!-- Eixo Base -->
          <line x1="20" y1="140" x2="${width - 10}" y2="140" stroke="#cbd5e1" stroke-width="1" />
          ${bars}
        </svg>
      `;
    },

    renderDonutSvg(sources) {
      if (!sources || sources.length === 0) {
        return '<div style="color: #94a3b8; font-size: 12px;">Sem dados de origens</div>';
      }

      const totalValue = sources.reduce((sum, s) => sum + s.totalValueCents, 0);
      if (totalValue === 0) {
        return '<div style="color: #94a3b8; font-size: 12px;">Sem volume por origem</div>';
      }

      const cx = 90;
      const cy = 90;
      const r = 60;
      const strokeWidth = 28;
      const circumference = 2 * Math.PI * r;

      let accumulatedAngle = 0;

      const slices = sources.map((s, idx) => {
        const ratio = s.totalValueCents / totalValue;
        const strokeDasharray = `${ratio * circumference} ${circumference}`;
        const strokeDashoffset = -accumulatedAngle;
        accumulatedAngle += ratio * circumference;
        const color = DONUT_COLORS[idx % DONUT_COLORS.length];

        return `
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="transparent"
            stroke="${color}" stroke-width="${strokeWidth}"
            stroke-dasharray="${strokeDasharray}"
            stroke-dashoffset="${strokeDashoffset}"
            transform="rotate(-90 ${cx} ${cy})">
            <title>${esc(s.source)}: ${fmtEur(s.totalValueCents)} (${Math.round(ratio * 100)}%)</title>
          </circle>
        `;
      }).join('');

      const legend = sources.slice(0, 5).map((s, idx) => {
        const color = DONUT_COLORS[idx % DONUT_COLORS.length];
        const pct = Math.round((s.totalValueCents / totalValue) * 100);
        return `
          <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; margin-bottom: 4px;">
            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 2px; background: ${color};"></span>
            <span style="color: #475569; font-weight: 500;">${esc(s.source)}</span>
            <span style="color: #1e293b; font-weight: 700; margin-left: auto;">${pct}%</span>
          </div>
        `;
      }).join('');

      return `
        <div style="display: flex; align-items: center; gap: 16px; width: 100%; justify-content: space-around;">
          <svg width="180" height="180" viewBox="0 0 180 180" role="img" aria-label="Donut Origens">
            <title>Distribuição por Origem</title>
            ${slices}
            <circle cx="${cx}" cy="${cy}" r="${r - strokeWidth / 2}" fill="#ffffff" />
          </svg>
          <div style="flex: 1; max-width: 180px;">
            ${legend}
          </div>
        </div>
      `;
    },

    renderAgingBarsSvg(account) {
      const receivable = account.totalReceivableCents || 0;
      const overdue = account.totalOverdueCents || 0;
      const current = Math.max(0, receivable - overdue);

      const width = 360;
      const height = 150;

      const currentPct = receivable > 0 ? Math.round((current / receivable) * 100) : 100;
      const overduePct = receivable > 0 ? Math.round((overdue / receivable) * 100) : 0;

      return `
        <div style="width: 100%; max-width: 380px;">
          <div style="margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
              <span style="color: #16a34a; font-weight: 600;">Dentro do Prazo (${currentPct}%)</span>
              <span style="font-weight: 700;">${fmtEur(current)}</span>
            </div>
            <div style="background: #e2e8f0; height: 14px; border-radius: 4px; overflow: hidden;">
              <div style="background: #16a34a; height: 100%; width: ${currentPct}%;"></div>
            </div>
          </div>

          <div style="margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
              <span style="color: #dc2626; font-weight: 600;">Vencido / Em Atraso (${overduePct}%)</span>
              <span style="font-weight: 700;">${fmtEur(overdue)}</span>
            </div>
            <div style="background: #e2e8f0; height: 14px; border-radius: 4px; overflow: hidden;">
              <div style="background: #dc2626; height: 100%; width: ${overduePct}%;"></div>
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; font-size: 12px; color: #64748b; padding-top: 8px; border-top: 1px solid #e2e8f0;">
            <span>Clientes Devedores: <strong>${account.debtorsCount || 0}</strong></span>
            <span>Casos Críticos: <strong>${account.criticalCount || 0}</strong></span>
          </div>
        </div>
      `;
    }
  };

  window.CRMDashboard = CRMDashboard;
})(window, document);
