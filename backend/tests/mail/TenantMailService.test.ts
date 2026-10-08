import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import Fastify from 'fastify';
import { createFakeMailDb } from './support/fakeMailDb';
import { encryptCredential, decryptCredential } from '../../src/modules/mail/services/credentialCipher';
import { isBlockedAddress, resolveSmtpTarget } from '../../src/modules/mail/services/smtpHostGuard';
import {
  TenantMailService,
  buildTransportOptions,
  type MailTransport
} from '../../src/modules/mail/services/TenantMailService';
import { tenantMailRoutes } from '../../src/modules/mail/routes/mail.routes';

const requireCjs = createRequire(__filename);
const nodemailer = requireCjs('nodemailer');
const { SMTPServer } = requireCjs('smtp-server');

const ACTOR = { userId: 'user_admin', email: 'admin@empresa.pt', role: 'TENANT_ADMIN' };
const publicResolver = async (host: string, port: number) => ({ hostname: host, address: '142.250.0.1', port });

process.env.EMAIL_CREDENTIALS_KEY = randomBytes(32).toString('base64');

function makeService(tenantId = 'tenant_a', db = createFakeMailDb(), extra: Record<string, unknown> = {}) {
  const audits: any[] = [];
  const service = new TenantMailService(tenantId, db, {
    resolveTarget: publicResolver,
    audit: async (input) => {
      audits.push(input);
    },
    ...extra
  });
  return { service, db, audits };
}

function fakeTransport(behaviour: { fail?: any } = {}) {
  const sent: any[] = [];
  const factory = (options: any): MailTransport => ({
    async verify() {
      if (behaviour.fail) throw behaviour.fail;
      return true;
    },
    async sendMail(message: any) {
      if (behaviour.fail) throw behaviour.fail;
      sent.push({ options, message });
      return { messageId: `<msg-${sent.length}@test>` };
    }
  });
  return { factory, sent };
}

const GMAIL_INPUT = {
  provider: 'SMTP',
  preset: 'GMAIL',
  smtpUser: 'helder@gmail.com',
  smtpPassword: 'abcd efgh ijkl mnop',
  fromName: 'Hélder Nóbrega',
  replyTo: ''
};

// -----------------------------------------------------------------------------
describe('Cifra de credenciais (AES-256-GCM)', () => {
  test('cifra e decifra; o valor guardado não contém a password', () => {
    const stored = encryptCredential('segredo-123', 'tenant_a');
    assert.ok(stored.startsWith('v1:'));
    assert.ok(!stored.includes('segredo'));
    assert.equal(decryptCredential(stored, 'tenant_a'), 'segredo-123');
  });

  test('duas cifras da mesma password são diferentes (IV aleatório)', () => {
    assert.notEqual(encryptCredential('x', 't'), encryptCredential('x', 't'));
  });

  test('uma password copiada para outro tenant não decifra', () => {
    const stored = encryptCredential('segredo', 'tenant_a');
    assert.throws(() => decryptCredential(stored, 'tenant_b'), /EMAIL_CRYPTO_DECRYPT_FAILED|Não foi possível ler/);
  });

  test('conteúdo adulterado é detetado', () => {
    const parts = encryptCredential('segredo', 'tenant_a').split(':');
    parts[3] = Buffer.from('outra-coisa').toString('base64url');
    assert.throws(() => decryptCredential(parts.join(':'), 'tenant_a'));
  });

  test('sem EMAIL_CREDENTIALS_KEY recusa gravar com 503', () => {
    const saved = process.env.EMAIL_CREDENTIALS_KEY;
    delete process.env.EMAIL_CREDENTIALS_KEY;
    try {
      assert.throws(() => encryptCredential('x', 't'), (err: any) => err.statusCode === 503);
    } finally {
      process.env.EMAIL_CREDENTIALS_KEY = saved;
    }
  });
});

// -----------------------------------------------------------------------------
describe('Guarda do servidor SMTP', () => {
  test('bloqueia endereços internos', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
    assert.equal(isBlockedAddress('142.250.184.109'), false);
    assert.equal(isBlockedAddress('2a00:1450:4003:80b::2005'), false);
  });

  test('recusa porta não permitida', async () => {
    await assert.rejects(resolveSmtpTarget('smtp.exemplo.pt', 22, async () => [{ address: '142.250.0.1' }]), (e: any) => e.code === 'SMTP_PORT_NOT_ALLOWED');
  });

  test('recusa nome que resolve para rede interna (ex.: metadados da cloud)', async () => {
    await assert.rejects(
      resolveSmtpTarget('interno.exemplo.pt', 587, async () => [{ address: '169.254.169.254' }]),
      (e: any) => e.code === 'SMTP_HOST_FORBIDDEN'
    );
  });

  test('liga ao IP resolvido e mantém o nome para o TLS', async () => {
    const target = await resolveSmtpTarget('SMTP.Gmail.com', 465, async () => [{ address: '142.250.0.1' }]);
    assert.deepEqual(target, { hostname: 'smtp.gmail.com', address: '142.250.0.1', port: 465 });
    const opts: any = buildTransportOptions(target, false, 'u', 'p');
    assert.equal(opts.host, '142.250.0.1');
    assert.equal(opts.tls.servername, 'smtp.gmail.com');
    assert.equal(opts.requireTLS, true, 'em 587 o STARTTLS tem de ser obrigatório');
  });
});

// -----------------------------------------------------------------------------
describe('Definições de email do tenant', () => {
  test('sem configuração: modo PLATFORM, sem password', async () => {
    const { service } = makeService();
    const s = await service.getSettings();
    assert.equal(s.provider, 'PLATFORM');
    assert.equal(s.configured, false);
    assert.equal(s.hasPassword, false);
  });

  test('Gmail: preset impõe servidor/porta, remove espaços da password e cifra', async () => {
    const { service, db, audits } = makeService();
    const s = await service.saveSettings(GMAIL_INPUT, ACTOR);
    assert.equal(s.smtpHost, 'smtp.gmail.com');
    assert.equal(s.smtpPort, 465);
    assert.equal(s.smtpSecure, true);
    assert.equal(s.fromEmail, 'helder@gmail.com', 'remetente por omissão = utilizador');
    assert.equal(s.hasPassword, true);
    assert.equal(s.isVerified, false, 'só fica verificado depois do teste');

    const row = db.__settings[0];
    assert.equal(decryptCredential(row.smtpPasswordEnc, 'tenant_a'), 'abcdefghijklmnop');
    assert.ok(!JSON.stringify(s).includes('abcd'), 'a resposta nunca contém a password');
    assert.ok(!('smtpPasswordEnc' in s));

    assert.equal(audits.length, 1);
    assert.equal(audits[0].category, 'SECURITY');
    assert.ok(!JSON.stringify(audits[0]).includes('abcd'), 'a auditoria nunca contém a password');
  });

  test('gravar sem password mantém a anterior', async () => {
    const { service, db } = makeService();
    await service.saveSettings(GMAIL_INPUT, ACTOR);
    const before = db.__settings[0].smtpPasswordEnc;
    await service.saveSettings({ ...GMAIL_INPUT, smtpPassword: '', fromName: 'Outro nome' }, ACTOR);
    assert.equal(db.__settings[0].smtpPasswordEnc, before);
    assert.equal(db.__settings[0].fromName, 'Outro nome');
  });

  test('mudar servidor ou utilizador sem reintroduzir a password é recusado', async () => {
    const { service } = makeService();
    await service.saveSettings(GMAIL_INPUT, ACTOR);
    await assert.rejects(
      service.saveSettings({ provider: 'SMTP', preset: 'CUSTOM', smtpHost: 'smtp.atacante.com', smtpPort: 587, smtpUser: 'helder@gmail.com' }, ACTOR),
      (e: any) => e.code === 'SMTP_PASSWORD_REENTRY_REQUIRED'
    );
  });

  test('SMTP sem password é recusado', async () => {
    const { service } = makeService();
    await assert.rejects(service.saveSettings({ ...GMAIL_INPUT, smtpPassword: '' }, ACTOR), (e: any) => e.code === 'SMTP_PASSWORD_REQUIRED');
  });

  test('nome de remetente com quebra de linha é recusado (injeção de cabeçalhos)', async () => {
    const { service } = makeService();
    await assert.rejects(service.saveSettings({ ...GMAIL_INPUT, fromName: 'X\r\nBcc: vitima@x.pt' }, ACTOR));
  });

  test('campos desconhecidos são recusados', async () => {
    const { service } = makeService();
    await assert.rejects(service.saveSettings({ ...GMAIL_INPUT, tenantId: 'outro' }, ACTOR));
  });
});

// -----------------------------------------------------------------------------
describe('Envio', () => {
  test('PLATFORM: envia pelo remetente da plataforma com o "responder para" do tenant e regista', async () => {
    const calls: any[] = [];
    const { service, db } = makeService('tenant_a', createFakeMailDb(), {
      platformSend: async (o: any) => {
        calls.push(o);
        return { ok: true, messageId: 're_1' };
      }
    });
    await service.saveSettings({ provider: 'PLATFORM', replyTo: 'helder@gmail.com' }, ACTOR);
    const r = await service.send({ to: 'cliente@empresa.pt', subject: 'Proposta', html: '<p>Olá</p>' }, ACTOR);
    assert.equal(r.ok, true);
    assert.equal(calls[0].replyTo, 'helder@gmail.com');
    assert.equal(calls[0].tenantId, 'tenant_a');
    assert.equal(db.__logs[0].status, 'SENT');
  });

  test('PLATFORM: anexos exigem SMTP próprio', async () => {
    const { service } = makeService('tenant_a', createFakeMailDb(), { platformSend: async () => ({ ok: true }) });
    await assert.rejects(
      service.send({ to: 'a@b.pt', subject: 'x', html: 'x', attachments: [{ filename: 'p.pdf', contentBase64: 'AAAA' }] }, ACTOR),
      (e: any) => e.code === 'ATTACHMENTS_REQUIRE_SMTP'
    );
  });

  test('SMTP: envia com o nome e email do tenant e o anexo', async () => {
    const t = fakeTransport();
    const { service, db } = makeService('tenant_a', createFakeMailDb(), { transportFactory: t.factory });
    await service.saveSettings(GMAIL_INPUT, ACTOR);
    await service.send(
      { to: 'cliente@empresa.pt', subject: 'Proposta', html: '<p>x</p>', attachments: [{ filename: 'proposta.pdf', contentBase64: Buffer.from('%PDF').toString('base64') }] },
      ACTOR
    );
    const { options, message } = t.sent[0];
    assert.equal(options.auth.pass, 'abcdefghijklmnop');
    assert.deepEqual(message.from, { name: 'Hélder Nóbrega', address: 'helder@gmail.com' });
    assert.equal(message.attachments[0].content.toString(), '%PDF');
    assert.equal(db.__logs[0].status, 'SENT');
  });

  test('SMTP: limite diário bloqueia e regista BLOCKED_LIMIT', async () => {
    const t = fakeTransport();
    const { service, db } = makeService('tenant_a', createFakeMailDb(), { transportFactory: t.factory });
    await service.saveSettings({ ...GMAIL_INPUT, dailyLimit: 2 }, ACTOR);
    await service.send({ to: 'a@b.pt', subject: '1', html: 'x' }, ACTOR);
    await service.send({ to: 'a@b.pt', subject: '2', html: 'x' }, ACTOR);
    await assert.rejects(service.send({ to: 'a@b.pt', subject: '3', html: 'x' }, ACTOR), (e: any) => e.statusCode === 429 && e.code === 'EMAIL_DAILY_LIMIT');
    assert.deepEqual(db.__logs.map((l: any) => l.status), ['SENT', 'SENT', 'BLOCKED_LIMIT']);
    assert.equal(t.sent.length, 2);
  });

  test('SMTP: password errada dá mensagem útil, regista FAILED e guarda o erro', async () => {
    const t = fakeTransport({ fail: Object.assign(new Error('Invalid login'), { code: 'EAUTH', response: '535-5.7.8 Username and Password not accepted' }) });
    const { service, db } = makeService('tenant_a', createFakeMailDb(), { transportFactory: t.factory });
    await service.saveSettings(GMAIL_INPUT, ACTOR);
    await assert.rejects(service.send({ to: 'a@b.pt', subject: 'x', html: 'x' }, ACTOR), (e: any) => e.code === 'SMTP_AUTH_FAILED' && /password de aplicação/.test(e.message));
    assert.equal(db.__logs[0].status, 'FAILED');
    assert.match(db.__settings[0].lastError, /password de aplicação/);
  });

  test('o limite diário é por tenant', async () => {
    const db = createFakeMailDb();
    const t = fakeTransport();
    const a = makeService('tenant_a', db, { transportFactory: t.factory }).service;
    const b = makeService('tenant_b', db, { transportFactory: t.factory }).service;
    await a.saveSettings({ ...GMAIL_INPUT, dailyLimit: 1 }, ACTOR);
    await b.saveSettings({ ...GMAIL_INPUT, dailyLimit: 1 }, ACTOR);
    await a.send({ to: 'a@b.pt', subject: 'x', html: 'x' }, ACTOR);
    await b.send({ to: 'a@b.pt', subject: 'x', html: 'x' }, ACTOR);
    assert.equal(t.sent.length, 2);
  });

  test('teste de definições marca como verificado e envia para o próprio utilizador', async () => {
    const t = fakeTransport();
    const { service } = makeService('tenant_a', createFakeMailDb(), { transportFactory: t.factory });
    await service.saveSettings(GMAIL_INPUT, ACTOR);
    const r = await service.testSettings(ACTOR);
    assert.equal(r.to, 'admin@empresa.pt');
    assert.equal(t.sent[0].message.to, 'admin@empresa.pt');
    const s = await service.getSettings();
    assert.equal(s.isVerified, true);
    assert.equal(s.sentLast24h, 1);
    assert.equal((await service.getStatus()).ready, true);
  });
});

// -----------------------------------------------------------------------------
describe('SMTP real (servidor local com STARTTLS e autenticação)', () => {
  let server: any;
  let port = 0;
  const received: { from?: string; auth?: string; secure?: boolean; data: string }[] = [];

  before(async () => {
    server = new SMTPServer({
      authOptional: false,
      logger: false,
      onAuth(auth: any, _session: any, cb: any) {
        if (auth.username === 'helder@gmail.com' && auth.password === 'abcdefghijklmnop') return cb(null, { user: auth.username });
        const err: any = new Error('Username and Password not accepted');
        err.responseCode = 535;
        return cb(err);
      },
      onData(stream: any, session: any, cb: any) {
        let data = '';
        stream.on('data', (c: Buffer) => (data += c.toString()));
        stream.on('end', () => {
          received.push({ from: session.envelope.mailFrom?.address, auth: session.user, secure: session.secure, data });
          cb();
        });
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.server.address().port;
  });

  after(() => new Promise<void>((resolve) => server.close(resolve)));

  beforeEach(() => {
    received.length = 0;
  });

  // O servidor de teste usa um certificado auto-assinado: só nos testes se aceita.
  const testFactory = (options: any) => nodemailer.createTransport({ ...options, tls: { ...options.tls, rejectUnauthorized: false } });
  const localResolver = async (host: string, p: number) => ({ hostname: host, address: '127.0.0.1', port });

  test('autentica via STARTTLS, envia e o servidor recebe o email com o remetente do tenant', async () => {
    const { service, db } = makeService('tenant_a', createFakeMailDb(), { transportFactory: testFactory, resolveTarget: localResolver });
    await service.saveSettings({ provider: 'SMTP', preset: 'CUSTOM', smtpHost: 'smtp.local.test', smtpPort: 587, smtpSecure: false, smtpUser: 'helder@gmail.com', smtpPassword: 'abcdefghijklmnop', fromName: 'HelderLabs' }, ACTOR);
    const r = await service.testSettings(ACTOR);
    assert.equal(r.ok, true);
    assert.equal(received.length, 1);
    assert.equal(received[0].auth, 'helder@gmail.com');
    assert.equal(received[0].from, 'helder@gmail.com');
    assert.match(received[0].data, /From: HelderLabs <helder@gmail\.com>/);
    assert.match(received[0].data, /Subject: =\?UTF-8\?Q\?Teste_de_envio/);
    assert.equal(received[0].secure, true, 'a ligação passou a TLS antes da autenticação');
    assert.equal(db.__logs[0].status, 'SENT');
  });

  test('password errada no servidor real: SMTP_AUTH_FAILED e configuração fica por verificar', async () => {
    const { service } = makeService('tenant_a', createFakeMailDb(), { transportFactory: testFactory, resolveTarget: localResolver });
    await service.saveSettings({ provider: 'SMTP', preset: 'CUSTOM', smtpHost: 'smtp.local.test', smtpPort: 587, smtpSecure: false, smtpUser: 'helder@gmail.com', smtpPassword: 'errada' }, ACTOR);
    await assert.rejects(service.testSettings(ACTOR), (e: any) => e.code === 'SMTP_AUTH_FAILED');
    const s = await service.getSettings();
    assert.equal(s.isVerified, false);
    assert.match(s.lastError || '', /password de aplicação/);
    assert.equal(received.length, 0);
  });
});

// -----------------------------------------------------------------------------
describe('Rotas /api/tenant/email', () => {
  async function buildTestApp(role: string, db = createFakeMailDb()) {
    const app = Fastify();
    app.decorate('authenticate', async (request: any) => {
      request.user = { sub: 'u1', tenantId: 'tenant_a', role, email: 'u1@empresa.pt' };
      request.db = db;
    });
    app.setErrorHandler((error: any, _req, reply) => {
      reply.status(error.statusCode ?? (error.name === 'ZodError' ? 400 : 500)).send({ error: error.code, message: error.message });
    });
    await app.register(tenantMailRoutes, { prefix: '/api/tenant/email' });
    return app;
  }

  test('utilizador comercial não vê nem altera as definições, mas vê o estado', async () => {
    const app = await buildTestApp('SALES');
    assert.equal((await app.inject({ method: 'GET', url: '/api/tenant/email/settings' })).statusCode, 403);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/tenant/email/settings', payload: { provider: 'PLATFORM' } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/tenant/email/test' })).statusCode, 403);
    const status = await app.inject({ method: 'GET', url: '/api/tenant/email/status' });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().status.provider, 'PLATFORM');
    await app.close();
  });

  test('administrador grava e a resposta HTTP nunca inclui a password', async () => {
    const db = createFakeMailDb();
    db.__settings.push({
      id: 'tes_x',
      tenantId: 'tenant_a',
      provider: 'SMTP',
      preset: 'GMAIL',
      smtpHost: 'smtp.gmail.com',
      smtpPort: 465,
      smtpSecure: true,
      smtpUser: 'helder@gmail.com',
      smtpPasswordEnc: encryptCredential('abcdefghijklmnop', 'tenant_a'),
      fromEmail: 'helder@gmail.com',
      dailyLimit: 300,
      isVerified: true
    });
    const app = await buildTestApp('TENANT_ADMIN', db);
    const res = await app.inject({ method: 'GET', url: '/api/tenant/email/settings' });
    assert.equal(res.statusCode, 200);
    assert.ok(!res.body.includes('abcdefghijklmnop'));
    assert.ok(!res.body.includes('smtpPasswordEnc'));
    assert.equal(res.json().settings.hasPassword, true);
    await app.close();
  });
});
