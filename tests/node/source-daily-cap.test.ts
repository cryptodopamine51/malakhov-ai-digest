import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applySourceDailyCap } from '../../pipeline/claims'

function c(id: string, source: string | null) {
  return { id, source_name: source }
}

test('пропускает всех, пока источники под кэпом', () => {
  const { allowed, skippedBySource } = applySourceDailyCap(
    [c('1', 'Habr AI'), c('2', 'TechCrunch AI'), c('3', 'Habr AI')],
    new Map(),
    5,
  )
  assert.equal(allowed.length, 3)
  assert.equal(skippedBySource.size, 0)
})

test('режет кандидатов источника сверх кэпа с учётом уже опубликованного сегодня', () => {
  const publishedToday = new Map([['Habr AI', 9]])
  const { allowed, skippedBySource } = applySourceDailyCap(
    [c('1', 'Habr AI'), c('2', 'Habr AI'), c('3', 'The Verge AI')],
    publishedToday,
    10,
  )
  assert.deepEqual(allowed.map((a) => a.id), ['1', '3'])
  assert.equal(skippedBySource.get('Habr AI'), 1)
})

test('источник, выбравший квоту до батча, пропускается целиком', () => {
  const publishedToday = new Map([['Habr AI', 10]])
  const { allowed, skippedBySource } = applySourceDailyCap(
    [c('1', 'Habr AI'), c('2', 'Habr AI'), c('3', 'CNews')],
    publishedToday,
    10,
  )
  assert.deepEqual(allowed.map((a) => a.id), ['3'])
  assert.equal(skippedBySource.get('Habr AI'), 2)
})

test('кандидаты без source_name не ограничиваются', () => {
  const { allowed } = applySourceDailyCap(
    [c('1', null), c('2', null), c('3', null)],
    new Map(),
    1,
  )
  assert.equal(allowed.length, 3)
})

test('порядок кандидатов сохраняется', () => {
  const { allowed } = applySourceDailyCap(
    [c('a', 'X'), c('b', 'Y'), c('c', 'X'), c('d', 'Z')],
    new Map(),
    1,
  )
  assert.deepEqual(allowed.map((a) => a.id), ['a', 'b', 'd'])
})
