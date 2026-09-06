import { FastifyInstance } from 'fastify';
import { prisma } from '../../../database/prisma/client';
import { applicationsRoutes } from './applications.routes';
import { ApplicationController } from '../controllers/ApplicationController';
import { AuditService } from '../services/AuditService';

export async function platformRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    await app.authenticate(request, reply);
    if (request.user?.role !== 'SUPER_ADMIN' && request.user?.role !== 'PLATFORM_ADMIN') {
      return reply.status(403).send({ message: 'Acesso negado.' });
    }
  });

  app.get('/tenants', async (request, reply) => {
    const tenants = await prisma.tenant.findMany({
      include: {
        _count: { select: { users: true } },
        users: { where: { isOnline: true } },
        branding: true
      }
    });
    
    return reply.status(200).send({
      tenants: tenants.map(t => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        email: t.email,
        status: t.status,
        createdAt: t.createdAt,
        userCount: t._count.users,
        onlineCount: t.users.length,
        branding: t.branding
      }))
    });
  });

  app.get('/users', async (request, reply) => {
    const { online } = request.query as { online?: string };

    const users = await prisma.user.findMany({
      where: online === 'true' ? { isOnline: true } : undefined,
      include: { tenant: true }
    });
    return reply.status(200).send({
      users: users.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        tenantName: u.tenant?.name,
        role: u.role,
        status: u.status,
        isOnline: u.isOnline,
        lastSeen: u.lastSeen
      }))
    });
  });

  app.patch('/users/:id/status', async (request, reply) => {
    const { id } = request.params as any;
    const { status } = request.body as any;
    const user = await prisma.user.update({
      where: { id },
      data: { status }
    });
    return reply.status(200).send({ success: true, user });
  });

  app.post('/impersonate', ApplicationController.startImpersonation);
  app.post('/impersonate/end', ApplicationController.endImpersonation);
  app.post('/account-requests/:id/approve', ApplicationController.approveAccountRequest);

  app.get('/audit-chain/verify', async (request, reply) => {
    const { tenantId } = request.query as { tenantId?: string };
    const result = await AuditService.verifyAuditChain(tenantId);
    return reply.status(200).send(result);
  });

  // Módulos como Aplicativos — gestão por tenant
  app.register(applicationsRoutes, { prefix: '/applications' });
}
