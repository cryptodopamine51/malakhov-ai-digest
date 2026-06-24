/**
 * pipeline/tg-weekly-monitor.ts
 *
 * Алёрт `tg_weekly_report_missing`: pipeline-health (раз в 2 часа) проверяет, что
 * еженедельный отраслевой отчёт за прошлую полную неделю реально доставлен.
 *
 * Контекст: 2026-06-22 weekly report молча не выходил — миграция не была накатана,
 * primary pg_cron не создан, backup-workflow падал, а монитора (в отличие от channel
 * posts) не существовало, поэтому провал был невидим. См.
 * docs/task_telegram_bot_reliability_2026-06-24.md.
 *
 * Логика (по МСК): отчёт уходит в понедельник ~11:00 (backup 11:20). С понедельника
 * 13:00 и до конца недели success-строка за ожидаемый week_start обязана существовать.
 *  - до понедельника 13:00 → noop (отчёт ещё не должен был выйти);
 *  - таблицы нет (миграция не накатана) → fire critical reason=no_schema;
 *  - нет ни одной строки за неделю → fire reason=no_rows (pg_cron + backup мертвы);
 *  - строки есть, но нет success → fire reason=no_success (ломается отправка);
 *  - есть success → resolve.
 */

import { config as loadEnv } from 'dotenv'
import { resolve } from 'path'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { weeklyReportWindow } from '../bot/weekly-report-core'
import { getMoscowDateKey } from '../lib/utils'
import { fireAlert, resolveAlert } from './alerts'
import { isMissingObjectError } from './schema-guard'

const TG_WEEKLY_ALERT_TYPE = 'tg_weekly_report_missing'
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000
const DUE_AFTER_MINUTES = 13 * 60 // понедельник 13:00 МСК

export interface WeeklyRunRow {
  status: string
}

export type WeeklyDecision =
  | { kind: 'fire'; reason: 'no_schema' | 'no_rows' | 'no_success'; successCount: number }
  | { kind: 'resolve'; successCount: number }
  | { kind: 'noop'; reason: 'too_early' }

/** МСК-минуты от начала недели: понедельник 00:00 = 0. */
export function isWeeklyReportDue(now: Date = new Date()): boolean {
  const msk = new Date(now.getTime() + MSK_OFFSET_MS)
  const weekday = msk.getUTCDay() === 0 ? 7 : msk.getUTCDay() // 1=Mon..7=Sun
  const minutesOfDay = msk.getUTCHours() * 60 + msk.getUTCMinutes()
  if (weekday === 1 && minutesOfDay < DUE_AFTER_MINUTES) return false
  return true
}

export function decideWeeklyAlert(
  input: { rows: WeeklyRunRow[] | null; schemaMissing: boolean },
  now: Date = new Date(),
): WeeklyDecision {
  if (!isWeeklyReportDue(now)) return { kind: 'noop', reason: 'too_early' }
  if (input.schemaMissing) return { kind: 'fire', reason: 'no_schema', successCount: 0 }
  const rows = input.rows ?? []
  const successCount = rows.filter((row) => row.status === 'success').length
  if (successCount > 0) return { kind: 'resolve', successCount }
  if (rows.length === 0) return { kind: 'fire', reason: 'no_rows', successCount }
  return { kind: 'fire', reason: 'no_success', successCount }
}

export function isStaleWeeklyAlertEntity(entityKey: string | null | undefined, currentWeekStart: string): boolean {
  const match = /^week:(\d{4}-\d{2}-\d{2})$/.exec(entityKey ?? '')
  return Boolean(match && match[1] < currentWeekStart)
}

export async function resolveStaleWeeklyAlerts(
  supabase: SupabaseClient,
  currentWeekStart: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('pipeline_alerts')
    .select('entity_key')
    .eq('alert_type', TG_WEEKLY_ALERT_TYPE)
    .eq('status', 'open')
  if (error) {
    console.error(`[tg-weekly-monitor] stale alert query failed: ${error.message}`)
    return 0
  }
  const staleKeys = Array.from(new Set(
    ((data ?? []) as Array<{ entity_key: string | null }>)
      .map((row) => row.entity_key)
      .filter((key): key is string => isStaleWeeklyAlertEntity(key, currentWeekStart)),
  ))
  for (const key of staleKeys) await resolveAlert(supabase, TG_WEEKLY_ALERT_TYPE, key)
  return staleKeys.length
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL и SUPABASE_SERVICE_KEY должны быть заданы')
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const weekStart = weeklyReportWindow(getMoscowDateKey()).weekStart
  const { data, error } = await supabase
    .from('weekly_report_runs')
    .select('status')
    .eq('week_start', weekStart)
  const schemaMissing = isMissingObjectError(error)
  if (error && !schemaMissing) throw new Error(`weekly_report_runs query failed: ${error.message}`)

  const decision = decideWeeklyAlert({ rows: (data ?? null) as WeeklyRunRow[] | null, schemaMissing })
  console.log(`[tg-weekly-monitor] week=${weekStart}: ${JSON.stringify(decision)}`)

  const staleResolved = await resolveStaleWeeklyAlerts(supabase, weekStart)
  if (staleResolved > 0) console.log(`[tg-weekly-monitor] resolved ${staleResolved} stale alert(s)`)

  if (decision.kind === 'fire') {
    const detail = decision.reason === 'no_schema'
      ? 'таблицы weekly_report_runs нет — миграция 20260622073323_weekly_telegram_report.sql не накатана на прод (docs/OPERATIONS.md → Deploy)'
      : decision.reason === 'no_rows'
        ? 'нет ни одной строки за неделю — primary pg_cron job tg-weekly-report не сработал И backup-workflow не дошёл'
        : 'строки есть, но нет success — ломается отправка (см. error в weekly_report_runs)'
    await fireAlert({
      supabase,
      alertType: TG_WEEKLY_ALERT_TYPE,
      severity: 'critical',
      entityKey: `week:${weekStart}`,
      message: `Weekly report за неделю ${weekStart}: не доставлен. ${detail}`,
      payload: { weekStart, reason: decision.reason, successCount: decision.successCount },
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID,
    })
  } else if (decision.kind === 'resolve') {
    await resolveAlert(supabase, TG_WEEKLY_ALERT_TYPE, `week:${weekStart}`)
  }
}

const entryHref = process.argv[1] ? new URL(`file://${resolve(process.argv[1])}`).href : ''
if (import.meta.url === entryHref) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
