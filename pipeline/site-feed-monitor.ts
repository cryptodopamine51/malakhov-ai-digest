/**
 * pipeline/site-feed-monitor.ts
 *
 * Synthetic uptime-check публичной ленты. Раз в 15 минут (см.
 * .github/workflows/site-monitor.yml) дёргает production `/api/feed` и алёртит,
 * если лента пустая (`total === 0`) или endpoint недоступен.
 *
 * Зачем (incident learning 2026-05-26, см. CLAUDE.md / docs/OPERATIONS.md):
 * прод-редеплой при egress-заблокированном Supabase стирает тёплый stale ISR-кеш →
 * страницы рендерятся пустыми (`/api/feed` total:0), хотя данные в БД целы. Раньше
 * это ловилось только глазами. Теперь — критический Telegram-алёрт.
 *
 * Важно: `fireAlert` устойчив к недоступной БД — при ошибке записи в pipeline_alerts
 * он всё равно шлёт Telegram (если задан target и severity проходит политику). Это и
 * есть нужное поведение: при блокировке Supabase алёрт всё равно дойдёт.
 */

import { config as loadEnv } from 'dotenv'
import { resolve } from 'path'

import type { SupabaseClient } from '@supabase/supabase-js'

import { fireAlert, resolveAlert } from './alerts'

const DEFAULT_SITE_URL = 'https://news.malakhovai.ru'

export interface FeedSnapshot {
  httpOk: boolean
  status: number
  total: number | null
  error?: string
}

export type FeedDecision =
  | { kind: 'fire'; reason: 'empty_feed' | 'fetch_failed' }
  | { kind: 'resolve'; reason: 'feed_ok' }

/** Pure decision: пустая лента или недоступный endpoint → fire; иначе resolve. */
export function decideFeed(snapshot: FeedSnapshot): FeedDecision {
  if (!snapshot.httpOk || snapshot.total === null) {
    return { kind: 'fire', reason: 'fetch_failed' }
  }
  if (snapshot.total === 0) {
    return { kind: 'fire', reason: 'empty_feed' }
  }
  return { kind: 'resolve', reason: 'feed_ok' }
}

async function fetchOnce(feedUrl: string): Promise<FeedSnapshot> {
  try {
    const res = await fetch(feedUrl, { headers: { 'cache-control': 'no-cache' } })
    if (!res.ok) {
      return { httpOk: false, status: res.status, total: null, error: `HTTP ${res.status}` }
    }
    const body = (await res.json()) as { total?: unknown }
    const total = typeof body.total === 'number' ? body.total : null
    return { httpOk: true, status: res.status, total }
  } catch (err) {
    return { httpOk: false, status: 0, total: null, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Фетч с короткими ретраями — глушит транзиентные сетевые сбои перед критическим алёртом. */
export async function fetchFeedSnapshot(feedUrl: string, attempts = 3): Promise<FeedSnapshot> {
  let last: FeedSnapshot = { httpOk: false, status: 0, total: null, error: 'no attempt' }
  for (let i = 0; i < attempts; i++) {
    last = await fetchOnce(feedUrl)
    // Успех (даже total:0 — это валидный ответ, ретраить нечего) → возвращаем сразу.
    if (last.httpOk) return last
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000))
  }
  return last
}

export interface SiteFeedMonitorConfig {
  siteUrl?: string
  attempts?: number
  botToken?: string
  adminChatId?: string
}

export async function runSiteFeedMonitor(
  supabase: SupabaseClient,
  config: SiteFeedMonitorConfig = {},
): Promise<{ decision: FeedDecision; snapshot: FeedSnapshot }> {
  const siteUrl = (config.siteUrl ?? DEFAULT_SITE_URL).replace(/\/$/, '')
  const feedUrl = `${siteUrl}/api/feed`
  const snapshot = await fetchFeedSnapshot(feedUrl, config.attempts ?? 3)
  const decision = decideFeed(snapshot)

  if (decision.kind === 'fire') {
    const message =
      decision.reason === 'empty_feed'
        ? `Публичная лента пуста: ${feedUrl} вернул total:0. Вероятно сброшен ISR-кеш или недоступна БД.`
        : `Публичная лента недоступна: ${feedUrl} (${snapshot.error ?? `HTTP ${snapshot.status}`}).`
    await fireAlert({
      supabase,
      alertType: 'site_feed_empty',
      severity: 'critical',
      message,
      payload: {
        feed_url: feedUrl,
        reason: decision.reason,
        http_status: snapshot.status,
        total: snapshot.total,
        error: snapshot.error ?? null,
      },
      botToken: config.botToken,
      adminChatId: config.adminChatId,
    })
  } else {
    await resolveAlert(supabase, 'site_feed_empty')
  }

  return { decision, snapshot }
}

async function main(): Promise<void> {
  loadEnv({ path: resolve(process.cwd(), '.env.local') })

  const { getServerClient } = await import('../lib/supabase')
  const supabase = getServerClient()

  const result = await runSiteFeedMonitor(supabase, {
    siteUrl: process.env.SITE_MONITOR_URL,
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID,
  })

  const ts = new Date().toTimeString().slice(0, 8)
  console.log(
    `[${ts}] site-feed-monitor: decision=${result.decision.kind}/${result.decision.reason} ` +
      `httpOk=${result.snapshot.httpOk} total=${result.snapshot.total}`,
  )
  // Не выходим с ошибкой при fire: канал оповещения — Telegram-алёрт (как и у прочих
  // мониторов). Красный workflow на каждый тик во время длительного простоя только шумит.
}

const isDirect = (() => {
  if (typeof require !== 'undefined' && typeof module !== 'undefined') {
    return require.main === module
  }
  return false
})()

if (isDirect) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
