import { AuditService } from './AuditService';
import { randomUUID } from 'crypto';

// =============================================================================
// EmailService — serviço transacional central do HelderLabs ERP
// =============================================================================
//
// REGRA ARQUITETURAL: este é o ÚNICO ponto do sistema que fala com um
// fornecedor de email. Nenhum módulo (HCCALL, CRM, 2SellMais, Finanças,
// Plataforma) chama a API do Resend diretamente. Quem precisa de enviar um
// email chama um dos métodos `send*` desta classe.
//
// Consequência prática: trocar de fornecedor, acrescentar retentativas,
// mudar o remetente, acrescentar auditoria ou um idioma novo faz-se aqui e
// em mais lado nenhum.
//
// A RESEND_API_KEY vive apenas no ambiente do backend. Nunca é enviada para
// o cliente, nunca aparece em `public/`, nunca é escrita em código.
// =============================================================================

export type EmailLocale = 'pt-PT' | 'en';

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  category?: 'SYSTEM' | 'SECURITY' | 'USER' | 'APPLICATION';
  /** Identifica o tipo de email na auditoria (ex.: 'auth.otp', 'account.approved'). */
  template?: string;
  tenantId?: string;
  actorId?: string;
  actorEmail?: string;
  ipAddress?: string;
  userAgent?: string;
  /**
   * Chave de idempotência. O Resend descarta um segundo pedido com a mesma
   * chave em 24h — é o que impede uma retentativa de duplicar o email.
   * Se não for indicada, é gerada uma por envio.
   */
  idempotencyKey?: string;
}

export interface EmailResult {
  ok: boolean;
  code?: string;
  message?: string;
  messageId?: string;
  /** true quando nada foi enviado de facto (ambiente sem RESEND_API_KEY). */
  simulated?: boolean;
  attempts?: number;
}

interface TemplateMeta {
  locale?: EmailLocale;
  tenantId?: string;
  actorId?: string;
  actorEmail?: string;
  ipAddress?: string;
  userAgent?: string;
  idempotencyKey?: string;
}

// -----------------------------------------------------------------------------
// Utilitários
// -----------------------------------------------------------------------------

/**
 * Escapa dados de origem externa antes de entrarem no HTML do email.
 *
 * Sem isto, um nome como `<img src=x onerror=...>` ou `</div><a href="...">`
 * gravado num pedido de acesso passaria intacto para dentro do corpo do email.
 * Não é XSS no sentido clássico — os clientes de email não executam scripts —
 * mas permite injetar marcação e links num email que aparenta ser nosso.
 */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Só deixa passar http(s). Evita `javascript:` e afins num botão do email. */
function safeUrl(url: string | undefined, fallback: string): string {
  const candidate = (url || '').trim();
  if (/^https?:\/\//i.test(candidate)) return candidate;
  return fallback;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// -----------------------------------------------------------------------------
// Textos por idioma
// -----------------------------------------------------------------------------
// Acrescentar um idioma é acrescentar uma entrada aqui. Não há textos soltos
// dentro dos templates. Só existem os idiomas efetivamente revistos — um
// idioma por traduzir cai em pt-PT em vez de aparecer meio traduzido.
// -----------------------------------------------------------------------------
// Validade do código OTP
// -----------------------------------------------------------------------------
// Isto NÃO é uma escolha de texto. É a validade real, definida em
// `AuthService` e em `public.routes` como 24 horas:
//
//     const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
//
// Antes, o email dizia "15 minutos" enquanto o código durava 24 horas. Um
// utilizador que voltasse ao fim de uma hora concluía, pelo texto, que o
// código já não servia — e pedia outro sem necessidade.
//
// NOTA DE SEGURANÇA, para decisão do proprietário: 24 horas é um prazo longo
// para um código de 6 dígitos. O habitual são 5 a 15 minutos. Existe limite de
// tentativas (`otpAttempts`), o que atenua a força bruta, mas não protege de um
// código interceptado e usado horas depois. Encurtar o prazo é uma alteração de
// comportamento e não foi feita sem autorização.
const OTP_VALIDITY_LABEL = { 'pt-PT': '24 horas', en: '24 hours' } as const;

const STRINGS = {
  'pt-PT': {
    brand: 'HelderLabs ERP',
    tagline: 'Plataforma Integrada de Gestão Empresarial',
    hello: (n: string) => `Olá ${n},`,
    rights: (y: number) => `© ${y} HelderLabs. Todos os direitos reservados.`,
    automated: 'Mensagem automática — não responda a este endereço.',
    ignore: 'Se não efetuou este pedido, ignore esta mensagem em segurança.',
    expiresIn: () => `Este código expira em ${OTP_VALIDITY_LABEL['pt-PT']}.`,
    codeLabel: 'Código de validação'
  },
  en: {
    brand: 'HelderLabs ERP',
    tagline: 'Integrated Business Management Platform',
    hello: (n: string) => `Hello ${n},`,
    rights: (y: number) => `© ${y} HelderLabs. All rights reserved.`,
    automated: 'Automated message — please do not reply to this address.',
    ignore: 'If you did not request this, you can safely ignore this message.',
    expiresIn: () => `This code expires in ${OTP_VALIDITY_LABEL.en}.`,
    codeLabel: 'Verification code'
  }
} as const;

function t(locale?: EmailLocale) {
  return locale === 'en' ? STRINGS.en : STRINGS['pt-PT'];
}

// -----------------------------------------------------------------------------
// Guarda contra ciclos de envio
// -----------------------------------------------------------------------------
// NOTA HONESTA sobre o alcance desta guarda: em Vercel o backend corre em
// instâncias serverless independentes, por isso este contador é POR INSTÂNCIA.
// Não é um limite de segurança — é uma rede contra um ciclo acidental de envio
// (um retry mal feito, um webhook em loop) dentro da mesma instância. O limite
// verdadeiro, partilhado, teria de viver na base de dados ou no Resend.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_RECIPIENT = 8;
const recentSends = new Map<string, number[]>();

function rateLimited(recipient: string): boolean {
  const now = Date.now();
  const key = recipient.toLowerCase();
  const hits = (recentSends.get(key) || []).filter((ts) => now - ts < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX_PER_RECIPIENT) {
    recentSends.set(key, hits);
    return true;
  }
  hits.push(now);
  recentSends.set(key, hits);
  if (recentSends.size > 5000) recentSends.clear();
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// =============================================================================

export class EmailService {
  // ---------------------------------------------------------------------------
  // Configuração — toda lida do ambiente, nada em código
  // ---------------------------------------------------------------------------

  private static getApiKey(): string | undefined {
    return process.env.RESEND_API_KEY;
  }

  /**
   * Remetente. `RESEND_FROM_EMAIL` + `RESEND_FROM_NAME` são a forma preferida;
   * `SMTP_FROM` mantém-se aceite para não partir a configuração já em produção.
   */
  private static getFromAddress(): string {
    const email = process.env.RESEND_FROM_EMAIL;
    if (email) {
      const name = process.env.RESEND_FROM_NAME || 'HelderLabs ERP';
      return `${name} <${email}>`;
    }
    return process.env.SMTP_FROM || 'HelderLabs ERP <noreply@helderlabs.eu>';
  }

  private static getReplyTo(): string | undefined {
    return process.env.RESEND_REPLY_TO || undefined;
  }

  private static getAppUrl(): string {
    return safeUrl(process.env.APP_URL, 'https://helderlabs.eu');
  }

  /** Diagnóstico de configuração — usado pelo endpoint de saúde do email. */
  static describeConfig() {
    return {
      provider: 'resend',
      apiKeyConfigured: Boolean(this.getApiKey()),
      from: this.getFromAddress(),
      replyTo: this.getReplyTo() || null,
      appUrl: this.getAppUrl(),
      environment: process.env.NODE_ENV || 'development'
    };
  }

  // ---------------------------------------------------------------------------
  // Envio
  // ---------------------------------------------------------------------------

  static async send(options: SendEmailOptions): Promise<EmailResult> {
    const apiKey = this.getApiKey();
    const fromAddress = this.getFromAddress();
    const replyTo = options.replyTo || this.getReplyTo();
    const isProduction = process.env.NODE_ENV === 'production';

    const rawRecipients = Array.isArray(options.to) ? options.to : [options.to];
    const recipients = rawRecipients.map((r) => String(r || '').trim()).filter(Boolean);

    const auditBase = {
      category: options.category || ('SYSTEM' as const),
      tenantId: options.tenantId,
      actorId: options.actorId,
      actorEmail: options.actorEmail,
      resource: 'Email',
      resourceId: recipients.join(','),
      ipAddress: options.ipAddress,
      userAgent: options.userAgent
    };

    // --- Validações antes de gastar um pedido à API ---------------------------
    if (recipients.length === 0) {
      return { ok: false, code: 'NO_RECIPIENT', message: 'Nenhum destinatário indicado.' };
    }
    const invalid = recipients.filter((r) => !EMAIL_RE.test(r));
    if (invalid.length > 0) {
      await AuditService.audit({
        ...auditBase,
        action: 'email.send_failed',
        newValue: { subject: options.subject, template: options.template, error: 'INVALID_RECIPIENT' },
        result: 'FAILURE'
      });
      return { ok: false, code: 'INVALID_RECIPIENT', message: 'Endereço de email inválido.' };
    }
    if (recipients.some((r) => rateLimited(r))) {
      console.warn('[EMAIL SERVICE] Limite de envios por destinatário atingido:', recipients.join(','));
      await AuditService.audit({
        ...auditBase,
        action: 'email.rate_limited',
        newValue: { subject: options.subject, template: options.template },
        result: 'FAILURE'
      });
      return {
        ok: false,
        code: 'EMAIL_RATE_LIMITED',
        message: 'Foram enviados demasiados emails para este endereço. Tente novamente dentro de instantes.'
      };
    }

    // --- Sem chave configurada ------------------------------------------------
    if (!apiKey) {
      if (isProduction) {
        console.error('[EMAIL SERVICE] RESEND_API_KEY ausente em ambiente de produção!');
        await AuditService.audit({
          ...auditBase,
          action: 'email.send_failed',
          newValue: { subject: options.subject, template: options.template, error: 'MISSING_RESEND_API_KEY' },
          result: 'FAILURE'
        });
        return {
          ok: false,
          code: 'EMAIL_CONFIG_MISSING',
          message: 'O serviço de envio de email não está configurado na plataforma.'
        };
      }

      // Dev/teste: nada é enviado. `simulated: true` existe para que um teste
      // possa distinguir "enviado" de "simulado" — sem isto, uma suite inteira
      // pode passar a verde sem nunca ter falado com o fornecedor.
      console.warn(
        `[EMAIL SERVICE · SIMULADO — NADA FOI ENVIADO] to=${recipients.join(', ')} template=${options.template || '-'} subject="${options.subject}"`
      );
      await AuditService.audit({
        ...auditBase,
        action: 'email.simulated',
        newValue: { subject: options.subject, template: options.template, mode: 'simulation' },
        result: 'SUCCESS'
      });
      return {
        ok: true,
        simulated: true,
        code: 'SIMULATED',
        message: 'Email simulado (ambiente sem RESEND_API_KEY). Nada foi enviado.'
      };
    }

    // --- Envio com retentativas ----------------------------------------------
    const idempotencyKey = options.idempotencyKey || randomUUID();
    const payload: Record<string, unknown> = {
      from: fromAddress,
      to: recipients,
      subject: options.subject,
      html: options.html,
      text: options.text || htmlToText(options.html)
    };
    if (replyTo) payload.reply_to = replyTo;

    const MAX_ATTEMPTS = 3;
    let lastError = '';
    let lastCode = 'RESEND_API_ERROR';
    let sent: { messageId?: string; attempts: number } | null = null;

    // -------------------------------------------------------------------------
    // Remetente de recurso do Resend (`onboarding@resend.dev`)
    // -------------------------------------------------------------------------
    // Enquanto helderlabs.eu não estiver verificado, o Resend recusa qualquer
    // envio a partir de @helderlabs.eu. O remetente partilhado deles funciona,
    // MAS só entrega ao dono da conta (helderguiomar@gmail.com). Para qualquer
    // outro destinatário falha na mesma.
    //
    // Por isso este recurso é explícito e barulhento, nunca silencioso:
    //   - desligado por omissão (RESEND_ALLOW_SANDBOX_FALLBACK=true para ligar);
    //   - nunca em produção;
    //   - o resultado vem marcado com SENT_VIA_SANDBOX_SENDER, para que nenhum
    //     teste possa ficar verde a pensar que o envio foi normal.
    //
    // Um recurso silencioso esconderia exatamente aquilo que este trabalho
    // existe para tornar visível: o domínio ainda não está verificado.
    const sandboxFrom = 'HelderLabs ERP <onboarding@resend.dev>';
    const sandboxAllowed =
      process.env.RESEND_ALLOW_SANDBOX_FALLBACK === 'true' && !isProduction;
    let usedSandbox = false;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            // A mesma chave em todas as tentativas: uma retentativa depois de
            // um timeout não pode resultar em dois emails para o utilizador.
            'Idempotency-Key': (payload.__sandboxKey as string) || idempotencyKey
          },
          body: JSON.stringify({ ...payload, __sandboxKey: undefined })
        });

        const resData: any = await response.json().catch(() => ({}));

        if (response.ok) {
          // NÃO auditar aqui dentro. O `catch` abaixo apanha tudo o que este
          // bloco lançar, e a AuditService lança de propósito quando não
          // consegue gravar um evento de segurança. O resultado seria o
          // envio bem-sucedido a ser confundido com uma falha de rede e o
          // email a ser reenviado. A auditoria do sucesso é feita depois do
          // ciclo, fora do try.
          sent = { messageId: resData.id, attempts: attempt };
          break;
        }

        lastError = (resData && (resData.message || resData.name)) || `HTTP ${response.status} ${response.statusText}`;

        // O domínio ainda não está verificado no Resend?
        const domainRejected =
          response.status === 403 ||
          /domain|verify a domain|testing emails/i.test(String(resData?.message || '')) ||
          /validation/i.test(String(resData?.name || ''));

        if (domainRejected) {
          lastCode = 'RESEND_DOMAIN_NOT_VERIFIED';
          lastError =
            `O domínio de envio não está verificado no Resend. Resposta do fornecedor: ${lastError}`;

          if (sandboxAllowed && !usedSandbox) {
            console.warn(
              `[EMAIL SERVICE] Domínio '${fromAddress}' recusado. A repetir com o remetente de recurso '${sandboxFrom}'. ` +
                'ATENÇÃO: este remetente só entrega ao dono da conta Resend.'
            );
            usedSandbox = true;
            payload.from = sandboxFrom;
            // Remetente diferente = email diferente. A chave de idempotência
            // tem de mudar, ou o Resend descarta este envio como repetido.
            payload.__sandboxKey = `${idempotencyKey}-sandbox`;
            continue;
          }
        }

        // 4xx (exceto 429) é um erro nosso — repetir dá exatamente o mesmo.
        const retryable = response.status === 429 || response.status >= 500;
        if (!domainRejected) {
          lastCode = response.status === 429 ? 'RESEND_RATE_LIMIT' : 'RESEND_API_ERROR';
        }
        console.error(
          `[EMAIL SERVICE] Resend HTTP ${response.status} (tentativa ${attempt}/${MAX_ATTEMPTS}):`,
          lastError
        );
        if (!retryable || attempt === MAX_ATTEMPTS) break;
      } catch (err: any) {
        lastError = err?.message || 'Erro de rede';
        lastCode = 'NETWORK_ERROR';
        console.error(`[EMAIL SERVICE] exceção de rede (tentativa ${attempt}/${MAX_ATTEMPTS}):`, lastError);
        if (attempt === MAX_ATTEMPTS) break;
      }

      await sleep(attempt === 1 ? 400 : 1200);
    }

    // -------------------------------------------------------------------------
    // Auditoria fora do ciclo.
    //
    // A AuditService lança quando não consegue gravar, para que a operação
    // aborte antes de causar dano. Aqui o dano — ou o benefício — já aconteceu:
    // o email já saiu. Abortar não o traz de volta e repetir duplicava-o.
    // Por isso o resultado real do envio é devolvido ao chamador, com a falha
    // de auditoria assinalada em vez de escondida.
    // -------------------------------------------------------------------------
    if (sent) {
      console.log(
        `[EMAIL SERVICE] enviado to=${recipients.join(',')} template=${options.template || '-'} id=${sent.messageId} tentativas=${sent.attempts}`
      );
      try {
        await AuditService.audit({
          ...auditBase,
          action: 'email.sent',
          newValue: {
            subject: options.subject,
            template: options.template,
            resendId: sent.messageId,
            attempts: sent.attempts
          },
          result: 'SUCCESS'
        });
      } catch (auditErr: any) {
        console.error(
          '[EMAIL SERVICE] EMAIL ENVIADO MAS NÃO AUDITADO — investigar:',
          auditErr?.message || auditErr
        );
        return {
          ok: true,
          messageId: sent.messageId,
          attempts: sent.attempts,
          code: 'SENT_BUT_NOT_AUDITED',
          message: 'O email foi enviado, mas não foi possível registar o evento na auditoria.'
        };
      }
      if (usedSandbox) {
        return {
          ok: true,
          messageId: sent.messageId,
          attempts: sent.attempts,
          code: 'SENT_VIA_SANDBOX_SENDER',
          message:
            'Enviado pelo remetente de recurso do Resend (onboarding@resend.dev). ' +
            'Só chega ao dono da conta Resend. O domínio helderlabs.eu continua por verificar.'
        };
      }
      return { ok: true, messageId: sent.messageId, attempts: sent.attempts };
    }

    try {
      await AuditService.audit({
        ...auditBase,
        action: 'email.send_failed',
        newValue: {
          subject: options.subject,
          template: options.template,
          error: lastError,
          attempts: MAX_ATTEMPTS
        },
        result: 'FAILURE'
      });
    } catch (auditErr: any) {
      console.error('[EMAIL SERVICE] falha de envio NÃO auditada:', auditErr?.message || auditErr);
    }

    return {
      ok: false,
      code: lastCode,
      message: `Falha no envio de email: ${lastError}`,
      attempts: MAX_ATTEMPTS
    };
  }

  // ---------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------
  // Um único invólucro visual para toda a plataforma. Antes, cada email repetia
  // o seu próprio HTML — três cópias do mesmo cabeçalho e rodapé que iam
  // divergindo. Agora o invólucro é um só e cada template só descreve o miolo.

  private static layout(
    bodyHtml: string,
    opts: { locale?: EmailLocale; preheader?: string; subtitle?: string } = {}
  ): string {
    const s = t(opts.locale);
    const preheader = opts.preheader ? esc(opts.preheader) : '';
    return `<!DOCTYPE html>
<html lang="${opts.locale === 'en' ? 'en' : 'pt-PT'}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#f5f6f8;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>` : ''}
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:540px;margin:0 auto;padding:32px 24px;color:#1f2937;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
  <div style="text-align:center;margin-bottom:24px;">
    <h1 style="color:#0d419f;margin:0;font-size:24px;font-weight:700;">${esc(s.brand)}</h1>
    <p style="color:#6b7280;font-size:14px;margin-top:4px;">${esc(opts.subtitle || s.tagline)}</p>
  </div>
  ${bodyHtml}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0 0 4px;">${esc(s.automated)}</p>
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">${esc(s.rights(new Date().getFullYear()))}</p>
</div>
</body></html>`;
  }

  private static codeBlock(code: string): string {
    return `<div style="background:#f0f4f8;border:1px solid #d0d7de;border-radius:8px;padding:18px;text-align:center;margin:24px 0;">
      <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#0d419f;font-family:monospace;">${esc(code)}</span>
    </div>`;
  }

  private static button(url: string, label: string): string {
    return `<div style="text-align:center;margin:30px 0;">
      <a href="${esc(url)}" style="background-color:#0d419f;color:#ffffff;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;display:inline-block;">${esc(label)}</a>
    </div>
    <p style="font-size:12px;color:#6b7280;word-break:break-all;">${esc(url)}</p>`;
  }

  /** Verificação de email no registo público. */
  static async sendVerificationEmail(
    to: string,
    name: string,
    otpCode: string,
    meta?: TemplateMeta
  ): Promise<EmailResult> {
    const s = t(meta?.locale);
    const subject =
      meta?.locale === 'en'
        ? `Your HelderLabs ERP verification code: ${otpCode}`
        : `O seu código de validação HelderLabs ERP: ${otpCode}`;

    const body =
      meta?.locale === 'en'
        ? `<p style="font-size:15px;line-height:1.5;">${esc(s.hello(name || 'there'))}</p>
           <p style="font-size:15px;line-height:1.5;color:#374151;">Thank you for requesting access to HelderLabs ERP. Enter the code below to confirm your email address.</p>
           ${this.codeBlock(otpCode)}
           <p style="font-size:13px;color:#6b7280;line-height:1.4;">${esc(s.expiresIn())} ${esc(s.ignore)}</p>`
        : `<p style="font-size:15px;line-height:1.5;">${esc(s.hello(name || 'Utilizador'))}</p>
           <p style="font-size:15px;line-height:1.5;color:#374151;">Obrigado por solicitar acesso ao HelderLabs ERP. Para confirmar o seu endereço de email, introduza o código abaixo.</p>
           ${this.codeBlock(otpCode)}
           <p style="font-size:13px;color:#6b7280;line-height:1.4;">${esc(s.expiresIn())} ${esc(s.ignore)}</p>`;

    return this.send({
      to,
      subject,
      html: this.layout(body, { locale: meta?.locale, preheader: subject }),
      category: 'SECURITY',
      template: 'auth.verification',
      ...pick(meta)
    });
  }

  /** Código OTP de início de sessão. */
  static async sendOtpEmail(to: string, otpCode: string, meta?: TemplateMeta): Promise<EmailResult> {
    const s = t(meta?.locale);
    const subject =
      meta?.locale === 'en'
        ? `Your HelderLabs ERP sign-in code: ${otpCode}`
        : `O seu código de acesso HelderLabs ERP: ${otpCode}`;

    const body =
      meta?.locale === 'en'
        ? `<p style="font-size:15px;line-height:1.5;color:#374151;">We received a sign-in request for your HelderLabs ERP account.</p>
           ${this.codeBlock(otpCode)}
           <p style="font-size:13px;color:#6b7280;line-height:1.4;">${esc(s.expiresIn())} Do not share it with anyone. ${esc(s.ignore)}</p>`
        : `<p style="font-size:15px;line-height:1.5;color:#374151;">Recebemos um pedido de início de sessão para a sua conta no HelderLabs ERP.</p>
           ${this.codeBlock(otpCode)}
           <p style="font-size:13px;color:#6b7280;line-height:1.4;">${esc(s.expiresIn())} Não o partilhe com ninguém. ${esc(s.ignore)}</p>`;

    return this.send({
      to,
      subject,
      html: this.layout(body, {
        locale: meta?.locale,
        preheader: subject,
        subtitle: meta?.locale === 'en' ? 'Secure access' : 'Acesso seguro'
      }),
      category: 'SECURITY',
      template: 'auth.otp',
      ...pick(meta)
    });
  }

  /** Conta aprovada pelo administrador. */
  static async sendAccountApprovedEmail(
    to: string,
    name: string,
    loginUrl?: string,
    meta?: TemplateMeta
  ): Promise<EmailResult> {
    const url = safeUrl(loginUrl, this.getAppUrl());
    const s = t(meta?.locale);
    const subject =
      meta?.locale === 'en'
        ? 'Your HelderLabs ERP account is active'
        : 'A sua conta HelderLabs ERP foi aprovada e está ativa';

    const body =
      meta?.locale === 'en'
        ? `<p style="font-size:15px;line-height:1.5;">${esc(s.hello(name || 'there'))}</p>
           <p style="font-size:15px;line-height:1.5;color:#374151;">Your access request has been reviewed and <strong>approved</strong>. Your workspace is ready with the modules assigned to you.</p>
           ${this.button(url, 'Open HelderLabs ERP')}`
        : `<p style="font-size:15px;line-height:1.5;">${esc(s.hello(name || 'Utilizador'))}</p>
           <p style="font-size:15px;line-height:1.5;color:#374151;">O seu pedido de adesão foi analisado e <strong>aprovado</strong>. O seu espaço de trabalho está pronto, com os módulos que lhe foram atribuídos.</p>
           ${this.button(url, 'Aceder ao HelderLabs ERP')}`;

    return this.send({
      to,
      subject,
      html: this.layout(body, { locale: meta?.locale, preheader: subject }),
      category: 'USER',
      template: 'account.approved',
      ...pick(meta)
    });
  }

  /** Pedido de acesso recusado. */
  static async sendAccountRejectedEmail(
    to: string,
    name: string,
    reason?: string,
    meta?: TemplateMeta
  ): Promise<EmailResult> {
    const s = t(meta?.locale);
    const subject =
      meta?.locale === 'en'
        ? 'About your HelderLabs ERP access request'
        : 'Sobre o seu pedido de acesso ao HelderLabs ERP';

    const reasonHtml = reason
      ? `<div style="background:#f9fafb;border-left:3px solid #d1d5db;padding:12px 16px;margin:18px 0;font-size:14px;color:#374151;">${esc(reason)}</div>`
      : '';

    const body =
      meta?.locale === 'en'
        ? `<p style="font-size:15px;line-height:1.5;">${esc(s.hello(name || 'there'))}</p>
           <p style="font-size:15px;line-height:1.5;color:#374151;">Your access request was reviewed and could not be approved at this time.</p>
           ${reasonHtml}
           <p style="font-size:14px;color:#374151;">If you believe this is a mistake, reply to the administrator who handles your organisation.</p>`
        : `<p style="font-size:15px;line-height:1.5;">${esc(s.hello(name || 'Utilizador'))}</p>
           <p style="font-size:15px;line-height:1.5;color:#374151;">O seu pedido de acesso foi analisado e não foi possível aprová-lo de momento.</p>
           ${reasonHtml}
           <p style="font-size:14px;color:#374151;">Se considera que se trata de um lapso, contacte o administrador responsável pela sua organização.</p>`;

    return this.send({
      to,
      subject,
      html: this.layout(body, { locale: meta?.locale, preheader: subject }),
      category: 'USER',
      template: 'account.rejected',
      ...pick(meta)
    });
  }

  /**
   * Validação do endereço de email de um utilizador de tenant, por ligação
   * segura (token em `users.emailVerificationToken`).
   *
   * Introduzido pelo Antigravity; aqui mantido com a mesma assinatura e o mesmo
   * propósito, mas a passar pelo invólucro comum: o nome e a URL deixam de ser
   * interpolados em bruto no HTML e a URL é validada antes de virar botão.
   */
  static async sendUserVerificationLinkEmail(
    to: string,
    name: string,
    verificationUrl: string,
    meta?: TemplateMeta
  ): Promise<EmailResult> {
    const url = safeUrl(verificationUrl, this.getAppUrl());
    const s = t(meta?.locale);
    const subject =
      meta?.locale === 'en'
        ? 'Verify your email address — HelderLabs Platform'
        : 'Validação do seu endereço de email — HelderLabs Platform';

    const body =
      meta?.locale === 'en'
        ? `<p style="font-size:15px;line-height:1.5;">${esc(s.hello(name || 'there'))}</p>
           <p style="font-size:15px;line-height:1.5;color:#374151;">An account was created for you on the HelderLabs platform. Verify your email address to receive licences and access the business modules.</p>
           ${this.button(url, 'Verify email')}
           <p style="font-size:13px;color:#6b7280;line-height:1.4;">This link is personal and valid for <strong>24 hours</strong>. ${esc(s.ignore)}</p>`
        : `<p style="font-size:15px;line-height:1.5;">${esc(s.hello(name || 'Utilizador'))}</p>
           <p style="font-size:15px;line-height:1.5;color:#374151;">Foi criada ou associada uma conta para si na plataforma HelderLabs. Valide o seu endereço de email para poder receber licenças e aceder aos módulos empresariais.</p>
           ${this.button(url, 'Validar email')}
           <p style="font-size:13px;color:#6b7280;line-height:1.4;">Esta ligação é pessoal e válida por <strong>24 horas</strong>. ${esc(s.ignore)}</p>`;

    return this.send({
      to,
      subject,
      html: this.layout(body, {
        locale: meta?.locale,
        preheader: subject,
        subtitle: meta?.locale === 'en' ? 'Email verification' : 'Validação do seu endereço de email'
      }),
      category: 'SECURITY',
      template: 'account.verification_link',
      ...pick(meta)
    });
  }

  /** Boas-vindas — primeiro acesso concluído. */
  static async sendWelcomeEmail(
    to: string,
    name: string,
    workspaceName?: string,
    meta?: TemplateMeta
  ): Promise<EmailResult> {
    const url = this.getAppUrl();
    const s = t(meta?.locale);
    const subject =
      meta?.locale === 'en' ? 'Welcome to HelderLabs ERP' : 'Bem-vindo ao HelderLabs ERP';

    const ws = workspaceName ? ` <strong>${esc(workspaceName)}</strong>` : '';
    const body =
      meta?.locale === 'en'
        ? `<p style="font-size:15px;line-height:1.5;">${esc(s.hello(name || 'there'))}</p>
           <p style="font-size:15px;line-height:1.5;color:#374151;">Your workspace${ws} is ready. You can sign in with a one-time code sent to this address, or with your password.</p>
           ${this.button(url, 'Open HelderLabs ERP')}`
        : `<p style="font-size:15px;line-height:1.5;">${esc(s.hello(name || 'Utilizador'))}</p>
           <p style="font-size:15px;line-height:1.5;color:#374151;">O seu espaço de trabalho${ws} está pronto. Pode iniciar sessão com um código enviado para este endereço ou com a sua palavra-passe.</p>
           ${this.button(url, 'Aceder ao HelderLabs ERP')}`;

    return this.send({
      to,
      subject,
      html: this.layout(body, { locale: meta?.locale, preheader: subject }),
      category: 'USER',
      template: 'account.welcome',
      ...pick(meta)
    });
  }

  /** Recuperação de palavra-passe. */
  static async sendPasswordResetEmail(
    to: string,
    name: string,
    resetUrl: string,
    expiresInMinutes = 30,
    meta?: TemplateMeta
  ): Promise<EmailResult> {
    const url = safeUrl(resetUrl, this.getAppUrl());
    const s = t(meta?.locale);
    const subject =
      meta?.locale === 'en'
        ? 'Reset your HelderLabs ERP password'
        : 'Redefinir a palavra-passe do HelderLabs ERP';

    const body =
      meta?.locale === 'en'
        ? `<p style="font-size:15px;line-height:1.5;">${esc(s.hello(name || 'there'))}</p>
           <p style="font-size:15px;line-height:1.5;color:#374151;">Use the link below to choose a new password. It is valid for ${expiresInMinutes} minutes and can be used once.</p>
           ${this.button(url, 'Choose a new password')}
           <p style="font-size:13px;color:#6b7280;">${esc(s.ignore)} Your current password stays active until a new one is set.</p>`
        : `<p style="font-size:15px;line-height:1.5;">${esc(s.hello(name || 'Utilizador'))}</p>
           <p style="font-size:15px;line-height:1.5;color:#374151;">Utilize a ligação abaixo para definir uma nova palavra-passe. É válida durante ${expiresInMinutes} minutos e só pode ser usada uma vez.</p>
           ${this.button(url, 'Definir nova palavra-passe')}
           <p style="font-size:13px;color:#6b7280;">${esc(s.ignore)} A palavra-passe atual mantém-se válida enquanto não definir uma nova.</p>`;

    return this.send({
      to,
      subject,
      html: this.layout(body, { locale: meta?.locale, preheader: subject }),
      category: 'SECURITY',
      template: 'auth.password_reset',
      ...pick(meta)
    });
  }

  /** Convite de um utilizador para um workspace existente. */
  static async sendInvitationEmail(
    to: string,
    inviterName: string,
    workspaceName: string,
    inviteUrl: string,
    meta?: TemplateMeta
  ): Promise<EmailResult> {
    const url = safeUrl(inviteUrl, this.getAppUrl());
    const subject =
      meta?.locale === 'en'
        ? `${inviterName} invited you to ${workspaceName} on HelderLabs ERP`
        : `${inviterName} convidou-o para ${workspaceName} no HelderLabs ERP`;

    const body =
      meta?.locale === 'en'
        ? `<p style="font-size:15px;line-height:1.5;color:#374151;"><strong>${esc(inviterName)}</strong> invited you to join <strong>${esc(workspaceName)}</strong> on HelderLabs ERP.</p>
           ${this.button(url, 'Accept invitation')}
           <p style="font-size:13px;color:#6b7280;">If you were not expecting this invitation, you can ignore this message.</p>`
        : `<p style="font-size:15px;line-height:1.5;color:#374151;"><strong>${esc(inviterName)}</strong> convidou-o a juntar-se a <strong>${esc(workspaceName)}</strong> no HelderLabs ERP.</p>
           ${this.button(url, 'Aceitar convite')}
           <p style="font-size:13px;color:#6b7280;">Se não estava à espera deste convite, pode ignorar esta mensagem.</p>`;

    return this.send({
      to,
      subject: subject.slice(0, 190),
      html: this.layout(body, { locale: meta?.locale, preheader: subject }),
      category: 'USER',
      template: 'account.invitation',
      ...pick(meta)
    });
  }

  /** Alerta de segurança (novo dispositivo, alteração de credenciais, etc.). */
  static async sendSecurityAlertEmail(
    to: string,
    name: string,
    event: string,
    details: { ip?: string; userAgent?: string; when?: Date },
    meta?: TemplateMeta
  ): Promise<EmailResult> {
    const s = t(meta?.locale);
    const when = (details.when || new Date()).toLocaleString(meta?.locale === 'en' ? 'en-GB' : 'pt-PT', {
      timeZone: 'Europe/Lisbon'
    });
    const subject =
      meta?.locale === 'en' ? `Security alert: ${event}` : `Alerta de segurança: ${event}`;

    const rows = `<table style="width:100%;font-size:14px;color:#374151;border-collapse:collapse;margin:18px 0;">
      <tr><td style="padding:6px 0;color:#6b7280;">${meta?.locale === 'en' ? 'Event' : 'Evento'}</td><td style="padding:6px 0;"><strong>${esc(event)}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">${meta?.locale === 'en' ? 'When' : 'Quando'}</td><td style="padding:6px 0;">${esc(when)}</td></tr>
      ${details.ip ? `<tr><td style="padding:6px 0;color:#6b7280;">IP</td><td style="padding:6px 0;">${esc(details.ip)}</td></tr>` : ''}
      ${details.userAgent ? `<tr><td style="padding:6px 0;color:#6b7280;">${meta?.locale === 'en' ? 'Device' : 'Dispositivo'}</td><td style="padding:6px 0;font-size:12px;">${esc(details.userAgent)}</td></tr>` : ''}
    </table>`;

    const body =
      meta?.locale === 'en'
        ? `<p style="font-size:15px;line-height:1.5;">${esc(s.hello(name || 'there'))}</p>
           <p style="font-size:15px;line-height:1.5;color:#374151;">We are letting you know about activity on your account.</p>
           ${rows}
           <p style="font-size:14px;color:#374151;">If this was you, no action is needed. If it was not, change your password immediately.</p>`
        : `<p style="font-size:15px;line-height:1.5;">${esc(s.hello(name || 'Utilizador'))}</p>
           <p style="font-size:15px;line-height:1.5;color:#374151;">Informamos que foi registada atividade na sua conta.</p>
           ${rows}
           <p style="font-size:14px;color:#374151;">Se foi o próprio, não é necessário fazer nada. Caso contrário, altere a palavra-passe de imediato.</p>`;

    return this.send({
      to,
      subject,
      html: this.layout(body, {
        locale: meta?.locale,
        preheader: subject,
        subtitle: meta?.locale === 'en' ? 'Security' : 'Segurança'
      }),
      category: 'SECURITY',
      template: 'security.alert',
      ...pick(meta)
    });
  }

  /**
   * Notificação genérica de um módulo (HCCALL, CRM, 2SellMais, Finanças).
   * Existe para que um módulo NUNCA tenha razão para chamar o Resend por si.
   */
  static async sendNotificationEmail(
    to: string | string[],
    subject: string,
    paragraphs: string[],
    opts?: { ctaUrl?: string; ctaLabel?: string; module?: string } & TemplateMeta
  ): Promise<EmailResult> {
    const body = [
      ...paragraphs.map(
        (p) => `<p style="font-size:15px;line-height:1.5;color:#374151;">${esc(p)}</p>`
      ),
      opts?.ctaUrl
        ? this.button(safeUrl(opts.ctaUrl, this.getAppUrl()), opts.ctaLabel || 'Abrir')
        : ''
    ].join('\n');

    return this.send({
      to,
      subject,
      html: this.layout(body, {
        locale: opts?.locale,
        preheader: subject,
        subtitle: opts?.module
      }),
      category: 'APPLICATION',
      template: `notification.${opts?.module || 'generic'}`,
      ...pick(opts)
    });
  }
}

// -----------------------------------------------------------------------------

function pick(meta?: TemplateMeta) {
  return {
    tenantId: meta?.tenantId,
    actorId: meta?.actorId,
    actorEmail: meta?.actorEmail,
    ipAddress: meta?.ipAddress,
    userAgent: meta?.userAgent,
    idempotencyKey: meta?.idempotencyKey
  };
}

/**
 * Versão em texto simples do corpo HTML.
 *
 * Não é cosmético: um email só-HTML é penalizado pelos filtros de spam e é
 * ilegível em clientes de texto. Todos os envios passam a levar as duas partes.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h1|h2|h3)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}
