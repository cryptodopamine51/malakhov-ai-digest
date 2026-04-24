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

export async function runRecoverBatchStuck(): Promise<void> {
  log('=== Запуск recover-batch-stuck.ts ===')

  const supabase = getServerClient()
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID
  const now = Date.now()
  const pollThreshold = new Date(now - PROVIDER_BATCH_POLL_STUCK_MINUTES * 60_000).toISOString()
  const resultThreshold = new Date(now - RESULT_IMPORTED_NOT_APPLIED_MINUTES * 60_000).toISOString()
  const applyThreshold = new Date(now - APPLY_STARTED_NOT_FINISHED_MINUTES * 60_000).toISOString()

  const { data: stuckBatches } = await supabase
    .from('anthropic_batches')
    .select('id, provider_batch_id, processing_status, last_polled_at')
    .neq('processing_status', 'ended')
    .or(`last_polled_at.is.null,last_polled_at.lte.${pollThreshold}`)
    .limit(50)

  for (const batch of stuckBatches ?? []) {
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
