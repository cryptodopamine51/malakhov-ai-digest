import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  rankArticleRecommendations,
  rankInterestingArticles,
  rankInterestingArticlesWithFallback,
  scoreInterestingArticle,
} from '../../lib/interest-ranking'
import type { Article } from '../../lib/supabase'

function article(overrides: Partial<Article>): Article {
  const now = new Date('2026-05-01T12:00:00.000Z').toISOString()
  return {
    id: overrides.id ?? 'article-1',
    original_url: 'https://example.com/story',
    original_title: 'OpenAI GPT agent benchmark for enterprise AI',
    original_text: 'OpenAI GPT agent benchmark chart enterprise AI product.',
    source_name: 'OpenAI',
    source_lang: 'en',
    topics: ['ai-industry'],
    primary_category: 'ai-industry',
    secondary_categories: [],
    pub_date: now,
    cover_image_url: 'https://example.com/cover.jpg',
    ru_title: 'OpenAI GPT agent benchmark',
    ru_text: null,
    why_it_matters: null,
    lead: 'OpenAI показала GPT agent benchmark.',
    summary: ['OpenAI benchmark', 'GPT agent', 'Enterprise AI'],
    card_teaser: 'Короткий вывод про OpenAI GPT agents.',
    tg_teaser: null,
    editorial_body: 'x'.repeat(1400),
    editorial_model: null,
    glossary: null,
    link_anchors: null,
    article_tables: null,
    article_images: null,
    article_videos: null,
    quality_ok: true,
    quality_reason: null,
    dedup_hash: null,
    enriched: true,
    published: true,
    tg_sent: false,
    score: 5,
    slug: overrides.slug ?? null,
    created_at: now,
    updated_at: now,
    ingest_status: 'ingested',
    enrich_status: 'enriched_ok',
    publish_status: 'live',
    first_seen_at: now,
    last_seen_at: now,
    discover_count: 1,
    attempt_count: 0,
    processing_started_at: null,
    processing_finished_at: null,
    processing_by: null,
    claim_token: null,
    lease_expires_at: null,
    last_error: null,
    last_error_code: null,
    next_retry_at: null,
    publish_ready_at: now,
    verified_live: true,
    verified_live_at: now,
    live_check_error: null,
    current_batch_item_id: null,
    last_publish_verifier: null,
    published_at: null,
    ...overrides,
  }
}

const fixedNow = new Date('2026-05-01T12:00:00.000Z')

test('rankInterestingArticles freshness can beat older high-score article', () => {
  const olderHighQuality = article({
    id: 'old-high',
    source_name: 'OpenAI',
    score: 10,
    created_at: '2026-04-29T12:00:00.000Z',
    pub_date: '2026-04-29T12:00:00.000Z',
  })
  const newerMedium = article({
    id: 'new-medium',
    source_name: 'TechCrunch',
    score: 3,
    created_at: '2026-05-01T11:00:00.000Z',
    pub_date: '2026-05-01T11:00:00.000Z',
  })
  const filler = [
    article({
      id: 'filler-1',
      source_name: 'The Verge',
      score: 1,
      created_at: '2026-04-29T12:00:00.000Z',
      pub_date: '2026-04-29T12:00:00.000Z',
    }),
    article({
      id: 'filler-2',
      source_name: 'MIT Technology Review',
      score: 1,
      created_at: '2026-04-29T12:00:00.000Z',
      pub_date: '2026-04-29T12:00:00.000Z',
    }),
  ]

  const ranked = rankInterestingArticles([newerMedium, olderHighQuality, ...filler], {
    now: fixedNow,
    limit: 4,
  })

  assert.equal(ranked[0].article.id, 'new-medium')
})

test('scoreInterestingArticle uses 24h freshness decay', () => {
  const twelveHoursOld = scoreInterestingArticle(article({
    id: 'twelve-hours',
    created_at: '2026-05-01T00:00:00.000Z',
    pub_date: '2026-05-01T00:00:00.000Z',
  }), fixedNow)
  const seventyTwoHoursOld = scoreInterestingArticle(article({
    id: 'seventy-two-hours',
    created_at: '2026-04-28T12:00:00.000Z',
    pub_date: '2026-04-28T12:00:00.000Z',
  }), fixedNow)

  assert.ok(Math.abs(twelveHoursOld.components.freshnessScore - 6.07) < 0.05)
  assert.ok(seventyTwoHoursOld.components.freshnessScore < 1)
})

test('rankInterestingArticles limits same-source dominance when alternatives exist', () => {
  const sameSource = [0, 1, 2, 3].map((i) => article({
    id: `same-${i}`,
    source_name: 'OpenAI',
    score: 10 - i * 0.1,
    created_at: `2026-05-01T1${i}:00:00.000Z`,
    pub_date: `2026-05-01T1${i}:00:00.000Z`,
  }))
  const alternatives = [
    article({ id: 'alt-1', source_name: 'Anthropic', score: 7 }),
    article({ id: 'alt-2', source_name: 'The Verge', score: 6 }),
    article({ id: 'alt-3', source_name: 'TechCrunch', score: 5 }),
  ]

  const ranked = rankInterestingArticles([...sameSource, ...alternatives], {
    now: fixedNow,
    limit: 4,
  })

  assert.equal(ranked.length, 4)
  assert.ok(ranked.filter((item) => item.article.source_name === 'OpenAI').length <= 2)
})

test('rankInterestingArticles hides block when fewer than three candidates remain', () => {
  const ranked = rankInterestingArticles([
    article({ id: 'one' }),
    article({ id: 'two', source_name: 'Anthropic' }),
  ], {
    now: fixedNow,
    limit: 4,
  })

  assert.deepEqual(ranked, [])
})

test('rankInterestingArticles ordering is deterministic with fixed now', () => {
  const candidates = [
    article({ id: 'a', source_name: 'OpenAI', score: 8 }),
    article({ id: 'b', source_name: 'Anthropic', score: 7 }),
    article({ id: 'c', source_name: 'The Verge', score: 6 }),
  ]

  const first = rankInterestingArticles(candidates, { now: fixedNow }).map((item) => item.article.id)
  const second = rankInterestingArticles(candidates, { now: fixedNow }).map((item) => item.article.id)

  assert.deepEqual(first, second)
})

test('rankInterestingArticlesWithFallback uses wider window after excluded fresh page', () => {
  const firstFreshPage = [
    article({ id: 'fresh-1', source_name: 'OpenAI', created_at: '2026-05-01T11:00:00.000Z', pub_date: '2026-05-01T11:00:00.000Z' }),
    article({ id: 'fresh-2', source_name: 'Anthropic', created_at: '2026-05-01T10:00:00.000Z', pub_date: '2026-05-01T10:00:00.000Z' }),
    article({ id: 'fresh-3', source_name: 'The Verge', created_at: '2026-05-01T09:00:00.000Z', pub_date: '2026-05-01T09:00:00.000Z' }),
    article({ id: 'fresh-4', source_name: 'TechCrunch', created_at: '2026-05-01T08:00:00.000Z', pub_date: '2026-05-01T08:00:00.000Z' }),
  ]
  const widerWindow = [
    ...firstFreshPage,
    article({ id: 'older-1', source_name: 'MIT Technology Review', created_at: '2026-04-24T12:00:00.000Z', pub_date: '2026-04-24T12:00:00.000Z', score: 9 }),
    article({ id: 'older-2', source_name: 'Wired', created_at: '2026-04-23T12:00:00.000Z', pub_date: '2026-04-23T12:00:00.000Z', score: 8 }),
    article({ id: 'older-3', source_name: 'VentureBeat', created_at: '2026-04-22T12:00:00.000Z', pub_date: '2026-04-22T12:00:00.000Z', score: 7 }),
  ]

  const ranked = rankInterestingArticlesWithFallback(firstFreshPage, widerWindow, {
    now: fixedNow,
    limit: 4,
    excludeIds: firstFreshPage.map((item) => item.id),
  })

  assert.deepEqual(ranked.map((item) => item.article.id), ['older-1', 'older-2', 'older-3'])
})

test('importance: multi-source big funding beats a fresher trivial item', () => {
  // Один крупный раунд, подтверждённый тремя независимыми источниками, но опубликованный
  // на ~6 часов раньше, чем проходная заметка без entity/события.
  const fundingBase = {
    original_title: 'Anthropic raises $3.5B in new funding round',
    ru_title: 'Anthropic привлекла $3,5 млрд в новом раунде',
    lead: 'Anthropic закрыла раунд на $3,5 млрд.',
    primary_category: 'ai-startups',
    score: 5,
    created_at: '2026-05-01T06:00:00.000Z',
    pub_date: '2026-05-01T06:00:00.000Z',
  }
  const fundingCluster = [
    article({ id: 'fund-tc', source_name: 'TechCrunch', ...fundingBase }),
    article({ id: 'fund-vb', source_name: 'VentureBeat', ...fundingBase }),
    article({ id: 'fund-decoder', source_name: 'The Decoder', ...fundingBase }),
  ]
  const freshTrivial = article({
    id: 'trivial-fresh',
    source_name: 'Habr AI',
    original_title: 'Подборка полезных советов по настройке редактора',
    ru_title: 'Подборка полезных советов по настройке редактора',
    lead: 'Небольшая заметка с советами.',
    primary_category: 'coding',
    score: 5,
    created_at: '2026-05-01T11:30:00.000Z',
    pub_date: '2026-05-01T11:30:00.000Z',
  })

  const ranked = rankInterestingArticles([freshTrivial, ...fundingCluster], {
    now: fixedNow,
    limit: 4,
  })

  assert.equal(ranked[0].article.source_name !== 'Habr AI', true)
  assert.ok(ranked[0].components.importance.multiSourceBonus >= 2)
  assert.ok(ranked[0].components.importance.magnitudeBonus >= 3)
})

test('importance: model release of a known lab beats a same-age minor update', () => {
  const release = article({
    id: 'release',
    source_name: 'The Verge',
    original_title: 'OpenAI launches GPT-6 with new reasoning modes',
    ru_title: 'OpenAI выпустила GPT-6 с новыми режимами рассуждений',
    lead: 'OpenAI представила GPT-6.',
    primary_category: 'ai-industry',
    score: 5,
    created_at: '2026-05-01T08:00:00.000Z',
    pub_date: '2026-05-01T08:00:00.000Z',
  })
  const minorUpdate = article({
    id: 'minor',
    source_name: 'Habr AI',
    original_title: 'Обновили внутреннюю панель мониторинга сервиса',
    ru_title: 'Обновили внутреннюю панель мониторинга сервиса',
    lead: 'Мелкое обновление панели.',
    primary_category: 'ai-industry',
    score: 5,
    created_at: '2026-05-01T08:00:00.000Z',
    pub_date: '2026-05-01T08:00:00.000Z',
  })
  const filler = [
    article({ id: 'fill-a', source_name: 'TechCrunch', original_title: 'Заметка про индустрию', ru_title: 'Заметка про индустрию', primary_category: 'ai-industry', score: 3, created_at: '2026-05-01T07:00:00.000Z', pub_date: '2026-05-01T07:00:00.000Z' }),
    article({ id: 'fill-b', source_name: 'VentureBeat', original_title: 'Ещё одна заметка', ru_title: 'Ещё одна заметка', primary_category: 'ai-industry', score: 3, created_at: '2026-05-01T07:00:00.000Z', pub_date: '2026-05-01T07:00:00.000Z' }),
  ]

  const ranked = rankInterestingArticles([minorUpdate, release, ...filler], {
    now: fixedNow,
    limit: 4,
  })

  assert.equal(ranked[0].article.id, 'release')
  assert.ok(ranked[0].components.importance.eventTypeWeight >= 2)
})

test('importance: recommendations get a soft importance nudge within same relevance', () => {
  const current = article({ id: 'current', primary_category: 'ai-startups', topics: [] })
  const bigStory = article({
    id: 'big-story',
    source_name: 'TechCrunch',
    original_title: 'Mistral raises $2B in fresh funding round',
    ru_title: 'Mistral привлекла $2 млрд в новом раунде',
    lead: 'Mistral закрыла раунд на $2 млрд.',
    primary_category: 'ai-startups',
    secondary_categories: [],
    topics: [],
    score: 5,
    created_at: '2026-05-01T08:00:00.000Z',
    pub_date: '2026-05-01T08:00:00.000Z',
  })
  const plainStory = article({
    id: 'plain-story',
    source_name: 'TechCrunch',
    original_title: 'Небольшой апдейт продукта без деталей',
    ru_title: 'Небольшой апдейт продукта без деталей',
    lead: 'Краткая заметка.',
    primary_category: 'ai-startups',
    secondary_categories: [],
    topics: [],
    score: 5,
    created_at: '2026-05-01T08:00:00.000Z',
    pub_date: '2026-05-01T08:00:00.000Z',
  })
  const filler = [
    article({ id: 'rec-fill-a', source_name: 'The Verge', primary_category: 'ai-startups', secondary_categories: [], topics: [], score: 1 }),
    article({ id: 'rec-fill-b', source_name: 'Wired', primary_category: 'ai-startups', secondary_categories: [], topics: [], score: 1 }),
  ]

  const ranked = rankArticleRecommendations(current, [plainStory, bigStory, ...filler], {
    now: fixedNow,
    limit: 3,
  })

  assert.equal(ranked[0].article.id, 'big-story')
  assert.ok(ranked[0].components.importanceScore > 0)
})

test('rankArticleRecommendations keeps same primary category first', () => {
  const current = article({
    id: 'current',
    primary_category: 'ai-research',
    secondary_categories: ['ai-industry'],
    topics: ['models', 'agents'],
  })
  const samePrimaryOlder = article({
    id: 'same-primary',
    source_name: 'MIT Technology Review',
    primary_category: 'ai-research',
    created_at: '2026-04-29T12:00:00.000Z',
    pub_date: '2026-04-29T12:00:00.000Z',
    score: 4,
  })
  const sharedButFresh = article({
    id: 'shared-fresh',
    source_name: 'OpenAI',
    primary_category: 'ai-industry',
    secondary_categories: ['ai-research'],
    topics: ['models'],
    created_at: '2026-05-01T11:30:00.000Z',
    pub_date: '2026-05-01T11:30:00.000Z',
    score: 10,
  })
  const filler = [
    article({ id: 'filler-a', source_name: 'The Verge', primary_category: 'coding' }),
    article({ id: 'filler-b', source_name: 'TechCrunch', primary_category: 'ai-startups' }),
  ]

  const ranked = rankArticleRecommendations(current, [sharedButFresh, samePrimaryOlder, ...filler], {
    now: fixedNow,
    limit: 3,
  })

  assert.equal(ranked[0].article.id, 'same-primary')
})

test('rankArticleRecommendations excludes current article and limits source dominance', () => {
  const current = article({ id: 'current', primary_category: 'ai-industry' })
  const candidates = [
    current,
    article({ id: 'openai-1', source_name: 'OpenAI', primary_category: 'ai-industry', score: 10 }),
    article({ id: 'openai-2', source_name: 'OpenAI', primary_category: 'ai-industry', score: 9 }),
    article({ id: 'openai-3', source_name: 'OpenAI', primary_category: 'ai-industry', score: 8 }),
    article({ id: 'anthropic', source_name: 'Anthropic', primary_category: 'ai-industry', score: 7 }),
    article({ id: 'verge', source_name: 'The Verge', primary_category: 'ai-industry', score: 6 }),
  ]

  const ranked = rankArticleRecommendations(current, candidates, {
    now: fixedNow,
    limit: 4,
  })

  assert.equal(ranked.length, 4)
  assert.equal(ranked.some((item) => item.article.id === 'current'), false)
  assert.ok(ranked.filter((item) => item.article.source_name === 'OpenAI').length <= 2)
})

test('rankArticleRecommendations hides block when fewer than minimum remain', () => {
  const current = article({ id: 'current' })
  const ranked = rankArticleRecommendations(current, [
    article({ id: 'one', source_name: 'OpenAI' }),
    article({ id: 'two', source_name: 'Anthropic' }),
  ], {
    now: fixedNow,
    limit: 3,
  })

  assert.deepEqual(ranked, [])
})
