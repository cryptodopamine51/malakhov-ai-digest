import test from 'node:test'
import assert from 'node:assert/strict'

import type { Article } from '../../lib/supabase'
import { scoreArticle } from '../../pipeline/scorer'
import { getMinScoreForArticle } from '../../pipeline/scorer.config'

function article(overrides: Partial<Article>): Article {
  return {
    id: 'article-1',
    original_url: 'https://example.com/story',
    original_title: 'AI startup raises Series A',
    original_text: 'The startup raised $25M in a Series A round for an AI product.',
    source_name: 'TechCrunch Startups',
    source_lang: 'en',
    topics: ['ai-startups'],
    primary_category: 'ai-startups',
    secondary_categories: [],
    pub_date: new Date().toISOString(),
    cover_image_url: 'https://example.com/cover.jpg',
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
    quality_ok: false,
    quality_reason: null,
    dedup_hash: null,
    enriched: false,
    published: false,
    tg_sent: false,
    score: 0,
    slug: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ingest_status: 'ingested',
    enrich_status: 'pending',
    publish_status: 'draft',
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
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
    publish_ready_at: null,
    verified_live: null,
    verified_live_at: null,
    live_check_error: null,
    current_batch_item_id: null,
    ...overrides,
  }
}

test('research articles use stricter Claude threshold', () => {
  assert.equal(getMinScoreForArticle(article({ primary_category: 'ai-research', topics: ['ai-research'] })), 4)
  assert.equal(getMinScoreForArticle(article({ primary_category: 'ai-industry', topics: ['ai-industry'] })), 2)
})

test('startup articles receive a deal-signal score boost', () => {
  const withDealSignal = scoreArticle(article({}))
  const withoutDealSignal = scoreArticle(article({
    original_title: 'AI startup launches product platform',
    original_text: 'The company launched a product for enterprise AI workflows.',
  }))

  assert.equal(withDealSignal, withoutDealSignal + 1)
})
