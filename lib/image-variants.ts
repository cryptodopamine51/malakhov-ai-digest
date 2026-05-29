/**
 * lib/image-variants.ts
 *
 * Pure, client-safe helpers for R2 cover image variants.
 * NO `sharp` / `@aws-sdk` imports — safe to import from client components.
 *
 * Обложки хранятся в R2 одним base WebP (ширина 1200). Для адаптивной раздачи
 * при загрузке дополнительно генерятся уменьшенные WebP-варианты (`-400`/`-800`,
 * см. lib/r2-images.ts), а в рендере они отдаются нативным `<img srcset>`. Это
 * обходит лимит трансформаций Vercel `/_next/image` (HTTP 402 на Hobby tier),
 * из-за которого включён `images.unoptimized` в next.config.mjs.
 *
 * Список ширин здесь — единственный источник истины и для аплоада, и для
 * рендера: forward-upload и backfill генерят ровно COVER_VARIANT_WIDTHS, а
 * srcset перечисляет ровно их же. Поэтому перед включением фичи
 * (NEXT_PUBLIC_R2_IMAGE_VARIANTS=on) все R2-обложки обязаны иметь варианты —
 * иначе срабатывает 404 на выбранный браузером кандидат. Полный прогон
 * scripts/backfill-cover-variants.ts закрывает этот инвариант.
 */

/** Ширина base-обложки (исходный WebP, который уже лежит в R2). */
export const COVER_BASE_WIDTH = 1200

/** Уменьшенные ширины, генерируемые рядом с base. Меняешь здесь — перегенери все варианты. */
export const COVER_VARIANT_WIDTHS = [400, 800] as const

function insertWidthSuffix(input: string, width: number): string {
  // ".../slug-123.webp" → ".../slug-123-400.webp"
  return input.replace(/\.webp$/i, `-${width}.webp`)
}

/** Variant object key (storage path) для заданной ширины. */
export function variantKeyFor(key: string, width: number): string {
  return insertWidthSuffix(key, width)
}

/** Variant public URL для заданной ширины. */
export function variantUrlFor(url: string, width: number): string {
  return insertWidthSuffix(url, width)
}

/**
 * True, если `url` — наша R2-обложка (host `*.r2.dev` или NEXT_PUBLIC_R2_PUBLIC_BASE_URL,
 * путь под `/article-images/`, расширение `.webp`). Только у таких есть `-400`/`-800`.
 */
export function isR2ImageUrl(url: string | null | undefined): url is string {
  if (!url) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  if (!parsed.pathname.includes('/article-images/')) return false
  if (!/\.webp$/i.test(parsed.pathname)) return false

  const host = parsed.host.toLowerCase()
  if (host.endsWith('.r2.dev')) return true

  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL
  if (base) {
    try {
      if (host === new URL(base).host.toLowerCase()) return true
    } catch {
      /* malformed env — ignore */
    }
  }
  return false
}

/**
 * Responsive srcset для R2-обложки, либо null если `url` не наша R2-обложка.
 * Формат: "<url-400> 400w, <url-800> 800w, <base url> 1200w".
 */
export function r2VariantSrcSet(url: string | null | undefined): string | null {
  if (!isR2ImageUrl(url)) return null
  const parts = COVER_VARIANT_WIDTHS.map((w) => `${variantUrlFor(url, w)} ${w}w`)
  parts.push(`${url} ${COVER_BASE_WIDTH}w`)
  return parts.join(', ')
}
