import { test } from 'node:test'
import assert from 'node:assert/strict'

import { rankInterestingArticles, rankInterestingArticlesWithFallback, scoreInterestingArticle } from '../../lib/interest-ranking'
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
