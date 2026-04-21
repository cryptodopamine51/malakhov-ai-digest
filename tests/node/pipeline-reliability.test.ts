import test from 'node:test'
import assert from 'node:assert/strict'

import { releaseClaim } from '../../pipeline/claims'
import { generateEditorial } from '../../pipeline/claude'
import { fetchArticleContent } from '../../pipeline/fetcher'
import { buildVerifyUrl, getVerifyCandidateKind } from '../../pipeline/publish-verify-utils'
import { nextRetryAt, retryDelayMs } from '../../pipeline/types'

test('retry policy starts with the first backoff step', () => {
  assert.equal(retryDelayMs(1), 5 * 60 * 1000)
  assert.equal(retryDelayMs(2), 30 * 60 * 1000)
  assert.equal(retryDelayMs(3), 2 * 60 * 60 * 1000)

  const now = Date.now()
  const retryAt = nextRetryAt(1).getTime()
  assert.ok(retryAt - now >= 5 * 60 * 1000 - 1000)
  assert.ok(retryAt - now <= 5 * 60 * 1000 + 1000)
})

test('releaseClaim requires the expected claim token', async () => {
  const filters: Array<[string, unknown]> = []

  const builder = {
    update() {
      return this
    },
    eq(column: string, value: unknown) {
      filters.push([column, value])
      return this
    },
    select() {
      return this
    },
    async maybeSingle() {
      return { data: { id: 'article-1' }, error: null }
    },
  }

  const supabase = {
    from() {
      return builder
    },
  }

  const released = await releaseClaim(supabase as never, 'article-1', 'claim-1', { enrich_status: 'enriched_ok' })

  assert.equal(released, true)
  assert.deepEqual(filters, [
    ['id', 'article-1'],
    ['claim_token', 'claim-1'],
  ])
})

test('releaseClaim skips stale claims', async () => {
  const builder = {
    update() {
      return this
    },
    eq() {
      return this
    },
    select() {
      return this
    },
    async maybeSingle() {
      return { data: null, error: null }
    },
  }

  const supabase = {
    from() {
      return builder
    },
  }

  const released = await releaseClaim(supabase as never, 'article-1', 'claim-stale', { enrich_status: 'failed' })
  assert.equal(released, false)
})

test('fetchArticleContent returns fetch_failed on non-200 response', async () => {
  const originalFetch = global.fetch
  global.fetch = (async () =>
    new Response('nope', { status: 503, statusText: 'Service Unavailable' })) as typeof fetch

  try {
    const result = await fetchArticleContent('https://example.com/fail')
    assert.equal(result.errorCode, 'fetch_failed')
    assert.match(result.errorMessage ?? '', /HTTP 503/)
  } finally {
    global.fetch = originalFetch
  }
})

test('fetchArticleContent returns fetch_timeout on aborted request', async () => {
  const originalFetch = global.fetch
  global.fetch = (async () => {
    throw new Error('The operation was aborted')
  }) as typeof fetch

  try {
    const result = await fetchArticleContent('https://example.com/timeout')
    assert.equal(result.errorCode, 'fetch_timeout')
  } finally {
    global.fetch = originalFetch
  }
})

test('generateEditorial reports missing api key as operational error', async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_API_KEY

  try {
    const result = await generateEditorial('Title', 'Body', 'Source', 'en', ['ai'])
    assert.equal(result.output, null)
    assert.equal(result.errorCode, 'claude_api_error')
  } finally {
    if (previousKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY
    } else {
      process.env.ANTHROPIC_API_KEY = previousKey
    }
  }
})

test('publish verify classifies new, legacy and live candidates correctly', () => {
  assert.equal(
    getVerifyCandidateKind({ publish_status: 'publish_ready', verified_live: null } as never),
    'new_candidate',
  )
  assert.equal(
    getVerifyCandidateKind({ publish_status: 'live', verified_live: null } as never),
    'legacy_backfill',
  )
  assert.equal(
    getVerifyCandidateKind({ publish_status: 'live', verified_live: true } as never),
    'live_sample',
  )
})

test('publish verify uses internal preview URL for pre-live candidates', () => {
  assert.equal(
    buildVerifyUrl('https://news.malakhovai.ru', 'example-slug', 'new_candidate'),
    'https://news.malakhovai.ru/internal/articles/example-slug',
  )
  assert.equal(
    buildVerifyUrl('https://news.malakhovai.ru', 'example-slug', 'legacy_backfill'),
    'https://news.malakhovai.ru/internal/articles/example-slug',
  )
  assert.equal(
    buildVerifyUrl('https://news.malakhovai.ru', 'example-slug', 'live_sample'),
    'https://news.malakhovai.ru/articles/example-slug',
  )
})
