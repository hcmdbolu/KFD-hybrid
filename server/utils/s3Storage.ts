import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const S3_ENDPOINT = process.env.S3_ENDPOINT || process.env.R2_ENDPOINT;
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || process.env.R2_BUCKET_NAME || 'kiid-pos-media';
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'auto';
const S3_PUBLIC_DOMAIN = process.env.S3_PUBLIC_DOMAIN || process.env.R2_PUBLIC_DOMAIN;

let s3ClientInstance: S3Client | null = null;

export function isS3Configured(): boolean {
  return Boolean(S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY && S3_BUCKET_NAME);
}

export function getS3Client(): S3Client | null {
  if (!isS3Configured()) {
    return null;
  }
  if (!s3ClientInstance) {
    s3ClientInstance = new S3Client({
      region: S3_REGION,
      endpoint: S3_ENDPOINT || undefined,
      credentials: {
        accessKeyId: S3_ACCESS_KEY_ID!,
        secretAccessKey: S3_SECRET_ACCESS_KEY!,
      },
      forcePathStyle: true,
    });
  }
  return s3ClientInstance;
}

/**
 * Uploads a buffer directly to Cloudflare R2 / AWS S3 cloud storage.
 * Returns the public CDN / bucket URL.
 */
export async function uploadToCloudStorage(params: {
  buffer: Buffer;
  key: string;
  contentType: string;
  metadata?: Record<string, string>;
}): Promise<{ url: string; key: string; bucket: string }> {
  const client = getS3Client();
  if (!client) {
    throw new Error('Cloud object storage (S3/R2) is not configured in environment variables.');
  }

  const cleanKey = params.key.replace(/^\/+/, '');
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key: cleanKey,
    Body: params.buffer,
    ContentType: params.contentType,
    Metadata: params.metadata,
  });

  await client.send(command);

  let publicUrl: string;
  if (S3_PUBLIC_DOMAIN) {
    const base = S3_PUBLIC_DOMAIN.replace(/\/+$/, '');
    publicUrl = `${base}/${cleanKey}`;
  } else if (S3_ENDPOINT) {
    const base = S3_ENDPOINT.replace(/\/+$/, '');
    publicUrl = `${base}/${S3_BUCKET_NAME}/${cleanKey}`;
  } else {
    publicUrl = `https://${S3_BUCKET_NAME}.s3.${S3_REGION}.amazonaws.com/${cleanKey}`;
  }

  return {
    url: publicUrl,
    key: cleanKey,
    bucket: S3_BUCKET_NAME,
  };
}

