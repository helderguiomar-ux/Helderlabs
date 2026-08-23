import jwt from 'jsonwebtoken';
import type { OAuthProviderName } from './providers';

// O fluxo OAuth normal guardaria o `code_verifier`/`nonce` numa sessão do
// lado do servidor entre o /start e o /callback. Este backend não tem
// sessões (é stateless por desenho — cada pedido só depende do JWT), por
// isso metemos esses valores DENTRO do próprio `state` OAuth, assinado, para
// que o provider no-los devolva intactos no callback sem precisarmos de
// guardar nada em memória/BD entretanto. Curta duração (5 min) porque um
// login social não deve demorar mais do que isso.

export interface OAuthStatePayload {
  provider: OAuthProviderName;
  nonce: string;
  codeVerifier: string;
}

function getStateSecret(): string {
  // Reutiliza JWT_SECRET de propósito — é o mesmo segredo do backend, não
  // há vantagem de segurança em duplicar a variável de ambiente só para
  // isto, e simplifica o .env.
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET não está definido no .env.');
  }
  return secret;
}

export function signOAuthState(payload: OAuthStatePayload): string {
  return jwt.sign(payload, getStateSecret(), { expiresIn: '5m' });
}

export function verifyOAuthState(state: string): OAuthStatePayload {
  const payload = jwt.verify(state, getStateSecret()) as OAuthStatePayload & { iat: number; exp: number };
  if (!payload.provider || !payload.nonce || !payload.codeVerifier) {
    throw new Error('State OAuth com payload incompleto.');
  }
  return payload;
}
