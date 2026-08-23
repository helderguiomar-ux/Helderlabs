import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../services/AuthService';

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

  // Passo 1: Verificar se utilizador tem password
  app.post('/check-email', async (request, reply) => {
    const { email } = emailSchema.parse(request.body);
    const hasPassword = await authService.checkHasPassword(email);
    return reply.status(200).send({ hasPassword });
  });

  // Passo 2a: Enviar OTP (se não tiver password ou se pedir por código)
  app.post('/send-otp', async (request, reply) => {
    const { email } = emailSchema.parse(request.body);
    await authService.sendOtp(email);
    return reply.status(200).send({ message: 'Código enviado com sucesso' });
  });

  // Passo 3a: Validar OTP (devolve token ou status de PENDING)
  app.post('/verify-otp', async (request, reply) => {
    const { email, code } = verifyOtpSchema.parse(request.body);
    const result = await authService.verifyOtp(email, code);
    return reply.status(200).send(result);
  });

  // Passo 2b: Login com Password
  app.post('/login', async (request, reply) => {
    const { email, password } = loginPasswordSchema.parse(request.body);
    const result = await authService.loginWithPassword(email, password);
    return reply.status(200).send(result);
  });

  // Rota Protegida: Definir password na BD (após entrar com OTP)
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
}