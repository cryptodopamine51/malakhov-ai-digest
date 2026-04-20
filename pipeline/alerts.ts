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
  provider_rate_limit: 1,
  enrich_failed_spike: 2,
  publish_verify_failed: 6,
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

/**
 * Fires an alert. Skips if an identical alert was fired within its cooldown window.
 * Returns true if the alert was sent, false if suppressed by dedup.
 */
export async function fireAlert(opts: AlertPayload): Promise<boolean> {
  const { supabase, alertType, severity, entityKey, message, payload = {} } = opts
  const dedupKey = entityKey ? `${alertType}:${entityKey}` : alertType
  const now = new Date().toISOString()

  // Check for existing open alert within cooldown
  const { data: existing } = await supabase
    .from('pipeline_alerts')
    .select('id, cooldown_until, occurrence_count')
    .eq('dedupe_key', dedupKey)
    .eq('status', 'open')
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing && existing.cooldown_until && existing.cooldown_until > now) {
    // Still in cooldown — just increment occurrence_count silently
    await supabase
      .from('pipeline_alerts')
      .update({
        occurrence_count: (existing.occurrence_count ?? 1) + 1,
        last_seen_at: now,
      })
      .eq('id', existing.id)
    return false
  }

  const cooldownHours = COOLDOWN_HOURS[alertType] ?? 2
  const cooldownUntil = new Date(Date.now() + cooldownHours * 60 * 60 * 1000).toISOString()

  if (existing) {
    // Reopen and reset cooldown
    await supabase
      .from('pipeline_alerts')
      .update({
        occurrence_count: (existing.occurrence_count ?? 1) + 1,
        last_seen_at: now,
        cooldown_until: cooldownUntil,
        message,
        payload,
      })
      .eq('id', existing.id)
  } else {
    await supabase.from('pipeline_alerts').insert({
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
  }

  // Send Telegram notification if configured
  if (opts.botToken && opts.adminChatId) {
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
  await supabase
    .from('pipeline_alerts')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('dedupe_key', dedupKey)
    .eq('status', 'open')
}

async function sendTelegramAlert(
  botToken: string,
  chatId: string,
  severity: string,
  message: string,
): Promise<void> {
  const icon = severity === 'critical' ? '🔴' : severity === 'warning' ? '⚠️' : 'ℹ️'
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `${icon} <b>Pipeline alert</b>\n${message}`,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })
  } catch {
    // Non-critical — alert is already written to DB
  }
}
