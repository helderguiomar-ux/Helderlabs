/**
 * HELDERLABS ERP — API & Authentication Utility (api.js)
 * Utilitário universal de autenticação e chamadas HTTP protegidas por JWT.
 * Fonte Única de Sessão: 'erp_session'
 */

(function(window) {
  'use strict';

  const SESSION_KEY = 'erp_session';
  const LEGACY_KEYS = ['hl_token', 'auth_token', 'erp_token'];

  // Migração automática inicial de chaves legadas para chave única erp_session
  (function migrateLegacySession() {
    try {
      let existingSession = localStorage.getItem(SESSION_KEY);
      if (!existingSession) {
        for (const legKey of LEGACY_KEYS) {
          const val = localStorage.getItem(legKey);
          if (val) {
            try {
              const parsed = JSON.parse(val);
              if (parsed && (parsed.token || parsed.user)) {
                localStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
                break;
              }
            } catch (_) {
              // É uma string JWT simples
              localStorage.setItem(SESSION_KEY, JSON.stringify({ token: val }));
              break;
            }
          }
        }
      }
      // Eliminar de forma limpa todas as chaves legadas
      for (const legKey of LEGACY_KEYS) {
        localStorage.removeItem(legKey);
      }
    } catch (e) {
      console.warn('[AUTH SESSION] Erro na migração de chaves:', e);
    }
  })();

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function getAuthToken() {
    const session = getSession();
    return session?.token || null;
  }

  function getAuthUser() {
    const session = getSession();
    return session?.user || null;
  }

  function setAuthSession(sessionData) {
    if (!sessionData) {
      clearAuthSession();
      return;
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
  }

  function clearAuthSession() {
    localStorage.removeItem(SESSION_KEY);
    for (const legKey of LEGACY_KEYS) {
      localStorage.removeItem(legKey);
    }
    sessionStorage.clear();
  }

  function logout() {
    clearAuthSession();
    fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
      window.location.href = '/login.html';
    });
  }

  // Banner visual não-intrusivo para erros 403 de licenciamento/permissões
  function showForbiddenBanner(message) {
    const existing = document.getElementById('erp-forbidden-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'erp-forbidden-banner';
    banner.style.cssText = 'position:fixed;top:16px;right:16px;z-index:99999;background:#b91c1c;color:#ffffff;padding:12px 20px;border-radius:8px;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,0.25);display:flex;align-items:center;gap:12px;max-width:440px;animation:slideIn 0.2s ease-out;';
    banner.innerHTML = `
      <span>⚠️ <strong>Acesso Restrito:</strong> ${message || 'Módulo não licenciado para a sua empresa ou sem permissão de acesso.'}</span>
      <button style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1;" onclick="this.parentElement.remove()">&times;</button>
    `;
    document.body.appendChild(banner);

    setTimeout(() => {
      if (banner.parentElement) banner.remove();
    }, 6000);
  }

  let isRedirectingToLogin = false;

  async function apiFetch(url, options = {}) {
    const opts = { ...options };
    opts.headers = { ...(opts.headers || {}) };

    const token = getAuthToken();
    if (token && !opts.headers['Authorization']) {
      opts.headers['Authorization'] = 'Bearer ' + token;
    }

    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData) && !(opts.body instanceof Blob)) {
      if (!opts.headers['Content-Type']) {
        opts.headers['Content-Type'] = 'application/json';
      }
      opts.body = JSON.stringify(opts.body);
    }

    const response = await fetch(url, opts);

    // Tratamento 401 — Sessão expirada
    if (response.status === 401) {
      const currentPath = window.location.pathname;
      if (!currentPath.includes('login.html') && !currentPath.includes('index.html')) {
        if (!isRedirectingToLogin) {
          isRedirectingToLogin = true;
          clearAuthSession();
          window.location.href = '/login.html';
        }
      }
    }

    // Tratamento 403 — Licença / Permissões (não desloga o utilizador)
    if (response.status === 403) {
      try {
        const clone = response.clone();
        const errJson = await clone.json();
        if (errJson?.error === 'APP_NOT_LICENSED' || errJson?.error === 'APP_NOT_ASSIGNED' || errJson?.error === 'APP_READ_ONLY' || errJson?.message) {
          showForbiddenBanner(errJson.message);
        }
      } catch (_) {}
    }

    return response;
  }

  window.ERPAuth = {
    getToken: getAuthToken,
    getUser: getAuthUser,
    getSession: getSession,
    setSession: setAuthSession,
    clearSession: clearAuthSession,
    logout: logout,
    showForbiddenBanner: showForbiddenBanner
  };

  window.apiFetch = apiFetch;

})(window);
