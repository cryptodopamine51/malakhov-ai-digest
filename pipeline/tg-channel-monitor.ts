/**
 * pipeline/tg-channel-monitor.ts
 *
 * Алёрт `tg_channel_posts_missing`: раз в 2 часа (pipeline-health.yml) проверяет,
 * что Telegram channel posts сегодня реально выходят.
 *
 * Контекст: 2026-06-09..10 цепочка Supabase pg_cron → pg_net молча перестала
 * дёргать `/api/cron/tg-channel-post` — канал молчал двое суток, а единственным
 * сигналом была строка в утреннем ops-report. Этот монитор делает молчание канала
 * громким: critical-алёрт в pipeline_alerts + немедленный пинг в админ-чат.
 *
 * Логика (всё по МСК):
 *  - слот считается «должен был выйти» через 30 минут после планового времени;
 *  - если должно было выйти ≥ 2 слотов (≈ с 13:00 МСК), а success-доставок меньше
 *    ожидаемого числа — fire critical (различаем: вообще нет строк = pg_cron мёртв;
 *    строки есть, но нет success = ломается отправка; success есть, но меньше due =
 *    missed slot/catch-up не сработал);
 *  - success-доставок не меньше ожидаемого числа — resolveAlert;
 *  - раньше 13:00 МСК — noop (не шумим из-за одного слота).
 */

import { config as loadEnv } from 'dotenv'
import { resolve } from 'path'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { TG_CHANNEL_SLOT_TIMES_MSK_MINUTES } from '../lib/tg-channel-schedule'
import { fireAlert, resolveAlert } from './alerts'

loadEnv({ path: resolve(process.cwd(), '.env.local') })
loadEnv({ path: resolve(process.cwd(), '.env') })

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000
const SLOT_GRACE_MINUTES = 30
const TG_CHANNEL_ALERT_TYPE = 'tg_channel_posts_missing'

export interface TgChannelDayRow {
  status: string
}

export type TgChannelDecision =
  | { kind: 'fire'; reason: 'no_rows' | 'no_success' | 'partial_success'; dueSlots: number; successCount: number }
  | { kind: 'resolve'; successCount: number }
  | { kind: 'noop'; reason: 'too_early'; dueSlots: number }

export function mskDateKey(now: Date = new Date()): string {
  return new Date(now.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10)
}

export function dueSlotCount(now: Date = new Date()): number {
  const msk = new Date(now.getTime() + MSK_OFFSET_MS)
  const minutesOfDay = msk.getUTCHours() * 60 + msk.getUTCMinutes()
  return TG_CHANNEL_SLOT_TIMES_MSK_MINUTES.filter((slot) => slot + SLOT_GRACE_MINUTES <= minutesOfDay).length
}

export function decideTgChannelAlert(rows: TgChannelDayRow[], now: Date = new Date()): TgChannelDecision {
  const dueSlots = dueSlotCount(now)
  const successCount = rows.filter((row) => row.status === 'success').length
  if (successCount >= dueSlots && dueSlots > 0) return { kind: 'resolve', successCount }
  if (successCount > 0 && dueSlots < 2) return { kind: 'resolve', successCount }
  if (dueSlots < 2) return { kind: 'noop', reason: 'too_early', dueSlots }
  if (rows.length === 0) return { kind: 'fire', reason: 'no_rows', dueSlots, successCount }
  if (successCount === 0) return { kind: 'fire', reason: 'no_success', dueSlots, successCount }
  return { kind: 'fire', reason: 'partial_success', dueSlots, successCount }
}

export function isStaleTgChannelAlertEntity(entityKey: string | null | undefined, currentDeliveryDate: string): boolean {
  const match = /^day:(\d{4}-\d{2}-\d{2})$/.exec(entityKey ?? '')
  return Boolean(match && match[1] < currentDeliveryDate)
}

export async function resolveStaleTgChannelDayAlerts(
  supabase: SupabaseClient,
  currentDeliveryDate: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('pipeline_alerts')
    .select('entity_key')
    .eq('alert_type', TG_CHANNEL_ALERT_TYPE)
    .eq('status', 'open')

  if (error) {
    console.error(`[tg-channel-monitor] stale alert query failed: ${error.message}`)
    return 0
  }

  const staleEntityKeys = Array.from(new Set(
    ((data ?? []) as Array<{ entity_key: string | null }>)
      .map((row) => row.entity_key)
      .filter((entityKey): entityKey is string => isStaleTgChannelAlertEntity(entityKey, currentDeliveryDate)),
  ))

  for (const entityKey of staleEntityKeys) {
    await resolveAlert(supabase, TG_CHANNEL_ALERT_TYPE, entityKey)
  }

  return staleEntityKeys.length
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL и SUPABASE_SERVICE_KEY должны быть заданы')
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const deliveryDate = mskDateKey()
  const { data, error } = await supabase
    .from('telegram_channel_posts')
    .select('status')
    .eq('delivery_date', deliveryDate)
  if (error) throw new Error(`telegram_channel_posts query failed: ${error.message}`)

  const decision = decideTgChannelAlert((data ?? []) as TgChannelDayRow[])
  console.log(`[tg-channel-monitor] ${deliveryDate}: ${JSON.stringify(decision)}`)
  const staleResolved = await resolveStaleTgChannelDayAlerts(supabase, deliveryDate)
  if (staleResolved > 0) {
    console.log(`[tg-channel-monitor] resolved ${staleResolved} stale tg_channel_posts_missing day alert(s)`)
  }

  if (decision.kind === 'fire') {
    const detail = decision.reason === 'no_rows'
      ? 'нет ни одной строки за день — pg_cron/pg_net не дёргает /api/cron/tg-channel-post (диагностика: docs/OPERATIONS.md → Cron-расписание Telegram channel posts)'
      : decision.reason === 'no_success'
        ? 'строки плана есть, но ни одной success-доставки — ломается отправка (см. error_message в telegram_channel_posts)'
        : 'есть success-доставка, но меньше ожидаемых слотов — проверь missed planned slots и catch-up в bot/channel-post-core.ts'
    await fireAlert({
      supabase,
      alertType: 'tg_channel_posts_missing',
      severity: 'critical',
      entityKey: `day:${deliveryDate}`,
      message: `Telegram channel posts: ${decision.successCount} успешных доставок при ${decision.dueSlots} ожидаемых слотах. ${detail}`,
      payload: { deliveryDate, dueSlots: decision.dueSlots, successCount: decision.successCount, reason: decision.reason },
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID,
    })
  } else if (decision.kind === 'resolve') {
    await resolveAlert(supabase, TG_CHANNEL_ALERT_TYPE, `day:${deliveryDate}`)
  }
}

const entryHref = process.argv[1] ? new URL(`file://${resolve(process.argv[1])}`).href : ''
if (import.meta.url === entryHref) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
