import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MODEL } from './claude'
import { fireAlert, resolveAlert } from './alerts'

export const ANTHROPIC_UNAVAILABLE_ALERT_TYPE = 'anthropic_unavailable'
export const ANTHROPIC_UNAVAILABLE_ENTITY_KEY = 'anthropic'
export const ANTHROPIC_DEGRADED_ERROR_CODE = 'anthropic_degraded'

export interface AnthropicDegradedState {
  active: boolean
  reason: string | null
  firstSeenAt: string | null
  lastSeenAt: string | null
}

export function isAnthropicBillingOrAvailabilityError(error: unknown): boolean {
  const { status, text } = extractProviderErrorDetails(error)
  if (/credit balance is too low|credits? (?:is |are )?too low|insufficient(?:_| )credits?|billing|payment required|quota exceeded|over quota/i.test(text)) {
    return true
  }
  if ((status === 401 || status === 403) && /credit|billing|payment|quota|balance/i.test(text)) return true
  return false
}

export function isAnthropicTransientUnavailable(error: unknown): boolean {
  const { status, text } = extractProviderErrorDetails(error)
  if (status === 529 || status === 502 || status === 503 || status === 504) return true
  return /overloaded|temporarily unavailable|service unavailable|connection reset|timeout/i.test(text)
}

export function shouldEnableAnthropicDegradedFromStats(params: {
  billingHits: number
  unavailableHits: number
  threshold?: number
}): boolean {
  return params.billingHits > 0 || params.unavailableHits >= (params.threshold ?? 5)
}

export async function getAnthropicDegradedState(supabase: SupabaseClient): Promise<AnthropicDegradedState> {
  const { data, error } = await supabase
    .from('pipeline_alerts')
    .select('payload, first_seen_at, last_seen_at')
    .eq('dedupe_key', `${ANTHROPIC_UNAVAILABLE_ALERT_TYPE}:${ANTHROPIC_UNAVAILABLE_ENTITY_KEY}`)
    .eq('status', 'open')
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) {
    return { active: false, reason: null, firstSeenAt: null, lastSeenAt: null }
  }

  const payload = (data.payload ?? {}) as Record<string, unknown>
  return {
    active: true,
    reason: typeof payload.reason === 'string' ? payload.reason : null,
    firstSeenAt: data.first_seen_at ? String(data.first_seen_at) : null,
    lastSeenAt: data.last_seen_at ? String(data.last_seen_at) : null,
  }
}

export async function enableAnthropicDegradedMode(params: {
  supabase: SupabaseClient
  reason: string
  payload?: Record<string, unknown>
  botToken?: string
  adminChatId?: string
}): Promise<boolean> {
  return fireAlert({
    supabase: params.supabase,
    alertType: 'anthropic_unavailable',
    severity: 'critical',
    entityKey: ANTHROPIC_UNAVAILABLE_ENTITY_KEY,
    message:
      `Anthropic недоступен (причина: ${params.reason}). ` +
      'Включён degraded-режим: low-risk статьи публикуются на DeepSeek без reviewer, high-risk ждут восстановления.',
    payload: {
      reason: params.reason,
      degraded: true,
      ...(params.payload ?? {}),
    },
    botToken: params.botToken ?? process.env.TELEGRAM_BOT_TOKEN,
    adminChatId: params.adminChatId ?? process.env.TELEGRAM_ADMIN_CHAT_ID,
  })
}

export async function disableAnthropicDegradedMode(params: {
  supabase: SupabaseClient
  reason?: string
  botToken?: string
  adminChatId?: string
}): Promise<{ wasActive: boolean; releasedHighRisk: number }> {
  const state = await getAnthropicDegradedState(params.supabase)
  if (!state.active) return { wasActive: false, releasedHighRisk: 0 }

  const releasedHighRisk = await releaseAnthropicDegradedArticles(params.supabase)
  await resolveAlert(params.supabase, ANTHROPIC_UNAVAILABLE_ALERT_TYPE, ANTHROPIC_UNAVAILABLE_ENTITY_KEY)
  await sendTelegramAdminMessage(
    params.botToken ?? process.env.TELEGRAM_BOT_TOKEN,
    params.adminChatId ?? process.env.TELEGRAM_ADMIN_CHAT_ID,
    `Anthropic снова доступен, режим вернулся к обычному, в очереди ${releasedHighRisk} high-risk статей.`,
  )

  return { wasActive: true, releasedHighRisk }
}

export async function parkArticleForAnthropicRecovery(params: {
  supabase: SupabaseClient
  articleId: string
  claimToken: string | null
  reason: string
  retryAfterMs?: number
}): Promise<boolean> {
  if (!params.claimToken) return false
  const now = new Date().toISOString()
  const nextRetryAt = new Date(Date.now() + (params.retryAfterMs ?? 6 * 60 * 60 * 1000)).toISOString()
  const { data, error } = await params.supabase
    .from('articles')
    .update({
      enrich_status: 'retry_wait',
      publish_status: 'draft',
      claim_token: null,
      processing_by: null,
      lease_expires_at: null,
      processing_finished_at: now,
      next_retry_at: nextRetryAt,
      current_batch_item_id: null,
      last_error: `anthropic_degraded: ${params.reason}`,
      last_error_code: ANTHROPIC_DEGRADED_ERROR_CODE,
      updated_at: now,
    })
    .eq('id', params.articleId)
    .eq('claim_token', params.claimToken)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error(`[provider-degraded] park failed for ${params.articleId}: ${error.message}`)
    return false
  }
  return Boolean(data)
}

export async function releaseAnthropicDegradedArticles(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from('articles')
    .update({
      enrich_status: 'pending',
      next_retry_at: null,
      last_error: null,
      last_error_code: null,
      updated_at: new Date().toISOString(),
    })
    .eq('enrich_status', 'retry_wait')
    .eq('last_error_code', ANTHROPIC_DEGRADED_ERROR_CODE)
    .select('id')

  if (error) {
    console.error(`[provider-degraded] release parked articles failed: ${error.message}`)
    return 0
  }
  return data?.length ?? 0
}

export async function probeAnthropicAvailability(apiKey = process.env.ANTHROPIC_API_KEY): Promise<{
  ok: boolean
  error: string | null
  unavailable: boolean
}> {
  if (!apiKey) return { ok: false, error: 'ANTHROPIC_API_KEY missing', unavailable: false }
  try {
    const client = new Anthropic({ apiKey })
    await client.messages.create({
      model: MODEL,
      max_tokens: 1,
      temperature: 0,
      messages: [{ role: 'user', content: 'ping' }],
    } as any)
    return { ok: true, error: null, unavailable: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      error: message,
      unavailable: isAnthropicBillingOrAvailabilityError(error) || isAnthropicTransientUnavailable(error),
    }
  }
}

function extractProviderErrorDetails(error: unknown): { status: number | null; text: string } {
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : null
  const parts: string[] = []

  if (error instanceof Error) parts.push(error.message)
  if (typeof error === 'string') parts.push(error)
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    for (const key of ['message', 'type']) {
      if (typeof record[key] === 'string') parts.push(record[key])
    }
    const providerError = record.error
    if (providerError && typeof providerError === 'object') {
      const providerRecord = providerError as Record<string, unknown>
      for (const key of ['message', 'type']) {
        if (typeof providerRecord[key] === 'string') parts.push(providerRecord[key])
      }
      const nestedError = providerRecord.error
      if (nestedError && typeof nestedError === 'object') {
        const nestedRecord = nestedError as Record<string, unknown>
        for (const key of ['message', 'type']) {
          if (typeof nestedRecord[key] === 'string') parts.push(nestedRecord[key])
        }
      }
    }
  }

  return { status: Number.isFinite(status) ? status : null, text: parts.join(' ') }
}

async function sendTelegramAdminMessage(
  botToken: string | undefined,
  chatId: string | undefined,
  message: string,
): Promise<void> {
  if (!botToken || !chatId) return
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `ℹ️ <b>Pipeline alert</b>\n${message}`,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })
  } catch (error) {
    console.error(`[provider-degraded] Telegram recovery push failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
