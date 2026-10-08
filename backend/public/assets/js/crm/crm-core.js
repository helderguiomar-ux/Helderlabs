/**
 * HELDERLABS ERP — CRM Core Module (crm-core.js) v1.6.1
 * Utilitários, escape XSS estrito e gestão de estado partilhada
 */
(function (window) {
  'use strict';

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escAttr(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function fmtCurrency(cents) {
    if (cents === null || cents === undefined || isNaN(cents)) return '—';
    return (Number(cents) / 100).toLocaleString('pt-PT', {
      style: 'currency',
      currency: 'EUR'
    });
  }

  function fmtDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-PT');
  }

  window.CRMCore = {
    esc,
    escAttr,
    fmtCurrency,
    fmtDate,

    async api(path, options = {}) {
      const fetchFn = window.apiFetch || window.fetch;
      const res = await fetchFn(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    }
  };
})(window);
