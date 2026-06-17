/**
 * Pure helpers for local guide image variants in `public/images/guides`.
 *
 * Guide images are static files, so `next/image` cannot generate adaptive
 * variants while `images.unoptimized=true`. The build-time `images:prep`
 * script writes these siblings and render code emits native `srcset`.
 */

export const GUIDE_IMAGE_BASE_WIDTH = 1200
export const GUIDE_IMAGE_VARIANT_WIDTHS = [480, 768] as const

function insertWidthSuffix(input: string, width: number): string {
  return input.replace(/\.webp$/i, `-${width}.webp`)
}

export function localImageVariantPathFor(path: string, width: number): string {
  return insertWidthSuffix(path, width)
}

export function isLocalGuideImageSrc(src: string | null | undefined): src is string {
  return typeof src === 'string' && src.startsWith('/images/guides/') && /\.webp$/i.test(src)
}

export function localGuideImageSrcSet(
  src: string | null | undefined,
  baseWidth = GUIDE_IMAGE_BASE_WIDTH,
): string | null {
  if (!isLocalGuideImageSrc(src)) return null
  const parts = GUIDE_IMAGE_VARIANT_WIDTHS.map((width) => {
    return `${localImageVariantPathFor(src, width)} ${width}w`
  })
  parts.push(`${src} ${baseWidth}w`)
  return parts.join(', ')
}

export function variantHeightFor(width: number, baseWidth: number, baseHeight: number): number {
  return Math.round((baseHeight / baseWidth) * width)
}
