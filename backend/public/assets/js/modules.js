/**
 * REGISTO UNIFICADO DE MÓDULOS — HELDERLABS ERP
 * Fonte Única de Verdade para Plataforma, Landing Page e Área de Cliente
 * NOTA: ficheiro carregado como script normal (sem ES module import) para compatibilidade com Vercel.
 */

window.MODULES_REGISTRY = [
  {
    key: "sellmais",
    name: { pt: "2SELLMAIS", en: "2SELLMAIS" },
    blurb: { 
      pt: "Gestão de inventário e comércio em segunda mão, velharias e antiguidades com catálogo público SSR", 
      en: "Second-hand, vintage and antiques inventory & trading management with public SSR storefront" 
    },
    status: "ativo",
    route: "/app.html#sellmais",
    icon: "shopping-bag",
    licensable: true,
    ready: {
      pt: [
        "Ficha de artigo completa com atributos dinâmicos JSONB por tipo",
        "Máquina de estados estrita (RASCUNHO -> DISPONIVEL -> RESERVADO -> VENDIDO -> ENTREGUE)",
        "Materialização em tempo real de custos de restauro e margem real",
        "Gestão de consignações e liquidações a comitentes",
        "Publicação multi-canal com outbox assíncrona (OLX, Standvirtual, Wallapop, Vinted, Loja Própria)",
        "Gestão de leilões com controlo estrito de concorrência e lances",
        "Catálogo público SSR com dados estruturados JSON-LD e SEO"
      ],
      en: [
        "Complete item record with validated dynamic JSONB attributes",
        "Strict state machine (DRAFT -> AVAILABLE -> RESERVED -> SOLD -> DELIVERED)",
        "Real-time cost materialization (restoration & real profit margin)",
        "Consignment lifecycle and consignor settlements",
        "Multi-channel outbox publishing (OLX, Standvirtual, Wallapop, Vinted, Web Store)",
        "Auction management with strict concurrency control and live bidding",
        "Public SSR storefront with JSON-LD structured data and SEO"
      ]
    },
    missing: { pt: [], en: [] }
  },
  {
    key: "hccall",
    name: { pt: "HCCALL Telecom", en: "HCCALL Telecom" },
    blurb: { 
      pt: "Ferramenta operacional mobile-first para operadores de call center e lojas de telecomunicações", 
      en: "Mobile-first operational tool for call center agents and telecom retail stores" 
    },
    status: "ativo",
    route: "/hccall.html",
    icon: "headset",
    licensable: true,
    ready: {
      pt: [
        "Registo rápido de vendas em menos de 20s (<8 toques)",
        "Snapshot imutável de dinamizações e comissões efetivas",
        "Histórico detalhado de alterações por venda",
        "Funcionamento Offline-First com sincronização idempotente",
        "Relatórios de comissões por estado de comissão (Previstas, Confirmadas, Pagas)",
        "Exportação CSV e conformidade RGPD"
      ],
      en: [
        "Fast sales entry in under 20s (<8 taps)",
        "Immutable snapshot of promotions and effective commissions",
        "Detailed audit change log per sale",
        "Offline-First engine with idempotent synchronization",
        "Commission reports by state (Forecast, Confirmed, Paid)",
        "CSV export and GDPR compliance"
      ]
    },
    missing: { pt: [], en: [] }
  },
  {
    key: "financas",
    name: { pt: "Gestão Financeira", en: "Financial Management" },
    blurb: { 
      pt: "Gestão multi-tenant com PostgreSQL RLS, receitas, despesas, orçamentos, objetivos, dívidas, relatórios e auditoria SHA256", 
      en: "Multi-tenant financial management with PostgreSQL RLS, budgets, goals, debts, reports, and SHA256 auditing" 
    },
    status: "beta", // ativo | beta | em_construcao | planeado
    route: "/app.html#financas",
    icon: "wallet",
    licensable: true,
    ready: {
      pt: [
        "Movimentos (Receitas e Despesas com inteiros de cêntimos)",
        "Reversão instantânea (Undo 10s)",
        "Contas Bancárias e Transferências isoladas",
        "Alertas de Orçamento por Categoria (80%, 90%, 100%+)",
        "Objetivos de Poupança com depósitos",
        "Amortização de Dívidas e Passivos",
        "Relatórios de Evolução Mensal e Repartição",
        "Exportação CSV com auditoria SHA256"
      ],
      en: [
        "Transactions (Income & Expenses in integer cents)",
        "Instant Undo (10s)",
        "Bank Accounts and isolated Transfers",
        "Category Budget Alerts (80%, 90%, 100%+)",
        "Savings Goals with direct deposits",
        "Debt Amortization and Liabilities",
        "Monthly Evolution & Category Reports",
        "CSV Export with SHA256 Audit Trail"
      ]
    },
    missing: { pt: [], en: [] }
  },
  {
    key: "audit",
    name: { pt: "Registos de Auditoria", en: "Activity & Audit Logs" },
    blurb: { 
      pt: "Cadeia de hashes SHA256 encadeada por tenant e exportação mensal de auditoria", 
      en: "Tenant sequential SHA256 hash chaining and monthly audit verification" 
    },
    status: "ativo",
    route: "/app.html#audit",
    icon: "shield",
    licensable: true,
    ready: {
      pt: [
        "Visualizador de auditoria em tempo real",
        "Encadeamento imutável por SHA256",
        "Flusher mensal para ficheiros JSONL",
        "Verificação de integridade via CLI (`npm run audit:verify`)"
      ],
      en: [
        "Real-time audit log viewer",
        "SHA256 hash chain verification",
        "Monthly JSONL flusher",
        "CLI verification tool (`npm run audit:verify`)"
      ]
    },
    missing: { pt: [], en: [] }
  },
  {
    key: "crm",
    name: { pt: "CRM & Oportunidades", en: "CRM & Deals" },
    blurb: { 
      pt: "Gestão de contactos, leads da landing page e acompanhamento de oportunidades", 
      en: "Contact management, landing page leads, and deal tracking" 
    },
    status: "beta",
    route: "/app.html#crm",
    icon: "users",
    licensable: true,
    ready: {
      pt: [
        "Entrada automática de leads via formulário da landing page",
        "Fichas de clientes e contactos",
        "Métricas agregadas de oportunidades"
      ],
      en: [
        "Automatic lead capture from landing page form",
        "Customer & contact cards",
        "Pipeline deal metrics"
      ]
    },
    missing: {
      pt: ["Importação massiva de ficheiros CSV", "Envio automático de sequências de email"],
      en: ["Bulk CSV contact import", "Automated email sequence dispatch"]
    }
  },
  {
    key: "condominios",
    name: { pt: "Gestão de Condomínios", en: "Condominium Management" },
    blurb: { 
      pt: "Controlo de edifícios, frações, proprietários e quotas de condomínio", 
      en: "Building, unit, owner, and quota management" 
    },
    status: "em_construcao",
    route: "/app.html#condominios",
    icon: "building",
    licensable: false,
    ready: {
      pt: ["Estrutura de edifícios e frações", "Fichas de condóminos"],
      en: ["Building and unit structures", "Owner profiles"]
    },
    missing: {
      pt: [
        "Emissão automática de avisos de cobrança de quotas",
        "Leitura e cálculo de contadores de água",
        "Atas de reuniões de condóminos em PDF"
      ],
      en: [
        "Automatic quota payment notices",
        "Water meter reading calculations",
        "Meeting minutes PDF generation"
      ]
    }
  },
  {
    key: "rent_a_car",
    name: { pt: "Rent-a-Car & Frotas", en: "Car Rental & Fleet" },
    blurb: { 
      pt: "Gestão de frota, reservas de veículos, contratos de aluguer e check-in/out", 
      en: "Fleet management, vehicle reservations, rental contracts, and check-in/out" 
    },
    status: "planeado",
    route: "/app.html#rent_a_car",
    icon: "car",
    licensable: false,
    ready: { pt: [], en: [] },
    missing: {
      pt: [
        "Calendário de disponibilidade de frota",
        "Contratos digitais de aluguer de veículos",
        "Inspeção visual de danos no check-in"
      ],
      en: [
        "Fleet availability schedule calendar",
        "Digital vehicle rental contracts",
        "Visual damage inspection check-in"
      ]
    }
  }
];

window.getModuleByKey = function(key) {
  return window.MODULES_REGISTRY.find(m => m.key === key);
};

window.renderIncompleteModuleScreen = function(containerEl, moduleKey, lang) {
  lang = lang || "pt";
  const mod = window.getModuleByKey(moduleKey);
  if (!mod) return;

  const isEmConstrucao = mod.status === "em_construcao";
  const badgeText = isEmConstrucao 
    ? (lang === "pt" ? "Em construção" : "Under Construction")
    : (lang === "pt" ? "Brevemente" : "Coming Soon");

  const readyTitle = lang === "pt" ? "O que já funciona:" : "What already works:";
  const missingTitle = lang === "pt" ? "O que estamos a construir:" : "What we are building:";
  const notifyBtnText = lang === "pt" ? "Avisem-me quando estiver pronto" : "Notify me when ready";
  const backBtnText = lang === "pt" ? "Voltar ao Ambiente de Trabalho" : "Back to Workspace";

  const checkSvg = `<svg style="width:14px;height:14px;stroke:var(--pen);fill:none;margin-right:6px;vertical-align:middle;" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`;
  const clockSvg = `<svg style="width:14px;height:14px;stroke:var(--ink-3);fill:none;margin-right:6px;vertical-align:middle;" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

  const readyItems = (mod.ready[lang] || []).map(item => `<li style="display:flex;align-items:center;">${checkSvg} <span>${item}</span></li>`).join("");
  const missingItems = (mod.missing[lang] || []).map(item => `<li style="display:flex;align-items:center;">${clockSvg} <span>${item}</span></li>`).join("");

  containerEl.innerHTML = `
    <div style="max-width: 680px; margin: 4rem auto; padding: 2.5rem; background: var(--sheet); border: 1px solid var(--rule-2); border-radius: var(--radius-card); font-family: var(--font-sans); color: var(--ink);">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; border-bottom: 1px solid var(--rule); padding-bottom: 1rem;">
        <h2 style="font-family: var(--font-serif); font-size: 1.75rem; margin: 0; color: var(--ink);">${mod.name[lang]}</h2>
        <span style="font-family: var(--font-mono); font-size: 0.75rem; padding: 0.25rem 0.6rem; border-radius: 2px; background: var(--sheet-2); border: 1px dashed var(--rule-2); color: var(--red); font-weight: bold; text-transform: uppercase;">
          ${badgeText}
        </span>
      </div>

      <p style="color: var(--ink-2); font-size: 0.95rem; margin-bottom: 2rem; line-height: 1.6;">
        ${mod.blurb[lang]}
      </p>

      ${readyItems ? `
        <div style="margin-bottom: 1.5rem;">
          <h4 style="font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-3); margin-bottom: 0.5rem;">${readyTitle}</h4>
          <ul style="list-style: none; padding: 0; margin: 0; space-y: 0.4rem; font-size: 0.9rem; color: var(--ink-2);">
            ${readyItems}
          </ul>
        </div>
      ` : ''}

      ${missingItems ? `
        <div style="margin-bottom: 2rem;">
          <h4 style="font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-3); margin-bottom: 0.5rem;">${missingTitle}</h4>
          <ul style="list-style: none; padding: 0; margin: 0; space-y: 0.4rem; font-size: 0.9rem; color: var(--ink-2);">
            ${missingItems}
          </ul>
        </div>
      ` : ''}

      <div style="display: flex; gap: 1rem; align-items: center; border-top: 1px solid var(--rule); padding-top: 1.5rem; margin-top: 2rem;">
        <button id="notify-interest-btn" style="padding: 0.75rem 1.25rem; background: var(--pen); color: #fff; border: none; border-radius: var(--radius-btn); font-size: 0.9rem; font-weight: 500; cursor: pointer; font-family: var(--font-sans);">
          ${notifyBtnText}
        </button>
        <a href="/workspace.html" style="padding: 0.75rem 1.25rem; background: var(--sheet-2); color: var(--ink); text-decoration: none; border-radius: var(--radius-btn); font-size: 0.9rem; font-weight: 500; font-family: var(--font-sans); border: 1px solid var(--rule);">
          ${backBtnText}
        </a>
      </div>
      <div id="notify-feedback" style="margin-top: 1rem; font-size: 0.85rem; font-weight: bold; color: var(--state-success-text); display: none;"></div>
    </div>
  `;

  const notifyBtn = containerEl.querySelector('#notify-interest-btn');
  const notifyFeedback = containerEl.querySelector('#notify-feedback');
  if (notifyBtn) {
    notifyBtn.addEventListener('click', () => {
      notifyBtn.disabled = true;
      notifyFeedback.style.display = 'block';
      notifyFeedback.textContent = lang === "pt" 
        ? "Obrigado! O teu interesse ficou registado com sucesso."
        : "Thank you! Your interest has been registered successfully.";
    });
  }
}
