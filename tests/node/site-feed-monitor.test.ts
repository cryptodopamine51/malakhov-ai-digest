import { test } from 'node:test'
import assert from 'node:assert/strict'

import { decideFeed, resolveSiteUrl } from '../../pipeline/site-feed-monitor'

const DEFAULT_SITE_URL = 'https://news.malakhovai.ru'

test('resolveSiteUrl falls back to default on empty string (GH Actions unset var)', () => {
  assert.equal(resolveSiteUrl(''), DEFAULT_SITE_URL)
})

test('resolveSiteUrl falls back to default on whitespace', () => {
  assert.equal(resolveSiteUrl('   '), DEFAULT_SITE_URL)
})

test('resolveSiteUrl falls back to default on null/undefined', () => {
  assert.equal(resolveSiteUrl(null), DEFAULT_SITE_URL)
  assert.equal(resolveSiteUrl(undefined), DEFAULT_SITE_URL)
})

test('resolveSiteUrl honors explicit override and strips trailing slash', () => {
  assert.equal(resolveSiteUrl('https://staging.example.com/'), 'https://staging.example.com')
})

test('decideFeed fires on empty feed', () => {
  const d = decideFeed({ httpOk: true, status: 200, total: 0 })
  assert.deepEqual(d, { kind: 'fire', reason: 'empty_feed' })
})

test('decideFeed fires on HTTP failure', () => {
  const d = decideFeed({ httpOk: false, status: 500, total: null, error: 'HTTP 500' })
  assert.deepEqual(d, { kind: 'fire', reason: 'fetch_failed' })
})

test('decideFeed fires when total is unparseable', () => {
  const d = decideFeed({ httpOk: true, status: 200, total: null })
  assert.deepEqual(d, { kind: 'fire', reason: 'fetch_failed' })
})

test('decideFeed resolves when feed has articles', () => {
  const d = decideFeed({ httpOk: true, status: 200, total: 42 })
  assert.deepEqual(d, { kind: 'resolve', reason: 'feed_ok' })
})
