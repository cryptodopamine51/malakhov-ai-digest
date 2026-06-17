import {
  GUIDE_IMAGE_VARIANT_WIDTHS,
  isLocalGuideImageSrc,
  localGuideImageSrcSet,
  localImageVariantPathFor,
} from '../../lib/local-image-variants'

type ResponsiveLocalImageProps = {
  src: string
  alt: string
  width: number
  height: number
  sizes: string
  className?: string
  loading?: 'lazy' | 'eager'
  priority?: boolean
}

export default function ResponsiveLocalImage({
  src,
  alt,
  width,
  height,
  sizes,
  className,
  loading = 'lazy',
  priority = false,
}: ResponsiveLocalImageProps) {
  const srcSet = localGuideImageSrcSet(src, width)
  const mobileSrcSet = isLocalGuideImageSrc(src)
    ? GUIDE_IMAGE_VARIANT_WIDTHS.map((variantWidth) => {
        return `${localImageVariantPathFor(src, variantWidth)} ${variantWidth}w`
      }).join(', ')
    : null

  return (
    <picture>
      {mobileSrcSet && (
        <source
          media="(max-width: 768px)"
          srcSet={mobileSrcSet}
          sizes={sizes}
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        srcSet={srcSet ?? undefined}
        sizes={srcSet ? sizes : undefined}
        alt={alt}
        width={width}
        height={height}
        className={className}
        loading={priority ? 'eager' : loading}
        fetchPriority={priority ? 'high' : undefined}
        decoding="async"
      />
    </picture>
  )
}
