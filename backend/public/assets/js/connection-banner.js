/**
 * HELDERLABS ERP — Componente Universal de Indicador de Ambiente, Estado da API/BD e Preservação de Formulários
 * ---------------------------------------------------------------------------------------------------------
 * Executa em todos os clientes (Web e Desktop):
 *   - Identifica o modo de execução: [ DESKTOP ] vs [ WEB ]
 *   - Consulta periodicamente o endpoint /api/health para verificar a API e Base de Dados Online
 *   - Apresenta o estado em tempo real: 🟢 API: Online · 🟢 BD: Online · vX.Y.Z
 *   - Mostra aviso de perda de ligação e preserva dados de formulários quando offline
 */

(function () {
  'use strict';

  function getRuntimeConfig() {
    return window.HELDERLABS_CONFIG || window.ERPConfig || {
      apiBaseUrl: '',
      clientType: (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' || window.location.port === '3400') ? 'DESKTOP' : 'WEB',
      appVersion: '1.2.0',
      buildId: 'local',
      environment: 'production'
    };
  }

  function isDesktopClient() {
    const cfg = getRuntimeConfig();
    if (cfg.clientType === 'DESKTOP' || cfg.clientType === 'LOCAL') return true;
    if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' || window.location.port === '3400') return true;
    return false;
  }

  function getHealthEndpointUrl() {
    if (typeof window.apiUrl === 'function') {
      return window.apiUrl('/api/health');
    }
    const cfg = getRuntimeConfig();
    const base = (cfg.apiBaseUrl || '').replace(/\/$/, '');
    return base ? `${base}/api/health` : '/api/health';
  }

  // --- 1. Banner de Aviso de Perda de Ligação (Topo) -------------------------
  function createTopBanner() {
    if (document.getElementById('hl-connection-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'hl-connection-banner';
    banner.setAttribute('role', 'alert');
    banner.setAttribute('aria-live', 'assertive');
    banner.style.cssText = `
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 999999;
      background-color: #b91c1c;
      color: #ffffff;
      padding: 10px 16px;
      text-align: center;
      font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.02em;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
    `;
    banner.innerHTML = `⚠️ <strong>Sem ligação à API Online.</strong> As operações que requerem o servidor estão suspensas.`;
    document.body.prepend(banner);
  }

  // --- 2. Cápsula / Badge de Ambiente e Estado da Ligação (Canto Inferior) ---
  function createEnvStatusWidget() {
    if (document.getElementById('hl-env-status-widget')) return;

    const isDesktop = isDesktopClient();
    const cfg = getRuntimeConfig();
    const clientLabel = isDesktop ? 'DESKTOP' : 'WEB';

    const widget = document.createElement('div');
    widget.id = 'hl-env-status-widget';
    widget.style.cssText = `
      position: fixed;
      bottom: 12px;
      left: 12px;
      z-index: 99998;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 5px 10px;
      border-radius: 20px;
      background: rgba(18, 24, 38, 0.90);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #e2e8f0;
      font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
      font-size: 11px;
      line-height: 1;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
      user-select: none;
      transition: all 0.3s ease;
    `;

    widget.innerHTML = `
      <span style="font-weight:700; letter-spacing:0.04em; color:#94a3b8;">HelderLabs ERP</span>
      <span id="hl-widget-type" style="
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 10px;
        font-size: 10px;
        letter-spacing: 0.05em;
        background: ${isDesktop ? '#2563eb' : '#475569'};
        color: #ffffff;
      ">[ ${clientLabel} ]</span>
      <span style="display:flex; align-items:center; gap:5px;" id="hl-widget-health">
        <span id="hl-status-dot" style="width:7px; height:7px; border-radius:50%; background:#22c55e; box-shadow:0 0 6px #22c55e;"></span>
        <span id="hl-status-text" style="color:#cbd5e1;">API: Online · BD: Online</span>
      </span>
      <span id="hl-widget-version" style="color:#64748b; font-size:10px; border-left:1px solid rgba(255,255,255,0.15); padding-left:6px;">v${cfg.appVersion || '1.2.0'}</span>
    `;

    document.body.appendChild(widget);

    // Injeta também o badge discreto nos cabeçalhos existentes se aplicável
    injectHeaderBadges(clientLabel, isDesktop);
  }

  function injectHeaderBadges(label, isDesktop) {
    const appH1 = document.querySelector('.header-brand h1, .brand-section .company-title, .sidebar-header');
    if (appH1 && !document.getElementById('hl-header-env-badge')) {
      const tag = document.createElement('span');
      tag.id = 'hl-header-env-badge';
      tag.style.cssText = `
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 4px;
        margin-left: 8px;
        font-weight: 700;
        font-family: var(--font-mono, monospace);
        letter-spacing: 0.05em;
        vertical-align: middle;
        background: ${isDesktop ? 'rgba(37, 99, 235, 0.15)' : 'rgba(100, 116, 139, 0.15)'};
        color: ${isDesktop ? '#3b82f6' : '#64748b'};
        border: 1px solid ${isDesktop ? 'rgba(37, 99, 235, 0.35)' : 'rgba(100, 116, 139, 0.35)'};
      `;
      tag.textContent = `[ ${label} ]`;
      appH1.appendChild(tag);
    }
  }

  let isCheckingHealth = false;

  async function checkServerHealth() {
    if (isCheckingHealth) return;
    isCheckingHealth = true;

    const healthUrl = getHealthEndpointUrl();
    const dot = document.getElementById('hl-status-dot');
    const text = document.getElementById('hl-status-text');
    const versionEl = document.getElementById('hl-widget-version');
    const banner = document.getElementById('hl-connection-banner');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(healthUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const dbReady = data.database === 'ready' || data.database === 'healthy' || data.database === 'connected' || data.status === 'ok';

        if (dot) {
          dot.style.background = dbReady ? '#22c55e' : '#eab308';
          dot.style.boxShadow = dbReady ? '0 0 6px #22c55e' : '0 0 6px #eab308';
        }
        if (text) {
          text.textContent = dbReady ? 'API: Online · BD: Online' : 'API: Online · BD: A inicializar';
          text.style.color = '#cbd5e1';
        }
        if (versionEl && (data.version || data.appVersion)) {
          versionEl.textContent = `v${data.version || data.appVersion}`;
        }
        if (banner) banner.style.display = 'none';
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      if (dot) {
        dot.style.background = '#ef4444';
        dot.style.boxShadow = '0 0 6px #ef4444';
      }
      if (text) {
        text.textContent = 'API: Offline · BD: Indisponível';
        text.style.color = '#f87171';
      }
      if (banner) banner.style.display = 'block';
      saveFormState();
    } finally {
      isCheckingHealth = false;
    }
  }

  // --- 3. Preservação de Formulários Offline ----------------------------------
  function getFormKey(form, index) {
    const id = form.id || form.getAttribute('name') || `form_${index}`;
    return `hl_draft_${window.location.pathname}_${id}`;
  }

  function saveFormState() {
    const forms = document.querySelectorAll('form');
    forms.forEach((form, idx) => {
      const data = {};
      const elements = form.querySelectorAll('input, textarea, select');
      elements.forEach(el => {
        if (!el.name && !el.id) return;
        if (el.type === 'password' || el.type === 'hidden') return;
        const key = el.name || el.id;
        if (el.type === 'checkbox' || el.type === 'radio') {
          data[key] = el.checked;
        } else {
          data[key] = el.value;
        }
      });
      if (Object.keys(data).length > 0) {
        try {
          localStorage.setItem(getFormKey(form, idx), JSON.stringify(data));
        } catch (e) {}
      }
    });
  }

  function restoreFormState() {
    const forms = document.querySelectorAll('form');
    forms.forEach((form, idx) => {
      const key = getFormKey(form, idx);
      try {
        const saved = localStorage.getItem(key);
        if (!saved) return;
        const data = JSON.parse(saved);
        Object.keys(data).forEach(fieldKey => {
          const el = form.querySelector(`[name="${fieldKey}"], #${fieldKey}`);
          if (el) {
            if (el.type === 'checkbox' || el.type === 'radio') {
              el.checked = Boolean(data[fieldKey]);
            } else {
              el.value = data[fieldKey];
            }
          }
        });
      } catch (e) {}
    });
  }

  // --- 4. Inicialização & Listeners ------------------------------------------
  function init() {
    createTopBanner();
    createEnvStatusWidget();
    restoreFormState();
    checkServerHealth();

    document.addEventListener('input', (e) => {
      if (e.target && e.target.closest('form')) {
        saveFormState();
      }
    });

    window.addEventListener('online', checkServerHealth);
    window.addEventListener('offline', checkServerHealth);
    window.addEventListener('erp:offline', checkServerHealth);
    window.addEventListener('focus', checkServerHealth);

    // Consulta periódica (30s)
    setInterval(checkServerHealth, 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
