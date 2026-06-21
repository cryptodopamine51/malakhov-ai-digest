import test from 'node:test'
import assert from 'node:assert/strict'

import { fireAlert, _internals } from '../../pipeline/alerts'

interface MockCall {
  table: string
  op: string
  payload?: Record<string, unknown>
}

function mockSupabase(): { client: { from: (table: string) => Record<string, unknown> }; calls: MockCall[] } {
  const calls: MockCall[] = []
  return {
    calls,
    client: {
      from(table: string) {
        const builder: Record<string, unknown> = {}
        builder.select = () => builder
        builder.eq = () => builder
        builder.order = () => builder
        builder.limit = () => builder
        builder.maybeSingle = async () => ({ data: null, error: null })
        builder.insert = async (payload: Record<string, unknown>) => {
          calls.push({ table, op: 'insert', payload })
          return { error: null }
        }
        builder.update = (payload: Record<string, unknown>) => {
          calls.push({ table, op: 'update', payload })
          return builder
        }
        return builder
      },
    },
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

test('default immediate Telegram policy keeps all alerts in the dashboard only', () => {
  const previous = process.env.TELEGRAM_IMMEDIATE_ALERT_MIN_SEVERITY
  delete process.env.TELEGRAM_IMMEDIATE_ALERT_MIN_SEVERITY
  try {
    assert.equal(_internals.shouldSendImmediateTelegramAlert('warning', 'source_down'), false)
    assert.equal(_internals.shouldSendImmediateTelegramAlert('critical', 'source_down'), false)
  } finally {
    restoreEnv('TELEGRAM_IMMEDIATE_ALERT_MIN_SEVERITY', previous)
  }
})

test('fireAlert writes warning to DB but suppresses immediate Telegram by default', async () => {
  const previousMin = process.env.TELEGRAM_IMMEDIATE_ALERT_MIN_SEVERITY
  delete process.env.TELEGRAM_IMMEDIATE_ALERT_MIN_SEVERITY
  const previousFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = (async () => {
    fetchCalls += 1
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 })
  }) as typeof fetch

  const supabase = mockSupabase()
  try {
    const sent = await fireAlert({
      supabase: supabase.client as never,
      alertType: 'claude_parse_failed',
      severity: 'warning',
      message: 'parse failed',
      botToken: 'bot-token',
      adminChatId: 'admin-chat',
    })
    assert.equal(sent, false)
    assert.equal(fetchCalls, 0)
    assert.equal(supabase.calls.find((call) => call.table === 'pipeline_alerts' && call.op === 'insert')?.payload?.alert_type, 'claude_parse_failed')
  } finally {
    globalThis.fetch = previousFetch
    restoreEnv('TELEGRAM_IMMEDIATE_ALERT_MIN_SEVERITY', previousMin)
  }
})

test('fireAlert sends critical alert immediately', async () => {
  const previousMin = process.env.TELEGRAM_IMMEDIATE_ALERT_MIN_SEVERITY
  process.env.TELEGRAM_IMMEDIATE_ALERT_MIN_SEVERITY = 'critical'
  const previousFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = (async () => {
    fetchCalls += 1
    return new Response(JSON.stringify({ ok: true, result: { message_id: 2 } }), { status: 200 })
  }) as typeof fetch

  const supabase = mockSupabase()
  try {
    const sent = await fireAlert({
      supabase: supabase.client as never,
      alertType: 'publish_verify_failed',
      severity: 'critical',
      message: 'verify failed',
      botToken: 'bot-token',
      adminChatId: 'admin-chat',
    })
    assert.equal(sent, true)
    assert.equal(fetchCalls, 1)
  } finally {
    globalThis.fetch = previousFetch
    restoreEnv('TELEGRAM_IMMEDIATE_ALERT_MIN_SEVERITY', previousMin)
  }
})
