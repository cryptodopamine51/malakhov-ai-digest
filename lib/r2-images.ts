/**
 * lib/r2-images.ts
 *
 * Server-only: генерация и заливка R2 cover-вариантов через sharp.
 * НЕ импортировать из client-компонентов — тащит sharp + @aws-sdk.
 *
 * Контракт ширин — в lib/image-variants.ts (COVER_VARIANT_WIDTHS). Pure-хелперы
 * оттуда (variantKeyFor) переиспользуются здесь, чтобы имена объектов при
 * аплоаде совпадали с URL'ами, которые строит srcset на клиенте.
 */

import sharp from 'sharp'
import { uploadToR2 } from './r2'
import { COVER_VARIANT_WIDTHS, variantKeyFor } from './image-variants'

/**
 * Заливает base WebP-обложку + уменьшенные WebP-варианты (`-400`/`-800`) в R2.
 * Варианты ресайзятся вниз из переданного base-буфера (без увеличения).
 * Возвращает public URL base-обложки — drop-in замена uploadToR2 для cover-аплоадов.
 */
export async function uploadWebpWithVariants(
  path: string,
  baseWebp: Buffer,
  opts: { contentType: string; cacheControl?: string },
): Promise<string> {
  const cacheControl = opts.cacheControl ?? '31536000'
  const baseUrl = await uploadToR2(path, baseWebp, { contentType: opts.contentType, cacheControl })

  for (const width of COVER_VARIANT_WIDTHS) {
    const resized = await sharp(baseWebp)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer()
    await uploadToR2(variantKeyFor(path, width), resized, {
      contentType: 'image/webp',
      cacheControl,
    })
  }

  return baseUrl
}
