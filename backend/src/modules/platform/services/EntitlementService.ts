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
  impersonation: {
    session: string;
    actorEmail: string;
    writeEnabled: boolean;
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

  async resolveForUser(userId: string, tenantId: string, impersonationSessionId?: string): Promise<WorkspaceManifest> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        applicationAssignments: {
          include: {
            application: true
          }
        }
      }
    });

    if (!user) throw new Error('Utilizador não encontrado');

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        branding: true,
        applications: {
          include: {
            module: true
          }
        }
      }
    });

    if (!tenant) throw new Error('Tenant não encontrado');

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
      let impersonationData: WorkspaceManifest['impersonation'] = null;
      if (impersonationSessionId) {
        const impSession = await prisma.impersonationSession.findUnique({
          where: { id: impersonationSessionId }
        });
        if (impSession && !impSession.endedAt && impSession.expiresAt > now) {
          impersonationData = {
            session: impSession.id,
            actorEmail: impSession.actorEmail,
            writeEnabled: impSession.writeEnabled
          };
          if (!impSession.writeEnabled) {
            writable = false;
          }
        }
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
        roleInApp: assignment ? assignment.roleInApp : null,
        permissions: assignment ? [`${mod.key}.access`] : []
      });
    }

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
      showUpsell: true
    };

    const issuedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

    const payloadToSign = JSON.stringify({
      version: tenant.entitlementsVersion,
      userId: user.id,
      tenantId: tenant.id,
      issuedAt,
      expiresAt,
      apps: apps.map(a => ({ key: a.key, state: a.state, writable: a.writable }))
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
        showUpsell: branding.showUpsell ?? true
      },
      apps,
      impersonation: null
    };

    manifestCache.set(cacheKey, { manifest, expiresAt: Date.now() + 60 * 1000 });
    return manifest;
  }
}
