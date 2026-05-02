import test from 'node:test'
import assert from 'node:assert/strict'

import { writeLlmUsageLog, ZERO_USAGE_TOTALS } from '../../pipeline/llm-usage'

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
        if (table === 'llm_usage_logs') {
          return {
            async insert() {
              throw new Error('database connection dropped')
            },
          }
        }

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

test('writeLlmUsageLog does not throw and fires warning alert when insert throws', async () => {
  const supabase = mockSupabase()
  const previousBotToken = process.env.TELEGRAM_BOT_TOKEN
  const previousAdminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_ADMIN_CHAT_ID

  try {
    await assert.doesNotReject(() => writeLlmUsageLog({
      supabase: supabase.client as never,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      operation: 'editorial_batch_result',
      runKind: 'batch_collect',
      enrichRunId: 'run-1',
      articleId: 'article-1',
      batchItemId: 'batch-item-1',
      resultStatus: 'ok',
      usage: ZERO_USAGE_TOTALS,
    }))
  } finally {
    if (previousBotToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN
    else process.env.TELEGRAM_BOT_TOKEN = previousBotToken
    if (previousAdminChatId === undefined) delete process.env.TELEGRAM_ADMIN_CHAT_ID
    else process.env.TELEGRAM_ADMIN_CHAT_ID = previousAdminChatId
  }

  const alertInsert = supabase.calls.find((call) => call.table === 'pipeline_alerts' && call.op === 'insert')
  assert.ok(alertInsert, 'expected pipeline_alerts insert')
  assert.equal(alertInsert!.payload?.alert_type, 'llm_usage_log_write_failed')
  assert.equal(alertInsert!.payload?.severity, 'warning')
  assert.equal(alertInsert!.payload?.entity_key, 'run-1')
  assert.match(String(alertInsert!.payload?.message), /database connection dropped/)
})
