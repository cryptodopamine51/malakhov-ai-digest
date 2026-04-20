/**
 * pipeline/recover-stuck.ts
 *
 * Finds articles stuck in `processing` state with an expired lease
 * and transitions them: processing → stuck → retry_wait.
 *
 * Safe to run alongside active enrich workers — only touches expired leases.
 *
 * Запуск: npm run recover-stuck
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient } from '../lib/supabase'
import { nextRetryAt } from './types'

function log(msg: string): void {
  const ts = new Date().toTimeString().slice(0, 8)
  console.log(`[${ts}] ${msg}`)
}

async function recoverStuck(): Promise<void> {
  log('=== Запуск recover-stuck.ts ===')

  const supabase = getServerClient()
  const now = new Date().toISOString()

  // Find articles where lease has expired but status is still processing
  const { data: stuck, error: selectError } = await supabase
    .from('articles')
    .select('id, attempt_count, processing_by, lease_expires_at, original_title')
    .eq('enrich_status', 'processing')
    .lte('lease_expires_at', now)
    .limit(100)

  if (selectError) {
    log(`Ошибка выборки: ${selectError.message}`)
    process.exit(1)
  }

  if (!stuck?.length) {
    log('Нет зависших статей')
    return
  }

  log(`Зависших статей: ${stuck.length}`)

  let recovered = 0

  for (const article of stuck) {
    const attemptCount = (article.attempt_count ?? 0) + 1
    const retryAt = nextRetryAt(attemptCount).toISOString()

    // Transition: processing → retry_wait (via stuck marker in last_error_code)
    const { error } = await supabase
      .from('articles')
      .update({
        enrich_status: 'retry_wait',
        attempt_count: attemptCount,
        next_retry_at: retryAt,
        claim_token: null,
        processing_by: null,
        lease_expires_at: null,
        processing_finished_at: now,
        last_error: `lease expired (was held by ${article.processing_by ?? 'unknown'})`,
        last_error_code: 'fetch_timeout',
        updated_at: now,
      })
      .eq('id', article.id)
      .eq('enrich_status', 'processing') // guard: only if still processing

    if (!error) {
      recovered++
      log(
        `  ↻ recovered: ${article.original_title?.slice(0, 60)} ` +
        `[was held by ${article.processing_by ?? 'unknown'}, retry at ${retryAt}]`,
      )
    }
  }

  log(`Восстановлено: ${recovered} из ${stuck.length}`)
  log('=== recover-stuck.ts завершён ===')
}

recoverStuck().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error)
  console.error(`[${new Date().toTimeString().slice(0, 8)}] КРИТИЧЕСКАЯ ОШИБКА: ${msg}`)
  process.exit(1)
})
