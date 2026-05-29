'use client'

import Image, { type ImageProps } from 'next/image'
import { useState } from 'react'
import { r2VariantSrcSet } from '../../lib/image-variants'

type SafeImageProps = Omit<ImageProps, 'onError'> & {
  fallbackClassName?: string
}

// Dormant by default. Включается только после полного backfill вариантов в R2
// (scripts/backfill-cover-variants.ts) — иначе srcset 404-ит на -400/-800.
const VARIANTS_ENABLED = process.env.NEXT_PUBLIC_R2_IMAGE_VARIANTS === 'on'

export default function SafeImage({ fallbackClassName, className, ...props }: SafeImageProps) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div className={`w-full h-full bg-surface flex items-center justify-center ${fallbackClassName ?? ''}`}>
        <svg className="text-line w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
    )
  }

  // R2-обложка с готовыми вариантами → нативный <img srcset>, минуя /_next/image.
  const srcSet =
    VARIANTS_ENABLED && typeof props.src === 'string' ? r2VariantSrcSet(props.src) : null

  if (srcSet) {
    const positionClass = props.fill ? 'absolute inset-0 h-full w-full' : ''
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={props.src as string}
        srcSet={srcSet}
        sizes={typeof props.sizes === 'string' ? props.sizes : undefined}
        alt={typeof props.alt === 'string' ? props.alt : ''}
        className={`${positionClass} ${className ?? ''}`.trim()}
        loading={props.priority ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    // eslint-disable-next-line jsx-a11y/alt-text
    <Image
      {...props}
      className={className}
      onError={() => setFailed(true)}
    />
  )
}
