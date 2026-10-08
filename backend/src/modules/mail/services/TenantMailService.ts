import nodemailer from 'nodemailer';
import { z } from 'zod';
import { AppError } from '../../../utils/errors';
import { AuditService, type AuditLogInput } from '../../platform/services/AuditService';
import { EmailService } from '../../platform/services/EmailService';
import { decryptCredential, encryptCredential, isCredentialCipherConfigured } from './credentialCipher';
import { resolveSmtpTarget, type ResolvedSmtpTarget } from './smtpHostGuard';

// =============================================================================
// Envio de email por tenant
//
// Ponto único por onde QUALQUER módulo (CRM, propostas, HCCALL…) envia email
// em nome de um tenant. Dois modos:
//
//   PLATFORM — remetente da plataforma (Resend, domínio helderlabs.eu), com o
//              "responder para" do tenant. Funciona sem configuração.
//   SMTP     — servidor do próprio tenant (Gmail com password de aplicação,
//              Microsoft 365, servidor da empresa…). A password é guardada
//              cifrada e nunca sai do backend.
//
// Cada tentativa de envio fica registada em email_send_logs (SENT, FAILED ou
// BLOCKED_LIMIT). O limite diário conta envios SENT nas últimas 24 horas.
// =============================================================================

export const SMTP_PRESETS = {
  GMAIL: { host: 'smtp.gmail.com', port: 465, secure: true }
} as const;

const SINGLE_LINE = /^[^\r\n]*$/;

export const emailSettingsInputSchema = z
  .object({
    provider: z.enum(['PLATFORM', 'SMTP']),
    preset: z.enum(['GMAIL', 'CUSTOM']).optional().nullable(),
    smtpHost: z.string().trim().max(253).optional().nullable(),
    smtpPort: z.coerce.number().int().optional().nullable(),
    smtpSecure: z.boolean().optional(),
    smtpUser: z.string().trim().max(254).optional().nullable(),
    smtpPassword: z.string().max(512).optional().nullable(),
    fromName: z.string().trim().max(80).regex(SINGLE_LINE, 'O nome do remetente não pode ter quebras de linha.').optional().nullable(),
    fromEmail: z.string().trim().toLowerCase().email('Email do remetente inválido.').optional().nullable().or(z.literal('')),
    replyTo: z.string().trim().toLowerCase().email('Email de resposta inválido.').optional().nullable().or(z.literal('')),
    dailyLimit: z.coerce.number().int().min(1).max(2000).optional()
  })
  .strict();

export type EmailSettingsInput = z.infer<typeof emailSettingsInputSchema>;

export const sendEmailInputSchema = z.object({
  to: z.string().trim().toLowerCase().email('Destinatário inválido.'),
  subject: z.string().trim().min(1, 'O assunto é obrigatório.').max(250).regex(SINGLE_LINE, 'O assunto não pode ter quebras de linha.'),
  html: z.string().min(1).max(500_000),
  text: z.string().max(200_000).optional(),
  context: z.string().max(80).optional(),
  relatedType: z.string().max(80).optional(),
  relatedId: z.string().max(80).optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1).max(200),
        contentBase64: z.string().min(1),
        contentType: z.string().max(120).optional()
      })
    )
    .max(5)
    .optional()
});

export type SendEmailInput = z.infer<typeof sendEmailInputSchema>;

export interface MailActor {
  userId?: string;
  email?: string;
  role?: string;
  ipAddress?: string;
  userAgent?: string;
}

/** O mínimo de nodemailer que o serviço usa — permite substituir nos testes. */
export interface MailTransport {
  verify(): Promise<unknown>;
  sendMail(message: Record<string, unknown>): Promise<{ messageId?: string }>;
}

export type TransportFactory = (options: Record<string, unknown>) => MailTransport;

interface Deps {
  transportFactory?: TransportFactory;
  resolveTarget?: (host: string, port: number) => Promise<ResolvedSmtpTarget>;
  audit?: (input: AuditLogInput) => Promise<void>;
  platformSend?: typeof EmailService.send;
  now?: () => Date;
}

/** Opções de ligação SMTP. Exportado para os testes de protocolo reais. */
export function buildTransportOptions(target: ResolvedSmtpTarget, secure: boolean, user: string, pass: string) {
  return {
    host: target.address,
    port: target.port,
    secure,
    // Em 587/25/2525 o STARTTLS é obrigatório: nunca enviar a password em claro.
    requireTLS: !secure,
    auth: { user, pass },
    tls: { servername: target.hostname, minVersion: 'TLSv1.2' },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000
  };
}

const defaultTransportFactory: TransportFactory = (options) => nodemailer.createTransport(options as any) as unknown as MailTransport;

/** Traduz erros SMTP em mensagens que o utilizador consegue resolver. */
export function friendlySmtpError(error: any): { code: string; message: string } {
  const code = String(error?.code || '');
  const response = String(error?.response || error?.message || '');
  if (code === 'EAUTH' || /535|534|authentication/i.test(response)) {
    return {
      code: 'SMTP_AUTH_FAILED',
      message:
        'O servidor recusou o utilizador ou a password. No Gmail tem de usar uma password de aplicação (Conta Google > Segurança > Verificação em dois passos > Passwords de aplicações), não a password normal.'
    };
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ESOCKET' || code === 'ECONNREFUSED') {
    return { code: 'SMTP_CONNECTION_FAILED', message: 'Não foi possível ligar ao servidor SMTP. Confirme o servidor, a porta e o tipo de segurança.' };
  }
  if (code === 'EENVELOPE' || /^55\d/.test(response)) {
    return { code: 'SMTP_REJECTED', message: 'O servidor recusou o envio para este destinatário.' };
  }
  return { code: 'SMTP_ERROR', message: 'O servidor de email devolveu um erro ao enviar.' };
}

function sanitizeError(error: any): string {
  const raw = `${error?.code || ''} ${error?.response || error?.message || ''}`.trim();
  return raw.slice(0, 500);
}

function emptyToNull(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  return v ? v : null;
}

export class TenantMailService {
  private readonly transportFactory: TransportFactory;
  private readonly resolveTarget: (host: string, port: number) => Promise<ResolvedSmtpTarget>;
  private readonly audit: (input: AuditLogInput) => Promise<void>;
  private readonly platformSend: typeof EmailService.send;
  private readonly now: () => Date;

  constructor(
    private readonly tenantId: string,
    private readonly db: any,
    deps: Deps = {}
  ) {
    if (!tenantId) throw new Error('TenantMailService exige tenantId.');
    this.transportFactory = deps.transportFactory || defaultTransportFactory;
    this.resolveTarget = deps.resolveTarget || ((host, port) => resolveSmtpTarget(host, port));
    this.audit = deps.audit || ((input) => AuditService.audit(input));
    this.platformSend = deps.platformSend || ((options) => EmailService.send(options));
    this.now = deps.now || (() => new Date());
  }

  // ---------------------------------------------------------------------------
  // Leitura
  // ---------------------------------------------------------------------------

  private async loadRow() {
    return this.db.tenantEmailSettings.findUnique({ where: { tenantId: this.tenantId } });
  }

  private async countSentLast24h(): Promise<number> {
    const since = new Date(this.now().getTime() - 24 * 60 * 60 * 1000);
    return this.db.emailSendLog.count({
      where: { tenantId: this.tenantId, status: 'SENT', createdAt: { gte: since } }
    });
  }

  /** Vista pública das definições. NUNCA inclui a password nem a versão cifrada. */
  static toPublicView(row: any) {
    return {
      provider: row?.provider ?? 'PLATFORM',
      preset: row?.preset ?? null,
      smtpHost: row?.smtpHost ?? null,
      smtpPort: row?.smtpPort ?? null,
      smtpSecure: row?.smtpSecure ?? true,
      smtpUser: row?.smtpUser ?? null,
      hasPassword: Boolean(row?.smtpPasswordEnc),
      fromName: row?.fromName ?? null,
      fromEmail: row?.fromEmail ?? null,
      replyTo: row?.replyTo ?? null,
      dailyLimit: row?.dailyLimit ?? 300,
      isVerified: row?.isVerified ?? false,
      lastVerifiedAt: row?.lastVerifiedAt ?? null,
      lastError: row?.lastError ?? null,
      updatedAt: row?.updatedAt ?? null
    };
  }

  async getSettings() {
    const [row, sentLast24h] = await Promise.all([this.loadRow(), this.countSentLast24h()]);
    return {
      ...TenantMailService.toPublicView(row),
      configured: Boolean(row),
      sentLast24h,
      cryptoConfigured: isCredentialCipherConfigured(),
      platformSender: EmailService.describeConfig().from
    };
  }

  /** Estado resumido, para qualquer utilizador do tenant (ex.: aviso no CRM). */
  async getStatus() {
    const row = await this.loadRow();
    const provider = row?.provider ?? 'PLATFORM';
    return {
      provider,
      ready: provider === 'PLATFORM' || Boolean(row?.isVerified),
      fromEmail: provider === 'SMTP' ? row?.fromEmail ?? null : null
    };
  }

  // ---------------------------------------------------------------------------
  // Gravação
  // ---------------------------------------------------------------------------

  async saveSettings(rawInput: unknown, actor: MailActor) {
    const input = emailSettingsInputSchema.parse(rawInput);
    const existing = await this.loadRow();

    const data: Record<string, unknown> = {
      provider: input.provider,
      fromName: emptyToNull(input.fromName),
      replyTo: emptyToNull(input.replyTo),
      dailyLimit: input.dailyLimit ?? existing?.dailyLimit ?? 300,
      updatedByUserId: actor.userId ?? null
    };

    let passwordChanged = false;
    let connectionChanged = false;

    if (input.provider === 'SMTP') {
      const preset = input.preset ?? 'CUSTOM';
      const presetCfg = preset === 'GMAIL' ? SMTP_PRESETS.GMAIL : null;
      const host = (presetCfg?.host ?? emptyToNull(input.smtpHost) ?? '').toLowerCase();
      const port = presetCfg?.port ?? input.smtpPort ?? null;
      const secure = presetCfg?.secure ?? (input.smtpSecure ?? port === 465);
      const user = emptyToNull(input.smtpUser);

      if (!host) throw new AppError('SMTP_HOST_REQUIRED', 'Indique o servidor SMTP.', 400);
      if (!port) throw new AppError('SMTP_PORT_REQUIRED', 'Indique a porta SMTP.', 400);
      if (!user) throw new AppError('SMTP_USER_REQUIRED', 'Indique o utilizador SMTP (normalmente o seu email).', 400);

      connectionChanged =
        !existing ||
        existing.provider !== 'SMTP' ||
        existing.smtpHost !== host ||
        existing.smtpPort !== port ||
        existing.smtpSecure !== secure ||
        existing.smtpUser !== user;

      let password = input.smtpPassword ?? '';
      if (preset === 'GMAIL') password = password.replace(/\s+/g, ''); // o Google mostra-a em grupos de 4
      if (password) {
        data.smtpPasswordEnc = encryptCredential(password, this.tenantId);
        passwordChanged = true;
      } else if (!existing?.smtpPasswordEnc) {
        throw new AppError('SMTP_PASSWORD_REQUIRED', 'Indique a password SMTP.', 400);
      } else if (
        existing.smtpHost !== host ||
        existing.smtpPort !== port ||
        existing.smtpUser !== user
      ) {
        // Proteção contra exfiltração: a password guardada nunca é enviada para
        // um servidor ou utilizador diferente daquele para que foi introduzida.
        throw new AppError(
          'SMTP_PASSWORD_REENTRY_REQUIRED',
          'Alterou o servidor, a porta ou o utilizador: volte a introduzir a password.',
          400
        );
      }

      // Valida o destino (porta permitida, host resolúvel e não interno) depois dos campos obrigatórios.
      await this.resolveTarget(host, port);

      const fromEmail = emptyToNull(input.fromEmail) ?? (z.string().email().safeParse(user).success ? user.toLowerCase() : null);
      if (!fromEmail) throw new AppError('FROM_EMAIL_REQUIRED', 'Indique o email do remetente.', 400);

      Object.assign(data, { preset, smtpHost: host, smtpPort: port, smtpSecure: secure, smtpUser: user, fromEmail });
    } else {
      // PLATFORM: o remetente é sempre o da plataforma; guardam-se só o nome e o "responder para".
      // As credenciais SMTP anteriores mantêm-se guardadas (cifradas) para poder voltar atrás sem as reescrever.
      data.fromEmail = existing?.fromEmail ?? null;
      connectionChanged = existing?.provider !== 'PLATFORM';
    }

    if (connectionChanged || passwordChanged) {
      data.isVerified = input.provider === 'PLATFORM';
      data.lastVerifiedAt = input.provider === 'PLATFORM' ? this.now() : null;
      data.lastError = null;
    }

    const saved = await this.db.tenantEmailSettings.upsert({
      where: { tenantId: this.tenantId },
      create: { tenantId: this.tenantId, ...data },
      update: data
    });

    await this.audit({
      action: 'tenant.email_settings.update',
      module: 'email',
      category: 'SECURITY',
      resource: 'TenantEmailSettings',
      resourceId: saved.id,
      description: passwordChanged
        ? 'Definições de envio de email alteradas (password SMTP substituída).'
        : 'Definições de envio de email alteradas.',
      oldValue: existing ? TenantMailService.toPublicView(existing) : null,
      newValue: TenantMailService.toPublicView(saved),
      result: 'SUCCESS',
      tenantId: this.tenantId,
      actorId: actor.userId,
      actorEmail: actor.email,
      actorType: actor.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'USER',
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent
    }).catch(() => undefined);

    return this.getSettings();
  }

  // ---------------------------------------------------------------------------
  // Envio
  // ---------------------------------------------------------------------------

  private async logSend(entry: Record<string, unknown>) {
    try {
      await this.db.emailSendLog.create({ data: { tenantId: this.tenantId, ...entry } });
    } catch {
      // O registo de envios nunca pode fazer falhar um envio já concluído.
    }
  }

  private async buildSmtpTransport(row: any) {
    if (!row?.smtpHost || !row?.smtpPort || !row?.smtpUser || !row?.smtpPasswordEnc) {
      throw new AppError('SMTP_NOT_CONFIGURED', 'O envio por SMTP não está completamente configurado.', 400);
    }
    const target = await this.resolveTarget(row.smtpHost, row.smtpPort);
    const pass = decryptCredential(row.smtpPasswordEnc, this.tenantId);
    return this.transportFactory(buildTransportOptions(target, row.smtpSecure, row.smtpUser, pass));
  }

  async send(rawInput: unknown, actor: MailActor) {
    const input = sendEmailInputSchema.parse(rawInput);
    const row = await this.loadRow();
    const provider = row?.provider ?? 'PLATFORM';
    const base = {
      provider,
      toEmail: input.to,
      subject: input.subject,
      context: input.context ?? null,
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedId ?? null,
      sentByUserId: actor.userId ?? null
    };

    if (provider === 'PLATFORM') {
      if (input.attachments?.length) {
        throw new AppError(
          'ATTACHMENTS_REQUIRE_SMTP',
          'Para enviar anexos configure o envio pelo seu próprio email (SMTP) nas definições de email.',
          400
        );
      }
      const result = await this.platformSend({
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        replyTo: row?.replyTo || undefined,
        category: 'APPLICATION',
        template: input.context || 'tenant.mail',
        tenantId: this.tenantId,
        actorId: actor.userId,
        actorEmail: actor.email
      });
      await this.logSend({
        ...base,
        fromEmail: EmailService.describeConfig().from,
        status: result.ok ? 'SENT' : 'FAILED',
        messageId: result.messageId ?? null,
        error: result.ok ? null : `${result.code || ''} ${result.message || ''}`.trim().slice(0, 500)
      });
      if (!result.ok) {
        throw new AppError('EMAIL_SEND_FAILED', result.message || 'Não foi possível enviar o email.', 502);
      }
      return { ok: true, provider, messageId: result.messageId ?? null, simulated: Boolean(result.simulated) };
    }

    // SMTP do tenant
    const sent = await this.countSentLast24h();
    if (sent >= row.dailyLimit) {
      await this.logSend({ ...base, fromEmail: row.fromEmail, status: 'BLOCKED_LIMIT', error: `Limite diário de ${row.dailyLimit} atingido.` });
      throw new AppError(
        'EMAIL_DAILY_LIMIT',
        `Atingiu o limite de ${row.dailyLimit} emails nas últimas 24 horas. Pode ajustar o limite nas definições de email.`,
        429
      );
    }

    const transport = await this.buildSmtpTransport(row);
    try {
      const info = await transport.sendMail({
        from: { name: row.fromName || row.fromEmail, address: row.fromEmail },
        to: input.to,
        replyTo: row.replyTo || undefined,
        subject: input.subject,
        html: input.html,
        text: input.text,
        attachments: input.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.contentBase64, 'base64'),
          contentType: a.contentType
        }))
      });
      await this.logSend({ ...base, fromEmail: row.fromEmail, status: 'SENT', messageId: info?.messageId ?? null });
      return { ok: true, provider, messageId: info?.messageId ?? null, simulated: false };
    } catch (error) {
      const friendly = friendlySmtpError(error);
      await this.logSend({ ...base, fromEmail: row.fromEmail, status: 'FAILED', error: sanitizeError(error) });
      await this.db.tenantEmailSettings
        .update({ where: { tenantId: this.tenantId }, data: { lastError: friendly.message } })
        .catch(() => undefined);
      throw new AppError(friendly.code, friendly.message, 502);
    }
  }

  /**
   * Testa a configuração GUARDADA: liga ao servidor, autentica e envia um
   * email de teste para o próprio utilizador. Só uma configuração que passa
   * este teste fica marcada como verificada.
   */
  async testSettings(actor: MailActor & { email: string }) {
    const row = await this.loadRow();
    const provider = row?.provider ?? 'PLATFORM';

    if (provider === 'SMTP') {
      const transport = await this.buildSmtpTransport(row);
      try {
        await transport.verify();
      } catch (error) {
        const friendly = friendlySmtpError(error);
        await this.db.tenantEmailSettings.update({
          where: { tenantId: this.tenantId },
          data: { isVerified: false, lastError: friendly.message }
        });
        throw new AppError(friendly.code, friendly.message, 502);
      }
    }

    const result = await this.send(
      {
        to: actor.email,
        subject: 'Teste de envio — HelderLabs ERP',
        html:
          '<p>Este é um email de teste enviado a partir das definições de email do HelderLabs ERP.</p>' +
          '<p>Se o recebeu, a configuração está a funcionar.</p>',
        text: 'Este é um email de teste enviado a partir das definições de email do HelderLabs ERP. Se o recebeu, a configuração está a funcionar.',
        context: 'settings.test'
      },
      actor
    );

    if (row) {
      await this.db.tenantEmailSettings.update({
        where: { tenantId: this.tenantId },
        data: { isVerified: true, lastVerifiedAt: this.now(), lastError: null }
      });
    }
    return { ...result, to: actor.email };
  }

  async listRecentSends(limit = 50) {
    return this.db.emailSendLog.findMany({
      where: { tenantId: this.tenantId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      select: {
        id: true,
        provider: true,
        fromEmail: true,
        toEmail: true,
        subject: true,
        status: true,
        error: true,
        context: true,
        createdAt: true
      }
    });
  }
}
