import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../services/AuthService';
import { EntitlementService } from '../../platform/services/EntitlementService';
import { AuditService } from '../../platform/services/AuditService';

const emailSchema = z.object({
  email: z.string().email('Email inválido')
});

const verifyOtpSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6, 'O código deve ter 6 dígitos')
});

const loginPasswordSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

const setPasswordSchema = z.object({
  password: z
    .string()
    .min(12, 'A palavra-passe deve ter pelo menos 12 caracteres')
    .regex(/[a-z]/, 'A palavra-passe deve conter pelo menos uma letra minúscula')
    .regex(/[A-Z]/, 'A palavra-passe deve conter pelo menos uma letra maiúscula')
    .regex(/[0-9]/, 'A palavra-passe deve conter pelo menos um algarismo')
});


/**
 * AUD-08 — Auditoria explícita das rotas de autenticação.
 *
 * O hook global de `app.ts` preenche `actorEmail` a partir de `request.user`,
 * que NÃO existe em rotas pré-autenticação. Resultado: 100% dos eventos de
 * login, OTP e verificação ficavam gravados com actorEmail NULL, tornando
 * impossível atribuir uma tentativa de acesso a uma conta — exatamente no
 * cenário em que a auditoria mais vale.
 *
 * Aqui o email TENTADO é registado explicitamente, com o resultado e o IP real
 * (ver trustProxy em app.ts). Categoria SECURITY: se não for possível registar
 * a tentativa, a operação não se conclui.
 */
async function auditAuthAttempt(
  request: any,
  action: string,
  attemptedEmail: string,
  outcome: 'SUCCESS' | 'FAILURE',
  detail?: Record<string, unknown>
) {
  await AuditService.audit({
    action,
    module: 'auth',
    category: 'SECURITY',
    resource: 'Authentication',
    resourceId: attemptedEmail.toLowerCase().trim(),
    actorEmail: attemptedEmail.toLowerCase().trim(),
    actorType: 'USER',
    result: outcome,
    newValue: detail,
    requestId: request.id,
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'] as string | undefined
  });
}

export async function authRoutes(app: FastifyInstance) {
  const authService = new AuthService();
  const entitlementService = new EntitlementService();

  // Passo 1: Preparar o ecrã de autenticação.
  //
  // Este endpoint devolvia { hasPassword: true } para contas existentes e
  // { hasPassword: false } para emails desconhecidos — enumeração de contas
  // direta, reproduzida em produção. Passa a devolver SEMPRE a mesma resposta:
  // o ecrã de login apresenta ambos os campos e o utilizador escolhe o método.
  app.post('/check-email', {
    config: {
      rateLimit: { max: 20, timeWindow: '15 minutes' }
    }
  }, async (request, reply) => {
    emailSchema.parse(request.body);
    return reply.status(200).send({ hasPassword: true, passwordAvailable: true, otpAvailable: true });
  });

  const isE2EDisabled = process.env.DISABLE_RATE_LIMIT === 'true';
  const isStrictRateLimited = (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') && !isE2EDisabled;
  const strictRateLimit = isStrictRateLimited
    ? { max: 15, timeWindow: '15 minutes' }
    : { max: 1000, timeWindow: '15 minutes' };

  // Passo 2a: Enviar OTP
  app.post('/send-otp', {
    config: {
      rateLimit: strictRateLimit
    }
  }, async (request, reply) => {
    const { email } = emailSchema.parse(request.body);
    const result = await authService.sendOtp(email, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] as string | undefined
    });
    // Registado com o email tentado. A RESPOSTA ao cliente mantém-se neutra
    // (ver AuthService.sendOtp) — a auditoria é interna, não revela nada.
    await auditAuthAttempt(request, 'auth.send_otp', email, 'SUCCESS');
    return reply.status(200).send(result);
  });

  // Passo 3a: Validar OTP
  app.post('/verify-otp', {
    config: {
      rateLimit: strictRateLimit
    }
  }, async (request, reply) => {
    const { email, code } = verifyOtpSchema.parse(request.body);
    try {
      const result = await authService.verifyOtp(email, code);
      await auditAuthAttempt(request, 'auth.verify_otp', email, 'SUCCESS', {
        outcome: (result as any).status ?? 'AUTHENTICATED'
      });
      return reply.status(200).send(result);
    } catch (err: any) {
      await auditAuthAttempt(request, 'auth.verify_otp', email, 'FAILURE', {
        reason: err?.code || err?.message || 'UNKNOWN'
      });
      throw err;
    }
  });

  // Passo 2b: Login com Password
  app.post('/login', {
    config: {
      rateLimit: strictRateLimit
    }
  }, async (request, reply) => {
    const { email, password } = loginPasswordSchema.parse(request.body);
    try {
      const result = await authService.loginWithPassword(email, password);
      await auditAuthAttempt(request, 'auth.login', email, 'SUCCESS', {
        outcome: (result as any).status ?? 'AUTHENTICATED'
      });
      return reply.status(200).send(result);
    } catch (err: any) {
      await auditAuthAttempt(request, 'auth.login', email, 'FAILURE', {
        reason: err?.code || err?.message || 'UNKNOWN'
      });
      throw err;
    }
  });

  // Rota Protegida: Definir password na BD
  app.post('/set-password', {
    preHandler: [app.authenticate]
  }, async (request, reply) => {
    const { password } = setPasswordSchema.parse(request.body);
    const userId = request.user!.sub;
    await authService.setPassword(userId, password);
    return reply.status(200).send({ message: 'Password definida e guardada na base de dados com sucesso' });
  });

  // Verificar sessão atual
  app.get('/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    return reply.status(200).send({ user: request.user });
  });

  // Obter manifesto do workspace do utilizador (Fase 2)
  app.get('/me/workspace', { preHandler: [app.authenticate] }, async (request, reply) => {
    const manifest = await entitlementService.resolveForUser(request.user!.sub, request.user!.tenantId);
    return reply.status(200).send(manifest);
  });

  // F1: Guardas 501 Not Implemented para OAuth desativado
  const handleOAuthNotImplemented = async (_request: any, reply: any) => {
    return reply.status(501).send({
      code: 'OAUTH_NOT_IMPLEMENTED',
      message: 'A autenticação por fornecedor social está temporariamente desativada. Utilize o login por email/OTP ou palavra-passe.'
    });
  };

  app.get('/google', handleOAuthNotImplemented);
  app.get('/microsoft', handleOAuthNotImplemented);
  app.get('/apple', handleOAuthNotImplemented);
}