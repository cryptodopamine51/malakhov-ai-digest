import test from 'node:test'
import assert from 'node:assert/strict'

import type { Article } from '../../lib/supabase'
import { keywordMatches } from '../../pipeline/rss-parser'
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
    last_publish_verifier: null,
    published_at: null,
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
    original_title: 'AI startup releases product platform',
    original_text: 'The company released a product for enterprise AI workflows.',
  }))

  assert.equal(withDealSignal, withoutDealSignal + 1)
})

test('keywordMatches treats short AI abbreviations as whole words', () => {
  assert.equal(keywordMatches('новый инструмент для ии-поиска', 'ии'), true)
  assert.equal(keywordMatches('новости россии и бизнеса', 'ии'), false)
  assert.equal(keywordMatches('AI startup raises seed round', 'ai'), true)
  assert.equal(keywordMatches('said startup raises seed round', 'ai'), false)
})

test('AI lab tokens in title award the lab-signal bonus', () => {
  const withLab = scoreArticle(article({
    original_title: 'Google announces Gemini 3.5 Flash pricing change',
    original_text: 'Google’s newest model lands with higher token prices.'.repeat(30),
    source_name: 'The Verge AI',
    primary_category: 'ai-industry',
    topics: ['ai-industry'],
  }))
  const withoutLab = scoreArticle(article({
    original_title: 'Spotify rolls out new audio app feature',
    original_text: 'The streaming app launched a new feature for podcasts.'.repeat(30),
    source_name: 'The Verge AI',
    primary_category: 'ai-industry',
    topics: ['ai-industry'],
  }))

  // Gemini-match: +2 lab + +2 announcement bundle = +4 over the plain Spotify item.
  assert.equal(withLab, withoutLab + 4)
})

test('major announcement bundle requires AI lab signal', () => {
  const announceWithoutLab = scoreArticle(article({
    original_title: 'Russian retailer launches new loyalty programme',
    original_text: 'The retailer launched a new loyalty scheme aimed at urban customers.'.repeat(30),
    source_name: 'RB.ru',
    primary_category: 'ai-industry',
    topics: ['ai-industry'],
  }))
  const announceWithLab = scoreArticle(article({
    original_title: 'OpenAI launches new pricing for ChatGPT enterprise',
    original_text: 'OpenAI launched new enterprise pricing today affecting all teams.'.repeat(30),
    source_name: 'RB.ru',
    primary_category: 'ai-industry',
    topics: ['ai-industry'],
  }))

  // Without an AI lab/product anchor the announcement keyword alone yields nothing extra.
  assert.equal(announceWithLab, announceWithoutLab + 4)
})

test('ai-russia bonus is no longer duplicated by source_lang', () => {
  const ruArticle = article({
    original_title: 'Сбер представил GigaChat Enterprise для крупного бизнеса',
    original_text: 'Сбер запустил новую корпоративную версию GigaChat для крупного бизнеса.'.repeat(30),
    source_name: 'CNews',
    source_lang: 'ru',
    primary_category: 'ai-russia',
    topics: ['ai-russia'],
  })
  const enArticle = article({
    original_title: 'OpenAI launches new ChatGPT enterprise tier',
    original_text: 'OpenAI launched new ChatGPT enterprise tier today affecting all teams.'.repeat(30),
    source_name: 'The Decoder',
    primary_category: 'ai-industry',
    topics: ['ai-industry'],
  })

  // Industry launch from a top outlet should now be at least as strong as a generic ru story.
  assert.ok(scoreArticle(enArticle) >= scoreArticle(ruArticle))
})

test('AI/template/stock covers do not award the cover bonus', () => {
  const withRealCover = scoreArticle(article({
    cover_image_url: 'https://leonardo.osnova.io/uuid/-/scale_crop/592x/',
  }))
  const withGeneratedCover = scoreArticle(article({
    cover_image_url:
      'https://storage.example/storage/v1/object/public/article-images/ai-covers/2026-05-21/slug-gpt-image-1.5-low-123.webp',
  }))

  assert.equal(withRealCover, withGeneratedCover + 1)
})
