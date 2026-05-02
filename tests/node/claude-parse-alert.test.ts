import test from 'node:test'
import assert from 'node:assert/strict'

import { fireClaudeParseFailedAlert } from '../../pipeline/enrich-collect-batch'

function mockSupabase(): {
  client: { from: (table: string) => Record<string, unknown> }
  calls: Array<{ table: string; op: string; payload?: Record<string, unknown> }>
} {
  const calls: Array<{ table: string; op: string; payload?: Record<string, unknown> }> = []
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

test('fireClaudeParseFailedAlert writes warning alert deduped by batch id', async () => {
  const supabase = mockSupabase()
  const previousBotToken = process.env.TELEGRAM_BOT_TOKEN
  const previousAdminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_ADMIN_CHAT_ID

  try {
    await fireClaudeParseFailedAlert(supabase.client as never, {
      runId: 'run-1',
      batchId: 'batch-1',
      itemId: 'item-1',
      reason: 'missing output_text in batch response_payload',
    })
  } finally {
    if (previousBotToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN
    else process.env.TELEGRAM_BOT_TOKEN = previousBotToken
    if (previousAdminChatId === undefined) delete process.env.TELEGRAM_ADMIN_CHAT_ID
    else process.env.TELEGRAM_ADMIN_CHAT_ID = previousAdminChatId
  }

  const insert = supabase.calls.find((call) => call.table === 'pipeline_alerts' && call.op === 'insert')
  assert.ok(insert, 'expected pipeline_alerts insert')
  assert.equal(insert!.payload?.alert_type, 'claude_parse_failed')
  assert.equal(insert!.payload?.severity, 'warning')
  assert.equal(insert!.payload?.entity_key, 'batch-1')
  assert.equal(insert!.payload?.dedupe_key, 'claude_parse_failed:batch-1')
  assert.deepEqual(insert!.payload?.payload, {
    runId: 'run-1',
    batchId: 'batch-1',
    itemId: 'item-1',
    reason: 'missing output_text in batch response_payload',
  })
})
