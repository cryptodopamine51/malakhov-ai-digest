'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { readConsent, writeConsent } from '../../lib/consent'

export default function ConsentManager() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(readConsent() === null)
  }, [])

  const acknowledge = () => {
    writeConsent({
      decision: 'notice_ok',
      categories: { necessary: true, analytics: true, marketing: false },
    })
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Уведомление об использовании cookies"
      className="fixed inset-x-0 bottom-0 z-[55] border-t border-line bg-base/95 px-4 py-3 shadow-lg backdrop-blur"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-3xl text-sm leading-relaxed text-muted">
          Мы используем cookies для работы сайта и аналитику Яндекс Метрики, чтобы понимать,
          какие материалы читают. Подробнее — в{' '}
          <Link href="/cookie-policy" className="underline hover:text-ink">
            политике cookies
          </Link>
          .
        </p>
        <button
          type="button"
          onClick={acknowledge}
          className="inline-flex shrink-0 items-center justify-center rounded border border-ink bg-ink px-5 py-2 text-sm font-medium text-base transition-opacity hover:opacity-90"
        >
          OK
        </button>
      </div>
    </div>
  )
}
