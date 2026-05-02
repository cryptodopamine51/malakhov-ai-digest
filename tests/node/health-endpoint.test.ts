import test from 'node:test'
import assert from 'node:assert/strict'

import { getHealthSummary, _internals } from '../../lib/health-summary'

type AnyBuilder = Record<string, unknown> & { __end: () => unknown }

interface MockTable {
  rows: unknown[]
  count?: number
}

interface MockOptions {
  tables: Record<string, MockTable>
}

function makeBuilder(table: MockTable): AnyBuilder {
  const builder: AnyBuilder = {
    select() { return builder },
    eq() { return builder },
    in() { return builder },
    gte() { return builder },
    order() { return builder },
    limit() { return builder },
    async maybeSingle() {
      return { data: table.rows[0] ?? null, error: null }
    },
    __end() {
      return Promise.resolve({
        data: table.rows,
        error: null,
        count: table.count ?? table.rows.length,
      })
    },
    then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
      return (builder.__end() as Promise<unknown>).then(onFulfilled, onRejected)
    },
  }
  return builder
}

function mockSupabase(opts: MockOptions): { from: (name: string) => AnyBuilder } {
  return {
    from(name: string) {
      const t = opts.tables[name] ?? { rows: [], count: 0 }
      return makeBuilder(t)
    },
  }
}

test('startOfMskDayUtcIso returns 21:00 UTC of previous day for early-morning UTC', () => {
  const start = _internals.startOfMskDayUtcIso(new Date('2026-05-02T02:00:00.000Z'))
  // 02:00 UTC == 05:00 MSK same day → MSK day start was 2026-05-02T00:00 MSK == 2026-05-01T21:00 UTC
  assert.equal(start, '2026-05-01T21:00:00.000Z')
})

test('mergeBreakdownPrefix collapses keys by prefix before colon', () => {
  const out: Record<string, number> = {}
  _internals.mergeBreakdownPrefix(out, { 'research_too_short:1240': 1, 'research_too_short:980': 2, rejected_low_visual: 3 })
  assert.deepEqual(out, { research_too_short: 3, rejected_low_visual: 3 })
})

test('mergeBreakdownPrefix ignores non-numeric values', () => {
  const out: Record<string, number> = {}
  _internals.mergeBreakdownPrefix(out, { ok: 1, bad: 'x' as unknown as number, missing: NaN })
  assert.deepEqual(out, { ok: 1 })
})

test('getHealthSummary contract shape — all required keys present', async () => {
  const supabase = mockSupabase({
    tables: {
      ingest_runs: { rows: [{ finished_at: '2026-05-02T08:00:00Z', status: 'ok' }] },
      enrich_runs: { rows: [{ rejected_breakdown: { rejected_low_visual: 2 } }], count: 1 },
      digest_runs: { rows: [{ digest_date: '2026-05-02', status: 'success', sent_at: '2026-05-02T06:00:00Z' }] },
      pipeline_alerts: { rows: [{ alert_type: 'backlog_high', severity: 'warning', first_seen_at: '2026-05-02T07:00:00Z', last_seen_at: '2026-05-02T08:00:00Z', occurrence_count: 3, message: 'msg' }], count: 2 },
      anthropic_batches: { rows: [], count: 1 },
      articles: { rows: [{ created_at: '2026-05-02T05:00:00Z' }], count: 4 },
      llm_usage_logs: { rows: [{ estimated_cost_usd: 0.123 }, { estimated_cost_usd: 0.456 }] },
    },
  })

  const summary = await getHealthSummary(supabase as never)

  assert.ok(typeof summary.server_time === 'string')
  assert.ok('ingest' in summary)
  assert.ok('enrich' in summary)
  assert.ok('digest' in summary)
  assert.equal(typeof summary.alerts_open, 'number')
  assert.equal(typeof summary.batches_open, 'number')
  assert.ok('oldest_pending_age_minutes' in summary)
  assert.equal(typeof summary.articles_published_today, 'number')
  assert.ok(summary.articles_rejected_today_by_reason && typeof summary.articles_rejected_today_by_reason === 'object')
  assert.equal(typeof summary.cost_today_usd, 'number')
  assert.equal(typeof summary.live_window_6h_count, 'number')
  assert.ok(Array.isArray(summary.top_open_alerts))
})

test('getHealthSummary aggregates rejected_breakdown across runs', async () => {
  const supabase = mockSupabase({
    tables: {
      ingest_runs: { rows: [] },
      enrich_runs: {
        rows: [
          { rejected_breakdown: { rejected_low_visual: 2, 'research_too_short:1240': 1 } },
          { rejected_breakdown: { rejected_low_visual: 3, scorer_below_threshold: 5 } },
        ],
      },
      digest_runs: { rows: [] },
      pipeline_alerts: { rows: [], count: 0 },
      anthropic_batches: { rows: [], count: 0 },
      articles: { rows: [], count: 0 },
      llm_usage_logs: { rows: [] },
    },
  })

  const summary = await getHealthSummary(supabase as never)
  assert.deepEqual(summary.articles_rejected_today_by_reason, {
    rejected_low_visual: 5,
    research_too_short: 1,
    scorer_below_threshold: 5,
  })
})

test('getHealthSummary cost is rounded to micro-USD precision', async () => {
  const supabase = mockSupabase({
    tables: {
      ingest_runs: { rows: [] },
      enrich_runs: { rows: [] },
      digest_runs: { rows: [] },
      pipeline_alerts: { rows: [], count: 0 },
      anthropic_batches: { rows: [], count: 0 },
      articles: { rows: [], count: 0 },
      llm_usage_logs: { rows: [{ estimated_cost_usd: 0.1234567 }, { estimated_cost_usd: 0.0000003 }] },
    },
  })

  const summary = await getHealthSummary(supabase as never)
  assert.equal(summary.cost_today_usd, 0.123457)
})

test('getHealthSummary returns null age when no pending articles', async () => {
  const supabase = mockSupabase({
    tables: {
      ingest_runs: { rows: [] },
      enrich_runs: { rows: [] },
      digest_runs: { rows: [] },
      pipeline_alerts: { rows: [], count: 0 },
      anthropic_batches: { rows: [], count: 0 },
      articles: { rows: [], count: 0 },
      llm_usage_logs: { rows: [] },
    },
  })

  const summary = await getHealthSummary(supabase as never)
  assert.equal(summary.oldest_pending_age_minutes, null)
})
