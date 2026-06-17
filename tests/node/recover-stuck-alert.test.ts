import test from 'node:test'
import assert from 'node:assert/strict'

import { recoverStuck } from '../../pipeline/recover-stuck'

interface MockCall {
  table: string
  op: string
  payload?: Record<string, unknown>
}

function mockSupabase(
  stuckCount: number,
  overrides: Record<string, unknown> = {},
): { client: { from: (table: string) => Record<string, unknown> }; calls: MockCall[] } {
  const calls: MockCall[] = []
  const stuck = Array.from({ length: stuckCount }, (_, index) => ({
    id: `article-${index + 1}`,
    attempt_count: 0,
    processing_by: 'worker-1',
    claim_token: `claim-${index + 1}`,
    lease_expires_at: '2026-05-02T09:00:00.000Z',
    original_title: `Article ${index + 1}`,
    current_batch_item_id: null,
    ...overrides,
  }))

  return {
    calls,
    client: {
      from(table: string) {
        const builder: Record<string, unknown> = {}
        let op = 'select'

        builder.select = () => {
          op = 'select'
          return builder
        }
        builder.update = (payload: Record<string, unknown>) => {
          op = 'update'
          calls.push({ table, op, payload })
          return builder
        }
        builder.insert = async (payload: Record<string, unknown>) => {
          calls.push({ table, op: 'insert', payload })
          return { error: null }
        }
        builder.eq = (column: string, value: unknown) => {
          calls.push({ table, op: 'filter:eq', payload: { column, value } })
          return builder
        }
        builder.is = (column: string, value: unknown) => {
          calls.push({ table, op: 'filter:is', payload: { column, value } })
          return builder
        }
        builder.or = (expression: string) => {
          calls.push({ table, op: 'filter:or', payload: { expression } })
          return builder
        }
        builder.lte = (column: string, value: unknown) => {
          calls.push({ table, op: 'filter:lte', payload: { column, value } })
          return builder
        }
        builder.limit = () => builder
        builder.order = () => builder
        builder.maybeSingle = async () => ({ data: null, error: null })
        builder.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => {
          const value = table === 'articles' && op === 'select'
            ? { data: stuck, error: null }
            : { error: null }
          return Promise.resolve(value).then(onFulfilled, onRejected)
        }
        return builder
      },
    },
  }
}

test('recoverStuck fires lease_expired_spike when more than three articles recover', async () => {
  const supabase = mockSupabase(4)
  const previousBotToken = process.env.TELEGRAM_BOT_TOKEN
  const previousAdminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_ADMIN_CHAT_ID

  try {
    const result = await recoverStuck(supabase.client as never)

    assert.deepEqual(result, { scanned: 4, recovered: 4 })
    const alertInsert = supabase.calls.find((call) => call.table === 'pipeline_alerts' && call.op === 'insert')
    assert.ok(alertInsert, 'expected lease_expired_spike alert insert')
    assert.equal(alertInsert!.payload?.alert_type, 'lease_expired_spike')
    assert.equal(alertInsert!.payload?.severity, 'warning')
    assert.deepEqual(alertInsert!.payload?.payload, {
      recovered: 4,
      scanned: 4,
      threshold: 3,
    })
  } finally {
    if (previousBotToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN
    else process.env.TELEGRAM_BOT_TOKEN = previousBotToken
    if (previousAdminChatId === undefined) delete process.env.TELEGRAM_ADMIN_CHAT_ID
    else process.env.TELEGRAM_ADMIN_CHAT_ID = previousAdminChatId
  }
})

test('recoverStuck does not fire spike alert at three recovered articles', async () => {
  const supabase = mockSupabase(3)
  const result = await recoverStuck(supabase.client as never)

  assert.deepEqual(result, { scanned: 3, recovered: 3 })
  const alertInsert = supabase.calls.find((call) => call.table === 'pipeline_alerts' && call.op === 'insert')
  assert.equal(alertInsert, undefined)
})

test('recoverStuck recovers processing rows with null lease and null claim token', async () => {
  const supabase = mockSupabase(1, {
    processing_by: null,
    claim_token: null,
    lease_expires_at: null,
  })

  const result = await recoverStuck(supabase.client as never)

  assert.deepEqual(result, { scanned: 1, recovered: 1 })
  assert.ok(
    supabase.calls.some((call) =>
      call.table === 'articles' &&
      call.op === 'filter:or' &&
      String(call.payload?.expression).includes('lease_expires_at.is.null') &&
      String(call.payload?.expression).includes('processing_by.is.null')
    ),
    'expected null lease/worker rows to be selected as stuck',
  )
  assert.ok(
    supabase.calls.some((call) =>
      call.table === 'articles' &&
      call.op === 'filter:is' &&
      call.payload?.column === 'claim_token' &&
      call.payload?.value === null
    ),
    'expected null claim token update guard',
  )
  const articleUpdate = supabase.calls.find((call) => call.table === 'articles' && call.op === 'update')
  assert.equal(articleUpdate?.payload?.last_error, 'lease expired (was held by unknown)')
})
