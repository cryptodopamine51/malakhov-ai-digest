import test from 'node:test'
import assert from 'node:assert/strict'

import {
  deriveDigestStory,
  rankDigestCandidates,
  selectDigestArticles,
  type DigestSelectionArticle,
} from '../../bot/digest-selection'

function article(overrides: Partial<DigestSelectionArticle> & { id: string; original_title: string }): DigestSelectionArticle {
  return {
    id: overrides.id,
    source_name: overrides.source_name ?? 'The Decoder',
    original_title: overrides.original_title,
    ru_title: overrides.ru_title ?? null,
    lead: overrides.lead ?? null,
    tg_teaser: overrides.tg_teaser ?? null,
    primary_category: overrides.primary_category ?? 'ai-industry',
    secondary_categories: overrides.secondary_categories ?? [],
    topics: overrides.topics ?? ['ai-industry'],
    score: overrides.score ?? 5,
    pub_date: overrides.pub_date ?? '2026-05-29T10:00:00.000Z',
  }
}

const fundingCluster = [
  article({
    id: 'fund-cb',
    source_name: 'Crunchbase News',
    original_title: 'Anthropic raises $65 Billion funding round, nears $1T valuation',
    ru_title: 'Anthropic привлекла $65 млрд в раунде',
  }),
  article({
    id: 'fund-tc',
    source_name: 'TechCrunch AI',
    original_title: 'Anthropic raises $65 Billion funding round, nears $1T valuation',
    ru_title: 'Anthropic привлекла $65 млрд в раунде',
  }),
  article({
    id: 'fund-decoder',
    source_name: 'The Decoder',
    original_title: 'Anthropic raises $65 Billion funding round, nears $1T valuation',
    ru_title: 'Anthropic привлекла $65 млрд в раунде',
  }),
]

test('rankDigestCandidates lifts a multi-source big funding story above a higher-raw-score trivial item', () => {
  const trivialHighScore = article({
    id: 'trivial',
    source_name: 'Habr AI',
    original_title: 'Подборка заметок без громких событий',
    ru_title: 'Подборка заметок без громких событий',
    score: 8,
  })
  // funding cluster carries lower raw score but is confirmed by three distinct sources.
  const ranked = rankDigestCandidates([
    trivialHighScore,
    ...fundingCluster.map((a) => ({ ...a, score: 4 })),
  ])

  assert.equal(deriveDigestStory(ranked[0]).storyKey, 'anthropic:funding:65b')
})

test('rank → select keeps caps: only one funding article reaches the slots, and it gets a slot', () => {
  const others = [
    article({ id: 'o1', source_name: 'The Verge AI', original_title: 'Google unveils Gemini 3 update', ru_title: 'Google представила обновление Gemini 3', score: 6 }),
    article({ id: 'o2', source_name: 'VentureBeat AI', original_title: 'Регуляторы обсуждают новый закон об ИИ', ru_title: 'Регуляторы обсуждают новый закон об ИИ', score: 6 }),
    article({ id: 'o3', source_name: 'MIT Technology Review AI', original_title: 'Исследование о безопасности моделей', ru_title: 'Исследование о безопасности моделей', score: 6 }),
    article({ id: 'o4', source_name: 'Habr AI', original_title: 'Очередная заметка про индустрию', ru_title: 'Очередная заметка про индустрию', score: 3 }),
  ]

  const ranked = rankDigestCandidates([
    ...others,
    ...fundingCluster.map((a) => ({ ...a, score: 4 })),
  ])
  const { articles, diagnostics } = selectDigestArticles(ranked, [], {
    perSourceCap: 2,
    perPrimaryEntityCap: 2,
    target: 5,
  })

  const fundingSelected = articles.filter((a) => deriveDigestStory(a).storyKey === 'anthropic:funding:65b')
  assert.equal(fundingSelected.length, 1)
  assert.equal(articles.length, 5)
  // The duplicates of the funding story are skipped, not the trivial filler.
  assert.ok(diagnostics.skipped.some((s) => s.reason === 'duplicate_story' && s.storyKey === 'anthropic:funding:65b'))
})

test('rankDigestCandidates is deterministic', () => {
  const pool = [
    ...fundingCluster,
    article({ id: 'x', source_name: 'The Verge AI', original_title: 'Small product note', ru_title: 'Маленькая заметка', score: 7 }),
  ]
  const first = rankDigestCandidates(pool).map((a) => a.id)
  const second = rankDigestCandidates(pool).map((a) => a.id)
  assert.deepEqual(first, second)
})
