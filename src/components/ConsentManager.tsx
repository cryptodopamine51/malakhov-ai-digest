'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { readConsent, writeConsent, type ConsentRecord } from '../../lib/consent'

type View = 'hidden' | 'banner' | 'modal'

export default function ConsentManager() {
  const [view, setView] = useState<View>('hidden')
  const [analytics, setAnalytics] = useState(false)
  const [marketing, setMarketing] = useState(false)

  useEffect(() => {
    const existing = readConsent()
    if (existing) {
      setAnalytics(existing.categories.analytics)
      setMarketing(existing.categories.marketing)
      setView('hidden')
    } else {
      setView('banner')
    }
  }, [])

  const persist = (record: Omit<ConsentRecord, 'version' | 'decidedAt'>) => {
    writeConsent(record)
    setAnalytics(record.categories.analytics)
    setMarketing(record.categories.marketing)
    setView('hidden')
  }

  const acceptAll = () =>
    persist({
      decision: 'accept_all',
      categories: { necessary: true, analytics: true, marketing: true },
    })

  const necessaryOnly = () =>
    persist({
      decision: 'necessary_only',
      categories: { necessary: true, analytics: false, marketing: false },
    })

  const saveCustom = () =>
    persist({
      decision: 'custom',
      categories: { necessary: true, analytics, marketing },
    })

  if (view === 'hidden') return null

  if (view === 'modal') {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-modal-title"
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
      >
        <div className="w-full max-w-md rounded border border-line bg-base p-5 shadow-lg">
          <h2 id="consent-modal-title" className="mb-3 font-serif text-lg font-bold text-ink">
            Настройки cookies
          </h2>
          <p className="mb-4 text-sm text-muted">
            Выберите, какие категории cookies можно использовать. Решение можно изменить
            в любое время на странице{' '}
            <Link href="/cookie-policy" className="underline hover:text-ink">
              Политика cookies
            </Link>
            .
          </p>

          <ul className="mb-5 space-y-3 text-sm">
            <li className="flex items-start justify-between gap-3 border border-line rounded p-3">
              <div>
                <p className="font-medium text-ink">Необходимые</p>
                <p className="text-xs text-muted">
                  Без них сайт не работает: тема, согласие, безопасность.
                </p>
              </div>
              <input
                type="checkbox"
                checked
                disabled
                aria-label="Необходимые cookies (всегда включены)"
                className="mt-1 h-4 w-4 cursor-not-allowed accent-ink"
              />
            </li>
            <li className="flex items-start justify-between gap-3 border border-line rounded p-3">
              <div>
                <p className="font-medium text-ink">Аналитические</p>
                <p className="text-xs text-muted">
                  Яндекс Метрика — статистика посещений, оптимизация контента.
                </p>
              </div>
              <input
                type="checkbox"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
                aria-label="Аналитические cookies"
                className="mt-1 h-4 w-4 accent-ink"
              />
            </li>
            <li className="flex items-start justify-between gap-3 border border-line rounded p-3">
              <div>
                <p className="font-medium text-ink">Маркетинговые</p>
                <p className="text-xs text-muted">
                  Сейчас не используются. Зарезервированы на будущее.
                </p>
              </div>
              <input
                type="checkbox"
                checked={marketing}
                onChange={(e) => setMarketing(e.target.checked)}
                aria-label="Маркетинговые cookies"
                className="mt-1 h-4 w-4 accent-ink"
              />
            </li>
          </ul>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={saveCustom}
              className="rounded border border-ink bg-ink px-4 py-2 text-sm font-medium text-base hover:opacity-90"
            >
              Сохранить
            </button>
            <button
              type="button"
              onClick={() => setView('banner')}
              className="rounded border border-line px-4 py-2 text-sm font-medium text-muted hover:text-ink"
            >
              Назад
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Согласие на использование cookies"
      className="fixed inset-x-0 bottom-0 z-[55] border-t border-line bg-base/95 px-4 py-3 shadow-lg backdrop-blur"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-3xl text-sm text-muted">
          Мы используем cookies для аналитики и улучшения сайта. Подробности — в{' '}
          <Link href="/cookie-policy" className="underline hover:text-ink">
            Политике cookies
          </Link>
          {' '}и{' '}
          <Link href="/privacy-policy" className="underline hover:text-ink">
            Политике обработки персональных данных
          </Link>
          .
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setView('modal')}
            className="rounded border border-line px-3 py-2 text-sm font-medium text-muted hover:text-ink"
          >
            Настроить
          </button>
          <button
            type="button"
            onClick={necessaryOnly}
            className="rounded border border-line px-3 py-2 text-sm font-medium text-ink hover:border-ink"
          >
            Только необходимые
          </button>
          <button
            type="button"
            onClick={acceptAll}
            className="rounded border border-ink bg-ink px-4 py-2 text-sm font-medium text-base hover:opacity-90"
          >
            Принять все
          </button>
        </div>
      </div>
    </div>
  )
}
