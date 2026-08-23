import { getProviderConfig, type OAuthProviderName } from './providers';
import { computeCodeChallenge, generateCodeVerifier, generateNonce } from './pkce';
import { signOAuthState, verifyOAuthState } from './oauthState';
import { verifyIdToken } from './verifyIdToken';

export class OAuthStateError extends Error {
  constructor(message = 'Pedido de login social inválido ou expirado — tenta novamente.') {
    super(message);
  }
}

export class OAuthTokenExchangeError extends Error {}

/**
 * Constrói o URL de autorização para onde o browser deve ser redirecionado
 * (GET /api/auth/oauth/:provider/start). O `state` devolvido carrega tudo o
 * que precisamos de recuperar no callback (ver oauthState.ts).
 */
export function buildAuthorizeUrl(providerName: OAuthProviderName): string {
  const provider = getProviderConfig(providerName);
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);
  const nonce = generateNonce();

  const state = signOAuthState({ provider: providerName, nonce, codeVerifier });

  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('client_id', provider.clientId());
  url.searchParams.set('redirect_uri', provider.redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', provider.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');

  if (providerName === 'apple') {
    // A Apple só reenvia o "name" do utilizador (não repete email/perfil em
    // pedidos seguintes) e exige response_mode=form_post quando se pede
    // scope "name" — aqui só pedimos "openid email", por isso query chega.
    url.searchParams.set('response_mode', 'query');
  }

  return url.toString();
}

interface TokenResponse {
  id_token?: string;
  access_token?: string;
  error?: string;
  error_description?: string;
}

async function exchangeCodeForIdToken(providerName: OAuthProviderName, code: string, codeVerifier: string): Promise<string> {
  const provider = getProviderConfig(providerName);
  const clientSecret = await provider.clientSecret();

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: provider.redirectUri(),
    client_id: provider.clientId(),
    client_secret: clientSecret,
    code_verifier: codeVerifier
  });

  const response = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  const json = (await response.json().catch(() => ({}))) as TokenResponse;

  if (!response.ok || !json.id_token) {
    throw new OAuthTokenExchangeError(
      `Troca de código falhou junto do provider "${providerName}": ${json.error_description || json.error || response.status}`
    );
  }

  return json.id_token;
}

export interface OAuthLoginResult {
  provider: OAuthProviderName;
  subject: string;
  email: string;
  emailVerified: boolean;
}

/**
 * GET /api/auth/oauth/:provider/callback — troca o `code` por um id_token
 * junto do provider, verifica a assinatura/issuer/audience/nonce (nunca
 * confia no id_token só porque veio do provider certo) e devolve a
 * identidade verificada. Quem decide o que fazer com essa identidade
 * (encontrar/criar o User, promover a SUPER_ADMIN, emitir o nosso próprio
 * JWT) é o AuthService — este módulo só fala o protocolo OAuth.
 */
export async function handleOAuthCallback(providerName: OAuthProviderName, code: string, state: string): Promise<OAuthLoginResult> {
  let statePayload;
  try {
    statePayload = verifyOAuthState(state);
  } catch {
    throw new OAuthStateError();
  }

  if (statePayload.provider !== providerName) {
    throw new OAuthStateError('O provider do callback não corresponde ao pedido original.');
  }

  const idToken = await exchangeCodeForIdToken(providerName, code, statePayload.codeVerifier);
  const identity = await verifyIdToken(getProviderConfig(providerName), idToken);

  if (identity.nonce !== statePayload.nonce) {
    throw new OAuthStateError('Nonce do id_token não corresponde ao pedido original (possível repetição de pedido).');
  }

  return {
    provider: providerName,
    subject: identity.subject,
    email: identity.email,
    emailVerified: identity.emailVerified
  };
}
