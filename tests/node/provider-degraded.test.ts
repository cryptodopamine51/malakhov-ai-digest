import test from 'node:test'
import assert from 'node:assert/strict'

import {
  enableAnthropicDegradedMode,
  isAnthropicBillingOrAvailabilityError,
  isAnthropicTransientUnavailable,
  shouldEnableAnthropicDegradedFromStats,
} from '../../pipeline/provider-degraded'

function mockSupabase() {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = []
  return {
    inserts,
    client: {
      from(table: string) {
        const builder: Record<string, unknown> = {}
        builder.select = () => builder
        builder.eq = () => builder
        builder.order = () => builder
        builder.limit = () => builder
        builder.maybeSingle = async () => ({ data: null, error: null })
        builder.insert = async (payload: Record<string, unknown>) => {
          inserts.push({ table, payload })
          return { error: null }
        }
        builder.update = () => builder
        return builder
      },
    },
  }
}

test('isAnthropicBillingOrAvailabilityError detects credits and billing failures', () => {
  assert.equal(isAnthropicBillingOrAvailabilityError({
    status: 403,
    error: { error: { message: 'Your credit balance is too low to access the Anthropic API' } },
  }), true)

  assert.equal(isAnthropicBillingOrAvailabilityError({
    status: 403,
    message: 'permission denied for unrelated resource',
  }), false)
})

test('isAnthropicTransientUnavailable detects provider availability failures', () => {
  assert.equal(isAnthropicTransientUnavailable({ status: 529, message: 'overloaded_error' }), true)
  assert.equal(isAnthropicTransientUnavailable({ status: 400, message: 'invalid request' }), false)
})

test('shouldEnableAnthropicDegradedFromStats uses billing immediately or N unavailable errors', () => {
  assert.equal(shouldEnableAnthropicDegradedFromStats({ billingHits: 1, unavailableHits: 0 }), true)
  assert.equal(shouldEnableAnthropicDegradedFromStats({ billingHits: 0, unavailableHits: 4, threshold: 5 }), false)
  assert.equal(shouldEnableAnthropicDegradedFromStats({ billingHits: 0, unavailableHits: 5, threshold: 5 }), true)
})

test('enableAnthropicDegradedMode writes open alert and sends admin push', async () => {
  const previousMinSeverity = process.env.TELEGRAM_IMMEDIATE_ALERT_MIN_SEVERITY
  process.env.TELEGRAM_IMMEDIATE_ALERT_MIN_SEVERITY = 'critical'
  const supabase = mockSupabase()
  const previousFetch = global.fetch
  const fetchCalls: Array<{ url: string; body: string }> = []
  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), body: String(init?.body ?? '') })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as typeof fetch

  try {
    await enableAnthropicDegradedMode({
      supabase: supabase.client as never,
      reason: 'credit balance is too low',
      botToken: 'bot-token',
      adminChatId: 'admin-chat',
    })
  } finally {
    global.fetch = previousFetch
    if (previousMinSeverity === undefined) delete process.env.TELEGRAM_IMMEDIATE_ALERT_MIN_SEVERITY
    else process.env.TELEGRAM_IMMEDIATE_ALERT_MIN_SEVERITY = previousMinSeverity
  }

  const alert = supabase.inserts.find((call) => call.table === 'pipeline_alerts')?.payload
  assert.equal(alert?.alert_type, 'anthropic_unavailable')
  assert.equal(alert?.severity, 'critical')
  assert.match(String(alert?.message), /Включён degraded-режим/)
  assert.equal(fetchCalls.length, 1)
  assert.match(fetchCalls[0]!.body, /Anthropic недоступен/)
})
