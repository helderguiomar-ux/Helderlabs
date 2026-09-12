import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '../database/prisma/client';
import { EmailService } from '../modules/platform/services/EmailService';
import { AuditService } from '../modules/platform/services/AuditService';

const PublicRegisterSchema = z
  .object({
    email: z.string().email('Email inválido'),
    emailConfirmation: z.string().email('Email de confirmação inválido'),
    password: z
      .string()
      .min(12, 'A palavra-passe deve ter pelo menos 12 caracteres')
      .regex(/[a-z]/, 'A palavra-passe deve conter pelo menos uma letra minúscula')
      .regex(/[A-Z]/, 'A palavra-passe deve conter pelo menos uma letra maiúscula')
      .regex(/[0-9]/, 'A palavra-passe deve conter pelo menos um algarismo'),
    passwordConfirmation: z.string(),
    name: z.string().optional(),
    contactName: z.string().optional(),
    phone: z.string().optional(),
    companyName: z.string().optional(),
    intendedModule: z.string().optional().default('all'),
    acceptedTerms: z.boolean(),
    acceptedPrivacy: z.boolean(),
    termsVersion: z.string().optional().default('1.0'),
    privacyVersion: z.string().optional().default('1.0')
  })
  // Validação cruzada NO SCHEMA (e não no handler) para que seja impossível
  // contornar as confirmações através de um POST direto à API.
  .refine(
    (d) => d.email.toLowerCase().trim() === d.emailConfirmation.toLowerCase().trim(),
    { message: 'O email e a confirmação de email não coincidem.', path: ['emailConfirmation'] }
  )
  .refine((d) => d.password === d.passwordConfirmation, {
    message: 'A palavra-passe e a confirmação de palavra-passe não coincidem.',
    path: ['passwordConfirmation']
  });

const VerifyEmailSchema = z.object({
  email: z.string().email('Email inválido'),
  code: z.string().min(4, 'Código de verificação é obrigatório')
});

const ResendCodeSchema = z.object({
  email: z.string().email('Email inválido')
});

const PublicLeadSchema = z.object({
  name: z.string().min(2, 'Nome é obrigatório'),
  company: z.string().optional(),
  email: z.string().email('Email inválido'),
  phone: z.string().optional(),
  sector: z.string().optional(),
  message: z.string().min(5, 'Mensagem é obrigatória'),
  acceptedTerms: z.boolean().optional().default(true),
  acceptedPrivacy: z.boolean().optional().default(true)
});

export async function publicRoutes(app: FastifyInstance) {
  // Rate limit para endpoints públicos: 10 pedidos por 15 minutos por IP
  app.register(import('@fastify/rate-limit'), {
    max: 10,
    timeWindow: '15 minutes'
  });

  /**
   * POST /api/public/register
   * Pedido de registo de conta pública com consentimento RGPD, status PENDING_VERIFICATION e envio real de OTP
   */
  app.post('/register', async (request, reply) => {
    const body = PublicRegisterSchema.parse(request.body);

    if (!body.acceptedTerms || !body.acceptedPrivacy) {
      return reply.status(400).send({
        error: 'RGPD_CONSENT_REQUIRED',
        message: 'Deverá aceitar os Termos e Condições e a Política de Privacidade para registar a conta.'
      });
    }

    const cleanEmail = body.email.toLowerCase().trim();

    // As confirmações de email e de palavra-passe são validadas no schema Zod
    // (ver PublicRegisterSchema), pelo que aqui já estão garantidas.
    const passwordHash: string = await bcrypt.hash(body.password, 10);

    const contactName = body.contactName || body.name || cleanEmail.split('@')[0];
    const now = new Date();

    // Verificar se já existe conta de utilizador ativa ou aprovada
    const existingUser = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existingUser && existingUser.status === 'ACTIVE') {
      return reply.status(409).send({
        error: 'ACCOUNT_ALREADY_EXISTS',
        message: 'Já existe uma conta ativa associada a este email. Por favor inicie sessão.'
      });
    }

    // Verificar se existe AccountRequest
    const existingReq = await prisma.accountRequest.findUnique({
      where: { email: cleanEmail }
    });

    if (existingReq && existingReq.status === 'APPROVED') {
      return reply.status(409).send({
        error: 'ACCOUNT_ALREADY_APPROVED',
        message: 'Já existe uma conta associada a este email — inicie sessão ou recupere o acesso.'
      });
    }

    // Gerar código OTP de 6 dígitos
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otpCode, 10);
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    // -------------------------------------------------------------------------
    // ORDEM CRÍTICA: PERSISTIR PRIMEIRO, ENVIAR DEPOIS.
    // A ordem inversa (envio antes da gravação) fazia com que uma falha do
    // fornecedor de email abortasse o pedido com 502 e o AccountRequest nunca
    // chegasse a existir — o utilizador perdia o registo e o Super Admin nunca
    // via o pedido na fila de aprovação. Um pedido de acesso NUNCA se perde
    // por indisponibilidade de um serviço externo.
    // -------------------------------------------------------------------------
    const requestData = {
      name: contactName,
      contactName,
      phone: body.phone ?? existingReq?.phone ?? null,
      companyName: body.companyName ?? existingReq?.companyName ?? null,
      intendedModule: body.intendedModule ?? existingReq?.intendedModule ?? 'all',
      status: 'PENDING_VERIFICATION',
      passwordHash,
      emailVerifiedAt: null,
      otpHash,
      otpExpiresAt,
      otpAttempts: 0,
      acceptedTermsAt: now,
      acceptedPrivacyAt: now,
      termsVersion: body.termsVersion,
      privacyVersion: body.privacyVersion,
      emailDeliveryStatus: 'PENDING',
      emailDeliveryError: null,
      emailLastAttemptAt: now
    };

    const accountReq = existingReq
      ? await prisma.accountRequest.update({ where: { id: existingReq.id }, data: requestData })
      : await prisma.accountRequest.create({ data: { email: cleanEmail, ...requestData } });

    // Só agora se tenta o envio. O resultado é gravado no próprio pedido.
    const emailResult = await EmailService.sendVerificationEmail(cleanEmail, contactName, otpCode, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent']
    });

    await prisma.accountRequest.update({
      where: { id: accountReq.id },
      data: {
        emailDeliveryStatus: emailResult.ok ? 'SENT' : 'FAILED',
        // Detalhe do fornecedor guardado internamente — nunca devolvido ao cliente.
        emailDeliveryError: emailResult.ok ? null : `${emailResult.code ?? 'UNKNOWN'}: ${emailResult.message ?? ''}`.slice(0, 500),
        emailLastAttemptAt: new Date(),
        emailAttemptCount: { increment: 1 }
      }
    });

    await AuditService.audit({
      action: 'account_request.registered',
      category: 'SECURITY',
      resource: 'AccountRequest',
      resourceId: accountReq.id,
      actorEmail: cleanEmail,
      actorType: 'USER',
      newValue: {
        email: cleanEmail,
        companyName: body.companyName,
        status: 'PENDING_VERIFICATION',
        emailDelivered: emailResult.ok
      },
      result: 'SUCCESS',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent']
    });

    if (!emailResult.ok) {
      // O pedido FICA GRAVADO. Regista-se o detalhe técnico internamente e
      // devolve-se ao cliente uma mensagem estável, sem expor o fornecedor.
      app.log.error(
        { email: cleanEmail, accountRequestId: accountReq.id, result: emailResult },
        '[PUBLIC REGISTER] Pedido persistido, mas o envio do email de verificação falhou'
      );

      await AuditService.audit({
        action: 'account_request.email_delivery_failed',
        category: 'SYSTEM',
        resource: 'AccountRequest',
        resourceId: accountReq.id,
        actorEmail: cleanEmail,
        actorType: 'SYSTEM',
        newValue: { code: emailResult.code, providerMessage: emailResult.message },
        result: 'FAILURE',
        ipAddress: request.ip,
        userAgent: request.headers['user-agent']
      });

      return reply.status(200).send({
        success: true,
        status: 'PENDING_VERIFICATION',
        requestId: accountReq.id,
        emailDelivered: false,
        message:
          'O seu pedido foi registado com sucesso. Não foi possível enviar o código de validação neste momento — a nossa equipa foi notificada e entrará em contacto. Poderá também tentar reenviar o código dentro de alguns minutos.'
      });
    }

    return reply.status(200).send({
      success: true,
      status: 'PENDING_VERIFICATION',
      requestId: accountReq.id,
      emailDelivered: true,
      message:
        'Código de validação enviado para o seu email. Por favor introduza o código recebido para confirmar a autenticidade do seu endereço.'
    });
  });

  /**
   * POST /api/public/verify-email
   * Validação de código OTP para verificação de email do pedido de conta
   */
  app.post('/verify-email', async (request, reply) => {
    const body = VerifyEmailSchema.parse(request.body);
    const cleanEmail = body.email.toLowerCase().trim();

    const accountReq = await prisma.accountRequest.findUnique({
      where: { email: cleanEmail }
    });

    if (!accountReq) {
      return reply.status(404).send({
        error: 'REQUEST_NOT_FOUND',
        message: 'Não foi encontrado nenhum pedido de registo para este email.'
      });
    }

    if (accountReq.status === 'APPROVED') {
      return reply.status(400).send({
        error: 'ACCOUNT_ALREADY_APPROVED',
        message: 'Esta conta já se encontra aprovada e ativa. Por favor inicie sessão.'
      });
    }

    if (accountReq.emailVerifiedAt && accountReq.status === 'PENDING') {
      return reply.status(200).send({
        success: true,
        message: 'O seu email já se encontra validado e o pedido aguarda aprovação pelo Super Administrador.',
        status: 'PENDING'
      });
    }

    // Verificar bloqueio por tentativas
    if (accountReq.otpAttempts >= 5) {
      return reply.status(429).send({
        error: 'MAX_ATTEMPTS_EXCEEDED',
        message: 'Número máximo de tentativas excedido (5 tentativas). Solicite um novo código de verificação.'
      });
    }

    // Verificar expiração
    if (!accountReq.otpExpiresAt || accountReq.otpExpiresAt < new Date()) {
      return reply.status(400).send({
        error: 'CODE_EXPIRED',
        message: 'O código de verificação expirou. Por favor solicite um novo código.'
      });
    }

    const allowDevOtp = process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_OTP === 'true';
    const isMasterCode = allowDevOtp && body.code === '123456';
    const isHashValid = accountReq.otpHash ? await bcrypt.compare(body.code, accountReq.otpHash) : false;

    if (!isMasterCode && !isHashValid) {
      const updatedAttempts = accountReq.otpAttempts + 1;
      await prisma.accountRequest.update({
        where: { id: accountReq.id },
        data: { otpAttempts: updatedAttempts }
      });

      const remaining = 5 - updatedAttempts;
      return reply.status(400).send({
        error: 'INVALID_CODE',
        message: remaining > 0
          ? `Código de verificação incorreto. Restam ${remaining} tentativa(s).`
          : 'Código incorreto. Número máximo de tentativas atingido. Solicite um novo código.'
      });
    }

    // Sucesso na verificação
    const updated = await prisma.accountRequest.update({
      where: { id: accountReq.id },
      data: {
        status: 'PENDING',
        emailVerifiedAt: new Date(),
        otpHash: null,
        otpExpiresAt: null,
        otpAttempts: 0
      }
    });

    await AuditService.audit({
      action: 'account_request.email_verified',
      category: 'SECURITY',
      resource: 'AccountRequest',
      resourceId: updated.id,
      actorEmail: cleanEmail,
      actorType: 'USER',
      newValue: { email: cleanEmail, status: 'PENDING', emailVerifiedAt: updated.emailVerifiedAt },
      result: 'SUCCESS',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent']
    });

    return reply.status(200).send({
      success: true,
      message: 'Email validado com sucesso! O seu pedido de adesão foi colocado na fila de aprovação do Administrador.',
      status: 'PENDING'
    });
  });

  /**
   * POST /api/public/resend-code
   * Reenvio de código OTP com taxa limite controlada
   */
  app.post('/resend-code', async (request, reply) => {
    const body = ResendCodeSchema.parse(request.body);
    const cleanEmail = body.email.toLowerCase().trim();

    const accountReq = await prisma.accountRequest.findUnique({
      where: { email: cleanEmail }
    });

    if (!accountReq) {
      return reply.status(404).send({
        error: 'REQUEST_NOT_FOUND',
        message: 'Não foi encontrado nenhum pedido de registo para este email.'
      });
    }

    if (accountReq.status === 'APPROVED') {
      return reply.status(400).send({
        error: 'ACCOUNT_ALREADY_APPROVED',
        message: 'A sua conta já se encontra aprovada. Inicie sessão.'
      });
    }

    const contactName = accountReq.contactName || accountReq.name || cleanEmail.split('@')[0];
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otpCode, 10);
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // Persistir o novo código ANTES de tentar enviar (mesma regra do registo).
    await prisma.accountRequest.update({
      where: { id: accountReq.id },
      data: {
        otpHash,
        otpExpiresAt,
        otpAttempts: 0,
        emailDeliveryStatus: 'PENDING',
        emailLastAttemptAt: new Date()
      }
    });

    const emailResult = await EmailService.sendVerificationEmail(cleanEmail, contactName, otpCode, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent']
    });

    await prisma.accountRequest.update({
      where: { id: accountReq.id },
      data: {
        emailDeliveryStatus: emailResult.ok ? 'SENT' : 'FAILED',
        emailDeliveryError: emailResult.ok ? null : `${emailResult.code ?? 'UNKNOWN'}: ${emailResult.message ?? ''}`.slice(0, 500),
        emailLastAttemptAt: new Date(),
        emailAttemptCount: { increment: 1 }
      }
    });

    if (!emailResult.ok) {
      app.log.error(
        { email: cleanEmail, accountRequestId: accountReq.id, result: emailResult },
        '[PUBLIC RESEND] Falha no reenvio do código de verificação'
      );
      return reply.status(503).send({
        error: 'EMAIL_DELIVERY_FAILED',
        message: 'Não foi possível enviar o código neste momento. O seu pedido continua registado — tente novamente dentro de alguns minutos.'
      });
    }

    await AuditService.audit({
      action: 'account_request.code_resent',
      category: 'SECURITY',
      resource: 'AccountRequest',
      resourceId: accountReq.id,
      actorEmail: cleanEmail,
      actorType: 'USER',
      result: 'SUCCESS',
      ipAddress: request.ip,
      userAgent: request.headers['user-agent']
    });

    return reply.status(200).send({
      success: true,
      message: 'Novo código de validação enviado com sucesso para o seu email.'
    });
  });

  /**
   * POST /api/public/leads
   * Submissão pública de leads da Landing Page -> CRM do Tenant da Plataforma
   */
  app.post('/leads', async (request, reply) => {
    const body = PublicLeadSchema.parse(request.body);

    if (!body.acceptedTerms || !body.acceptedPrivacy) {
      return reply.status(400).send({
        error: 'RGPD_CONSENT_REQUIRED',
        message: 'Deverá aceitar a Política de Privacidade e os Termos de Uso.'
      });
    }

    const platformSlug = process.env.PLATFORM_TENANT_SLUG || 'helderlabs-platform';
    const platformTenant = await prisma.tenant.findUnique({
      where: { slug: platformSlug }
    });

    if (!platformTenant) {
      app.log.error({ platformSlug }, '[PUBLIC LEADS] Tenant da plataforma não encontrado!');
      return reply.status(503).send({
        error: 'PLATFORM_UNAVAILABLE',
        message: 'O serviço de submissão de mensagens está temporariamente indisponível.'
      });
    }

    const autoOppSetting = await prisma.platformSetting.findUnique({
      where: { key: 'crm.landing.auto_create_opportunity' }
    });
    const autoCreateOpp = autoOppSetting ? autoOppSetting.value !== 'false' : true;

    const companyName = body.company || (body.sector ? `Empresa (${body.sector})` : 'Contacto Web');
    const initialStatus = autoCreateOpp ? 'QUALIFICATION' : 'NEW';

    const lead = await prisma.lead.create({
      data: {
        tenantId: platformTenant.id,
        name: body.name,
        company: companyName,
        email: body.email,
        phone: body.phone,
        source: 'LANDING_PAGE',
        status: initialStatus
      }
    });

    const fullMessage = body.sector
      ? `[Sector: ${body.sector}]\n\nMensagem: ${body.message}`
      : body.message;

    await prisma.communication.create({
      data: {
        tenantId: platformTenant.id,
        leadId: lead.id,
        type: 'note',
        subject: 'Mensagem do formulário de contacto (Landing Page)',
        content: fullMessage
      }
    });

    let opportunity = null;
    if (autoCreateOpp) {
      opportunity = await prisma.opportunity.create({
        data: {
          tenantId: platformTenant.id,
          title: `Lead Landing: ${body.name} (${companyName})`,
          leadId: lead.id,
          stage: 'QUALIFICATION',
          estimatedValue: 0,
          probability: 10
        }
      });
    }

    app.log.info({ leadId: lead.id, opportunityId: opportunity?.id }, '[PUBLIC LEADS] Lead e comunicação criadas com sucesso no CRM');

    return reply.status(201).send({
      success: true,
      message: 'Mensagem enviada com sucesso. Entraremos em contacto brevemente.',
      leadId: lead.id,
      opportunityId: opportunity?.id
    });
  });
}
