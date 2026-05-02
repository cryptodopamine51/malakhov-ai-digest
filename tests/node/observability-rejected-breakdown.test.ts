import test from 'node:test'
import assert from 'node:assert/strict'

import { bumpRejectedBreakdown as bumpSubmit } from '../../pipeline/enrich-submit-batch'
import { bumpRejectedBreakdown as bumpCollect } from '../../pipeline/enrich-collect-batch'
import { finishEnrichRun } from '../../pipeline/enrich-runtime'
import { ZERO_USAGE_TOTALS } from '../../pipeline/llm-usage'

/**
 * Wave 2.3 — `enrich_runs.rejected_breakdown` агрегатор причин reject.
 * См. docs/spec_observability_publication_2026-05-01.md § 1.
 *
 *  - submit-batch коллекционирует pre-submit reject коды (rejected_low_visual, low_score)
 *  - collect-batch коллекционирует post-collect quality_reason (research_too_short:N, etc)
 *  - finishEnrichRun пишет `rejected_breakdown` в строку enrich_runs
 *  - при отсутствии колонки (старая БД) — fallback без поля, без падения.
 */

test('bumpRejectedBreakdown (submit) suммирует одинаковые причины', () => {
  const map: Record<string, number> = {}
  bumpSubmit(map, 'rejected_low_visual')
  bumpSubmit(map, 'rejected_low_visual')
  bumpSubmit(map, 'low_score')
  assert.deepEqual(map, { rejected_low_visual: 2, low_score: 1 })
})

test('bumpRejectedBreakdown игнорирует null / пустые значения', () => {
  const map: Record<string, number> = {}
  bumpSubmit(map, null)
  bumpSubmit(map, undefined)
  bumpSubmit(map, '')
  bumpSubmit(map, '   ')
  assert.deepEqual(map, {})
})

test('bumpRejectedBreakdown (collect) сохраняет полный quality_reason c длиной', () => {
  const map: Record<string, number> = {}
  bumpCollect(map, 'research_too_short: 1240')
  bumpCollect(map, 'research_too_short: 1240')
  bumpCollect(map, 'research_too_short: 980')
  bumpCollect(map, 'unspecified')
  // Полная форма сохраняется — health-summary потом схлопнет по префиксу.
  assert.equal(map['research_too_short: 1240'], 2)
  assert.equal(map['research_too_short: 980'], 1)
  assert.equal(map['unspecified'], 1)
})

interface UpdateCall {
  payload: Record<string, unknown>
}

function makeRecordingSupabase(updateError: { message: string } | null): {
  client: { from: (name: string) => unknown }
  calls: UpdateCall[]
} {
  const calls: UpdateCall[] = []
  const builder: Record<string, unknown> = {}
  builder.update = (payload: Record<string, unknown>) => {
    calls.push({ payload })
    return builder
  }
  builder.eq = () => Promise.resolve({ error: updateError })

  return {
    calls,
    client: {
      from(_name: string) {
        // reset chain on each call to ensure each `from(...)` returns its own thenable
        const local: Record<string, unknown> = {}
        local.update = (payload: Record<string, unknown>) => {
          calls.push({ payload })
          return local
        }
        local.eq = () => Promise.resolve({ error: updateError })
        return local
      },
    },
  }
}

test('finishEnrichRun пишет rejected_breakdown в первый update', async () => {
  const { client, calls } = makeRecordingSupabase(null)
  await finishEnrichRun(client as never, 'run-1', {
    claimed: 5,
    enrichedOk: 2,
    rejected: 3,
    retryable: 0,
    failed: 0,
    oldestPendingAgeMinutes: 0,
    usage: ZERO_USAGE_TOTALS,
    rejectedBreakdown: { rejected_low_visual: 2, low_score: 1 },
  })

  assert.equal(calls.length, 1)
  const payload = calls[0]!.payload
  assert.deepEqual(payload.rejected_breakdown, { rejected_low_visual: 2, low_score: 1 })
  assert.equal(payload.articles_rejected, 3)
})

test('finishEnrichRun отсутствие breakdown даёт пустой объект', async () => {
  const { client, calls } = makeRecordingSupabase(null)
  await finishEnrichRun(client as never, 'run-2', {
    claimed: 0,
    enrichedOk: 0,
    rejected: 0,
    retryable: 0,
    failed: 0,
    oldestPendingAgeMinutes: null,
    usage: ZERO_USAGE_TOTALS,
  })

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0]!.payload.rejected_breakdown, {})
})

test('finishEnrichRun: legacy fallback при отсутствии колонки rejected_breakdown', async () => {
  const calls: UpdateCall[] = []
  let firstCall = true
  const client = {
    from(_name: string) {
      const local: Record<string, unknown> = {}
      local.update = (payload: Record<string, unknown>) => {
        calls.push({ payload })
        return local
      }
      local.eq = () => {
        if (firstCall) {
          firstCall = false
          return Promise.resolve({ error: { message: 'column "rejected_breakdown" does not exist' } })
        }
        return Promise.resolve({ error: null })
      }
      return local
    },
  }

  await finishEnrichRun(client as never, 'run-3', {
    claimed: 1,
    enrichedOk: 0,
    rejected: 1,
    retryable: 0,
    failed: 0,
    oldestPendingAgeMinutes: 0,
    usage: ZERO_USAGE_TOTALS,
    rejectedBreakdown: { rejected_low_visual: 1 },
  })

  assert.equal(calls.length, 2, 'legacy fallback should issue a second update without rejected_breakdown')
  assert.ok(!('rejected_breakdown' in calls[1]!.payload))
})
