import { test } from 'node:test'
import assert from 'node:assert/strict'

import { compareArticlesByFreshness } from '../../lib/interest-ranking'
import type { Article } from '../../lib/supabase'

function article(overrides: Partial<Article>): Article {
  const now = new Date('2026-05-01T12:00:00.000Z').toISOString()
  return {
    id: 'article-1',
    original_url: 'https://example.com/story',
    original_title: 'AI story',
    original_text: null,
    source_name: 'Example',
    source_lang: 'en',
    topics: ['ai-industry'],
    primary_category: 'ai-industry',
    secondary_categories: [],
    pub_date: now,
    cover_image_url: null,
    ru_title: null,
    ru_text: null,
    why_it_matters: null,
    lead: null,
    summary: null,
    card_teaser: null,
    tg_teaser: null,
    editorial_body: null,
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
    score: 0,
    slug: null,
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

test('category freshness comparator keeps newer article above older high-score article', () => {
  const olderHighScore = article({
    id: 'older-high-score',
    score: 9,
    pub_date: '2026-05-01T08:00:00.000Z',
    created_at: '2026-05-01T08:00:00.000Z',
  })
  const newerLowScore = article({
    id: 'newer-low-score',
    score: 3,
    pub_date: '2026-05-01T10:00:00.000Z',
    created_at: '2026-05-01T10:00:00.000Z',
  })

  const sorted = [olderHighScore, newerLowScore].sort(compareArticlesByFreshness)

  assert.equal(sorted[0].id, 'newer-low-score')
  assert.equal(sorted[1].id, 'older-high-score')
})

test('category freshness comparator prefers created_at over newer source pub_date', () => {
  const olderIngestedLater = article({
    id: 'older-source-newer-ingest',
    score: 2,
    pub_date: '2026-04-01T12:00:00.000Z',
    created_at: '2026-05-01T11:00:00.000Z',
  })
  const newerSourceIngestedEarlier = article({
    id: 'newer-source-older-ingest',
    score: 9,
    pub_date: '2026-04-30T12:00:00.000Z',
    created_at: '2026-05-01T10:00:00.000Z',
  })

  const sorted = [newerSourceIngestedEarlier, olderIngestedLater].sort(compareArticlesByFreshness)

  assert.equal(sorted[0].id, 'older-source-newer-ingest')
  assert.equal(sorted[1].id, 'newer-source-older-ingest')
})

test('category freshness comparator uses score and id only as tie-breakers', () => {
  const lowerScore = article({
    id: 'a-lower-score',
    score: 2,
    pub_date: '2026-05-01T10:00:00.000Z',
    created_at: '2026-05-01T10:00:00.000Z',
  })
  const higherScore = article({
    id: 'b-higher-score',
    score: 8,
    pub_date: '2026-05-01T10:00:00.000Z',
    created_at: '2026-05-01T10:00:00.000Z',
  })

  const sorted = [lowerScore, higherScore].sort(compareArticlesByFreshness)

  assert.equal(sorted[0].id, 'b-higher-score')
})

test('category freshness pagination keeps stable non-overlapping pages', () => {
  const articles = [
    article({ id: 'newest', pub_date: '2026-05-01T12:00:00.000Z', created_at: '2026-05-01T12:00:00.000Z' }),
    article({ id: 'older-high', score: 10, pub_date: '2026-05-01T09:00:00.000Z', created_at: '2026-05-01T09:00:00.000Z' }),
    article({ id: 'middle', score: 4, pub_date: '2026-05-01T10:00:00.000Z', created_at: '2026-05-01T10:00:00.000Z' }),
    article({ id: 'oldest', pub_date: '2026-05-01T08:00:00.000Z', created_at: '2026-05-01T08:00:00.000Z' }),
  ].sort(compareArticlesByFreshness)

  const page1 = articles.slice(0, 2)
  const page2 = articles.slice(2, 4)
  const seen = new Set([...page1, ...page2].map((item) => item.id))

  assert.deepEqual(page1.map((item) => item.id), ['newest', 'middle'])
  assert.deepEqual(page2.map((item) => item.id), ['older-high', 'oldest'])
  assert.equal(seen.size, page1.length + page2.length)
})
