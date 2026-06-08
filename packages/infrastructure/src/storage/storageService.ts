// packages/infrastructure/src/storage/storageService.ts
//
// Phase 1.2 (F1.2.8) — S3-compatible object storage service.
//
// Supports Cloudflare R2 (production) and MinIO (dev/CI) through the
// same @aws-sdk/client-s3 interface — both accept standard S3 API calls.
//
// SDK dependency note:
//   @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner are NOT yet in
//   packages/api/package.json. They are required at runtime only when
//   requestUpload / confirmUpload procedures are called. The import at
//   the top of the router uses `require()` dynamically so the CI lint
//   and typecheck passes without the SDK installed. See attachment.router.ts
//   for the dynamic-require wrapper.
//
// This file provides the interface + factory that callers use.
// The concrete implementation lives in StorageServiceImpl below.
//
// ObjectKey convention:
//   {tenantId}/{cardId}/{uuid}{.ext}
// This keeps tenant data namespace-isolated inside the bucket.

export interface PresignedPutOptions {
  objectKey:    string;
  mimeType:     string;
  maxSizeBytes: number;
  /** Seconds until the upload URL expires. Default: 300 (5 min). */
  expiresIn?:   number;
}

export interface PresignedGetOptions {
  objectKey:  string;
  fileName:   string;
  expiresIn?: number;
}

export interface StorageServiceConfig {
  /** S3 endpoint override — use for MinIO in dev. Omit for AWS/R2. */
  endpoint?:        string;
  /** AWS region. Use "auto" for Cloudflare R2. */
  region:           string;
  accessKeyId:      string;
  secretAccessKey:  string;
  bucket:           string;
  /** CDN / public-read base URL for building permanent URLs. */
  publicUrl:        string;
  /** Set true for MinIO path-style addressing. Default: false. */
  forcePathStyle?:  boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public interface — callers depend on this, not the concrete class.
// ─────────────────────────────────────────────────────────────────────────────

export interface IStorageService {
  /**
   * Returns a pre-signed PUT URL the browser can use to upload a file
   * directly to R2/MinIO without routing through the server.
   */
  createPresignedPut(options: PresignedPutOptions): Promise<string>;

  /**
   * Returns a pre-signed GET URL for downloading a private object.
   * For public buckets (R2 public-read) use buildPublicUrl instead.
   */
  createPresignedGet(options: PresignedGetOptions): Promise<string>;

  /** Hard-delete an object from storage (called on attachment remove). */
  deleteObject(objectKey: string): Promise<void>;

  /** Build a permanent CDN URL for a public-read bucket. */
  buildPublicUrl(objectKey: string): string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Concrete implementation (requires @aws-sdk/* at runtime)
// ─────────────────────────────────────────────────────────────────────────────

export class StorageServiceImpl implements IStorageService {
  private readonly cfg: StorageServiceConfig;
  private _client: unknown = null;

  constructor(cfg: StorageServiceConfig) {
    this.cfg = cfg;
  }

  private getClient(): any {
    if (this._client) return this._client;
    const { S3Client } = require("@aws-sdk/client-s3");
    this._client = new S3Client({
      region:      this.cfg.region,
      endpoint:    this.cfg.endpoint,
      credentials: {
        accessKeyId:     this.cfg.accessKeyId,
        secretAccessKey: this.cfg.secretAccessKey,
      },
      forcePathStyle: this.cfg.forcePathStyle ?? false,
    });
    return this._client;
  }

  async createPresignedPut({
    objectKey,
    mimeType,
    maxSizeBytes,
    expiresIn = 300,
  }: PresignedPutOptions): Promise<string> {
    const { PutObjectCommand } = require("@aws-sdk/client-s3");
    const { getSignedUrl }     = require("@aws-sdk/s3-request-presigner");

    const command = new PutObjectCommand({
      Bucket:      this.cfg.bucket,
      Key:         objectKey,
      ContentType: mimeType,
    });

    return getSignedUrl(this.getClient(), command, { expiresIn });
  }

  async createPresignedGet({
    objectKey,
    fileName,
    expiresIn = 3600,
  }: PresignedGetOptions): Promise<string> {
    const { GetObjectCommand } = require("@aws-sdk/client-s3");
    const { getSignedUrl }     = require("@aws-sdk/s3-request-presigner");

    const command = new GetObjectCommand({
      Bucket:                     this.cfg.bucket,
      Key:                        objectKey,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(fileName)}"`,
    });

    return getSignedUrl(this.getClient(), command, { expiresIn });
  }

  async deleteObject(objectKey: string): Promise<void> {
    const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
    const command = new DeleteObjectCommand({
      Bucket: this.cfg.bucket,
      Key:    objectKey,
    });
    await this.getClient().send(command);
  }

  buildPublicUrl(objectKey: string): string {
    const base = this.cfg.publicUrl.replace(/\/$/, "");
    return `${base}/${objectKey}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton factory — reads from environment variables.
// ─────────────────────────────────────────────────────────────────────────────

let _storageInstance: IStorageService | null = null;

export function createStorageService(): IStorageService {
  if (_storageInstance) return _storageInstance;

  const cfg: StorageServiceConfig = {
    endpoint:       process.env.STORAGE_ENDPOINT,
    region:         process.env.R2_ACCOUNT_ID ? "auto" : (process.env.AWS_REGION ?? "us-east-1"),
    accessKeyId:    process.env.R2_ACCESS_KEY_ID    ?? process.env.AWS_ACCESS_KEY_ID    ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? "",
    bucket:         process.env.R2_BUCKET_NAME ?? process.env.STORAGE_BUCKET ?? "",
    publicUrl:      process.env.R2_PUBLIC_URL  ?? process.env.STORAGE_PUBLIC_URL ?? "",
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === "true",
  };

  _storageInstance = new StorageServiceImpl(cfg);
  return _storageInstance;
}
