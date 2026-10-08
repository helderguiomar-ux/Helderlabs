import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError } from '../../../utils/errors';

// =============================================================================
// Cifra de credenciais de email (AES-256-GCM)
//
// Formato guardado na base de dados:   v1:<iv>:<tag>:<ciphertext>   (base64url)
//
// - A chave vem de EMAIL_CREDENTIALS_KEY (32 bytes, em base64). Nunca do
//   JWT_SECRET: rodar o segredo de sessão não pode tornar as passwords SMTP
//   ilegíveis, nem o contrário.
// - O prefixo de versão permite trocar de chave no futuro sem migração
//   destrutiva (v2 com outra chave, v1 continua legível durante a transição).
// - GCM autentica o conteúdo: uma password adulterada na base de dados falha
//   a decifrar em vez de produzir lixo silencioso.
// - O tenantId entra como "additional authenticated data": uma password
//   copiada para a linha de outro tenant deixa de decifrar.
// =============================================================================

const VERSION = 'v1';
const IV_BYTES = 12;

function loadKey(): Buffer {
  const raw = process.env.EMAIL_CREDENTIALS_KEY;
  if (!raw) {
    throw new AppError(
      'EMAIL_CRYPTO_NOT_CONFIGURED',
      'A plataforma ainda não tem a chave de cifra de credenciais (EMAIL_CREDENTIALS_KEY). Contacte o administrador.',
      503
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new AppError(
      'EMAIL_CRYPTO_INVALID_KEY',
      'EMAIL_CREDENTIALS_KEY tem de ter exatamente 32 bytes codificados em base64.',
      503
    );
  }
  return key;
}

export function isCredentialCipherConfigured(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptCredential(plain: string, tenantId: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(tenantId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

export function decryptCredential(stored: string, tenantId: string): string {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new AppError('EMAIL_CRYPTO_FORMAT', 'Credencial guardada num formato desconhecido.', 500);
  }
  const key = loadKey();
  const [, ivB64, tagB64, dataB64] = parts;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
    decipher.setAAD(Buffer.from(tenantId, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new AppError(
      'EMAIL_CRYPTO_DECRYPT_FAILED',
      'Não foi possível ler a password guardada. Volte a introduzi-la nas definições de email.',
      500
    );
  }
}
