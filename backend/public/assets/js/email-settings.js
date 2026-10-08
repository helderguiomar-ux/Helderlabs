/**
 * HELDERLABS ERP — Definições de envio de email do tenant (email-settings.js)
 *
 * Ecrã para o administrador da empresa escolher como saem os emails:
 *  - remetente da plataforma (sem configuração), ou
 *  - o seu próprio email por SMTP (Gmail com password de aplicação, ou outro).
 *
 * A password nunca é lida do servidor: o campo vem sempre vazio e só é enviado
 * quando o utilizador escreve uma nova. Todo o texto vindo do servidor passa
 * por esc() antes de entrar no HTML.
 */
(function (window, document) {
  'use strict';

  const ADMIN_ROLES = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'TENANT_OWNER', 'TENANT_ADMIN'];

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
  }

  async function readJson(res) {
    try {
      return await res.json();
    } catch (_) {
      return {};
    }
  }

  const STATUS_LABEL = { SENT: 'Enviado', FAILED: 'Falhou', BLOCKED_LIMIT: 'Bloqueado (limite)' };
  const STATUS_BADGE = { SENT: 'badge-success', FAILED: 'badge-danger', BLOCKED_LIMIT: 'badge-warning' };

  const EmailSettingsModule = {
    settings: null,
    logs: [],
    busy: false,

    isAdminRole(role) {
      return ADMIN_ROLES.includes(role);
    },

    $(id) {
      return document.getElementById(id);
    },

    async init() {
      this.setMessage('', '');
      await Promise.all([this.loadSettings(), this.loadLogs()]);
    },

    async loadSettings() {
      try {
        const res = await window.apiFetch('/api/tenant/email/settings');
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.message || 'Não foi possível carregar as definições de email.');
        this.settings = data.settings;
        this.fillForm();
        this.renderStatus();
      } catch (err) {
        this.setMessage(err.message, 'error');
      }
    },

    async loadLogs() {
      try {
        const res = await window.apiFetch('/api/tenant/email/logs?limit=20');
        const data = await readJson(res);
        this.logs = res.ok ? data.logs || [] : [];
      } catch (_) {
        this.logs = [];
      }
      this.renderLogs();
    },

    // -------------------------------------------------------------------------
    // Formulário
    // -------------------------------------------------------------------------

    fillForm() {
      const s = this.settings || {};
      const form = this.$('email-settings-form');
      if (!form) return;

      form.provider.value = s.provider || 'PLATFORM';
      form.preset.value = s.preset === 'CUSTOM' ? 'CUSTOM' : 'GMAIL';
      form.smtpHost.value = s.preset === 'CUSTOM' ? s.smtpHost || '' : '';
      form.smtpPort.value = String(s.preset === 'CUSTOM' && s.smtpPort ? s.smtpPort : 587);
      form.smtpUser.value = s.smtpUser || '';
      form.smtpPassword.value = '';
      form.smtpPassword.placeholder = s.hasPassword ? 'Guardada. Deixe vazio para manter.' : '';
      form.fromName.value = s.fromName || '';
      form.fromEmail.value = s.provider === 'SMTP' ? s.fromEmail || '' : '';
      form.replyTo.value = s.replyTo || '';
      form.dailyLimit.value = String(s.dailyLimit || 300);

      const platformSender = this.$('email-platform-sender');
      if (platformSender) platformSender.textContent = s.platformSender || 'remetente da plataforma';

      const cryptoWarn = this.$('email-crypto-warning');
      if (cryptoWarn) cryptoWarn.hidden = s.cryptoConfigured !== false;

      this.syncVisibility();
    },

    syncVisibility() {
      const form = this.$('email-settings-form');
      if (!form) return;
      const isSmtp = form.provider.value === 'SMTP';
      const isGmail = form.preset.value === 'GMAIL';

      this.$('email-smtp-section').hidden = !isSmtp;
      this.$('email-custom-server').hidden = !isSmtp || isGmail;
      this.$('email-gmail-help').hidden = !isSmtp || !isGmail;
      this.$('email-from-email-group').hidden = !isSmtp;

      this.$('email-user-label').textContent = isGmail ? 'Endereço Gmail' : 'Utilizador SMTP';
      this.$('email-password-label').textContent = isGmail ? 'Password de aplicação (16 caracteres)' : 'Password SMTP';
      form.smtpUser.placeholder = isGmail ? 'nome@gmail.com' : 'utilizador@empresa.pt';

      document.querySelectorAll('#email-settings-form .email-provider-option').forEach((el) => {
        el.classList.toggle('selected', el.dataset.value === form.provider.value);
      });
    },

    collect() {
      const form = this.$('email-settings-form');
      const provider = form.provider.value;
      const payload = {
        provider,
        fromName: form.fromName.value.trim(),
        replyTo: form.replyTo.value.trim(),
        dailyLimit: Number(form.dailyLimit.value) || 300
      };
      if (provider === 'SMTP') {
        payload.preset = form.preset.value;
        payload.smtpUser = form.smtpUser.value.trim();
        payload.fromEmail = form.fromEmail.value.trim();
        if (form.smtpPassword.value) payload.smtpPassword = form.smtpPassword.value;
        if (form.preset.value === 'CUSTOM') {
          payload.smtpHost = form.smtpHost.value.trim();
          payload.smtpPort = Number(form.smtpPort.value);
          payload.smtpSecure = Number(form.smtpPort.value) === 465;
        }
      }
      return payload;
    },

    async save(event) {
      if (event) event.preventDefault();
      if (this.busy) return;
      this.setBusy(true);
      this.setMessage('A gravar…', 'info');
      try {
        const res = await window.apiFetch('/api/tenant/email/settings', { method: 'PUT', body: this.collect() });
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.message || 'Não foi possível gravar.');
        this.settings = data.settings;
        this.fillForm();
        this.renderStatus();
        this.setMessage(
          this.settings.provider === 'SMTP'
            ? 'Definições gravadas. Envie um email de teste para confirmar que funcionam.'
            : 'Definições gravadas.',
          'success'
        );
      } catch (err) {
        this.setMessage(err.message, 'error');
      } finally {
        this.setBusy(false);
      }
    },

    async sendTest() {
      if (this.busy) return;
      this.setBusy(true);
      this.setMessage('A ligar ao servidor e a enviar o email de teste…', 'info');
      try {
        const res = await window.apiFetch('/api/tenant/email/test', { method: 'POST', body: {} });
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.message || 'O teste falhou.');
        const r = data.result || {};
        this.setMessage(
          r.simulated
            ? 'Teste concluído em modo simulado (este ambiente não tem chave do Resend). Nenhum email saiu.'
            : `Email de teste enviado para ${r.to}. Confirme a caixa de entrada (e o spam).`,
          'success'
        );
      } catch (err) {
        this.setMessage(err.message, 'error');
      } finally {
        this.setBusy(false);
        await Promise.all([this.loadSettings(), this.loadLogs()]);
      }
    },

    setBusy(busy) {
      this.busy = busy;
      ['email-save-btn', 'email-test-btn'].forEach((id) => {
        const btn = this.$(id);
        if (btn) btn.disabled = busy;
      });
    },

    setMessage(text, kind) {
      const box = this.$('email-settings-message');
      if (!box) return;
      box.hidden = !text;
      box.textContent = text || '';
      box.className = 'email-message' + (kind ? ` email-message-${kind}` : '');
    },

    // -------------------------------------------------------------------------
    // Estado e histórico
    // -------------------------------------------------------------------------

    renderStatus() {
      const box = this.$('email-status-card');
      const s = this.settings;
      if (!box || !s) return;

      const isSmtp = s.provider === 'SMTP';
      const sender = isSmtp
        ? `${s.fromName ? esc(s.fromName) + ' ' : ''}&lt;${esc(s.fromEmail || '—')}&gt;`
        : esc(s.platformSender || '—');
      const badge = !isSmtp
        ? '<span class="badge badge-success">Ativo</span>'
        : s.isVerified
          ? '<span class="badge badge-success">Verificado</span>'
          : '<span class="badge badge-warning">Por testar</span>';

      box.innerHTML = `
        <div class="email-status-row"><span>Modo</span><strong>${isSmtp ? 'O meu email (SMTP)' : 'Remetente da plataforma'}</strong></div>
        <div class="email-status-row"><span>Estado</span>${badge}</div>
        <div class="email-status-row"><span>Remetente</span><strong class="email-mono">${sender}</strong></div>
        <div class="email-status-row"><span>Responder para</span><strong class="email-mono">${esc(s.replyTo || '—')}</strong></div>
        ${isSmtp ? `<div class="email-status-row"><span>Últimas 24 h</span><strong>${esc(s.sentLast24h)} / ${esc(s.dailyLimit)}</strong></div>` : ''}
        ${isSmtp ? `<div class="email-status-row"><span>Último teste</span><strong>${esc(fmtDate(s.lastVerifiedAt))}</strong></div>` : ''}
        ${s.lastError ? `<div class="email-status-error">${esc(s.lastError)}</div>` : ''}
      `;
    },

    renderLogs() {
      const body = this.$('email-logs-body');
      if (!body) return;
      if (!this.logs.length) {
        body.innerHTML = '<tr><td colspan="4" class="email-empty">Ainda não foi enviado nenhum email.</td></tr>';
        return;
      }
      body.innerHTML = this.logs
        .map(
          (l) => `
          <tr>
            <td>${esc(fmtDate(l.createdAt))}</td>
            <td class="email-mono">${esc(l.toEmail)}</td>
            <td>${esc(l.subject)}</td>
            <td><span class="badge ${STATUS_BADGE[l.status] || 'badge-neutral'}" title="${esc(l.error || '')}">${esc(STATUS_LABEL[l.status] || l.status)}</span></td>
          </tr>`
        )
        .join('');
    }
  };

  window.EmailSettingsModule = EmailSettingsModule;
})(window, document);
