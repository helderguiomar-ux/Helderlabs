/**
 * TESTES DE REGRESSÃO — Bloco 0/1
 *
 * O primeiro teste deste ficheiro é o que FALTAVA e que tornou inútil a suite
 * anterior: nenhum teste forçava `emailResult.ok === false`, porque em ambiente
 * de teste a RESEND_API_KEY está ausente e o EmailService devolve sempre
 * { ok: true, code: 'SIMULATED' }. O único caminho partido em produção era
 * exatamente o único que a suite nunca percorria — daí 122/122 verde sobre um
 * sistema com o registo a devolver 502.
 *
 * Aqui a chave é DEFINIDA e o envio é forçado a falhar.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/database/prisma/client';
import { EmailService } from '../../src/modules/platform/services/EmailService';

const STRONG_PASSWORD = 'Helderlabs2026!';

describe('Resiliência do onboarding e endurecimento da autenticação', () => {
  let app: any;
  const created: string[] = [];
  const originalSend = EmailService.send;
  const originalKey = process.env.RESEND_API_KEY;

  before(async () => {
    app = buildApp();
    await app.ready();
    // Ambiente equivalente ao de produção: a chave EXISTE.
    process.env.RESEND_API_KEY = 'test_key_present_on_purpose';
  });

  after(async () => {
    (EmailService as any).send = originalSend;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (created.length) {
      await prisma.accountRequest.deleteMany({ where: { email: { in: created } } });
    }
    await app.close();
  });

  it('grava o AccountRequest mesmo quando o envio de email FALHA (regressão AUTH-03)', async () => {
    // Reproduz a falha real: domínio não verificado no fornecedor.
    (EmailService as any).send = async () => ({
      ok: false,
      code: 'RESEND_API_ERROR',
      message: 'Falha no envio de email: The helderlabs.eu domain is not verified.'
    });

    const email = `regressao.envio.${Date.now()}@exemplo.pt`;
    created.push(email);

    const res = await app.inject({
      method: 'POST',
      url: '/api/public/register',
      payload: {
        email,
        emailConfirmation: email,
        password: STRONG_PASSWORD,
        passwordConfirmation: STRONG_PASSWORD,
        name: 'Registo Resiliente',
        companyName: 'Empresa Teste',
        acceptedTerms: true,
        acceptedPrivacy: true
      }
    });

    // Antes: 502 e NENHUM registo gravado.
    assert.strictEqual(res.statusCode, 200, 'o registo não pode falhar por causa do email');
    const body = JSON.parse(res.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.emailDelivered, false);

    // O essencial: o pedido EXISTE.
    const req = await prisma.accountRequest.findUnique({ where: { email } });
    assert.ok(req, 'o AccountRequest tem de existir mesmo com o email a falhar');
    assert.strictEqual(req?.status, 'PENDING_VERIFICATION');
    assert.strictEqual(req?.emailDeliveryStatus, 'FAILED');
    assert.ok(req?.emailDeliveryError, 'o detalhe do fornecedor é guardado internamente');
  });

  it('não expõe a mensagem do fornecedor de email ao cliente', async () => {
    (EmailService as any).send = async () => ({
      ok: false,
      code: 'RESEND_API_ERROR',
      message: 'The helderlabs.eu domain is not verified. Please, add and verify your domain on https://resend.com/domains'
    });

    const email = `regressao.fuga.${Date.now()}@exemplo.pt`;
    created.push(email);

    const res = await app.inject({
      method: 'POST',
      url: '/api/public/register',
      payload: {
        email,
        emailConfirmation: email,
        password: STRONG_PASSWORD,
        passwordConfirmation: STRONG_PASSWORD,
        acceptedTerms: true,
        acceptedPrivacy: true
      }
    });

    assert.ok(!res.body.includes('resend.com'), 'o URL do fornecedor não pode chegar ao cliente');
    assert.ok(!res.body.includes('not verified'), 'o estado da configuração não pode chegar ao cliente');
  });

  it('recusa palavras-passe fracas e confirmações em falta (regressão AUTH-05)', async () => {
    (EmailService as any).send = async () => ({ ok: true, messageId: 'x' });
    const base = (email: string, extra: Record<string, unknown>) => ({
      email,
      emailConfirmation: email,
      acceptedTerms: true,
      acceptedPrivacy: true,
      ...extra
    });

    const curta = `fraca.${Date.now()}@exemplo.pt`;
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/public/register',
      payload: base(curta, { password: 'abc1', passwordConfirmation: 'abc1' })
    });
    assert.strictEqual(r1.statusCode, 400, 'password de 4 caracteres tem de ser recusada');

    const semConf = `semconf.${Date.now()}@exemplo.pt`;
    const r2 = await app.inject({
      method: 'POST',
      url: '/api/public/register',
      payload: base(semConf, { password: STRONG_PASSWORD })
    });
    assert.strictEqual(r2.statusCode, 400, 'a confirmação de password não pode ser opcional no servidor');

    const emailA = `dif.a.${Date.now()}@exemplo.pt`;
    const r3 = await app.inject({
      method: 'POST',
      url: '/api/public/register',
      payload: {
        email: emailA,
        emailConfirmation: `dif.b.${Date.now()}@exemplo.pt`,
        password: STRONG_PASSWORD,
        passwordConfirmation: STRONG_PASSWORD,
        acceptedTerms: true,
        acceptedPrivacy: true
      }
    });
    assert.strictEqual(r3.statusCode, 400, 'emails diferentes têm de ser recusados');
  });

  it('send-otp responde de forma indistinguível para conta existente e inexistente (regressão AUTH-04)', async () => {
    (EmailService as any).send = async () => ({ ok: true, messageId: 'x' });

    const superAdmin = process.env.DEFAULT_SUPER_ADMIN_EMAIL || 'helderguiomar@gmail.com';
    const inexistente = `nao.existe.${Date.now()}@exemplo.pt`;

    const r1 = await app.inject({ method: 'POST', url: '/api/auth/send-otp', payload: { email: superAdmin } });
    const r2 = await app.inject({ method: 'POST', url: '/api/auth/send-otp', payload: { email: inexistente } });

    assert.strictEqual(r1.statusCode, r2.statusCode, 'o código HTTP tem de ser igual');
    assert.deepStrictEqual(JSON.parse(r1.body), JSON.parse(r2.body), 'o corpo tem de ser igual');
  });

  it('check-email não revela se a conta existe (regressão AUTH-04)', async () => {
    const superAdmin = process.env.DEFAULT_SUPER_ADMIN_EMAIL || 'helderguiomar@gmail.com';
    const inexistente = `nao.existe.${Date.now()}@exemplo.pt`;

    const r1 = await app.inject({ method: 'POST', url: '/api/auth/check-email', payload: { email: superAdmin } });
    const r2 = await app.inject({ method: 'POST', url: '/api/auth/check-email', payload: { email: inexistente } });

    assert.deepStrictEqual(JSON.parse(r1.body), JSON.parse(r2.body));
  });

  it('uma password errada não autentica NEM reescreve o hash guardado (regressão AUTH-01)', async () => {
    // Este teste NÃO pode depender da password que por acaso está gravada na
    // base de dados do ambiente. A primeira versão assertava 'admin1234' contra
    // o super-admin e falhava em dev — não porque a backdoor existisse, mas
    // porque a password REAL do super-admin era literalmente admin1234 (o
    // código antigo reescrevia-a para esse valor sempre que alguém a tentava).
    //
    // O que tem de ser testado é o MECANISMO: uma tentativa falhada não pode
    // mutar o passwordHash. Usa-se um utilizador próprio, com password conhecida.
    const bcrypt = (await import('bcrypt')).default;
    const email = `backdoor.probe.${Date.now()}@exemplo.pt`;
    const realPassword = 'PasswordForteReal2026!';

    const tenant = await prisma.tenant.create({
      data: { name: 'Tenant Probe', slug: `tenant-probe-${Date.now()}`, status: 'ACTIVE' }
    });
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: 'Probe',
        email,
        passwordHash: await bcrypt.hash(realPassword, 10),
        role: 'TENANT_ADMIN',
        status: 'ACTIVE'
      }
    });

    try {
      const hashBefore = (await prisma.user.findUnique({ where: { id: user.id } }))!.passwordHash;

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email, password: 'admin1234' }
      });

      assert.notStrictEqual(res.statusCode, 200, 'admin1234 não pode autenticar');
      assert.ok(!JSON.parse(res.body).token, 'não pode ser emitido token');

      const hashAfter = (await prisma.user.findUnique({ where: { id: user.id } }))!.passwordHash;
      assert.strictEqual(
        hashAfter,
        hashBefore,
        'ESTA é a backdoor: uma tentativa falhada reescrevia o passwordHash guardado'
      );

      // A password verdadeira continua a funcionar — a tentativa não a destruiu.
      const ok = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email, password: realPassword }
      });
      assert.strictEqual(ok.statusCode, 200, 'a password real tem de continuar válida');
    } finally {
      await prisma.user.deleteMany({ where: { id: user.id } });
      await prisma.tenant.deleteMany({ where: { id: tenant.id } });
    }
  });

  it('sinaliza o super-admin se a password guardada for reconhecidamente fraca', async () => {
    // Não falha o deploy — reporta. A remoção da backdoor não altera a password
    // que ficou GRAVADA por ela. Em produção isso significa que a conta pode
    // continuar a abrir com admin1234 até ser rodada.
    const bcrypt = (await import('bcrypt')).default;
    const superAdmin = (process.env.DEFAULT_SUPER_ADMIN_EMAIL || 'helderguiomar@gmail.com').toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: superAdmin } });

    if (!user?.passwordHash) {
      console.log('[AVISO] Super-admin sem password definida neste ambiente — nada a verificar.');
      return;
    }

    const weak = ['admin1234', 'admin', 'password', '123456', 'helderlabs'];
    const matched: string[] = [];
    for (const w of weak) {
      if (await bcrypt.compare(w, user.passwordHash)) matched.push(w);
    }

    if (matched.length > 0) {
      console.error(
        `\n[CRÍTICO] A password do super-admin (${superAdmin}) neste ambiente é uma credencial fraca conhecida: "${matched[0]}".\n` +
        '          Remover a backdoor NÃO muda a password que ela gravou.\n' +
        '          ROTAÇÃO OBRIGATÓRIA antes de considerar a conta segura.\n'
      );
    }

    assert.ok(true, 'verificação informativa — não bloqueia o deploy');
  });

  it('/api/finance foi removido e /api/financas continua a ser a única fonte (regressão FIN-01)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/finance/transactions' });
    assert.strictEqual(res.statusCode, 404, '/api/finance tem de deixar de existir');
  });
});
