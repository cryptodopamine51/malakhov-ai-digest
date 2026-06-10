/**
 * pipeline/cover-mirror.ts
 *
 * Зеркалирование внешних cover-картинок в R2 при публикации статьи.
 *
 * Зачем: hotlink-обложки с CDN источников (TechCrunch/Verge/Habr/...) отдаются
 * посетителям полноразмерными (до ~1 MB), потому что Vercel image-оптимизатор
 * выключен (`images.unoptimized=true`, лимит трансформаций Hobby — см.
 * next.config.mjs). Зеркало в R2 даёт WebP 1200w + варианты `-400`/`-800`,
 * которые SafeImage отдаёт нативным `<img srcset>` (NEXT_PUBLIC_R2_IMAGE_VARIANTS=on),
 * полностью минуя `/_next/image`. Заодно убирает зависимость от чужих CDN
 * (битые hotlink'и, rate-limit, протухшие URL).
 *
 * Контракт пути: ключи начинаются с `article-images/` — публичный URL содержит
 * `/article-images/...`, что требуется для isArticleImagesStorageUrl /
 * isR2ImageUrl (srcset-варианты). Подпапка `mirrored-covers` НЕ матчится
 * паттерном `(ai|template|stock)-covers`, поэтому scorer и needsAiCover
 * продолжают считать такую обложку «настоящей» обложкой источника.
 *
 * Отказоустойчивость: любая ошибка (нет R2-конфига, download timeout, не
 * картинка, слишком большая) — мягкий fallback, возвращаем null и статья
 * остаётся с исходным внешним URL (текущее поведение).
 */

import sharp from 'sharp'
import { isR2Configured } from '../lib/r2'
import { uploadWebpWithVariants } from '../lib/r2-images'
import { isR2ImageUrl, COVER_BASE_WIDTH } from '../lib/image-variants'
import { isArticleImagesStorageUrl } from '../lib/media-sanitizer'

const DOWNLOAD_TIMEOUT_MS = 15_000
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024
const WEBP_QUALITY = 82
const WEBP_EFFORT = 4

/** Внешний https-URL, который имеет смысл зеркалить (не R2, не legacy storage, не локальный путь). */
export function shouldMirrorCover(url: string | null | undefined): url is string {
  if (!url) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false // относительные пути (/images/...) — локальные ассеты
  }
  if (parsed.protocol !== 'https:') return false
  if (isR2ImageUrl(url)) return false
  if (isArticleImagesStorageUrl(url)) return false
  return true
}

export function mirroredCoverKey(articleId: string): string {
  return `article-images/mirrored-covers/${articleId}.webp`
}

async function downloadImage(url: string): Promise<Buffer | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MalakhovAIDigest/1.0)' },
      redirect: 'follow',
    })
    if (!res.ok) return null
    const contentLength = Number(res.headers.get('content-length') ?? '0')
    if (contentLength > MAX_DOWNLOAD_BYTES) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > MAX_DOWNLOAD_BYTES) return null
    return buf
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Скачивает внешнюю обложку, конвертирует в WebP 1200w и заливает в R2 с
 * вариантами. Возвращает публичный R2-URL или null (мягкий fallback).
 */
export async function mirrorCoverToR2(
  articleId: string,
  coverUrl: string,
  log: (msg: string) => void = () => {},
): Promise<string | null> {
  if (!isR2Configured()) return null
  if (!shouldMirrorCover(coverUrl)) return null

  const raw = await downloadImage(coverUrl)
  if (!raw) {
    log(`cover mirror: download failed for ${articleId} (${coverUrl})`)
    return null
  }

  let webp: Buffer
  try {
    const img = sharp(raw, { failOn: 'error' }).rotate()
    const meta = await img.metadata()
    // Слишком мелкие картинки — не обложка, оставляем источнику.
    if ((meta.width ?? 0) < 320 || (meta.height ?? 0) < 180) {
      log(`cover mirror: too small (${meta.width}x${meta.height}) for ${articleId}`)
      return null
    }
    webp = await img
      .resize({ width: COVER_BASE_WIDTH, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY, effort: WEBP_EFFORT })
      .toBuffer()
  } catch (err) {
    log(`cover mirror: not an image for ${articleId}: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }

  try {
    const publicUrl = await uploadWebpWithVariants(mirroredCoverKey(articleId), webp, {
      contentType: 'image/webp',
    })
    log(`cover mirror: ${articleId} → ${publicUrl} (${Math.round(webp.byteLength / 1024)} KB)`)
    return publicUrl
  } catch (err) {
    log(`cover mirror: upload failed for ${articleId}: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
