import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveRunStatus } from '../../pipeline/enrich-runtime'

test('resolveRunStatus treats mixed item failures and retryable work as partial, not failed', () => {
  assert.equal(resolveRunStatus({ enrichedOk: 0, rejected: 0, retryable: 1, failed: 1 }), 'partial')
  assert.equal(resolveRunStatus({ enrichedOk: 0, rejected: 1, retryable: 0, failed: 1 }), 'partial')
})

test('resolveRunStatus keeps a pure failed run failed', () => {
  assert.equal(resolveRunStatus({ enrichedOk: 0, rejected: 0, retryable: 0, failed: 1 }), 'failed')
})
