/**
 * pipeline/retry-failed.ts
 *
 * Picks up articles in retry_wait state whose next_retry_at has passed
 * and resets them to pending so the next enrich run can claim them.
 *
 * Запуск: npm run retry-failed
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient } from '../lib/supabase'
import { RETRY_POLICY } from './types'

function log(msg: string): void {
  const ts = new Date().toTimeString().slice(0, 8)
  console.log(`[${ts}] ${msg}`)
}

async function retryFailed(): Promise<void> {
  log('=== Запуск retry-failed.ts ===')

  const supabase = getServerClient()
  const now = new Date().toISOString()

  // Articles in retry_wait whose timer has expired and haven't exceeded max attempts
  const { data: ready, error: selectError } = await supabase
    .from('articles')
    .select('id, attempt_count, original_title, current_batch_item_id')
    .eq('enrich_status', 'retry_wait')
    .lte('next_retry_at', now)
    .lt('attempt_count', RETRY_POLICY.maxAttempts)
    .order('next_retry_at', { ascending: true })
    .limit(50)

  if (selectError) {
    log(`Ошибка выборки: ${selectError.message}`)
    process.exit(1)
  }

  if (!ready?.length) {
    log('Нет статей для повторной попытки')
    return
  }

  const batchItemIds = (ready ?? [])
    .map((a) => a.current_batch_item_id)
    .filter((id): id is string => Boolean(id))

  const batchStatusById = new Map<string, string>()
  if (batchItemIds.length) {
    const { data: batchItems } = await supabase
      .from('anthropic_batch_items')
      .select('id, status')
      .in('id', batchItemIds)

    for (const item of batchItems ?? []) {
      batchStatusById.set(String(item.id), String(item.status))
    }
  }

  const readyToReset = (ready ?? []).filter((article) => {
    if (!article.current_batch_item_id) return true
    const batchStatus = batchStatusById.get(article.current_batch_item_id)
    return !batchStatus || ['batch_failed', 'apply_failed_retriable', 'apply_failed_terminal', 'applied'].includes(batchStatus)
  })

  if (!readyToReset.length) {
    log('Нет статей для retry после проверки batch item status')
    return
  }

  log(`Готово к retry: ${readyToReset.length}`)

  const ids = readyToReset.map((a) => a.id)

  const { error: updateError, count } = await supabase
    .from('articles')
    .update({
      enrich_status: 'pending',
      claim_token: null,
      processing_by: null,
      lease_expires_at: null,
      next_retry_at: null,
      current_batch_item_id: null,
      updated_at: now,
    })
    .in('id', ids)
    .eq('enrich_status', 'retry_wait')

  if (updateError) {
    log(`Ошибка сброса статуса: ${updateError.message}`)
    process.exit(1)
  }

  log(`Сброшено в pending: ${count ?? ids.length}`)

  // Articles that have exhausted all retries → mark as failed
  const { data: exhausted, error: exhaustedSelectError } = await supabase
    .from('articles')
    .select('id, attempt_count, original_title, current_batch_item_id')
    .eq('enrich_status', 'retry_wait')
    .lte('next_retry_at', now)
    .gte('attempt_count', RETRY_POLICY.maxAttempts)
    .limit(50)

  if (exhaustedSelectError) {
    log(`Ошибка выборки exhausted: ${exhaustedSelectError.message}`)
    return
  }

  if (exhausted?.length) {
    const exhaustedIds = exhausted.map((a) => a.id)
    await supabase
      .from('articles')
      .update({
        enrich_status: 'failed',
        claim_token: null,
        processing_by: null,
        lease_expires_at: null,
        current_batch_item_id: null,
        updated_at: now,
      })
      .in('id', exhaustedIds)
      .eq('enrich_status', 'retry_wait')

    log(`Помечено как failed (exhausted): ${exhausted.length}`)
    for (const a of exhausted) {
      log(`  — ${a.original_title?.slice(0, 60)} [attempt ${a.attempt_count}]`)
    }
  }

  log('=== retry-failed.ts завершён ===')
}

retryFailed().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error)
  console.error(`[${new Date().toTimeString().slice(0, 8)}] КРИТИЧЕСКАЯ ОШИБКА: ${msg}`)
  process.exit(1)
})
