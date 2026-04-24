import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assertServiceRoleKey,
  claimDigestSlot,
  deliverClaimedDigest,
  finalizeDigestSuccess,
} from '../../bot/daily-digest'

type Operation = {
  table: string
  kind: 'insert' | 'update'
  payload: Record<string, unknown>
  filters: Array<[string, unknown]>
}

function createSupabaseMock(options: {
  insertError?: { code?: string; message: string } | null
  insertData?: Record<string, unknown>
  updateData?: Record<string, unknown>[]
  updateError?: { message: string } | null
} = {}) {
  const operations: Operation[] = []

  return {
    operations,
    from(table: string) {
      const state: {
        operation: Operation | null
        updateTerminal: boolean
      } = {
        operation: null,
        updateTerminal: false,
      }

      const builder = {
        insert(payload: Record<string, unknown>) {
          state.operation = { table, kind: 'insert', payload, filters: [] }
          operations.push(state.operation)
          return builder
        },
        update(payload: Record<string, unknown>) {
          state.operation = { table, kind: 'update', payload, filters: [] }
          operations.push(state.operation)
          return builder
        },
        select() {
          if (state.updateTerminal) {
            return Promise.resolve({
              data: options.updateData ?? [],
              error: options.updateError ?? null,
            })
          }
          return builder
        },
        single() {
          return Promise.resolve({
            data: options.insertData ?? { id: 'run-1' },
            error: options.insertError ?? null,
          })
        },
        eq(column: string, value: unknown) {
          state.operation?.filters.push([column, value])
          if (state.operation?.kind === 'update') {
            return Promise.resolve({ error: options.updateError ?? null })
          }
          return builder
        },
        in(column: string, value: unknown) {
          state.operation?.filters.push([column, value])
          state.updateTerminal = true
          return builder
        },
      }

      return builder
    },
  }
}

test('claimDigestSlot returns claimed=false on 23505', async () => {
  const supabase = createSupabaseMock({
    insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
  })

  const result = await claimDigestSlot(supabase as never, '2026-04-24', '@channel')

  assert.deepEqual(result, { claimed: false, reason: 'already_claimed' })
  assert.equal(supabase.operations[0]?.table, 'digest_runs')
  assert.equal(supabase.operations[0]?.payload.status, 'running')
})

test('missing service key fails before Telegram API', () => {
  const previousKey = process.env.SUPABASE_SERVICE_KEY
  delete process.env.SUPABASE_SERVICE_KEY

  try {
    assert.throws(() => assertServiceRoleKey(), /SUPABASE_SERVICE_KEY не задан/)
  } finally {
    if (previousKey === undefined) {
      delete process.env.SUPABASE_SERVICE_KEY
    } else {
      process.env.SUPABASE_SERVICE_KEY = previousKey
    }
  }
})

test('finalizeDigestSuccess writes Telegram metadata and message hash', async () => {
  const supabase = createSupabaseMock()

  await finalizeDigestSuccess(
    supabase as never,
    'run-1',
    12345,
    ['00000000-0000-0000-0000-000000000001'],
    'digest text',
    'https://news.example.com',
  )

  const update = supabase.operations[0]
  assert.equal(update?.table, 'digest_runs')
  assert.equal(update?.kind, 'update')
  assert.equal(update?.payload.status, 'success')
  assert.equal(update?.payload.telegram_message_id, 12345)
  assert.equal(update?.payload.articles_count, 1)
  assert.match(String(update?.payload.message_hash), /^[a-f0-9]{32}$/)
  assert.deepEqual(update?.filters, [['id', 'run-1']])
})

test('telegram error leaves tg_sent untouched and marks run failed', async () => {
  const supabase = createSupabaseMock()

  await assert.rejects(
    () => deliverClaimedDigest(
      supabase as never,
      'run-1',
      'bot-token',
      '@channel',
      'digest text',
      ['article-1'],
      'https://news.example.com',
      async () => {
        throw new Error('Telegram API вернул ok=false')
      },
    ),
    /Telegram API/,
  )

  assert.equal(
    supabase.operations.some((operation) => operation.table === 'articles'),
    false,
  )

  const failedRun = supabase.operations.find((operation) => operation.table === 'digest_runs')
  assert.equal(failedRun?.payload.status, 'failed')
  assert.match(String(failedRun?.payload.error_message), /Telegram API/)
})
