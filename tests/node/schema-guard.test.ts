import assert from 'node:assert/strict'
import test from 'node:test'

import {
  WEEKLY_REPORT_SCHEMA,
  assertSchemaReady,
  findMissingTables,
  isMissingObjectError,
} from '../../pipeline/schema-guard'
import { runWeeklyReport } from '../../bot/weekly-report-core'

function tableStub(present: Set<string>) {
  return {
    from(table: string) {
      const builder = {
        select() {
          return builder
        },
        limit() {
          if (present.has(table)) return Promise.resolve({ error: null })
          return Promise.resolve({
            error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` },
          })
        },
        then(onFulfilled: (value: { error: unknown }) => unknown) {
          // .limit() уже возвращает промис; этот then нужен лишь если await на builder.
          return Promise.resolve({ error: null }).then(onFulfilled)
        },
      }
      return builder
    },
  }
}

test('isMissingObjectError распознаёт PostgREST/Postgres коды отсутствия объекта', () => {
  assert.equal(isMissingObjectError({ code: 'PGRST205' }), true)
  assert.equal(isMissingObjectError({ code: 'PGRST202' }), true)
  assert.equal(isMissingObjectError({ code: '42P01' }), true)
  assert.equal(isMissingObjectError({ message: 'relation "x" does not exist' }), true)
  assert.equal(isMissingObjectError({ message: 'Could not find the function public.foo in the schema cache' }), true)
  assert.equal(isMissingObjectError(null), false)
  assert.equal(isMissingObjectError({ code: '42501', message: 'permission denied' }), false)
})

test('findMissingTables возвращает только отсутствующие таблицы', async () => {
  const supabase = tableStub(new Set(['present_table']))
  const missing = await findMissingTables(supabase as never, ['present_table', 'absent_table'])
  assert.deepEqual(missing, ['absent_table'])
})

test('assertSchemaReady кидает actionable ошибку с именем миграции', async () => {
  const supabase = tableStub(new Set())
  await assert.rejects(
    () => assertSchemaReady(supabase as never, WEEKLY_REPORT_SCHEMA),
    /weekly report: schema not applied.*weekly_report_runs.*20260622073323_weekly_telegram_report\.sql/s,
  )
  const ok = tableStub(new Set(['weekly_report_runs']))
  await assert.doesNotReject(() => assertSchemaReady(ok as never, WEEKLY_REPORT_SCHEMA))
})

test('scheduled weekly report падает внятно, если таблицы нет в проде', async () => {
  const candidates = Array.from({ length: 10 }, (_, index) => index)
  await assert.rejects(
    () =>
      runWeeklyReport({
        weekStart: '2026-06-15',
        format: 'signal',
        delivery: 'scheduled',
        supabase: tableStub(new Set()) as never,
        botToken: 'token',
        adminChatId: 'chat',
        fetchCandidates: async () => candidates as never,
        sendMessage: async () => ({ result: { message_id: 1 } }),
      }),
    /schema not applied.*20260622073323/s,
  )
})
