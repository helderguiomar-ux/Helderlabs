import jwt from 'jsonwebtoken';

// "Sign in with Apple" não aceita um client_secret fixo — tem de ser um JWT
// ES256 assinado com a chave privada .p8 gerada no Apple Developer Portal,
// válido no máximo 6 meses (aqui geramos um de curta duração, a cada
// pedido, o que é mais simples e mais seguro do que cachear um de 6 meses).
//
// Env vars necessárias (todas do Apple Developer Portal, Certificates,
// Identifiers & Profiles -> Keys):
//   APPLE_TEAM_ID     — Team ID da conta de developer (10 caracteres)
//   APPLE_KEY_ID       — Key ID da chave "Sign in with Apple" criada
//   APPLE_CLIENT_ID    — Services ID (não o App ID) registado para este uso
//   APPLE_PRIVATE_KEY  — conteúdo do ficheiro .p8 transferido ao criar a
//                         chave, com as quebras de linha como "\n" literais
//                         dentro da string do .env (ver .env.example)
export function buildAppleClientSecret(): string {
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const clientId = process.env.APPLE_CLIENT_ID;
  const privateKeyRaw = process.env.APPLE_PRIVATE_KEY;

  if (!teamId || !keyId || !clientId || !privateKeyRaw) {
    throw new Error(
      'Login com Apple não está configurado — faltam APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_CLIENT_ID / APPLE_PRIVATE_KEY no .env.'
    );
  }

  // No .env, quebras de linha reais partiriam o valor — por isso o .p8 é
  // guardado com "\n" literais e convertido aqui de volta para quebras de
  // linha reais (formato PEM exige-o).
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      iss: teamId,
      iat: now,
      exp: now + 60 * 5, // 5 minutos chega — é gerado a cada troca de código, não precisa de durar mais
      aud: 'https://appleid.apple.com',
      sub: clientId
    },
    privateKey,
    {
      algorithm: 'ES256',
      keyid: keyId
    }
  );
}
