import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { signOAuthState, verifyOAuthState } from '../../../src/modules/auth/oauth/oauthState';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'segredo-de-teste';

describe('oauthState', () => {
  test('sign/verify: round-trip devolve exatamente o que foi assinado', () => {
    const state = signOAuthState({ provider: 'google', nonce: 'nonce-123', codeVerifier: 'verifier-abc' });
    const payload = verifyOAuthState(state);

    assert.equal(payload.provider, 'google');
    assert.equal(payload.nonce, 'nonce-123');
    assert.equal(payload.codeVerifier, 'verifier-abc');
  });

  test('verify: rejeita um state adulterado (assinatura inválida)', () => {
    const state = signOAuthState({ provider: 'microsoft', nonce: 'n', codeVerifier: 'v' });
    const tampered = state.slice(0, -2) + 'xx';

    assert.throws(() => verifyOAuthState(tampered));
  });

  test('verify: rejeita um state assinado com outro segredo (ex.: outro processo/deploy)', () => {
    const originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'segredo-diferente';
    const stateAssinadoComOutroSegredo = signOAuthState({ provider: 'apple', nonce: 'n', codeVerifier: 'v' });
    process.env.JWT_SECRET = originalSecret;

    assert.throws(() => verifyOAuthState(stateAssinadoComOutroSegredo));
  });
});
