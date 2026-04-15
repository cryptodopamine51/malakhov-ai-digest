'use client'

import Image, { type ImageProps } from 'next/image'
import { useState } from 'react'

type SafeImageProps = Omit<ImageProps, 'onError'> & {
  fallbackClassName?: string
}

/**
 * Обёртка над next/image с обработкой ошибки загрузки на клиенте.
 * При ошибке показывает серый placeholder вместо сломанной картинки.
 */
export default function SafeImage({ fallbackClassName, className, ...props }: SafeImageProps) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div className={`w-full h-full bg-surface flex items-center justify-center ${fallbackClassName ?? ''}`}>
        <svg className="text-muted/40 w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
    )
  }

  return (
    <Image
      {...props}
      className={className}
      onError={() => setFailed(true)}
    />
  )
}
