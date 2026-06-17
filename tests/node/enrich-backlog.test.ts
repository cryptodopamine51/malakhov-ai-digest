import { test } from 'node:test'
import assert from 'node:assert/strict'

import { summarizeEnrichBacklogCandidates } from '../../lib/enrich-backlog'

function row(id: string, source: string, created_at: string) {
  return { id, source_name: source, created_at }
}

test('source-capped pending rows are excluded from actionable oldest age', () => {
  const now = new Date('2026-06-12T00:00:00.000Z')
  const snapshot = summarizeEnrichBacklogCandidates(
    [
      row('old-capped', 'Habr AI', '2026-06-11T12:00:00.000Z'),
      row('new-actionable', 'The Verge AI', '2026-06-11T23:00:00.000Z'),
    ],
    new Map([['Habr AI', 10]]),
    now,
    10,
  )

  assert.equal(snapshot.totalDueCount, 2)
  assert.equal(snapshot.actionableCount, 1)
  assert.equal(snapshot.parkedBySourceCapCount, 1)
  assert.deepEqual(snapshot.parkedBySource, [{ source: 'Habr AI', count: 1 }])
  assert.equal(snapshot.oldestActionableCreatedAt, '2026-06-11T23:00:00.000Z')
  assert.equal(snapshot.oldestActionableAgeMinutes, 60)
})

test('all parked rows produce no actionable age', () => {
  const snapshot = summarizeEnrichBacklogCandidates(
    [
      row('1', 'Habr AI', '2026-06-11T12:00:00.000Z'),
      row('2', 'Habr AI', '2026-06-11T13:00:00.000Z'),
    ],
    new Map([['Habr AI', 10]]),
    new Date('2026-06-12T00:00:00.000Z'),
    10,
  )

  assert.equal(snapshot.actionableCount, 0)
  assert.equal(snapshot.parkedBySourceCapCount, 2)
  assert.equal(snapshot.oldestActionableAgeMinutes, null)
})
