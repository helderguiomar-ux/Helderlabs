/**
 * HELDERLABS ERP — Componente de Aviso de Perda de Ligação e Preservação de Formulários
 */

(function () {
  'use strict';

  function createBanner() {
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
      background-color: #da3633;
      color: #ffffff;
      padding: 10px 16px;
      text-align: center;
      font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
    `;
    banner.innerHTML = `⚠️ Sem ligação ao servidor. As tuas alterações no formulário serão preservadas localmente.`;
    document.body.prepend(banner);
  }

  function showBanner() {
    createBanner();
    const banner = document.getElementById('hl-connection-banner');
    if (banner) banner.style.display = 'block';
  }

  function hideBanner() {
    const banner = document.getElementById('hl-connection-banner');
    if (banner) banner.style.display = 'none';
  }

  function updateStatus() {
    if (!navigator.onLine) {
      showBanner();
      saveFormState();
    } else {
      hideBanner();
    }
  }

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
        } catch (e) {
          console.warn('[HelderLabs] Erro ao guardar formulário offline:', e);
        }
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
      } catch (e) {
        console.warn('[HelderLabs] Erro ao restaurar formulário offline:', e);
      }
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    createBanner();
    restoreFormState();
    updateStatus();

    document.addEventListener('input', (e) => {
      if (e.target && e.target.closest('form')) {
        saveFormState();
      }
    });
  });

  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
})();
