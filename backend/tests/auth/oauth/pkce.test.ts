import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeCodeChallenge, generateCodeVerifier, generateNonce } from '../../../src/modules/auth/oauth/pkce';

describe('pkce', () => {
  test('computeCodeChallenge: corresponde ao vetor de teste oficial da RFC 7636', () => {
    // Vetor de teste do Apêndice B da RFC 7636 — confirma que a implementação
    // (SHA-256 + base64url sem padding) está correta, sem depender de rede.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

    assert.equal(computeCodeChallenge(verifier), expectedChallenge);
  });

  test('generateCodeVerifier: produz strings diferentes e dentro do tamanho exigido pela spec (43-128)', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();

    assert.notEqual(a, b);
    assert.ok(a.length >= 43 && a.length <= 128, `tamanho inesperado: ${a.length}`);
    assert.match(a, /^[A-Za-z0-9_-]+$/, 'deve ser base64url puro, sem "+", "/" ou "="');
  });

  test('generateNonce: produz valores diferentes a cada chamada', () => {
    assert.notEqual(generateNonce(), generateNonce());
  });
});
