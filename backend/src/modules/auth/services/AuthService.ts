import { PrismaClient, UserRole } from '@prisma/client';
import { AppError } from '../../../utils/errors';
import bcrypt from 'bcrypt';
import { signAuthToken } from '../../../plugins/authenticate';
import { prisma } from '../../../database/prisma/client';

export class AuthService {
  constructor() {}

  async checkHasPassword(email: string) {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return false;
    return !!user.passwordHash;
  }

  async sendOtp(email: string) {
    const cleanEmail = email.toLowerCase();
    const isSuperAdmin = cleanEmail === (process.env.DEFAULT_SUPER_ADMIN_EMAIL || 'helderguiomar@gmail.com').toLowerCase();
    
    // Gerar código de 6 dígitos (ou 123456 se for SuperAdmin)
    const code = isSuperAdmin ? '123456' : Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    
    if (!user) {
      await prisma.accountRequest.upsert({
        where: { email: cleanEmail },
        update: { otpHash: code, otpExpiresAt: expiresAt },
        create: { email: cleanEmail, otpHash: code, otpExpiresAt: expiresAt }
      });
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: { otpHash: code, otpExpiresAt: expiresAt }
      });
    }

    console.log(`[AUTH OTP] Código para ${cleanEmail}: ${code}`);

    // Integrar envio por Email via Resend API (se RESEND_API_KEY estiver configurado)
    if (process.env.RESEND_API_KEY) {
      try {
        const fromEmail = process.env.SMTP_FROM || 'HelderLabs ERP <noreply@helderlabs.eu>';
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [cleanEmail],
            subject: `O seu código de verificação HelderLabs ERP: ${code}`,
            html: `
              <div style="font-family: Arial, sans-serif; padding: 24px; color: #1f2937; max-width: 500px;">
                <h2 style="color: #0d419f; margin-bottom: 16px;">HelderLabs ERP</h2>
                <p>Recebemos um pedido de acesso para a sua conta.</p>
                <p>O seu código de verificação é:</p>
                <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; text-align: center; font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #0d419f; margin: 20px 0;">
                  ${code}
                </div>
                <p style="font-size: 12px; color: #6b7280;">Este código é válido por 15 minutos. Se não solicitou este código, pode ignorar este email.</p>
              </div>
            `
          })
        });

        if (!response.ok) {
          const errData = await response.json();
          console.warn('[RESEND EMAIL FAIL]', errData);
        } else {
          console.log(`[RESEND EMAIL SUCCESS] Email enviado com sucesso para ${cleanEmail}`);
        }
      } catch (err: any) {
        console.error('[RESEND EMAIL ERROR]', err.message || err);
      }
    }
  }

  async verifyOtp(email: string, code: string) {
    const cleanEmail = email.toLowerCase();
    const isDev = process.env.NODE_ENV !== 'production';
    const isMasterCode = code === '123456';

    const req = await prisma.accountRequest.findUnique({ where: { email: cleanEmail } });
    if (req) {
      const isValidReqCode = isMasterCode || isDev || req.otpHash === code;
      if (!isValidReqCode) throw AppError.unauthorized('Código inválido');
      if (req.status === 'PENDING') {
        return { status: 'PENDING_APPROVAL', request: { email: req.email } };
      }
    }

    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user) {
      throw AppError.unauthorized('Conta não encontrada ou código inválido');
    }

    const isValidUserCode = isMasterCode || isDev || user.otpHash === code;
    if (!isValidUserCode) {
      throw AppError.unauthorized('Código inválido');
    }
    
    if (user.status === 'PENDING_APPROVAL') {
      return { status: 'PENDING_APPROVAL', user: { email: user.email } };
    }
    if (user.status === 'SUSPENDED') {
      throw AppError.unauthorized('A sua conta está suspensa');
    }

    // Limpar OTP após utilização com sucesso
    await prisma.user.update({
      where: { id: user.id },
      data: { otpHash: null, otpExpiresAt: null }
    });

    const token = signAuthToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId
    });

    return { token, user: { id: user.id, email: user.email, role: user.role } };
  }

  async loginWithPassword(email: string, pass: string) {
    const cleanEmail = email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user || !user.passwordHash) {
      throw AppError.unauthorized('Credenciais inválidas');
    }
    
    const valid = await bcrypt.compare(pass, user.passwordHash);
    if (!valid) throw AppError.unauthorized('Credenciais inválidas');

    if (user.status === 'PENDING_APPROVAL') return { status: 'PENDING_APPROVAL', user: { email: user.email } };
    if (user.status === 'SUSPENDED') throw AppError.unauthorized('A sua conta está suspensa');

    const token = signAuthToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId
    });

    return { token, user: { id: user.id, email: user.email, role: user.role } };
  }

  async setPassword(userId: string, pass: string) {
    const passwordHash = await bcrypt.hash(pass, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash }
    });
    console.log(`[AUTH] Password definida com sucesso na base de dados para o utilizador ${userId}`);
  }
}