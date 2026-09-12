import { UserRole } from '@prisma/client';
import { AppError } from '../../../utils/errors';
import bcrypt from 'bcrypt';
import { signAuthToken } from '../../../plugins/authenticate';
import { prisma } from '../../../database/prisma/client';
import { EmailService } from '../../platform/services/EmailService';

export class AuthService {
  constructor() {}

  /**
   * Guarda de processo: o bootstrap do super-admin corre no MÁXIMO uma vez por
   * instância. Antes era invocado em checkHasPassword/sendOtp/verifyOtp/login —
   * todos caminhos NÃO autenticados — o que provocava N+1 escritas na base de
   * dados a cada pedido público (P95 medido de 9,8 s) e constituía um vetor de
   * negação de serviço trivial.
   */
  private static bootstrapDone = false;

  /**
   * Garante que o Super Admin tem utilizador criado e associado ao Tenant do
   * Sistema com a role SUPER_ADMIN e estado ACTIVE.
   *
   * PÚBLICO e IDEMPOTENTE: destinado a ser chamado no arranque da aplicação
   * (scripts/prod-bootstrap.ts) e NUNCA a partir de uma rota pública.
   */
  public async ensureSuperAdminBootstrap(email?: string) {
    if (AuthService.bootstrapDone) return null;
    AuthService.bootstrapDone = true;
    return this.ensureSuperAdminUser(
      email || (process.env.DEFAULT_SUPER_ADMIN_EMAIL || 'helderguiomar@gmail.com')
    );
  }

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
    const cleanEmail = email.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user) return false;
    return !!user.passwordHash;
  }

  /**
   * Envia OTP para utilizadores existentes. NUNCA cria AccountRequest espúrios no login.
   */
  async sendOtp(email: string, meta?: { ipAddress?: string; userAgent?: string }) {
    const cleanEmail = email.toLowerCase().trim();

    // -----------------------------------------------------------------------
    // RESPOSTA NEUTRA E CONSTANTE.
    // Antes existiam três respostas distinguíveis (conta existente / pedido
    // pendente / email desconhecido), o que permitia enumerar contas de forma
    // trivial. A resposta é agora idêntica em corpo e código para os três casos.
    // -----------------------------------------------------------------------
    const NEUTRAL = {
      success: true,
      message: 'Se existir uma conta associada a este email, enviámos um código de acesso.'
    } as const;

    // Piso de latência: sem isto, 1,2 s para conta existente vs 230 ms para
    // inexistente enumera por cronómetro mesmo com o corpo igual.
    const startedAt = Date.now();
    const MIN_RESPONSE_MS = 700;
    const settle = async () => {
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_RESPONSE_MS) {
        await new Promise((r) => setTimeout(r, MIN_RESPONSE_MS - elapsed));
      }
      return NEUTRAL;
    };

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });

    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: { otpHash: hashedOtp, otpExpiresAt: expiresAt, otpAttempts: 0 }
      });

      const result = await EmailService.sendOtpEmail(cleanEmail, code, {
        tenantId: user.tenantId,
        actorId: user.id,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent
      });

      if (!result.ok) {
        // Falha registada internamente; a resposta ao cliente mantém-se neutra
        // para não revelar a existência da conta através do modo de falha.
        console.error('[AUTH OTP] Falha no envio do código de acesso', {
          code: result.code,
          userId: user.id
        });
      }

      return settle();
    }

    const pendingReq = await prisma.accountRequest.findUnique({ where: { email: cleanEmail } });

    if (pendingReq && pendingReq.status === 'PENDING_VERIFICATION') {
      await prisma.accountRequest.update({
        where: { id: pendingReq.id },
        data: { otpHash: hashedOtp, otpExpiresAt: expiresAt, otpAttempts: 0 }
      });
      const contactName = pendingReq.contactName || pendingReq.name || cleanEmail.split('@')[0];
      const result = await EmailService.sendVerificationEmail(cleanEmail, contactName, code, meta);
      if (!result.ok) {
        console.error('[AUTH OTP] Falha no reenvio do código de verificação', {
          code: result.code,
          requestId: pendingReq.id
        });
      }
      return settle();
    }

    // Email desconhecido, ou pedido já verificado a aguardar aprovação:
    // nenhuma escrita, nenhum AccountRequest espúrio, e a MESMA resposta.
    return settle();
  }

  async verifyOtp(email: string, code: string) {
    const cleanEmail = email.toLowerCase().trim();
    const superAdminEmail = (process.env.DEFAULT_SUPER_ADMIN_EMAIL || 'helderguiomar@gmail.com').toLowerCase();
    const isSuperAdmin = cleanEmail === superAdminEmail;
    
    // Master code 123456 estritamente bloqueado em produção
    const isProduction = process.env.NODE_ENV === 'production';
    const allowDevOtp = !isProduction && process.env.ALLOW_DEV_OTP === 'true';
    const isMasterCode = allowDevOtp && code === '123456';

    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });

    if (user) {
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

    // Se o utilizador não existe, verificar se há AccountRequest
    const req = await prisma.accountRequest.findUnique({ where: { email: cleanEmail } });
    if (req) {
      if (req.status === 'PENDING_VERIFICATION') {
        if (!req.otpExpiresAt || req.otpExpiresAt < new Date()) {
          throw AppError.unauthorized('Código expirado ou inválido');
        }

        if (req.otpAttempts >= 5) {
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

        await prisma.accountRequest.update({
          where: { id: req.id },
          data: {
            status: 'PENDING',
            emailVerifiedAt: new Date(),
            otpHash: null,
            otpExpiresAt: null,
            otpAttempts: 0
          }
        });

        return {
          status: 'PENDING_APPROVAL',
          message: 'O seu email foi verificado. A sua conta está a aguardar aprovação e atribuição de empresa pelo Super Administrador.',
          request: { email: req.email }
        };
      }

      if (req.status === 'PENDING') {
        return {
          status: 'PENDING_APPROVAL',
          message: 'O seu email já se encontra validado. A sua conta está a aguardar aprovação pelo Super Administrador.',
          request: { email: req.email }
        };
      }
    }

    throw AppError.unauthorized('Conta não encontrada ou código inválido');
  }

  async loginWithPassword(email: string, pass: string) {
    const cleanEmail = email.toLowerCase().trim();
    const superAdminEmail = (process.env.DEFAULT_SUPER_ADMIN_EMAIL || 'helderguiomar@gmail.com').toLowerCase();
    const isSuperAdmin = cleanEmail === superAdminEmail;

    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user) throw AppError.unauthorized('Credenciais inválidas');

    if (!user.passwordHash) {
      // Resposta idêntica à de conta inexistente — não revelar o estado da conta.
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
