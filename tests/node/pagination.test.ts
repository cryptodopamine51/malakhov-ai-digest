import { test } from 'node:test'
import assert from 'node:assert/strict'

import { getPaginationMeta, normalizePositivePage } from '../../lib/pagination'

test('normalizePositivePage returns a positive integer page', () => {
  assert.equal(normalizePositivePage('2'), 2)
  assert.equal(normalizePositivePage(3.8), 3)
  assert.equal(normalizePositivePage('0'), 1)
  assert.equal(normalizePositivePage('-4'), 1)
  assert.equal(normalizePositivePage('not-a-number'), 1)
  assert.equal(normalizePositivePage(undefined), 1)
})

test('getPaginationMeta calculates visible range and total pages', () => {
  assert.deepEqual(getPaginationMeta(47, 1, 20), {
    page: 1,
    perPage: 20,
    total: 47,
    totalPages: 3,
    start: 1,
    end: 20,
  })

  assert.deepEqual(getPaginationMeta(47, 3, 20), {
    page: 3,
    perPage: 20,
    total: 47,
    totalPages: 3,
    start: 41,
    end: 47,
  })
})

test('getPaginationMeta handles empty lists', () => {
  assert.deepEqual(getPaginationMeta(0, 1, 20), {
    page: 1,
    perPage: 20,
    total: 0,
    totalPages: 0,
    start: 0,
    end: 0,
  })
})
