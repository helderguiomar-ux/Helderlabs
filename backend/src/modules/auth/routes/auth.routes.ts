import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../services/AuthService';
import { EntitlementService } from '../../platform/services/EntitlementService';

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
  password: z.string().min(4, 'A password deve ter pelo menos 4 caracteres')
});

export async function authRoutes(app: FastifyInstance) {
  const authService = new AuthService();
  const entitlementService = new EntitlementService();

  // Passo 1: Verificar se utilizador tem password
  app.post('/check-email', async (request, reply) => {
    const { email } = emailSchema.parse(request.body);
    const hasPassword = await authService.checkHasPassword(email);
    return reply.status(200).send({ hasPassword });
  });

  const isE2EDisabled = process.env.DISABLE_RATE_LIMIT === 'true';
  const isStrictRateLimited = (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') && !isE2EDisabled;
  const strictRateLimit = isStrictRateLimited
    ? { max: 5, timeWindow: '15 minutes' }
    : { max: 1000, timeWindow: '15 minutes' };

  // Passo 2a: Enviar OTP
  app.post('/send-otp', {
    config: {
      rateLimit: strictRateLimit
    }
  }, async (request, reply) => {
    const { email } = emailSchema.parse(request.body);
    await authService.sendOtp(email);
    return reply.status(200).send({ message: 'Código enviado com sucesso' });
  });

  // Passo 3a: Validar OTP
  app.post('/verify-otp', {
    config: {
      rateLimit: strictRateLimit
    }
  }, async (request, reply) => {
    const { email, code } = verifyOtpSchema.parse(request.body);
    const result = await authService.verifyOtp(email, code);
    return reply.status(200).send(result);
  });

  // Passo 2b: Login com Password
  app.post('/login', {
    config: {
      rateLimit: strictRateLimit
    }
  }, async (request, reply) => {
    const { email, password } = loginPasswordSchema.parse(request.body);
    const result = await authService.loginWithPassword(email, password);
    return reply.status(200).send(result);
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