import 'server-only';
import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StudioError } from './errors';

export interface R2ObjectConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  privateBucket: string;
  publicBucket: string;
  /** HTTPS custom domain attached to the public bucket, without a path. */
  publicBaseUrl: string;
}

type R2Client = Pick<S3Client, 'send'>;
type Signer = typeof getSignedUrl;

function required(value: string | undefined, name: string): string {
  if (!value?.trim())
    throw new StudioError('storage_not_configured', `Configure ${name} for Image Studio.`, 503);
  return value.trim();
}

export function r2ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): R2ObjectConfig {
  return {
    accountId: required(env.R2_ACCOUNT_ID, 'R2_ACCOUNT_ID'),
    accessKeyId: required(env.R2_ACCESS_KEY_ID, 'R2_ACCESS_KEY_ID'),
    secretAccessKey: required(env.R2_SECRET_ACCESS_KEY, 'R2_SECRET_ACCESS_KEY'),
    privateBucket: required(env.R2_PRIVATE_BUCKET, 'R2_PRIVATE_BUCKET'),
    publicBucket: required(env.R2_PUBLIC_BUCKET, 'R2_PUBLIC_BUCKET'),
    publicBaseUrl: required(env.R2_PUBLIC_BASE_URL, 'R2_PUBLIC_BASE_URL'),
  };
}

function key(path: string): string {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..') || /[\u0000-\u001f\u007f]/.test(path))
    throw new StudioError('invalid_asset_path', 'The image path is invalid.', 400);
  return path;
}

function safeFilename(name: string): string {
  const basename = name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f";\r\n]/g, '_').trim();
  if (!basename || basename === '.' || basename === '..')
    throw new StudioError('invalid_download_name', 'The download filename is invalid.', 400);
  return basename;
}

function publicOrigin(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new StudioError('storage_not_configured', 'R2_PUBLIC_BASE_URL must be an HTTPS origin.', 503); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new StudioError('storage_not_configured', 'R2_PUBLIC_BASE_URL must be an HTTPS origin.', 503);
  return url.origin;
}

/** Object operations only. Database records and authorization remain with the repository. */
export class R2ObjectStore {
  private readonly client: R2Client;
  private readonly signingClient: S3Client;
  private readonly signer: Signer;
  private readonly publicOrigin: string;

  constructor(
    private readonly config: R2ObjectConfig = r2ConfigFromEnv(),
    dependencies: { client?: S3Client; signer?: Signer } = {},
  ) {
    if (!/^[a-f0-9]{32}$/i.test(config.accountId))
      throw new StudioError('storage_not_configured', 'R2_ACCOUNT_ID must be a Cloudflare account ID.', 503);
    if (config.privateBucket === config.publicBucket)
      throw new StudioError('storage_not_configured', 'R2 private and public buckets must differ.', 503);
    this.publicOrigin = publicOrigin(config.publicBaseUrl);
    this.signingClient = dependencies.client || new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
    this.client = this.signingClient;
    this.signer = dependencies.signer || getSignedUrl;
  }

  async checkReady(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.privateBucket }));
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.publicBucket }));
    } catch {
      throw new StudioError('storage_not_ready', 'R2 buckets or credentials are unavailable.', 503);
    }
  }

  async putObject(path: string, bytes: Buffer, mimeType: string, published = false): Promise<void> {
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: published ? this.config.publicBucket : this.config.privateBucket,
        Key: key(path), Body: bytes, ContentType: mimeType,
        CacheControl: published ? 'public, max-age=31536000, immutable' : 'private, max-age=3600',
      }));
    } catch (error) {
      if (error instanceof StudioError) throw error;
      throw new StudioError('asset_save_failed', 'The image could not be saved to storage.', 503);
    }
  }

  async getObject(path: string): Promise<Buffer> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.privateBucket, Key: key(path) }));
      if (!result.Body) throw new Error('Empty object body');
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      if (error instanceof StudioError) throw error;
      throw new StudioError('asset_unavailable', 'A selected reference could not be loaded. Remove or replace it before generating.', 422);
    }
  }

  async signObject(path: string, download?: string): Promise<string> {
    try {
      const responseContentDisposition = download
        ? `attachment; filename="${safeFilename(download)}"`
        : undefined;
      return await this.signer(this.signingClient, new GetObjectCommand({
        Bucket: this.config.privateBucket, Key: key(path), ResponseContentDisposition: responseContentDisposition,
      }), { expiresIn: 3600 });
    } catch (error) {
      if (error instanceof StudioError) throw error;
      throw new StudioError('preview_unavailable', 'Could not refresh the private image preview.', 503);
    }
  }

  async uploadTicket(path: string): Promise<{ signedUrl: string; token: string; path: string }> {
    try {
      const signedUrl = await this.signer(this.signingClient, new PutObjectCommand({
        Bucket: this.config.privateBucket, Key: key(path), IfNoneMatch: '*',
      }), { expiresIn: 600 });
      // R2 uses the signed URL itself as the upload credential; token is retained for repository compatibility.
      return { signedUrl, token: '', path };
    } catch (error) {
      if (error instanceof StudioError) throw error;
      throw new StudioError('upload_unavailable', 'Could not create a private upload.', 503);
    }
  }

  publicUrl(path: string): string {
    return `${this.publicOrigin}/${key(path).split('/').map(encodeURIComponent).join('/')}`;
  }
}
