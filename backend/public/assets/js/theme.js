/**
 * HELDERLABS ERP — Universal Theme Manager (theme.js)
 * Suporte a Temas: 'system' | 'light' | 'dark'
 * Persistência na chave: 'hl_theme'
 */

(function(window) {
  'use strict';

  const THEME_KEY = 'hl_theme';

  function getSavedTheme() {
    return localStorage.getItem(THEME_KEY) || 'system';
  }

  function getSystemPreference() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function resolveEffectiveTheme(themePreference) {
    if (themePreference === 'system') {
      return getSystemPreference();
    }
    return themePreference === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    const pref = theme || getSavedTheme();
    const effective = resolveEffectiveTheme(pref);

    if (pref === 'system') {
      document.documentElement.removeAttribute('data-theme');
      // O media query no CSS aplicará o tema do sistema
    } else {
      document.documentElement.setAttribute('data-theme', pref);
    }

    // Atualizar eventuais botões de alternância na página
    updateThemeToggleUI(pref, effective);
  }

  function setTheme(theme) {
    const valid = ['system', 'light', 'dark'].includes(theme) ? theme : 'system';
    localStorage.setItem(THEME_KEY, valid);
    applyTheme(valid);
  }

  function toggleTheme() {
    const current = getSavedTheme();
    if (current === 'light') {
      setTheme('dark');
    } else if (current === 'dark') {
      setTheme('system');
    } else {
      setTheme('light');
    }
  }

  function updateThemeToggleUI(pref, effective) {
    const toggles = document.querySelectorAll('[data-theme-toggle]');
    toggles.forEach(btn => {
      const icon = effective === 'dark' ? '🌙' : '☀️';
      const label = pref === 'system' ? 'Sistema' : pref === 'dark' ? 'Escuro' : 'Claro';
      btn.setAttribute('title', 'Tema atual: ' + label + ' (Clique para alternar)');
      const iconEl = btn.querySelector('.theme-icon');
      if (iconEl) iconEl.textContent = icon;
    });
  }

  // Monitorizar alterações no tema do SO quando em modo 'system'
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (getSavedTheme() === 'system') {
        applyTheme('system');
      }
    });
  }

  // Executar imediatamente no carregamento
  applyTheme();

  window.ERPTheme = {
    getTheme: getSavedTheme,
    setTheme: setTheme,
    toggleTheme: toggleTheme,
    applyTheme: applyTheme
  };

})(window);
