// Configuração dos três providers de login social. Os três seguem o mesmo
// desenho (OAuth 2.0 Authorization Code + OpenID Connect id_token), por
// isso o resto do fluxo (start/callback, verificação de assinatura) é
// genérico — só isto é que varia por provider.
//
// IMPORTANTE (limitação a comunicar ao utilizador, não é bug): a Apple exige
// um `redirect_uri` HTTPS num domínio verificado — "Sign in with Apple" NÃO
// funciona contra http://localhost. Dá para configurar e testar Google e
// Microsoft em localhost sem problema; a Apple só é testável depois de
// existir um domínio público (ex.: já em staging/produção no Vercel).

export type OAuthProviderName = 'google' | 'microsoft' | 'apple';

export interface OAuthProviderConfig {
  name: OAuthProviderName;
  displayName: string;
  authorizeUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  issuer: string | RegExp; // Microsoft usa endpoint "common" — o issuer real inclui o tenant id, por isso aceitamos um padrão.
  scope: string;
  clientId: () => string;
  redirectUri: () => string;
  // Google/Microsoft: client_secret estático (do .env). Apple: gerado por
  // pedido (JWT assinado ES256) — ver appleClientSecret.ts.
  clientSecret: () => Promise<string> | string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} não está definido no .env — necessário para o login social.`);
  }
  return value;
}

export const OAUTH_PROVIDERS: Record<OAuthProviderName, OAuthProviderConfig> = {
  google: {
    name: 'google',
    displayName: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    issuer: 'https://accounts.google.com',
    scope: 'openid email profile',
    clientId: () => requireEnv('GOOGLE_CLIENT_ID'),
    redirectUri: () => requireEnv('GOOGLE_REDIRECT_URI'),
    clientSecret: () => requireEnv('GOOGLE_CLIENT_SECRET')
  },
  microsoft: {
    name: 'microsoft',
    displayName: 'Microsoft',
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    jwksUrl: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    // Endpoint "common" (multi-tenant, contas pessoais + organizacionais) —
    // o issuer real é "https://login.microsoftonline.com/{tid}/v2.0", por
    // isso validamos o prefixo em vez de um valor exato.
    issuer: /^https:\/\/login\.microsoftonline\.com\/[^/]+\/v2\.0$/,
    scope: 'openid email profile',
    clientId: () => requireEnv('MICROSOFT_CLIENT_ID'),
    redirectUri: () => requireEnv('MICROSOFT_REDIRECT_URI'),
    clientSecret: () => requireEnv('MICROSOFT_CLIENT_SECRET')
  },
  apple: {
    name: 'apple',
    displayName: 'Apple',
    authorizeUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    jwksUrl: 'https://appleid.apple.com/auth/keys',
    issuer: 'https://appleid.apple.com',
    scope: 'openid email',
    clientId: () => requireEnv('APPLE_CLIENT_ID'),
    redirectUri: () => requireEnv('APPLE_REDIRECT_URI'),
    // A Apple não usa client_secret estático — é um JWT ES256 assinado por
    // pedido com a chave privada da conta de developer. Import feito aqui
    // dentro (não no topo do ficheiro) só para não obrigar quem não usa
    // Apple a ter as env vars da Apple definidas.
    clientSecret: async () => {
      const { buildAppleClientSecret } = await import('./appleClientSecret');
      return buildAppleClientSecret();
    }
  }
};

export function getProviderConfig(name: string): OAuthProviderConfig {
  if (name !== 'google' && name !== 'microsoft' && name !== 'apple') {
    throw new Error(`Provider de login social desconhecido: "${name}".`);
  }
  return OAUTH_PROVIDERS[name];
}
