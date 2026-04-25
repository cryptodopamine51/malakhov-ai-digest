'use client'

import { useState } from 'react'
import { CONSENT_CHANGED_EVENT, CONSENT_STORAGE_KEY } from '../../lib/consent'

export default function RevokeConsentButton() {
  const [done, setDone] = useState(false)

  const revoke = () => {
    try {
      window.localStorage.removeItem(CONSENT_STORAGE_KEY)
      window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT, { detail: null }))
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
