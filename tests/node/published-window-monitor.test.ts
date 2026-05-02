import test from 'node:test'
import assert from 'node:assert/strict'

import {
  checkLiveWindow,
  decideWindow,
  isQuietWindow,
  runPublishedWindowMonitor,
} from '../../pipeline/published-window-monitor'

/**
 * Wave 2.1 contract — `pipeline/published-window-monitor.ts`.
 *
 * Покрывает 4 кейса из spec § 2:
 *  (a) 0 live за окно, активные feeds → fire warning
 *  (b) 0 live + все ingest_runs failed → silent (downstream-сигнал)
 *  (c) ночное «тихое окно» МСК (00:00–06:00) → silent
 *  (d) после live за окно → resolveAlert
 */

interface MockTable {
  count?: number
  rows?: unknown[]
}

interface MockOptions {
  articlesLiveCount?: number
  ingestRows?: Array<{ status: string }>
}

function mockSupabase(opts: MockOptions = {}): { from: (name: string) => unknown; calls: Array<{ table: string; op: string; payload?: unknown }> } {
  const calls: Array<{ table: string; op: string; payload?: unknown }> = []

  function makeBuilder(table: string, response: { data: unknown; count: number | null }): unknown {
    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.eq = () => builder
    builder.in = () => builder
    builder.gte = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.maybeSingle = async () => ({ data: Array.isArray(response.data) ? (response.data as unknown[])[0] ?? null : response.data ?? null, error: null })
    const thenable = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
      return Promise.resolve({ data: response.data, error: null, count: response.count }).then(onFulfilled, onRejected)
    }
    builder.then = thenable
    builder.update = (payload: unknown) => {
      calls.push({ table, op: 'update', payload })
      return builder
    }
    builder.insert = (payload: unknown) => {
      calls.push({ table, op: 'insert', payload })
      return builder
    }
    return builder
  }

  return {
    calls,
    from(name: string) {
      if (name === 'articles') {
        return makeBuilder(name, { data: [], count: opts.articlesLiveCount ?? 0 })
      }
      if (name === 'ingest_runs') {
        return makeBuilder(name, { data: opts.ingestRows ?? [], count: (opts.ingestRows ?? []).length })
      }
      if (name === 'pipeline_alerts') {
        // fireAlert / resolveAlert query pipeline_alerts. Always return "no existing alert"
        // so insert path (or no-op resolve) executes deterministically.
        return makeBuilder(name, { data: null, count: 0 })
      }
      return makeBuilder(name, { data: [], count: 0 })
    },
  }
}

test('isQuietWindow: 03:00 МСК ночью внутри 00–06 = quiet', () => {
  // 03:00 МСК = 00:00 UTC
  assert.equal(isQuietWindow(new Date('2026-05-02T00:00:00.000Z'), 0, 6), true)
})

test('isQuietWindow: 12:00 МСК (09:00 UTC) — не quiet', () => {
  assert.equal(isQuietWindow(new Date('2026-05-02T09:00:00.000Z'), 0, 6), false)
})

test('isQuietWindow: wraparound 22→4 покрывает 23:00 МСК', () => {
  // 23:00 МСК = 20:00 UTC
  assert.equal(isQuietWindow(new Date('2026-05-02T20:00:00.000Z'), 22, 4), true)
})

test('decideWindow: live present → resolve', () => {
  const dec = decideWindow({ liveCount: 3, ingestActive: true, ingestRowsTotal: 5 }, false)
  assert.equal(dec.kind, 'resolve')
})

test('decideWindow: 0 live + active ingest + не quiet → fire', () => {
  const dec = decideWindow({ liveCount: 0, ingestActive: true, ingestRowsTotal: 5 }, false)
  assert.equal(dec.kind, 'fire')
})

test('decideWindow: 0 live + ingest_inactive → noop', () => {
  const dec = decideWindow({ liveCount: 0, ingestActive: false, ingestRowsTotal: 5 }, false)
  assert.equal(dec.kind, 'noop')
  if (dec.kind === 'noop') assert.equal(dec.reason, 'ingest_inactive')
})

test('decideWindow: 0 live в quiet window → noop', () => {
  const dec = decideWindow({ liveCount: 0, ingestActive: true, ingestRowsTotal: 5 }, true)
  assert.equal(dec.kind, 'noop')
  if (dec.kind === 'noop') assert.equal(dec.reason, 'quiet_window')
})

test('checkLiveWindow считает только активные ingest_runs', async () => {
  const supabase = mockSupabase({
    articlesLiveCount: 0,
    ingestRows: [{ status: 'failed' }, { status: 'failed' }],
  })
  const snap = await checkLiveWindow(supabase as never, 6, new Date('2026-05-02T12:00:00Z'))
  assert.equal(snap.liveCount, 0)
  assert.equal(snap.ingestActive, false)
  assert.equal(snap.ingestRowsTotal, 2)
})

test('case (a) — 0 live + ok ingest, дневной час → fire warning + insert в pipeline_alerts', async () => {
  const supabase = mockSupabase({
    articlesLiveCount: 0,
    ingestRows: [{ status: 'ok' }, { status: 'ok' }],
  })
  const result = await runPublishedWindowMonitor(supabase as never, {
    windowHours: 6,
    now: new Date('2026-05-02T12:00:00Z'), // 15:00 МСК
  })
  assert.equal(result.decision.kind, 'fire')
  const inserts = (supabase as { calls: Array<{ table: string; op: string; payload?: unknown }> }).calls.filter(
    (c) => c.table === 'pipeline_alerts' && c.op === 'insert',
  )
  assert.equal(inserts.length, 1, 'expected one insert into pipeline_alerts')
  const payload = inserts[0]!.payload as { alert_type: string; severity: string }
  assert.equal(payload.alert_type, 'published_low_window')
  assert.equal(payload.severity, 'warning')
})

test('case (b) — 0 live + все ingest_runs failed → noop, никаких записей', async () => {
  const supabase = mockSupabase({
    articlesLiveCount: 0,
    ingestRows: [{ status: 'failed' }, { status: 'failed' }],
  })
  const result = await runPublishedWindowMonitor(supabase as never, {
    windowHours: 6,
    now: new Date('2026-05-02T12:00:00Z'),
  })
  assert.equal(result.decision.kind, 'noop')
  if (result.decision.kind === 'noop') {
    assert.equal(result.decision.reason, 'ingest_inactive')
  }
  const writes = (supabase as { calls: Array<{ table: string; op: string }> }).calls.filter(
    (c) => c.table === 'pipeline_alerts' && (c.op === 'insert' || c.op === 'update'),
  )
  assert.equal(writes.length, 0, 'no alert writes on ingest_inactive')
})

test('case (c) — quiet window МСК (03:00 МСК = 00:00 UTC) → noop', async () => {
  const supabase = mockSupabase({
    articlesLiveCount: 0,
    ingestRows: [{ status: 'ok' }],
  })
  const result = await runPublishedWindowMonitor(supabase as never, {
    windowHours: 6,
    quietStartMsk: 0,
    quietEndMsk: 6,
    now: new Date('2026-05-02T00:00:00Z'),
  })
  assert.equal(result.decision.kind, 'noop')
  if (result.decision.kind === 'noop') {
    assert.equal(result.decision.reason, 'quiet_window')
  }
})

test('case (d) — есть live → resolveAlert (update в pipeline_alerts по dedupe_key)', async () => {
  const supabase = mockSupabase({
    articlesLiveCount: 4,
    ingestRows: [{ status: 'ok' }],
  })
  const result = await runPublishedWindowMonitor(supabase as never, {
    windowHours: 6,
    now: new Date('2026-05-02T12:00:00Z'),
  })
  assert.equal(result.decision.kind, 'resolve')
  const updates = (supabase as { calls: Array<{ table: string; op: string; payload?: unknown }> }).calls.filter(
    (c) => c.table === 'pipeline_alerts' && c.op === 'update',
  )
  assert.equal(updates.length, 1, 'expected resolveAlert to issue an update')
  const u = updates[0]!.payload as { status: string }
  assert.equal(u.status, 'resolved')
})
