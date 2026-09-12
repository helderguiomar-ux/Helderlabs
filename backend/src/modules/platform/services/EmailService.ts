import { AuditService } from './AuditService';

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  category?: 'SYSTEM' | 'SECURITY' | 'USER' | 'APPLICATION';
  tenantId?: string;
  actorId?: string;
  actorEmail?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface EmailResult {
  ok: boolean;
  code?: string;
  message?: string;
  messageId?: string;
}

export class EmailService {
  private static getApiKey(): string | undefined {
    return process.env.RESEND_API_KEY;
  }

  private static getFromAddress(): string {
    return process.env.SMTP_FROM || 'HelderLabs ERP <noreply@helderlabs.eu>';
  }

  /**
   * Envia um email através da API Resend com auditoria e tratamento de erros rigoroso.
   */
  static async send(options: SendEmailOptions): Promise<EmailResult> {
    const apiKey = this.getApiKey();
    const fromAddress = this.getFromAddress();
    const recipients = Array.isArray(options.to) ? options.to : [options.to];
    const isProduction = process.env.NODE_ENV === 'production';

    // Se a chave não estiver configurada
    if (!apiKey) {
      if (isProduction) {
        console.error('[EMAIL SERVICE] RESEND_API_KEY ausente em ambiente de produção!');
        await AuditService.audit({
          action: 'email.send_failed',
          category: options.category || 'SYSTEM',
          tenantId: options.tenantId,
          actorId: options.actorId,
          actorEmail: options.actorEmail,
          resource: 'Email',
          resourceId: recipients.join(','),
          newValue: { subject: options.subject, error: 'MISSING_RESEND_API_KEY' },
          result: 'FAILURE',
          ipAddress: options.ipAddress,
          userAgent: options.userAgent
        });
        return {
          ok: false,
          code: 'EMAIL_CONFIG_MISSING',
          message: 'O serviço de envio de email não está configurado na plataforma.'
        };
      }

      // Em ambiente de desenvolvimento ou teste: simulação segura
      console.log(`[EMAIL SERVICE SIMULATION] [To: ${recipients.join(', ')}] [Subject: ${options.subject}]`);
      await AuditService.audit({
        action: 'email.simulated',
        category: options.category || 'SYSTEM',
        tenantId: options.tenantId,
        actorId: options.actorId,
        actorEmail: options.actorEmail,
        resource: 'Email',
        resourceId: recipients.join(','),
        newValue: { subject: options.subject, mode: 'simulation' },
        result: 'SUCCESS',
        ipAddress: options.ipAddress,
        userAgent: options.userAgent
      });

      return {
        ok: true,
        code: 'SIMULATED',
        message: 'Email simulado com sucesso (modo dev/test).'
      };
    }

    try {
      let activeFrom = fromAddress;
      let payload = {
        from: activeFrom,
        to: recipients,
        subject: options.subject,
        html: options.html,
        text: options.text
      };

      let response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      let resData: any = await response.json().catch(() => ({}));

      // Caso o domínio de envio configurado não esteja ainda verificado no Resend, tenta fallback para onboarding@resend.dev
      if (!response.ok && (response.status === 403 || String(resData?.message || '').toLowerCase().includes('domain') || String(resData?.name || '').toLowerCase().includes('validation'))) {
        const fallbackFrom = 'HelderLabs ERP <onboarding@resend.dev>';
        if (activeFrom !== fallbackFrom) {
          console.warn(`[EMAIL SERVICE] Domínio não verificado no Resend para '${activeFrom}'. Tentando fallback para '${fallbackFrom}'...`);
          activeFrom = fallbackFrom;
          payload.from = activeFrom;

          response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          });
          resData = await response.json().catch(() => ({}));
        }
      }

      if (!response.ok) {
        const errorMsg = (resData && (resData.message || resData.name)) || `HTTP ${response.status} ${response.statusText}`;
        console.error('[EMAIL SERVICE ERROR] Resend retornou erro:', resData);

        await AuditService.audit({
          action: 'email.send_failed',
          category: options.category || 'SYSTEM',
          tenantId: options.tenantId,
          actorId: options.actorId,
          actorEmail: options.actorEmail,
          resource: 'Email',
          resourceId: recipients.join(','),
          newValue: { subject: options.subject, error: resData },
          result: 'FAILURE',
          ipAddress: options.ipAddress,
          userAgent: options.userAgent
        });

        let friendlyMsg = errorMsg;
        if (typeof errorMsg === 'string' && (errorMsg.includes('testing emails') || errorMsg.includes('verify a domain'))) {
          friendlyMsg = 'Fornecedor Resend em modo de teste/sandbox. Para envio para caixas de correio externas, verifique o domínio em resend.com/domains.';
        }

        return {
          ok: false,
          code: 'RESEND_API_ERROR',
          message: friendlyMsg
        };
      }

      console.log(`[EMAIL SERVICE SUCCESS] Email enviado com sucesso para ${recipients.join(', ')} (id: ${resData.id})`);

      await AuditService.audit({
        action: 'email.sent',
        category: options.category || 'SYSTEM',
        tenantId: options.tenantId,
        actorId: options.actorId,
        actorEmail: options.actorEmail,
        resource: 'Email',
        resourceId: recipients.join(','),
        newValue: { subject: options.subject, resendId: resData.id },
        result: 'SUCCESS',
        ipAddress: options.ipAddress,
        userAgent: options.userAgent
      });

      return {
        ok: true,
        messageId: resData.id
      };
    } catch (err: any) {
      console.error('[EMAIL SERVICE EXCEPTION]', err);

      await AuditService.audit({
        action: 'email.send_exception',
        category: options.category || 'SYSTEM',
        tenantId: options.tenantId,
        actorId: options.actorId,
        actorEmail: options.actorEmail,
        resource: 'Email',
        resourceId: recipients.join(','),
        newValue: { subject: options.subject, error: err.message },
        result: 'FAILURE',
        ipAddress: options.ipAddress,
        userAgent: options.userAgent
      });

      return {
        ok: false,
        code: 'NETWORK_ERROR',
        message: err.message || 'Erro inesperado na ligação ao fornecedor de email.'
      };
    }
  }

  /**
   * Envia email com código de verificação para novos registos públicos
   */
  static async sendVerificationEmail(to: string, name: string, otpCode: string, meta?: { ipAddress?: string; userAgent?: string }): Promise<EmailResult> {
    const subject = `O seu código de validação HelderLabs ERP: ${otpCode}`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 32px 24px; color: #1f2937; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #0d419f; margin: 0; font-size: 24px; font-weight: 700;">HelderLabs ERP</h2>
          <p style="color: #6b7280; font-size: 14px; margin-top: 4px;">Plataforma Integrada de Gestão Empresarial</p>
        </div>
        <p style="font-size: 15px; line-height: 1.5;">Olá <strong>${name || 'Utilizador'}</strong>,</p>
        <p style="font-size: 15px; line-height: 1.5; color: #374151;">
          Obrigado por solicitar acesso ao HelderLabs ERP. Para confirmar a autenticidade do seu endereço de email, introduza o seguinte código de validação:
        </p>
        <div style="background: #f0f4f8; border: 1px solid #d0d7de; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #0d419f; font-family: monospace;">${otpCode}</span>
        </div>
        <p style="font-size: 13px; color: #6b7280; line-height: 1.4;">
          Este código expira em <strong>24 horas</strong>. Se não efetuou este pedido, ignore esta mensagem em segurança.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 0;">
          &copy; ${new Date().getFullYear()} HelderLabs. Todos os direitos reservados.
        </p>
      </div>
    `;

    return this.send({
      to,
      subject,
      html,
      category: 'SECURITY',
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent
    });
  }

  /**
   * Envia email com código OTP para login / autenticação
   */
  static async sendOtpEmail(to: string, otpCode: string, meta?: { ipAddress?: string; userAgent?: string; tenantId?: string; actorId?: string }): Promise<EmailResult> {
    const subject = `O seu código de acesso HelderLabs ERP: ${otpCode}`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 32px 24px; color: #1f2937; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #0d419f; margin: 0; font-size: 24px; font-weight: 700;">HelderLabs ERP</h2>
          <p style="color: #6b7280; font-size: 14px; margin-top: 4px;">Acesso Seguro</p>
        </div>
        <p style="font-size: 15px; line-height: 1.5; color: #374151;">
          Recebemos um pedido de início de sessão para a sua conta no HelderLabs ERP.
        </p>
        <div style="background: #f0f4f8; border: 1px solid #d0d7de; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #0d419f; font-family: monospace;">${otpCode}</span>
        </div>
        <p style="font-size: 13px; color: #6b7280; line-height: 1.4;">
          Este código é de utilização única e é válido por <strong>24 horas</strong>. Não o partilhe com terceiros.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 0;">
          &copy; ${new Date().getFullYear()} HelderLabs. Todos os direitos reservados.
        </p>
      </div>
    `;

    return this.send({
      to,
      subject,
      html,
      category: 'SECURITY',
      tenantId: meta?.tenantId,
      actorId: meta?.actorId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent
    });
  }

  /**
   * Envia email de notificação quando a conta é aprovada pelo Super Admin
   */
  static async sendAccountApprovedEmail(to: string, name: string, loginUrl?: string, meta?: { tenantId?: string }): Promise<EmailResult> {
    const url = loginUrl || process.env.APP_URL || 'https://helderlabs.eu';
    const subject = 'A sua conta HelderLabs ERP foi aprovada e está ativa!';
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 32px 24px; color: #1f2937; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #0d419f; margin: 0; font-size: 24px; font-weight: 700;">HelderLabs ERP</h2>
        </div>
        <p style="font-size: 15px; line-height: 1.5;">Olá <strong>${name || 'Utilizador'}</strong>,</p>
        <p style="font-size: 15px; line-height: 1.5; color: #374151;">
          Temos o prazer de informar que o seu pedido de adesão foi analisado e <strong>aprovado pelo Administrador</strong>.
        </p>
        <p style="font-size: 15px; line-height: 1.5; color: #374151;">
          O seu espaço de trabalho está configurado e pronto a utilizar com os módulos atribuídos.
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${url}" style="background-color: #0d419f; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px; display: inline-block;">
            Aceder ao HelderLabs ERP &rarr;
          </a>
        </div>
        <p style="font-size: 13px; color: #6b7280; line-height: 1.4;">
          Poderá iniciar sessão com o seu email através de código OTP ou palavra-passe.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 0;">
          &copy; ${new Date().getFullYear()} HelderLabs. Todos os direitos reservados.
        </p>
      </div>
    `;

    return this.send({
      to,
      subject,
      html,
      category: 'USER',
      tenantId: meta?.tenantId
    });
  }

  /**
   * Envia email com link seguro para validação de email de um utilizador de tenant
   */
  static async sendUserVerificationLinkEmail(to: string, name: string, verificationUrl: string, meta?: { tenantId?: string; ipAddress?: string; userAgent?: string }): Promise<EmailResult> {
    const subject = 'Validação do seu endereço de email — HelderLabs Platform';
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 32px 24px; color: #1f2937; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #0d419f; margin: 0; font-size: 24px; font-weight: 700;">HelderLabs</h2>
          <p style="color: #6b7280; font-size: 14px; margin-top: 4px;">Validação do seu endereço de email</p>
        </div>
        <p style="font-size: 15px; line-height: 1.5;">Olá <strong>${name || 'Utilizador'}</strong>,</p>
        <p style="font-size: 15px; line-height: 1.5; color: #374151;">
          Foi criada ou associada uma conta para si na plataforma HelderLabs. Para poder receber licenças e aceder aos módulos empresariais, por favor valide o seu endereço de email clicando no botão abaixo:
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}" style="background-color: #0d419f; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 700; font-size: 15px; display: inline-block; letter-spacing: 0.5px;">
            VALIDAR EMAIL &rarr;
          </a>
        </div>
        <p style="font-size: 13px; color: #6b7280; line-height: 1.4;">
          Este link é pessoal, seguro e válido por <strong>24 horas</strong>. Se não solicitou esta conta ou não reconhece este registo, ignore este email em segurança.
        </p>
        <p style="font-size: 12px; color: #9ca3af; word-break: break-all; margin-top: 20px;">
          Se o botão não funcionar, copie e abra este link no navegador:<br>
          <a href="${verificationUrl}" style="color: #0d419f;">${verificationUrl}</a>
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 0;">
          &copy; ${new Date().getFullYear()} HelderLabs. Todos os direitos reservados.
        </p>
      </div>
    `;

    return this.send({
      to,
      subject,
      html,
      category: 'SECURITY',
      tenantId: meta?.tenantId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent
    });
  }
}
