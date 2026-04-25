import { test } from 'node:test'
import assert from 'node:assert/strict'

import { splitTopicsToCategories, isKnownCategory, DEFAULT_CATEGORY } from '../../lib/categories'

test('splitTopicsToCategories: первый известный topic становится primary, остальные — secondary', () => {
  const { primary, secondary } = splitTopicsToCategories(['ai-research', 'ai-industry', 'ai-labs'])
  assert.equal(primary, 'ai-research')
  assert.deepEqual(secondary, ['ai-industry', 'ai-labs'])
})

test('splitTopicsToCategories: secondary ограничивается двумя элементами', () => {
  const { secondary } = splitTopicsToCategories(['ai-industry', 'ai-research', 'ai-labs', 'ai-startups'])
  assert.equal(secondary.length, 2)
})

test('splitTopicsToCategories: неизвестные topic-и игнорируются', () => {
  const { primary, secondary } = splitTopicsToCategories(['something-unknown', 'ai-labs', 'another'])
  assert.equal(primary, 'ai-labs')
  assert.deepEqual(secondary, [])
})

test('splitTopicsToCategories: дубликаты схлопываются', () => {
  const { primary, secondary } = splitTopicsToCategories(['ai-industry', 'ai-industry', 'ai-research'])
  assert.equal(primary, 'ai-industry')
  assert.deepEqual(secondary, ['ai-research'])
})

test('splitTopicsToCategories: пустой/null вход даёт DEFAULT_CATEGORY и пустой secondary', () => {
  for (const input of [null, undefined, [], ['unknown-only']]) {
    const { primary, secondary } = splitTopicsToCategories(input as string[] | null | undefined)
    assert.equal(primary, DEFAULT_CATEGORY)
    assert.deepEqual(secondary, [])
  }
})

test('isKnownCategory: распознаёт текущие slug-и и отвергает остальное', () => {
  assert.equal(isKnownCategory('ai-research'), true)
  assert.equal(isKnownCategory('coding'), true)
  assert.equal(isKnownCategory('research'), false)
  assert.equal(isKnownCategory(null), false)
  assert.equal(isKnownCategory(undefined), false)
  assert.equal(isKnownCategory(''), false)
})
