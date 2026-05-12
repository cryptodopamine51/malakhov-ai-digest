import { test } from 'node:test'
import assert from 'node:assert/strict'

import { selectInlineImageSlots } from '../../lib/article-media-placement'

test('selectInlineImageSlots skips short articles', () => {
  assert.deepEqual(selectInlineImageSlots(0, 3), [])
  assert.deepEqual(selectInlineImageSlots(3, 3), [])
})

test('selectInlineImageSlots never places an image after the final paragraph', () => {
  const slots = selectInlineImageSlots(8, 5)

  assert.ok(slots.length > 0)
  assert.ok(slots.every((slot) => slot < 7))
})

test('selectInlineImageSlots spaces images inside longer articles', () => {
  const slots = selectInlineImageSlots(16, 10)

  assert.deepEqual(slots, [2, 6, 10, 14])
  for (let index = 1; index < slots.length; index++) {
    assert.ok(slots[index] - slots[index - 1] >= 3)
  }
})

test('selectInlineImageSlots caps output by available images', () => {
  assert.deepEqual(selectInlineImageSlots(20, 2), [2, 6])
})
