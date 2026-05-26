/**
 * lib/r2.ts
 *
 * Cloudflare R2 (S3-compatible) storage layer for article cover/inline images.
 *
 * Замена Supabase Storage: egress R2 бесплатен, поэтому отдача обложек посетителям
 * больше не жжёт метрическую квоту (см. инцидент 2026-05-26 exceed_egress_quota).
 *
 * Ключи объектов ВСЕГДА начинаются с `article-images/`, чтобы публичные URL содержали
 * сегмент `/article-images/...` — от этого зависит классификация обложек в
 * scripts/generate-ai-covers.ts (`.includes('/article-images/ai-covers/')` и т.п.)
 * и lib/media-sanitizer.ts::isArticleImagesStorageUrl.
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

export const R2_KEY_PREFIX = 'article-images'

let client: S3Client | null = null

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim() ? value.trim() : undefined
}

export function isR2Configured(): boolean {
  return Boolean(
    readEnv('R2_ACCOUNT_ID') &&
      readEnv('R2_ACCESS_KEY_ID') &&
      readEnv('R2_SECRET_ACCESS_KEY') &&
      readEnv('R2_BUCKET') &&
      readEnv('R2_PUBLIC_BASE_URL'),
  )
}

export function r2PublicBaseUrl(): string {
  const base = readEnv('R2_PUBLIC_BASE_URL')
  if (!base) throw new Error('R2_PUBLIC_BASE_URL is not set')
  return base.replace(/\/$/, '')
}

function getClient(): S3Client {
  if (client) return client
  const accountId = readEnv('R2_ACCOUNT_ID')
  const accessKeyId = readEnv('R2_ACCESS_KEY_ID')
  const secretAccessKey = readEnv('R2_SECRET_ACCESS_KEY')
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 credentials are not fully configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)')
  }
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
  return client
}

/** Normalize a storage path into an R2 object key prefixed with `article-images/`. */
export function r2KeyFor(path: string): string {
  const clean = path.replace(/^\/+/, '')
  if (clean === R2_KEY_PREFIX || clean.startsWith(`${R2_KEY_PREFIX}/`)) return clean
  return `${R2_KEY_PREFIX}/${clean}`
}

export function r2PublicUrl(key: string): string {
  return `${r2PublicBaseUrl()}/${r2KeyFor(key)}`
}

/**
 * Upload a buffer to R2 and return its public URL.
 * `path` may be given with or without the `article-images/` prefix.
 */
export async function uploadToR2(
  path: string,
  body: Buffer | Uint8Array,
  opts: { contentType: string; cacheControl?: string } ,
): Promise<string> {
  const bucket = readEnv('R2_BUCKET')
  if (!bucket) throw new Error('R2_BUCKET is not set')
  const key = r2KeyFor(path)
  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: opts.contentType,
      CacheControl: opts.cacheControl ?? '31536000',
    }),
  )
  return `${r2PublicBaseUrl()}/${key}`
}
