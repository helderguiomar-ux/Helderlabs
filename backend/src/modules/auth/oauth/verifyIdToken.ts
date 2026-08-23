import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { OAuthProviderConfig } from './providers';

// Cache dos JWKSets por provider — createRemoteJWKSet já faz cache/retry
// interno das chaves públicas, só não queremos recriar o objeto (e portanto
// perder esse cache) a cada pedido.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(provider: OAuthProviderConfig) {
  let jwks = jwksCache.get(provider.name);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(provider.jwksUrl));
    jwksCache.set(provider.name, jwks);
  }
  return jwks;
}

export interface VerifiedIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
  nonce: string | undefined;
}

/**
 * Verifica a assinatura, o issuer, a audience (client_id) e a validade do
 * id_token devolvido pelo provider — nunca confiamos num id_token só porque
 * "veio de lá"; é isto que garante que ninguém consegue forjar um email
 * (incluindo o de super admin) sem a chave privada do provider.
 */
export async function verifyIdToken(provider: OAuthProviderConfig, idToken: string): Promise<VerifiedIdentity> {
  // `jose` só aceita `issuer` como string | string[] — a Microsoft usa o
  // endpoint multi-tenant "common", cujo issuer real inclui o tenant id
  // (ex.: https://login.microsoftonline.com/<tid>/v2.0), por isso esse
  // provider é configurado com um RegExp e validado manualmente a seguir,
  // em vez de ser passado a jwtVerify.
  const { payload } = await jwtVerify(idToken, getJwks(provider), {
    issuer: typeof provider.issuer === 'string' ? provider.issuer : undefined,
    audience: provider.clientId()
  });

  if (provider.issuer instanceof RegExp) {
    const iss = typeof payload.iss === 'string' ? payload.iss : '';
    if (!provider.issuer.test(iss)) {
      throw new Error(`Issuer inesperado no id_token da ${provider.displayName}: "${iss}".`);
    }
  }

  const email = typeof payload.email === 'string' ? payload.email : undefined;
  if (!email) {
    throw new Error(`O id_token da ${provider.displayName} não incluiu um email — verifica o scope pedido.`);
  }

  // Google usa "email_verified" (boolean). Microsoft não garante este claim
  // (contas organizacionais são consideradas verificadas por definição — a
  // própria organização já validou o email); tratamos a ausência do claim
  // como "verificado" apenas para Microsoft/Apple, nunca para Google.
  let emailVerified = true;
  if (provider.name === 'google') {
    emailVerified = payload.email_verified === true || payload.email_verified === 'true';
  } else if (typeof payload.email_verified !== 'undefined') {
    emailVerified = payload.email_verified === true || payload.email_verified === 'true';
  }

  return {
    subject: String(payload.sub),
    email: email.toLowerCase(),
    emailVerified,
    nonce: typeof payload.nonce === 'string' ? payload.nonce : undefined
  };
}
