import { prisma } from '../../../database/prisma/client';
import crypto from 'node:crypto';

export type AppEntitlement = {
  key: string;
  name: string;
  icon: string | null;
  color: string | null;
  state: 'ACTIVE' | 'TRIAL' | 'GRACE' | 'SUSPENDED' | 'DISABLED' | 'NONE';
  writable: boolean;
  features: string[];
  limits: Record<string, number>;
  usage: Record<string, number>;
  daysLeft: number | null;
  roleInApp: string | null;
  permissions: string[];
};

export type WorkspaceManifest = {
  version: number;
  issuedAt: string;
  expiresAt: string;
  signature: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  tenant: {
    id: string;
    name: string;
    slug: string | null;
    status: string;
  };
  branding: {
    logoUrl: string | null;
    logoDarkUrl: string | null;
    faviconUrl: string | null;
    primaryColor: string;
    accentColor: string;
    theme: string;
    displayName: string | null;
    locale: string;
    currency: string;
    timezone: string;
    showUpsell: boolean;
  };
  apps: AppEntitlement[];
  licensing?: {
    status: string;
    planName: string;
    activeCount: number;
    modules: Array<{ key: string; name: string; state: string; daysLeft: number | null }>;
  };
  impersonation: {
    session: string;
    actorEmail: string;
    actorName?: string;
    writeEnabled: boolean;
    reason?: string;
    targetTenantId?: string;
    targetTenantName?: string;
    targetUserId?: string | null;
    targetUserName?: string | null;
    targetUserEmail?: string | null;
    targetUserRole?: string | null;
  } | null;
};

// In-memory cache (60s TTL)
const manifestCache = new Map<string, { manifest: WorkspaceManifest; expiresAt: number }>();

export class EntitlementService {
  /**
   * Limpa a cache de manifesto para um determinado tenant/user
   */
  static invalidateCache(tenantId?: string) {
    if (!tenantId) {
      manifestCache.clear();
      return;
    }
    for (const key of manifestCache.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        manifestCache.delete(key);
      }
    }
  }

  /**
   * Resolve o Workspace Manifest completo para o par (tenantId, userId)
   */
  static async getWorkspaceManifest(
    tenantId: string,
    userId: string,
    impersonationSessionId?: string
  ): Promise<WorkspaceManifest> {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        branding: true,
        applications: {
          where: { deletedAt: null },
          include: { module: true }
        }
      }
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        applicationAssignments: {
          where: { status: 'ACTIVE' },
          include: { application: true }
        }
      }
    });

    if (!tenant) throw new Error('Tenant não encontrado');
    if (!user) throw new Error('Utilizador não encontrado');

    const cacheKey = `${tenantId}:${userId}:${tenant.entitlementsVersion}:${impersonationSessionId || 'none'}`;
    const cached = manifestCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.manifest;
    }

    const modules = await prisma.module.findMany({
      orderBy: { sortOrder: 'asc' }
    });

    const now = new Date();
    const apps: AppEntitlement[] = [];

    // Obter dados da sessão de Impersonation se existir
    let impersonationData: WorkspaceManifest['impersonation'] = null;
    const isSuperOrPlatformAdmin = user.role === 'SUPER_ADMIN' || user.role === 'PLATFORM_ADMIN';
    const isImpersonating = !!impersonationSessionId;

    if (impersonationSessionId) {
      const impSession = await prisma.impersonationSession.findUnique({
        where: { id: impersonationSessionId }
      });
      if (impSession && !impSession.endedAt && impSession.expiresAt > now) {
        let targetUser = null;
        if (impSession.targetUserId) {
          targetUser = await prisma.user.findUnique({
            where: { id: impSession.targetUserId },
            select: { id: true, name: true, email: true, role: true }
          });
        }
        if (!targetUser) {
          targetUser = await prisma.user.findFirst({
            where: { tenantId: tenant.id, deletedAt: null },
            select: { id: true, name: true, email: true, role: true },
            orderBy: [{ role: 'asc' }, { createdAt: 'asc' }]
          });
        }

        impersonationData = {
          session: impSession.id,
          actorEmail: impSession.actorEmail,
          actorName: user.name || user.email || 'Super Administrador',
          writeEnabled: impSession.writeEnabled,
          reason: impSession.reason,
          targetTenantId: tenant.id,
          targetTenantName: tenant.name,
          targetUserId: targetUser?.id || null,
          targetUserName: targetUser?.name || targetUser?.email || 'Administrador do Tenant',
          targetUserEmail: targetUser?.email || null,
          targetUserRole: targetUser?.role || 'TENANT_ADMIN'
        };
      }
    }

    // Calcular contagens de uso por módulo
    const leadCount = await prisma.lead.count({ where: { tenantId } });
    const buildingCount = await prisma.building.count({ where: { tenantId } });

    for (const mod of modules) {
      const appInst = tenant.applications.find(a => a.moduleId === mod.id);
      const assignment = user.applicationAssignments.find(a => a.application.moduleId === mod.id);

      let state: 'ACTIVE' | 'TRIAL' | 'GRACE' | 'SUSPENDED' | 'DISABLED' | 'NONE' = 'NONE';
      let writable = true;
      let daysLeft: number | null = null;

      if (!mod.isActive) {
        state = 'DISABLED';
        writable = false;
      } else if (isSuperOrPlatformAdmin || isImpersonating) {
        state = 'ACTIVE';
        writable = impersonationData ? impersonationData.writeEnabled : true;
      } else if (!appInst) {
        state = 'NONE';
        writable = false;
      } else if (appInst.status === 'DISABLED' || appInst.status === 'ARCHIVED') {
        state = 'DISABLED';
        writable = false;
      } else if (appInst.status === 'SUSPENDED' || appInst.suspendedAt) {
        state = 'SUSPENDED';
        writable = false;
      } else if (appInst.validUntil) {
        const validUntil = new Date(appInst.validUntil);
        const graceEnd = new Date(validUntil.getTime() + (appInst.graceDays || 7) * 24 * 60 * 60 * 1000);
        
        if (now > graceEnd) {
          state = 'SUSPENDED';
          writable = false;
          daysLeft = 0;
        } else if (now > validUntil) {
          state = 'GRACE';
          writable = true;
          daysLeft = Math.ceil((graceEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        } else {
          state = appInst.status === 'TRIAL' ? 'TRIAL' : 'ACTIVE';
          writable = true;
          daysLeft = Math.ceil((validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        }
      } else {
        state = appInst.status === 'TRIAL' ? 'TRIAL' : 'ACTIVE';
        writable = true;
      }

      // Desabilitar escrita global se em Impersonation só-leitura
      if (impersonationData && !impersonationData.writeEnabled) {
        writable = false;
      }

      // Limites e uso específicos por módulo
      const limits: Record<string, number> = (appInst?.limits as Record<string, number>) || {};
      const usage: Record<string, number> = {};
      if (mod.key === 'crm') {
        usage['contactos'] = leadCount;
        if (!limits['contactos']) limits['contactos'] = 5000;
      } else if (mod.key === 'condominios') {
        usage['edificios'] = buildingCount;
        if (!limits['edificios']) limits['edificios'] = 50;
      }

      // Super Admin ou utilizador em Impersonation recebe papel e permissões totais de Admin nos módulos ativos
      const roleInApp = (isSuperOrPlatformAdmin || isImpersonating) ? 'ADMIN' : (assignment ? assignment.roleInApp : null);
      const permissions = (isSuperOrPlatformAdmin || isImpersonating) 
        ? [`${mod.key}.*`, `${mod.key}.access`, `${mod.key}.admin`] 
        : (assignment ? [`${mod.key}.access`] : []);

      apps.push({
        key: mod.key,
        name: mod.name,
        icon: mod.icon,
        color: mod.color,
        state,
        writable,
        features: appInst?.features || [],
        limits,
        usage,
        daysLeft,
        roleInApp,
        permissions
      });
    }

    // Resumo de Licenciamento do Tenant
    const licensedApps = apps.filter(a => a.state !== 'NONE' && a.state !== 'DISABLED');
    const activeLicensedApps = licensedApps.filter(a => a.state === 'ACTIVE' || a.state === 'TRIAL' || a.state === 'GRACE');
    const licensingSummary = {
      status: tenant.status,
      planName: tenant.status === 'ACTIVE' ? 'Licença Corporativa' : (tenant.status === 'TRIAL' ? 'Período Experimental (Trial)' : 'Licença Restrita'),
      activeCount: activeLicensedApps.length,
      modules: licensedApps.map(a => ({ key: a.key, name: a.name, state: a.state, daysLeft: a.daysLeft }))
    };

    // Restrição Estrita: o tenant só pode ver os módulos que tiver licenciados para utilização!
    // Super Admin ou Sessão de Suporte mantêm a visão de gestão dos módulos da plataforma
    const isPrivileged = isSuperOrPlatformAdmin || isImpersonating;
    const finalApps = isPrivileged ? apps : licensedApps;

    const branding = tenant.branding || {
      logoUrl: null,
      logoDarkUrl: null,
      faviconUrl: null,
      primaryColor: '#0d419f',
      accentColor: '#1f6feb',
      theme: 'system',
      displayName: tenant.name,
      locale: 'pt-PT',
      currency: 'EUR',
      timezone: 'Atlantic/Madeira',
      showUpsell: isPrivileged
    };

    const issuedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

    const payloadToSign = JSON.stringify({
      version: tenant.entitlementsVersion,
      userId: user.id,
      tenantId: tenant.id,
      issuedAt,
      expiresAt,
      apps: finalApps.map(a => ({ key: a.key, state: a.state, writable: a.writable }))
    });

    const secret = process.env.JWT_SECRET || 'dev_secret_key_change_in_production';
    const signature = crypto.createHmac('sha256', secret).update(payloadToSign).digest('hex');

    const manifest: WorkspaceManifest = {
      version: tenant.entitlementsVersion,
      issuedAt,
      expiresAt,
      signature,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status
      },
      branding: {
        logoUrl: branding.logoUrl,
        logoDarkUrl: branding.logoDarkUrl || null,
        faviconUrl: branding.faviconUrl || null,
        primaryColor: branding.primaryColor,
        accentColor: branding.accentColor,
        theme: branding.theme,
        displayName: branding.displayName || tenant.name,
        locale: branding.locale,
        currency: branding.currency,
        timezone: branding.timezone,
        showUpsell: isPrivileged ? (branding.showUpsell ?? true) : false
      },
      apps: finalApps,
      licensing: licensingSummary,
      impersonation: impersonationData
    };

    manifestCache.set(cacheKey, { manifest, expiresAt: Date.now() + 60 * 1000 });
    return manifest;
  }

  /**
   * Convenience wrapper used by API routes to obtain the workspace manifest for a user.
   * Accepts optional impersonationSessionId for impersonation scenarios.
   */
  static async resolveForUser(userId: string, tenantId: string, impersonationSessionId?: string): Promise<WorkspaceManifest> {
    return this.getWorkspaceManifest(tenantId, userId, impersonationSessionId);
  }

  // Instance method for compatibility with code that uses an instantiated EntitlementService.
  async resolveForUser(userId: string, tenantId: string, impersonationSessionId?: string): Promise<WorkspaceManifest> {
    return EntitlementService.getWorkspaceManifest(tenantId, userId, impersonationSessionId);
  }

  }

