import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { trimArticleForCard } from '../../lib/articles'
import type { Article } from '../../lib/supabase'

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'a1',
    slug: 'test-article',
    ru_title: 'Тестовая статья',
    original_title: 'Test article',
    original_url: 'https://example.com/a',
    source_name: 'TechCrunch AI',
    primary_category: 'ai-industry',
    publish_status: 'live',
    original_text: 'x'.repeat(5000),
    editorial_body: 'y'.repeat(5000),
    ru_text: 'z'.repeat(5000),
    article_images: [{ url: 'https://example.com/i.jpg' }],
    article_tables: [{ rows: [] }],
    article_videos: [{ url: 'https://example.com/v.mp4' }],
    link_anchors: ['якорь один'],
    ...overrides,
  } as unknown as Article
}

test('trims heavy text fields to sanitizer context size', () => {
  const trimmed = trimArticleForCard(makeArticle())
  assert.equal(trimmed.original_text!.length, 1000)
  assert.equal(trimmed.editorial_body!.length, 1000)
  assert.equal(trimmed.ru_text!.length, 1000)
})

test('drops inline media arrays and anchors unused by cards', () => {
  const trimmed = trimArticleForCard(makeArticle())
  assert.equal(trimmed.article_images, null)
  assert.equal(trimmed.article_tables, null)
  assert.equal(trimmed.article_videos, null)
  assert.equal(trimmed.link_anchors, null)
})

test('keeps card fields intact and tolerates null text', () => {
  const trimmed = trimArticleForCard(
    makeArticle({ original_text: null, editorial_body: null, ru_text: null }),
  )
  assert.equal(trimmed.ru_title, 'Тестовая статья')
  assert.equal(trimmed.source_name, 'TechCrunch AI')
  assert.equal(trimmed.original_text, null)
  assert.equal(trimmed.editorial_body, null)
})
