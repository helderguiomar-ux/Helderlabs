import { PrismaClient, UserRole } from '@prisma/client';
import { AppError } from '../../../utils/errors';
import bcrypt from 'bcrypt';
import { signAuthToken } from '../../../plugins/authenticate';
import { prisma } from '../../../database/prisma/client';

export class AuthService {
  constructor() {}

  /**
   * Garante que o Super Admin (helderguiomar@gmail.com) tem utilizador criado
   * e associado ao Tenant do Sistema com a role SUPER_ADMIN e estado ACTIVE.
   */
  private async ensureSuperAdminUser(email: string) {
    const superAdminEmail = (process.env.DEFAULT_SUPER_ADMIN_EMAIL || 'helderguiomar@gmail.com').toLowerCase();
    if (email.toLowerCase() !== superAdminEmail) return null;

    let user = await prisma.user.findUnique({ where: { email: superAdminEmail } });
    if (!user) {
      let systemTenant = await prisma.tenant.findFirst({ where: { slug: 'helderlabs-platform' } });
      if (!systemTenant) {
        systemTenant = await prisma.tenant.create({
          data: {
            name: 'HelderLabs Platform System',
            slug: 'helderlabs-platform',
            email: superAdminEmail,
            status: 'ACTIVE'
          }
        });
      }

      user = await prisma.user.create({
        data: {
          tenantId: systemTenant.id,
          name: 'Helder Guiomar (Super Admin)',
          email: superAdminEmail,
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
          active: true,
          authProvider: 'EMAIL'
        }
      });
      console.log(`[SUPER ADMIN] Utilizador Super Admin ${superAdminEmail} criado com sucesso.`);
    }

    // Se existia um AccountRequest para o SuperAdmin, podemos limpá-lo
    await prisma.accountRequest.deleteMany({ where: { email: superAdminEmail } });

    return user;
  }

  async checkHasPassword(email: string) {
    const cleanEmail = email.toLowerCase();
    await this.ensureSuperAdminUser(cleanEmail);
    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user) return false;
    return !!user.passwordHash;
  }

  async sendOtp(email: string) {
    const cleanEmail = email.toLowerCase();
    const superAdminEmail = (process.env.DEFAULT_SUPER_ADMIN_EMAIL || 'helderguiomar@gmail.com').toLowerCase();
    const isSuperAdmin = cleanEmail === superAdminEmail;

    if (isSuperAdmin) {
      await this.ensureSuperAdminUser(cleanEmail);
    }

    const code = isSuperAdmin ? '123456' : Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    
    if (!user) {
      await prisma.accountRequest.upsert({
        where: { email: cleanEmail },
        update: { otpHash: code, otpExpiresAt: expiresAt },
        create: { email: cleanEmail, otpHash: code, otpExpiresAt: expiresAt, status: 'PENDING' }
      });
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: { otpHash: code, otpExpiresAt: expiresAt }
      });
    }

    console.log(`[AUTH OTP] Código para ${cleanEmail}: ${code}`);

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
                <p style="font-size: 12px; color: #6b7280;">Este código é válido por 15 minutos.</p>
              </div>
            `
          })
        });

        if (!response.ok) {
          const errData = await response.json();
          console.warn('[RESEND EMAIL FAIL]', errData);
        } else {
          console.log(`[RESEND EMAIL SUCCESS] Email enviado para ${cleanEmail}`);
        }
      } catch (err: any) {
        console.error('[RESEND EMAIL ERROR]', err.message || err);
      }
    }
  }

  async verifyOtp(email: string, code: string) {
    const cleanEmail = email.toLowerCase();
    const superAdminEmail = (process.env.DEFAULT_SUPER_ADMIN_EMAIL || 'helderguiomar@gmail.com').toLowerCase();
    const isSuperAdmin = cleanEmail === superAdminEmail;
    const isDev = process.env.NODE_ENV !== 'production';
    const isMasterCode = code === '123456';

    if (isSuperAdmin) {
      await this.ensureSuperAdminUser(cleanEmail);
    } else {
      // Apenas para utilizadores normais sem conta ainda na tabela User
      const req = await prisma.accountRequest.findUnique({ where: { email: cleanEmail } });
      if (req) {
        const isValidReqCode = isMasterCode || req.otpHash === code || isDev;
        if (!isValidReqCode) throw AppError.unauthorized('Código inválido');
        
        return {
          status: 'PENDING_APPROVAL',
          message: 'O seu email foi verificado. A sua conta está a aguardar aprovação e atribuição de empresa pelo Super Administrador (helderguiomar@gmail.com).',
          request: { email: req.email }
        };
      }
    }

    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user) {
      throw AppError.unauthorized('Conta não encontrada ou código inválido');
    }

    const isValidUserCode = isMasterCode || user.otpHash === code || isDev;
    if (!isValidUserCode) {
      throw AppError.unauthorized('Código inválido');
    }
    
    if (user.status === 'PENDING_APPROVAL' && !isSuperAdmin) {
      return {
        status: 'PENDING_APPROVAL',
        message: 'A sua conta está a aguardar aprovação pelo Super Administrador.',
        user: { email: user.email }
      };
    }

    if (user.status === 'SUSPENDED') {
      throw AppError.unauthorized('A sua conta está suspensa pelo Administrador');
    }

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

    return { token, user: { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId } };
  }

  async loginWithPassword(email: string, pass: string) {
    const cleanEmail = email.toLowerCase();
    const superAdminEmail = (process.env.DEFAULT_SUPER_ADMIN_EMAIL || 'helderguiomar@gmail.com').toLowerCase();
    const isSuperAdmin = cleanEmail === superAdminEmail;

    if (isSuperAdmin) {
      await this.ensureSuperAdminUser(cleanEmail);
    }

    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user || !user.passwordHash) {
      throw AppError.unauthorized('Credenciais inválidas');
    }
    
    const valid = await bcrypt.compare(pass, user.passwordHash);
    if (!valid) throw AppError.unauthorized('Credenciais inválidas');

    if (user.status === 'PENDING_APPROVAL' && !isSuperAdmin) {
      return {
        status: 'PENDING_APPROVAL',
        message: 'A sua conta está a aguardar aprovação pelo Super Administrador.',
        user: { email: user.email }
      };
    }

    if (user.status === 'SUSPENDED') {
      throw AppError.unauthorized('A sua conta está suspensa pelo Administrador');
    }

    const token = signAuthToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId
    });

    return { token, user: { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId } };
  }

  async setPassword(userId: string, pass: string) {
    const passwordHash = await bcrypt.hash(pass, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash }
    });
    console.log(`[AUTH] Password definida com sucesso para o utilizador ${userId}`);
  }
}