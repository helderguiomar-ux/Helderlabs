import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '../database/prisma/client';

const PublicRegisterSchema = z.object({
  email: z.string().email('Email inválido'),
  name: z.string().optional(),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  companyName: z.string().optional(),
  intendedModule: z.string().optional().default('all'),
  acceptedTerms: z.boolean(),
  acceptedPrivacy: z.boolean(),
  termsVersion: z.string().optional().default('1.0'),
  privacyVersion: z.string().optional().default('1.0')
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
  // Rate limit for public endpoints: max 5 requests per 15 minutes per IP
  app.register(import('@fastify/rate-limit'), {
    max: 5,
    timeWindow: '15 minutes'
  });

  /**
   * POST /api/public/register
   * Pedido de registo de conta pública com consentimento RGPD e geração de OTP
   */
  app.post('/register', async (request, reply) => {
    const body = PublicRegisterSchema.parse(request.body);

    if (!body.acceptedTerms || !body.acceptedPrivacy) {
      return reply.status(400).send({
        error: 'RGPD_CONSENT_REQUIRED',
        message: 'Deverá aceitar os Termos e Condições e a Política de Privacidade para registar a conta.'
      });
    }

    const contactName = body.contactName || body.name || body.email.split('@')[0];
    const now = new Date();

    // Check if AccountRequest exists
    const existing = await prisma.accountRequest.findUnique({
      where: { email: body.email }
    });

    if (existing && existing.status === 'APPROVED') {
      return reply.status(409).send({
        error: 'ACCOUNT_ALREADY_APPROVED',
        message: 'Já existe uma conta associada a este email — inicie sessão ou recupere o acesso.'
      });
    }

    // Generate 6-digit OTP and hash it securely
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otpCode, 10);
    const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    let accountReq;
    if (existing) {
      accountReq = await prisma.accountRequest.update({
        where: { id: existing.id },
        data: {
          name: contactName,
          contactName,
          phone: body.phone || existing.phone,
          companyName: body.companyName || existing.companyName,
          intendedModule: body.intendedModule || existing.intendedModule,
          status: 'PENDING',
          otpHash,
          otpExpiresAt,
          acceptedTermsAt: now,
          acceptedPrivacyAt: now,
          termsVersion: body.termsVersion,
          privacyVersion: body.privacyVersion
        }
      });
    } else {
      accountReq = await prisma.accountRequest.create({
        data: {
          email: body.email,
          name: contactName,
          contactName,
          phone: body.phone,
          companyName: body.companyName,
          intendedModule: body.intendedModule,
          status: 'PENDING',
          otpHash,
          otpExpiresAt,
          acceptedTermsAt: now,
          acceptedPrivacyAt: now,
          termsVersion: body.termsVersion,
          privacyVersion: body.privacyVersion
        }
      });
    }

    app.log.info({ email: body.email, requestId: accountReq.id }, '[PUBLIC REGISTER OTP] Código de verificação gerado');

    return reply.status(200).send({
      success: true,
      message: 'Pedido de registo submetido com sucesso. Verifique o seu email para validar a conta.',
      requestId: accountReq.id
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

    // Fallback seguro de tenant: PLATFORM_TENANT_SLUG (default: 'helderlabs-platform')
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

    // Auto create opportunity setting check
    const autoOppSetting = await prisma.platformSetting.findUnique({
      where: { key: 'crm.landing.auto_create_opportunity' }
    });
    const autoCreateOpp = autoOppSetting ? autoOppSetting.value !== 'false' : true;

    const companyName = body.company || (body.sector ? `Empresa (${body.sector})` : 'Contacto Web');
    const initialStatus = autoCreateOpp ? 'QUALIFICATION' : 'NEW';

    // Create Lead under platform tenant
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

    // Create Communication record for message
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

    // Auto-create Opportunity if enabled
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
