import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AuditService } from '../../src/modules/platform/services/AuditService';
import { EmailService } from '../../src/modules/platform/services/EmailService';

// =============================================================================
// EmailService — serviço transacional central
// =============================================================================
// Estes testes NÃO tocam na rede nem na base de dados. Interceptam o `fetch`
// e inspecionam exatamente o que teria sido enviado ao Resend.
//
// Porque é que isto existe: até esta versão, uma suite inteira podia passar a
// verde sem nunca ter falado com o fornecedor, porque sem RESEND_API_KEY o
// serviço devolvia `ok: true`. Aqui a chave está presente (falsa) e o que se
// verifica é o CONTEÚDO do pedido.
// =============================================================================

type Captured = { url: string; headers: Record<string, string>; body: any };

let captured: Captured[] = [];
let auditEvents: any[] = [];
let auditShouldFail = false;
const realFetch = globalThis.fetch;

function okFetch(id = 'test-message-id') {
  return async (url: any, init: any) => {
    captured.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({ id }) } as any;
  };
}

before(() => {
  // A auditoria escreve na base de dados; nestes testes não há base de dados.
  (AuditService as any).audit = async (e: any) => {
    if (auditShouldFail) throw new Error('AUDIT_WRITE_FAILED: simulado');
    auditEvents.push(e);
  };
});

beforeEach(() => {
  captured = [];
  auditEvents = [];
  auditShouldFail = false;
  process.env.NODE_ENV = 'test';
  process.env.RESEND_API_KEY = 're_CHAVE_FALSA_DE_TESTE';
  process.env.RESEND_FROM_EMAIL = 'noreply@helderlabs.eu';
  process.env.RESEND_FROM_NAME = 'HelderLabs ERP';
  process.env.RESEND_REPLY_TO = 'suporte@helderlabs.eu';
  process.env.APP_URL = 'https://helderlabs.eu';
  globalThis.fetch = okFetch() as any;
});

describe('EmailService — configuração', () => {
  it('constrói o remetente a partir de RESEND_FROM_EMAIL + RESEND_FROM_NAME', () => {
    assert.equal(EmailService.describeConfig().from, 'HelderLabs ERP <noreply@helderlabs.eu>');
  });

  it('o diagnóstico nunca revela a chave da API', () => {
    const cfg = EmailService.describeConfig();
    assert.equal(JSON.stringify(cfg).includes('re_CHAVE_FALSA_DE_TESTE'), false);
    assert.equal(cfg.apiKeyConfigured, true);
  });

  it('aceita SMTP_FROM como forma antiga', () => {
    delete process.env.RESEND_FROM_EMAIL;
    process.env.SMTP_FROM = 'Antigo <old@helderlabs.eu>';
    assert.equal(EmailService.describeConfig().from, 'Antigo <old@helderlabs.eu>');
    delete process.env.SMTP_FROM;
  });
});

describe('EmailService — dados de origem externa no corpo do email', () => {
  const nomeMalicioso = '<img src=x onerror="alert(1)"> </div><a href="javascript:alert(2)">clique</a>';

  it('escapa marcação injetada através do nome', async () => {
    await EmailService.sendVerificationEmail('teste@example.com', nomeMalicioso, '482913');
    const html = captured.at(-1)!.body.html;
    assert.equal(html.includes('<img src=x'), false);
    assert.ok(html.includes('&lt;img'), 'deve aparecer escapado, não desaparecer');
  });

  it('não deixa nenhum href apontar para javascript:', async () => {
    await EmailService.sendVerificationEmail('teste@example.com', nomeMalicioso, '482913');
    const html = captured.at(-1)!.body.html;
    assert.equal(/href\s*=\s*["']?javascript:/i.test(html), false);
  });

  it('substitui uma URL não-http num botão pelo APP_URL', async () => {
    await EmailService.sendPasswordResetEmail('teste@example.com', 'Hélder', 'javascript:alert(1)');
    const html = captured.at(-1)!.body.html;
    assert.equal(html.includes('javascript:alert'), false);
    assert.ok(html.includes('https://helderlabs.eu'));
  });
});

describe('EmailService — corpo do pedido ao Resend', () => {
  it('envia sempre parte de texto simples além do HTML', async () => {
    await EmailService.sendVerificationEmail('teste@example.com', 'Hélder', '482913');
    const body = captured.at(-1)!.body;
    assert.equal(typeof body.text, 'string');
    assert.ok(body.text.includes('482913'), 'o código tem de estar também no texto simples');
    assert.equal(body.text.includes('<div'), false);
    assert.equal(body.text.includes('style='), false);
  });

  it('aplica o reply_to configurado', async () => {
    await EmailService.sendOtpEmail('teste@example.com', '123456');
    assert.equal(captured.at(-1)!.body.reply_to, 'suporte@helderlabs.eu');
  });

  it('envia chave de idempotência em todos os pedidos', async () => {
    await EmailService.sendOtpEmail('teste@example.com', '123456');
    assert.ok(captured.at(-1)!.headers['Idempotency-Key']);
  });

  it('suporta português e inglês', async () => {
    await EmailService.sendOtpEmail('teste@example.com', '123456', { locale: 'en' });
    const en = captured.at(-1)!.body;
    assert.ok(en.subject.startsWith('Your HelderLabs ERP sign-in code'));
    assert.ok(en.html.includes('lang="en"'));

    await EmailService.sendOtpEmail('teste2@example.com', '123456');
    const pt = captured.at(-1)!.body;
    assert.ok(pt.subject.startsWith('O seu código de acesso'));
    assert.ok(pt.html.includes('lang="pt-PT"'));
  });
});

describe('EmailService — validação e limites', () => {
  it('recusa endereços inválidos antes de gastar um pedido à API', async () => {
    const r = await EmailService.send({ to: 'nao-e-um-email', subject: 'x', html: '<p>x</p>' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'INVALID_RECIPIENT');
    assert.equal(captured.length, 0);
  });

  it('trava um ciclo de envio para o mesmo destinatário', async () => {
    const destino = `loop-${Date.now()}@example.com`;
    let travou = false;
    for (let i = 0; i < 12; i++) {
      const r = await EmailService.sendOtpEmail(destino, '000000');
      if (r.code === 'EMAIL_RATE_LIMITED') { travou = true; break; }
    }
    assert.ok(travou, 'a guarda tem de travar o ciclo');
  });
});

describe('EmailService — retentativas', () => {
  it('recupera de um 503 e usa SEMPRE a mesma chave de idempotência', async () => {
    let calls = 0;
    const keys = new Set<string>();
    globalThis.fetch = (async (_u: any, init: any) => {
      calls++;
      keys.add(init.headers['Idempotency-Key']);
      if (calls < 3) {
        return { ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({ message: 'temporário' }) } as any;
      }
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ id: 'after-retry' }) } as any;
    }) as any;

    const r = await EmailService.sendWelcomeEmail(`retry-${Date.now()}@example.com`, 'Hélder');
    assert.equal(r.ok, true);
    assert.equal(r.attempts, 3);
    assert.equal(keys.size, 1, 'três tentativas, uma só chave — o utilizador não recebe três emails');
  });

  it('não repete um 4xx: o resultado seria idêntico', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return { ok: false, status: 422, statusText: 'Unprocessable', json: async () => ({ message: 'domínio não verificado' }) } as any;
    }) as any;

    const r = await EmailService.sendWelcomeEmail(`quatro-${Date.now()}@example.com`, 'Hélder');
    assert.equal(r.ok, false);
    assert.equal(calls, 1);
    assert.ok((r.message || '').includes('domínio não verificado'), 'a razão real do Resend chega ao chamador');
  });
});

describe('EmailService — ausência de configuração', () => {
  it('em PRODUÇÃO sem chave devolve falha explícita, nunca sucesso', async () => {
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = 'production';
    const r = await EmailService.sendOtpEmail(`prod-${Date.now()}@example.com`, '999999');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EMAIL_CONFIG_MISSING');
  });

  it('em dev marca o resultado como simulado, para que um teste consiga distinguir', async () => {
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = 'test';
    const r = await EmailService.sendOtpEmail(`dev-${Date.now()}@example.com`, '999999');
    assert.equal(r.ok, true);
    assert.equal(r.simulated, true, 'sem isto, uma suite passa a verde sem nunca ter enviado nada');
  });
});

describe('EmailService — regressão: falha de auditoria não duplica o envio', () => {
  it('uma falha ao auditar não faz o email sair três vezes', async () => {
    let envios = 0;
    globalThis.fetch = (async (_u: any, init: any) => {
      envios++;
      captured.push({ url: String(_u), headers: init.headers, body: JSON.parse(init.body) });
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ id: 'once' }) } as any;
    }) as any;

    auditShouldFail = true;
    const r = await EmailService.sendWelcomeEmail(`audit-${Date.now()}@example.com`, 'Hélder');
    auditShouldFail = false;

    assert.equal(envios, 1, 'o email tem de sair UMA vez');
    assert.equal(r.ok, true, 'o chamador tem de saber que o email saiu');
    assert.equal(r.code, 'SENT_BUT_NOT_AUDITED', 'a falha de auditoria é assinalada, não escondida');
  });
});

describe('EmailService — auditoria', () => {
  it('regista sucessos, falhas e bloqueios, e nunca a chave da API', async () => {
    await EmailService.sendOtpEmail(`aud-${Date.now()}@example.com`, '111111');

    globalThis.fetch = (async () => ({
      ok: false, status: 422, statusText: 'Unprocessable', json: async () => ({ message: 'erro' })
    })) as any;
    await EmailService.sendOtpEmail(`aud2-${Date.now()}@example.com`, '222222');

    const acoes = auditEvents.map((e) => e.action);
    assert.ok(acoes.includes('email.sent'));
    assert.ok(acoes.includes('email.send_failed'));
    assert.equal(JSON.stringify(auditEvents).includes('re_CHAVE_FALSA_DE_TESTE'), false);
    globalThis.fetch = realFetch;
  });
});
