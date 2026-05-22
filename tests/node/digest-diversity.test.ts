import test from 'node:test'
import assert from 'node:assert/strict'

import { applyDiversityCap, buildSourceDistribution } from '../../bot/daily-digest-core'

type Stub = { source_name: string; id: string }

function stub(id: string, source: string): Stub {
  return { id, source_name: source }
}

test('applyDiversityCap keeps at most two articles per source_name', () => {
  const candidates: Stub[] = [
    stub('h1', 'Habr AI'),
    stub('h2', 'Habr AI'),
    stub('h3', 'Habr AI'),
    stub('h4', 'Habr AI'),
    stub('v1', 'The Verge AI'),
    stub('d1', 'The Decoder'),
    stub('t1', 'TechCrunch AI'),
  ]

  const selected = applyDiversityCap(candidates, { perSourceCap: 2, target: 5 })

  assert.equal(selected.length, 5)
  assert.equal(selected.filter((a) => a.source_name === 'Habr AI').length, 2)
  // Преимущество остаётся за исходным score-порядком — первые два Habr-материала входят,
  // следующие пропускаются в пользу The Verge / Decoder / TechCrunch.
  assert.deepEqual(selected.map((a) => a.id), ['h1', 'h2', 'v1', 'd1', 't1'])
})

test('applyDiversityCap returns fewer than target if pool is too narrow', () => {
  const onlyHabr: Stub[] = [
    stub('h1', 'Habr AI'),
    stub('h2', 'Habr AI'),
    stub('h3', 'Habr AI'),
  ]

  const selected = applyDiversityCap(onlyHabr, { perSourceCap: 2, target: 5 })
  assert.equal(selected.length, 2)
})

test('applyDiversityCap respects custom cap and target', () => {
  const articles: Stub[] = [
    stub('h1', 'Habr AI'),
    stub('h2', 'Habr AI'),
    stub('v1', 'The Verge AI'),
    stub('v2', 'The Verge AI'),
  ]

  // cap=1 forces every selected article to come from a unique source.
  const selected = applyDiversityCap(articles, { perSourceCap: 1, target: 3 })
  assert.deepEqual(selected.map((a) => a.id), ['h1', 'v1'])
})

test('buildSourceDistribution returns counts keyed by source_name', () => {
  const distribution = buildSourceDistribution([
    stub('h1', 'Habr AI'),
    stub('h2', 'Habr AI'),
    stub('v1', 'The Verge AI'),
  ])
  assert.deepEqual(distribution, { 'Habr AI': 2, 'The Verge AI': 1 })
})
