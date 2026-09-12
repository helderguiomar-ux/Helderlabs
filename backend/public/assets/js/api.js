/**
 * HELDERLABS ERP — API & Authentication Utility (api.js)
 * Utilitário universal de autenticação e chamadas HTTP protegidas por JWT.
 * Fonte Única de Sessão: 'erp_session'
 */

(function(window) {
  'use strict';

  // ---------------------------------------------------------------------------
  // CONFIGURAÇÃO DE RUNTIME
  //
  // O mesmo código serve dois clientes: o web (servido por helderlabs.eu, com a
  // API na mesma origem) e o local (servido por localhost, com a API remota).
  // A única diferença entre eles é o conteúdo de config.js.
  // ---------------------------------------------------------------------------
  const CONFIG = window.HELDERLABS_CONFIG || {
    apiBaseUrl: '',
    clientType: 'WEB',
    appVersion: 'unknown',
    buildId: 'unknown',
    environment: 'unknown'
  };

  /**
   * Converte um caminho de API relativo no URL absoluto do cliente atual.
   * No cliente web, apiBaseUrl é vazio e o caminho fica relativo — o
   * comportamento de sempre. No cliente local, passa a apontar para a API
   * de produção.
   */
  function resolveUrl(url) {
    if (typeof url !== 'string') return url;
    const base = (CONFIG.apiBaseUrl || '').replace(/\/$/, '');
    if (!base) return url;
    if (!url.startsWith('/api/')) return url;
    return base + url;
  }

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
    fetch(resolveUrl('/api/auth/logout'), { method: 'POST' })
      .catch(() => {})
      .finally(() => {
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

    // Identificação do cliente: DIAGNÓSTICO E AUDITORIA APENAS.
    // O backend nunca concede permissões com base nestes cabeçalhos — a
    // autorização vem do JWT e do tenant que lhe está associado.
    opts.headers['X-HelderLabs-Client'] = CONFIG.clientType;
    opts.headers['X-HelderLabs-Client-Version'] = CONFIG.appVersion;

    const target = resolveUrl(url);

    let response;
    try {
      response = await fetch(target, opts);
    } catch (networkError) {
      // Num cliente local, a API está noutro host: uma falha de rede é um
      // estado normal e tem de ser distinguível de um erro da aplicação.
      window.dispatchEvent(new CustomEvent('erp:offline', { detail: { url: target } }));
      throw new Error('Sem ligação ao servidor HelderLabs.');
    }

    // Incompatibilidade de versão entre este cliente e a API (ver /api/version).
    if (response.status === 426) {
      try {
        const info = await response.clone().json();
        window.dispatchEvent(new CustomEvent('erp:client-outdated', { detail: info }));
      } catch (_) {}
    }

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

  window.ERPConfig = CONFIG;
  window.apiUrl = resolveUrl;

  window.ERPAuth = {
    config: CONFIG,
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
