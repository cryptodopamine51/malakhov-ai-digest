/**
 * Cookie consent — модель решения пользователя по 152-ФЗ.
 *
 * Версия в имени ключа (`consent_v1`) позволяет при изменении политики
 * сбросить согласие у всех посетителей: достаточно бамкнуть на `consent_v2`
 * и переразвернуть.
 */

export const CONSENT_STORAGE_KEY = 'consent_v1'
export const CONSENT_CHANGED_EVENT = 'consent-changed'

export type ConsentDecision = 'accept_all' | 'necessary_only' | 'custom' | 'notice_ok'

export interface ConsentRecord {
  version: 1
  decision: ConsentDecision
  categories: {
    necessary: true
    analytics: boolean
    marketing: boolean
  }
  decidedAt: string
}

export function readConsent(): ConsentRecord | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ConsentRecord
    if (parsed?.version !== 1) return null
    return parsed
  } catch {
    return null
  }
}

export function writeConsent(record: Omit<ConsentRecord, 'version' | 'decidedAt'>) {
  if (typeof window === 'undefined') return
  const full: ConsentRecord = {
    version: 1,
    decision: record.decision,
    categories: record.categories,
    decidedAt: new Date().toISOString(),
  }
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(full))
    window.dispatchEvent(new CustomEvent<ConsentRecord>(CONSENT_CHANGED_EVENT, { detail: full }))
  } catch {
    // localStorage недоступен — тогда без сохранения, баннер появится снова
  }
}

export function hasAnalyticsConsent(record: ConsentRecord | null): boolean {
  return record ? record.categories.analytics === true : true
}
