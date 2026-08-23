import crypto from 'node:crypto';

// PKCE (RFC 7636) — não é estritamente obrigatório para um "confidential
// client" como este backend (que guarda um client_secret), mas é defesa em
// profundidade barata e é exigido por alguns providers/configurações. Usa
// só `node:crypto`, sem dependências novas.

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCodeVerifier(): string {
  // 32 bytes aleatórios em base64url dá ~43 caracteres — dentro do range
  // 43-128 exigido pela spec.
  return base64url(crypto.randomBytes(32));
}

export function computeCodeChallenge(codeVerifier: string): string {
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  return base64url(hash);
}

export function generateNonce(): string {
  return base64url(crypto.randomBytes(16));
}
