/**
 * pipeline/provider-guard.ts
 *
 * Checks for spikes in provider errors (Claude 429/5xx) by scanning
 * recent article_attempts. Fires alert when error rate is elevated.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient } from '../lib/supabase'
import { fireAlert, resolveAlert } from './alerts'

const WINDOW_HOURS = 2
const RATE_LIMIT_ALERT_COUNT = 5
const ERROR_RATE_THRESHOLD = 0.3  // 30% failure rate triggers alert

function log(msg: string): void {
  const ts = new Date().toTimeString().slice(0, 8)
  console.log(`[${ts}] ${msg}`)
}

async function checkProviderHealth(): Promise<void> {
  log('=== provider-guard check ===')

  const supabase = getServerClient()
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID
  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString()

  const { data: attempts, error } = await supabase
    .from('article_attempts')
    .select('result_status, error_code')
    .eq('stage', 'enrich')
    .gte('started_at', since)

  if (error) {
    log(`Ошибка выборки article_attempts: ${error.message}`)
    return
  }

  if (!attempts?.length) {
    log('Нет данных о попытках за последние 2 часа')
    return
  }

  const total = attempts.length
  const rateLimitHits = attempts.filter((a) => a.error_code === 'claude_rate_limit').length
  const apiErrors = attempts.filter((a) => a.error_code === 'claude_api_error').length
  const failed = attempts.filter((a) => a.result_status === 'failed' || a.result_status === 'retryable').length
  const errorRate = failed / total

  log(`Попыток за ${WINDOW_HOURS}h: ${total}, rate_limit: ${rateLimitHits}, api_errors: ${apiErrors}, error_rate: ${(errorRate * 100).toFixed(1)}%`)

  if (rateLimitHits >= RATE_LIMIT_ALERT_COUNT) {
    await fireAlert({
      supabase,
      alertType: 'provider_rate_limit',
      severity: 'warning',
      entityKey: 'claude',
      message: `Claude rate limit hit ${rateLimitHits} times in last ${WINDOW_HOURS}h. Enrichment may be degraded.`,
      payload: { rateLimitHits, apiErrors, total, errorRate },
      botToken,
      adminChatId,
    })
    log(`⚠️ Rate limit alert fired (${rateLimitHits} hits)`)
  } else if (errorRate > ERROR_RATE_THRESHOLD && total >= 10) {
    await fireAlert({
      supabase,
      alertType: 'enrich_failed_spike',
      severity: 'warning',
      message: `Enrich error rate ${(errorRate * 100).toFixed(1)}% (${failed}/${total}) in last ${WINDOW_HOURS}h.`,
      payload: { errorRate, failed, total, rateLimitHits, apiErrors },
      botToken,
      adminChatId,
    })
    log(`⚠️ Error spike alert fired (${(errorRate * 100).toFixed(1)}%)`)
  } else {
    await resolveAlert(supabase, 'provider_rate_limit', 'claude')
    await resolveAlert(supabase, 'enrich_failed_spike')
  }

  log('=== provider-guard завершён ===')
}

checkProviderHealth().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
