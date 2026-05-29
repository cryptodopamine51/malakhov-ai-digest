import { config } from 'dotenv'
import { resolve } from 'path'
import { pathToFileURL } from 'url'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient } from '../lib/supabase'
import { fireAlert } from './alerts'
import { log } from './enrich-runtime'

const PROVIDER_BATCH_POLL_STUCK_MINUTES = Number(process.env.BATCH_POLL_STUCK_MINUTES ?? 90)
const RESULT_IMPORTED_NOT_APPLIED_MINUTES = Number(process.env.BATCH_RESULT_NOT_APPLIED_MINUTES ?? 30)
const APPLY_STARTED_NOT_FINISHED_MINUTES = Number(process.env.BATCH_APPLY_STUCK_MINUTES ?? 30)
const NULL_POLL_RESCUE_AFTER_MINUTES = Number(process.env.BATCH_NULL_POLL_RESCUE_MINUTES ?? 5)
const POLL_PRIORITY_EPOCH = '1970-01-01T00:00:00Z'

type BatchPollRecoveryRow = {
  id: string
  provider_batch_id: string
  processing_status: string
  last_polled_at: string | null
  created_at: string | null
}

function dedupeBatches(rows: BatchPollRecoveryRow[]): BatchPollRecoveryRow[] {
  return Array.from(new Map(rows.map((row) => [row.id, row])).values())
}

// Батч может «застрять» в опросе только если он создан раньше порога stuck.
// Молодой батч (включая те, которым null-poll rescue выставил last_polled_at = эпоху 1970,
// чтобы поднять их в начало очереди collector-а) застрять ещё не мог — это норма при
// типичных задержках cron GitHub Actions (1-4 часа). Этот фильтр — защитный дубль к
// условию created_at в SQL-запросе, чтобы исключить ложный batch_poll_stuck.
export function filterGenuinelyStuckBatches(
  rows: BatchPollRecoveryRow[],
  pollThresholdMs: number,
): BatchPollRecoveryRow[] {
  return rows.filter((row) => {
    if (!row.created_at) return false
    const createdMs = Date.parse(row.created_at)
    return Number.isFinite(createdMs) && createdMs <= pollThresholdMs
  })
}

export async function runRecoverBatchStuck(): Promise<void> {
  log('=== Запуск recover-batch-stuck.ts ===')

  const supabase = getServerClient()
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID
  const now = Date.now()
  const pollThreshold = new Date(now - PROVIDER_BATCH_POLL_STUCK_MINUTES * 60_000).toISOString()
  const resultThreshold = new Date(now - RESULT_IMPORTED_NOT_APPLIED_MINUTES * 60_000).toISOString()
  const applyThreshold = new Date(now - APPLY_STARTED_NOT_FINISHED_MINUTES * 60_000).toISOString()
  const nullRescueCutoff = new Date(now - NULL_POLL_RESCUE_AFTER_MINUTES * 60_000).toISOString()

  // Auto-rescue: для строк с last_polled_at = NULL старше чем NULL_POLL_RESCUE_AFTER_MINUTES
  // выставляем last_polled_at = эпоха, чтобы они уехали в начало очереди collector-а.
  // Без этого Postgres сортирует NULL последними (даже при nullsFirst=true в JS клиенте сбой
  // может произойти в legacy коде), и новые батчи навсегда вытесняются уже опрошенными.
  const { data: nullPollBatches } = await supabase
    .from('anthropic_batches')
    .select('id, provider_batch_id, processing_status, last_polled_at, created_at')
    .neq('processing_status', 'ended')
    .is('last_polled_at', null)
    .lte('created_at', nullRescueCutoff)
    .limit(50)

  let nullRescued = 0
  for (const batch of (nullPollBatches ?? []) as BatchPollRecoveryRow[]) {
    const { error: rescueError } = await supabase
      .from('anthropic_batches')
      .update({ last_polled_at: POLL_PRIORITY_EPOCH, updated_at: new Date().toISOString() })
      .eq('id', batch.id)
      .is('last_polled_at', null)

    if (!rescueError) nullRescued++
  }

  const [{ data: stalePolledBatches }, { data: staleNeverPolledBatches }] = await Promise.all([
    supabase
      .from('anthropic_batches')
      .select('id, provider_batch_id, processing_status, last_polled_at, created_at')
      .neq('processing_status', 'ended')
      .lte('last_polled_at', pollThreshold)
      // Требуем, чтобы батч был реально старым (created_at тоже за порогом).
      // Иначе null-poll rescue выше (выставляет last_polled_at = эпоху 1970, чтобы
      // молодой батч уехал в начало очереди collector-а) мгновенно роняет молодой
      // батч в этот фильтр и поднимает ложный batch_poll_stuck. Cron GitHub Actions
      // часто опаздывает на 1-4 часа, так что свежий, ещё не опрошенный батч —
      // норма, а не «застрял».
      .lte('created_at', pollThreshold)
      .limit(50),
    supabase
      .from('anthropic_batches')
      .select('id, provider_batch_id, processing_status, last_polled_at, created_at')
      .neq('processing_status', 'ended')
      .is('last_polled_at', null)
      .lte('created_at', pollThreshold)
      .limit(50),
  ])
  const stuckBatches = filterGenuinelyStuckBatches(
    dedupeBatches([
      ...((stalePolledBatches ?? []) as BatchPollRecoveryRow[]),
      ...((staleNeverPolledBatches ?? []) as BatchPollRecoveryRow[]),
    ]),
    now - PROVIDER_BATCH_POLL_STUCK_MINUTES * 60_000,
  )

  for (const batch of stuckBatches) {
    await fireAlert({
      supabase,
      alertType: 'batch_poll_stuck',
      severity: 'warning',
      entityKey: String(batch.id),
      message: `Batch polling looks stuck for ${batch.provider_batch_id} (${batch.processing_status})`,
      payload: batch as Record<string, unknown>,
      botToken,
      adminChatId,
    })
  }

  const { data: readyNotApplied } = await supabase
    .from('anthropic_batch_items')
    .select('id, article_id, batch_id, status, result_imported_at, updated_at')
    .eq('status', 'batch_result_ready')
    .lte('result_imported_at', resultThreshold)
    .limit(100)

  for (const item of readyNotApplied ?? []) {
    await supabase
      .from('anthropic_batch_items')
      .update({
        status: 'apply_failed_retriable',
        last_apply_error_code: 'result_imported_not_applied',
        last_apply_error: 'result imported but not applied within recovery threshold',
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id)
      .eq('status', 'batch_result_ready')

    await fireAlert({
      supabase,
      alertType: 'batch_apply_stuck',
      severity: 'warning',
      entityKey: String(item.id),
      message: `Batch item ${item.id} is ready but not applied`,
      payload: item as Record<string, unknown>,
      botToken,
      adminChatId,
    })
  }

  const { data: applyingStuck } = await supabase
    .from('anthropic_batch_items')
    .select('id, article_id, batch_id, status, updated_at')
    .eq('status', 'applying')
    .lte('updated_at', applyThreshold)
    .limit(100)

  for (const item of applyingStuck ?? []) {
    await supabase
      .from('anthropic_batch_items')
      .update({
        status: 'apply_failed_retriable',
        last_apply_error_code: 'apply_started_not_finished',
        last_apply_error: 'apply started but did not finish within recovery threshold',
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id)
      .eq('status', 'applying')

    await fireAlert({
      supabase,
      alertType: 'batch_apply_stuck',
      severity: 'warning',
      entityKey: String(item.id),
      message: `Batch item ${item.id} is stuck in applying state`,
      payload: item as Record<string, unknown>,
      botToken,
      adminChatId,
    })
  }

  log(`Stuck batches: ${stuckBatches?.length ?? 0}`)
  log(`Null-poll rescued: ${nullRescued}`)
  log(`Result imported not applied: ${readyNotApplied?.length ?? 0}`)
  log(`Applying stuck: ${applyingStuck?.length ?? 0}`)
  log('=== recover-batch-stuck.ts завершён ===')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRecoverBatchStuck().catch((error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[${new Date().toTimeString().slice(0, 8)}] КРИТИЧЕСКАЯ ОШИБКА: ${msg}`)
    process.exit(1)
  })
}
