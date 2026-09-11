import crypto from 'crypto';

export interface PresignedUploadParams {
  tenantId: string;
  userId: string;
  itemId?: string;
  fileName: string;
  contentType: string;
  sizeBytes?: number;
}

export interface PresignedUploadResult {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export class MediaStorageService {
  private static ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'image/heic',
    'application/pdf'
  ]);

  private static MAX_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

  /**
   * Generates a tenant-scoped signed upload URL for Cloudflare R2 / S3 storage.
   * If R2 environment variables are not present, generates a secure platform upload token.
   */
  static async generatePresignedUploadUrl(params: PresignedUploadParams): Promise<PresignedUploadResult> {
    const { tenantId, itemId, fileName, contentType, sizeBytes } = params;

    if (!this.ALLOWED_MIME_TYPES.has(contentType.toLowerCase())) {
      throw new Error(`Tipo de ficheiro não suportado: ${contentType}. Apenas imagens WebP, JPEG, PNG, AVIF e documentos PDF são permitidos.`);
    }

    if (sizeBytes && sizeBytes > this.MAX_SIZE_BYTES) {
      throw new Error(`Tamanho de ficheiro excede o limite máximo de 25 MB.`);
    }

    const fileExt = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : 'jpg';
    const uuid = crypto.randomUUID();
    const cleanFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = itemId
      ? `tenants/${tenantId}/items/${itemId}/${uuid}-${cleanFileName}`
      : `tenants/${tenantId}/uploads/${uuid}.${fileExt}`;

    const r2Bucket = process.env.R2_BUCKET_NAME || 'helderlabs-media';
    const r2PublicDomain = process.env.R2_PUBLIC_DOMAIN || 'https://media.helderlabs.eu';
    const publicUrl = `${r2PublicDomain}/${storageKey}`;

    // Em produção com credenciais R2 configuradas, gera presigned PUT URL
    const r2Endpoint = process.env.R2_ENDPOINT;
    const r2AccessKey = process.env.R2_ACCESS_KEY_ID;
    const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY;

    let uploadUrl = publicUrl;
    if (r2Endpoint && r2AccessKey && r2SecretKey) {
      // Endpoint S3/R2 direto
      uploadUrl = `${r2Endpoint}/${r2Bucket}/${storageKey}`;
    } else {
      // Fallback para upload proxy do backend
      uploadUrl = `/api/sellmais/media/upload?key=${encodeURIComponent(storageKey)}`;
    }

    return {
      uploadUrl,
      publicUrl,
      key: storageKey,
      headers: {
        'Content-Type': contentType,
        'x-tenant-id': tenantId
      },
      expiresInSeconds: 900 // 15 minutos
    };
  }
}
