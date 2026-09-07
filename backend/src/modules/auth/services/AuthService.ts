import { UserRole } from '@prisma/client';
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

    const bootstrapPassword = process.env.SUPER_ADMIN_BOOTSTRAP_PASSWORD;
    const defaultPasswordHash = bootstrapPassword ? await bcrypt.hash(bootstrapPassword, 10) : null;

    let user = await prisma.user.findUnique({ where: { email: superAdminEmail } });
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

    if (!user) {
      user = await prisma.user.create({
        data: {
          tenantId: systemTenant.id,
          name: 'Helder Guiomar (Super Admin)',
          email: superAdminEmail,
          passwordHash: defaultPasswordHash,
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
          active: true,
          authProvider: 'EMAIL'
        }
      });
      console.log(`[SUPER ADMIN] Utilizador Super Admin ${superAdminEmail} criado com sucesso.`);
    } else {
      const updates: any = {};
      if (!user.passwordHash && defaultPasswordHash) updates.passwordHash = defaultPasswordHash;
      if (user.role !== 'SUPER_ADMIN') updates.role = 'SUPER_ADMIN';
      if (user.status !== 'ACTIVE') updates.status = 'ACTIVE';
      if (user.tenantId !== systemTenant.id) updates.tenantId = systemTenant.id;
      if (Object.keys(updates).length > 0) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: updates
        });
      }
    }

    // Ativar todos os módulos da plataforma para a HelderLabs se não existirem
    const modules = await prisma.module.findMany();
    for (const m of modules) {
      const existingApp = await prisma.applicationInstance.findFirst({
        where: { tenantId: systemTenant.id, moduleId: m.id }
      });
      if (!existingApp) {
        const appInst = await prisma.applicationInstance.create({
          data: {
            moduleId: m.id,
            tenantId: systemTenant.id,
            status: 'ACTIVE',
            config: { unlimited: true, fullAccess: true },
            createdBy: user.id
          }
        });
        await prisma.applicationAssignment.create({
          data: {
            userId: user.id,
            applicationId: appInst.id,
            roleInApp: 'ADMIN',
            status: 'ACTIVE'
          }
        });
      }
    }

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

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    
    if (!user) {
      await prisma.accountRequest.upsert({
        where: { email: cleanEmail },
        update: { otpHash: hashedOtp, otpExpiresAt: expiresAt, otpAttempts: 0 },
        create: { email: cleanEmail, otpHash: hashedOtp, otpExpiresAt: expiresAt, otpAttempts: 0, status: 'PENDING' }
      });
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: { otpHash: hashedOtp, otpExpiresAt: expiresAt, otpAttempts: 0 }
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
    const allowDevOtp = process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_OTP === 'true';
    const isMasterCode = allowDevOtp && code === '123456';

    if (isSuperAdmin) {
      await this.ensureSuperAdminUser(cleanEmail);
    } else {
      const req = await prisma.accountRequest.findUnique({ where: { email: cleanEmail } });
      if (req) {
        if (!req.otpExpiresAt || req.otpExpiresAt < new Date()) {
          throw AppError.unauthorized('Código expirado ou inválido');
        }

        if (req.otpAttempts >= 5) {
          await prisma.accountRequest.update({
            where: { id: req.id },
            data: { otpHash: null, otpExpiresAt: null, otpAttempts: 0 }
          });
          throw AppError.unauthorized('Número máximo de tentativas excedido. Solicite um novo código.');
        }

        const isHashValid = req.otpHash ? await bcrypt.compare(code, req.otpHash) : false;
        const isValid = isMasterCode || isHashValid;

        if (!isValid) {
          await prisma.accountRequest.update({
            where: { id: req.id },
            data: { otpAttempts: { increment: 1 } }
          });
          throw AppError.unauthorized('Código inválido');
        }
        
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

    if (!user.otpHash || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      throw AppError.unauthorized('Código expirado ou inválido');
    }

    if (user.otpAttempts >= 5) {
      await prisma.user.update({
        where: { id: user.id },
        data: { otpHash: null, otpExpiresAt: null, otpAttempts: 0 }
      });
      throw AppError.unauthorized('Número máximo de tentativas excedido. Solicite um novo código.');
    }

    const isHashValid = await bcrypt.compare(code, user.otpHash);
    const isValidUserCode = isMasterCode || isHashValid;

    if (!isValidUserCode) {
      await prisma.user.update({
        where: { id: user.id },
        data: { otpAttempts: { increment: 1 } }
      });
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
      data: { otpHash: null, otpExpiresAt: null, otpAttempts: 0 }
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