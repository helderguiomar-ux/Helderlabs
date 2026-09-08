import { FastifyInstance } from 'fastify';
import { ApplicationController } from '../controllers/ApplicationController';

/**
 * Rotas de gestão de Aplicativos (instâncias de módulos por tenant).
 * Prefixo registado em app.ts: /api/platform/applications
 *
 * Permissões:
 *   - SUPER_ADMIN / PLATFORM_ADMIN → acesso total
 *   - TENANT_ADMIN                → só vê/gere os aplicativos do próprio tenant
 *   - Outros roles                → 403
 */
export async function applicationsRoutes(app: FastifyInstance) {

  // Autenticação obrigatória em todas as rotas
  app.addHook('preHandler', app.authenticate);

  // Autorização: SUPER_ADMIN, PLATFORM_ADMIN ou TENANT_ADMIN
  app.addHook('preHandler', async (req, reply) => {
    const role = (req.user as any)?.role;
    const allowed = ['SUPER_ADMIN', 'PLATFORM_ADMIN', 'TENANT_ADMIN'];
    if (!allowed.includes(role)) {
      return reply.status(403).send({
        error: 'FORBIDDEN',
        message: 'Não tem permissão para gerir aplicativos.'
      });
    }
  });

  // ── Módulos globais disponíveis ──────────────────────────────────────────
  // GET /api/platform/applications/modules
  app.get('/modules', ApplicationController.listModules);

  // ── Aplicativos (instâncias de módulos por tenant) ───────────────────────
  // GET  /api/platform/applications (SUPER_ADMIN, PLATFORM_ADMIN, TENANT_ADMIN)
  app.get('/', ApplicationController.list);

  // POST /api/platform/applications (Apenas SUPER_ADMIN / PLATFORM_ADMIN)
  app.post('/', {
    preHandler: async (req, reply) => {
      const role = (req.user as any)?.role;
      if (role !== 'SUPER_ADMIN' && role !== 'PLATFORM_ADMIN') {
        return reply.status(403).send({ error: 'FORBIDDEN', message: 'Apenas administradores de plataforma podem licenciar módulos.' });
      }
    }
  }, ApplicationController.create);

  // PATCH /api/platform/applications/:applicationId (Apenas SUPER_ADMIN / PLATFORM_ADMIN)
  app.patch('/:applicationId', {
    preHandler: async (req, reply) => {
      const role = (req.user as any)?.role;
      if (role !== 'SUPER_ADMIN' && role !== 'PLATFORM_ADMIN') {
        return reply.status(403).send({ error: 'FORBIDDEN', message: 'Apenas administradores de plataforma podem alterar licenciamentos.' });
      }
    }
  }, ApplicationController.update);

  // DELETE /api/platform/applications/:applicationId (Apenas SUPER_ADMIN / PLATFORM_ADMIN)
  app.delete('/:applicationId', {
    preHandler: async (req, reply) => {
      const role = (req.user as any)?.role;
      if (role !== 'SUPER_ADMIN' && role !== 'PLATFORM_ADMIN') {
        return reply.status(403).send({ error: 'FORBIDDEN', message: 'Apenas administradores de plataforma podem remover licenciamentos.' });
      }
    }
  }, ApplicationController.remove);

  // ── Atribuições de utilizadores ──────────────────────────────────────────
  // POST   /api/platform/applications/:applicationId/assign
  app.post('/:applicationId/assign', ApplicationController.assignUser);

  // DELETE /api/platform/applications/:applicationId/assign/:userId
  app.delete('/:applicationId/assign/:userId', ApplicationController.removeUser);
}
