'use client'

import { useState } from 'react'
import { writeConsent } from '../../lib/consent'

export default function RevokeConsentButton() {
  const [done, setDone] = useState(false)

  const revoke = () => {
    try {
      writeConsent({
        decision: 'necessary_only',
        categories: { necessary: true, analytics: false, marketing: false },
      })
      setDone(true)
      window.setTimeout(() => window.location.reload(), 800)
    } catch {
      setDone(false)
    }
  }

  return (
    <button
      type="button"
      onClick={revoke}
      disabled={done}
      className="inline-flex items-center rounded border border-ink bg-ink px-4 py-2 text-sm font-medium text-base hover:opacity-90 disabled:opacity-60"
    >
      {done ? 'Согласие отозвано — перезагружаем…' : 'Отозвать согласие'}
    </button>
  )
}
