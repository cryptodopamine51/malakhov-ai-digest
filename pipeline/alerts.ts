/**
 * pipeline/alerts.ts
 *
 * Centralized alert system with deduplication.
 * Prevents spamming the admin on every hourly run when the same condition persists.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const COOLDOWN_HOURS: Record<string, number> = {
  source_down: 4,
  backlog_high: 2,
  provider_invalid_request: 6,
  provider_rate_limit: 1,
  enrich_failed_spike: 2,
  batch_submit_failed: 1,
  batch_collect_failed: 1,
  batch_poll_stuck: 2,
  batch_apply_stuck: 2,
  claude_daily_budget_exceeded: 6,
  claude_parse_failed: 4,
  lease_expired_spike: 2,
  llm_usage_log_write_failed: 4,
  publish_verify_failed: 6,
  publish_verify_failed_warn: 1,
  publish_rpc_bypass_active: 6,
  published_low_window: 2,
  digest_low_articles: 12,
}

export interface AlertPayload {
  supabase: SupabaseClient
  alertType: string
  severity: 'info' | 'warning' | 'critical'
  entityKey?: string
  message: string
  payload?: Record<string, unknown>
  botToken?: string
  adminChatId?: string
}

function hasTelegramAlertTarget(opts: Pick<AlertPayload, 'botToken' | 'adminChatId'>): opts is {
  botToken: string
  adminChatId: string
} {
  if (opts.botToken && opts.adminChatId) return true
  if (opts.botToken || opts.adminChatId) {
    console.warn('[alerts] Telegram admin alert skipped: TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID are both required')
  }
  return false
}

/**
 * Fires an alert. Skips if an identical alert was fired within its cooldown window.
 * Returns true if the alert was sent (Telegram notified), false if suppressed by dedup.
 */
export async function fireAlert(opts: AlertPayload): Promise<boolean> {
  const { supabase, alertType, severity, entityKey, message, payload = {} } = opts
  const dedupKey = entityKey ? `${alertType}:${entityKey}` : alertType
  const now = new Date().toISOString()

  try {
    // Check for existing open alert within cooldown
    const { data: existing, error: selectError } = await supabase
      .from('pipeline_alerts')
      .select('id, cooldown_until, occurrence_count')
      .eq('dedupe_key', dedupKey)
      .eq('status', 'open')
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (selectError) {
      console.error(`[alerts] Failed to query pipeline_alerts: ${selectError.message}`)
      // Still attempt Telegram even if DB is down
      if (hasTelegramAlertTarget(opts)) {
        await sendTelegramAlert(opts.botToken, opts.adminChatId, severity, message)
      }
      return true
    }

    if (existing && existing.cooldown_until && existing.cooldown_until > now) {
      // Still in cooldown — increment occurrence_count silently
      const { error: updateError } = await supabase
        .from('pipeline_alerts')
        .update({
          occurrence_count: (existing.occurrence_count ?? 1) + 1,
          last_seen_at: now,
        })
        .eq('id', existing.id)

      if (updateError) {
        console.error(`[alerts] Failed to update occurrence_count: ${updateError.message}`)
      }
      return false
    }

    const cooldownHours = COOLDOWN_HOURS[alertType] ?? 2
    const cooldownUntil = new Date(Date.now() + cooldownHours * 60 * 60 * 1000).toISOString()

    if (existing) {
      // Alert exists but cooldown expired — reopen and reset
      const { error: updateError } = await supabase
        .from('pipeline_alerts')
        .update({
          occurrence_count: (existing.occurrence_count ?? 1) + 1,
          last_seen_at: now,
          cooldown_until: cooldownUntil,
          message,
          payload,
        })
        .eq('id', existing.id)

      if (updateError) {
        console.error(`[alerts] Failed to reopen alert ${dedupKey}: ${updateError.message}`)
      }
    } else {
      const { error: insertError } = await supabase.from('pipeline_alerts').insert({
        alert_type: alertType,
        severity,
        status: 'open',
        entity_key: entityKey ?? null,
        dedupe_key: dedupKey,
        message,
        payload,
        occurrence_count: 1,
        first_seen_at: now,
        last_seen_at: now,
        cooldown_until: cooldownUntil,
      })

      if (insertError) {
        console.error(`[alerts] Failed to insert alert ${dedupKey}: ${insertError.message}`)
      }
    }
  } catch (err) {
    console.error(`[alerts] Unexpected error in fireAlert: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Send Telegram notification regardless of DB outcome
  if (hasTelegramAlertTarget(opts)) {
    await sendTelegramAlert(opts.botToken, opts.adminChatId, severity, message)
  }

  return true
}

/**
 * Resolves an open alert (e.g. source recovered).
 */
export async function resolveAlert(
  supabase: SupabaseClient,
  alertType: string,
  entityKey?: string,
): Promise<void> {
  const dedupKey = entityKey ? `${alertType}:${entityKey}` : alertType
  const { error } = await supabase
    .from('pipeline_alerts')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('dedupe_key', dedupKey)
    .eq('status', 'open')

  if (error) {
    console.error(`[alerts] Failed to resolve alert ${dedupKey}: ${error.message}`)
  }
}

async function sendTelegramAlert(
  botToken: string,
  chatId: string,
  severity: string,
  message: string,
): Promise<void> {
  const icon = severity === 'critical' ? '🔴' : severity === 'warning' ? '⚠️' : 'ℹ️'
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `${icon} <b>Pipeline alert</b>\n${message}`,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })
    if (!res.ok) {
      let body = ''
      try {
        body = await res.text()
      } catch {
        body = ''
      }
      const bodySuffix = body ? ` ${body.slice(0, 500)}` : ''
      console.error(`[alerts] Telegram send failed: ${res.status}${bodySuffix}`)
    }
  } catch (err) {
    // Non-critical — alert is already written to DB
    console.error(`[alerts] Telegram send error: ${err instanceof Error ? err.message : String(err)}`)
  }
}
