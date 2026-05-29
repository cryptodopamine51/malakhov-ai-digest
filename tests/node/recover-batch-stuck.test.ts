import test from 'node:test'
import assert from 'node:assert/strict'

import { filterGenuinelyStuckBatches } from '../../pipeline/recover-batch-stuck'

const STUCK_MINUTES = 90
const NOW = Date.parse('2026-05-29T12:00:00.000Z')
const POLL_THRESHOLD_MS = NOW - STUCK_MINUTES * 60_000 // 10:30:00Z

function isoMinutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString()
}

test('young batch rescued to epoch last_polled is NOT flagged stuck', () => {
  // null-poll rescue sets last_polled_at to 1970, but the batch itself is 6 min old.
  const rows = [
    {
      id: 'batch-young',
      provider_batch_id: 'msgbatch_young',
      processing_status: 'in_progress',
      last_polled_at: '1970-01-01T00:00:00Z',
      created_at: isoMinutesAgo(6),
    },
  ]
  assert.deepEqual(filterGenuinelyStuckBatches(rows, POLL_THRESHOLD_MS), [])
})

test('genuinely old batch (created before threshold) IS flagged stuck', () => {
  const rows = [
    {
      id: 'batch-old',
      provider_batch_id: 'msgbatch_old',
      processing_status: 'in_progress',
      last_polled_at: '1970-01-01T00:00:00Z',
      created_at: isoMinutesAgo(200),
    },
  ]
  const result = filterGenuinelyStuckBatches(rows, POLL_THRESHOLD_MS)
  assert.equal(result.length, 1)
  assert.equal(result[0]!.id, 'batch-old')
})

test('batch created exactly at threshold IS flagged (boundary inclusive)', () => {
  const rows = [
    {
      id: 'batch-boundary',
      provider_batch_id: 'msgbatch_boundary',
      processing_status: 'in_progress',
      last_polled_at: null,
      created_at: new Date(POLL_THRESHOLD_MS).toISOString(),
    },
  ]
  assert.equal(filterGenuinelyStuckBatches(rows, POLL_THRESHOLD_MS).length, 1)
})

test('handles Postgres +00:00 offset format, not just Z suffix', () => {
  const rows = [
    {
      id: 'batch-pg-old',
      provider_batch_id: 'msgbatch_pg_old',
      processing_status: 'in_progress',
      last_polled_at: null,
      created_at: '2026-05-29T08:00:00.123456+00:00', // 4h ago, well past threshold
    },
    {
      id: 'batch-pg-young',
      provider_batch_id: 'msgbatch_pg_young',
      processing_status: 'in_progress',
      last_polled_at: '1970-01-01T00:00:00+00:00',
      created_at: '2026-05-29T11:55:00.999999+00:00', // 5 min ago
    },
  ]
  const result = filterGenuinelyStuckBatches(rows, POLL_THRESHOLD_MS)
  assert.deepEqual(result.map((r) => r.id), ['batch-pg-old'])
})

test('drops rows with null/unparseable created_at', () => {
  const rows = [
    {
      id: 'batch-null-created',
      provider_batch_id: 'msgbatch_null',
      processing_status: 'in_progress',
      last_polled_at: '1970-01-01T00:00:00Z',
      created_at: null,
    },
    {
      id: 'batch-bad-created',
      provider_batch_id: 'msgbatch_bad',
      processing_status: 'in_progress',
      last_polled_at: '1970-01-01T00:00:00Z',
      created_at: 'not-a-date',
    },
  ]
  assert.deepEqual(filterGenuinelyStuckBatches(rows, POLL_THRESHOLD_MS), [])
})
