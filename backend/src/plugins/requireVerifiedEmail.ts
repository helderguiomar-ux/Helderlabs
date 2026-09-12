import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../database/prisma/client';

/**
 * Guarda: exige que o utilizador autenticado tenha provado ser dono da caixa
 * de correio (`users.emailVerifiedAt` preenchido).
 *
 * -------------------------------------------------------------------------
 * ESTADO: implementada, DESLIGADA por omissão. Não está ligada a nenhuma rota.
 * -------------------------------------------------------------------------
 *
 * Porquê desligada: `users.emailVerifiedAt` só fica preenchido quando o
 * utilizador percorre o fluxo de validação por ligação, ou quando a conta nasce
 * de um pedido de acesso já verificado. Todas as contas anteriores a esse
 * fluxo — seeds, promoções manuais, contas criadas à mão — ficam a NULL sem
 * que isso signifique que o email é falso. Ligar isto sem olhar caso a caso
 * fecha a porta a utilizadores legítimos.
 *
 * COMO LIGAR, quando o Hélder autorizar:
 *   1. Confirmar em produção quantos utilizadores ativos têm NULL:
 *        SELECT count(*) FROM users WHERE "emailVerifiedAt" IS NULL AND active;
 *   2. Resolver esses casos (verificação forçada ou preenchimento documentado).
 *   3. `ENFORCE_EMAIL_VERIFICATION=true` no ambiente.
 *   4. Acrescentar à cadeia de preHandler das rotas a proteger:
 *        { preHandler: [app.authenticate, requireVerifiedEmail] }
 *
 * Contas OAuth (Google, Microsoft) são consideradas verificadas: o próprio
 * provider já confirmou o endereço antes de o devolver.
 */
export async function requireVerifiedEmail(request: FastifyRequest, reply: FastifyReply) {
  if (process.env.ENFORCE_EMAIL_VERIFICATION !== 'true') return;

  const userId = request.user?.sub;
  if (!userId) {
    return reply.status(401).send({ message: 'Não autenticado.' });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailVerifiedAt: true, authProvider: true }
  });

  if (!user) {
    return reply.status(401).send({ message: 'Utilizador inexistente.' });
  }

  if (user.authProvider !== 'EMAIL') return;

  if (!user.emailVerifiedAt) {
    return reply.status(403).send({
      error: 'EMAIL_NOT_VERIFIED',
      message: 'É necessário confirmar o seu endereço de email antes de continuar.'
    });
  }
}
