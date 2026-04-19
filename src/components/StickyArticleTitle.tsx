'use client'

import { useEffect, useState } from 'react'

export default function StickyArticleTitle({ title }: { title: string }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const handler = () => setVisible(window.scrollY > 320)
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  return (
    <div
      className={`fixed top-14 left-0 right-0 z-40 border-b border-line bg-base/95 px-4 py-2 backdrop-blur-sm transition-all duration-200 ${
        visible
          ? 'translate-y-0 opacity-100'
          : '-translate-y-full opacity-0 pointer-events-none'
      }`}
    >
      <p className="mx-auto max-w-4xl truncate text-[13px] font-semibold text-ink">
        {title}
      </p>
    </div>
  )
}
