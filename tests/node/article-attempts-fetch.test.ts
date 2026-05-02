import test from 'node:test'
import assert from 'node:assert/strict'

import { fetchArticleContent } from '../../pipeline/fetcher'
import { writeArticleAttempt } from '../../pipeline/enrich-runtime'
import { writeFetchAttempt } from '../../pipeline/enrich-submit-batch'
import type { Article } from '../../lib/supabase'

/**
 * Wave 3.1 — fetch failures get normalized error codes and a dedicated
 * article_attempts row with stage='fetch'.
 */

test('fetchArticleContent maps 404 and blocked responses to normalized fetch codes', async () => {
  const originalFetch = global.fetch
  const responses = [
    new Response('missing', { status: 404 }),
    new Response('forbidden', { status: 403 }),
  ]
  global.fetch = (async () => responses.shift() ?? new Response('', { status: 500 })) as typeof fetch

  try {
    const missing = await fetchArticleContent('https://example.com/missing')
    const blocked = await fetchArticleContent('https://example.com/blocked')

    assert.equal(missing.errorCode, 'fetch_404')
    assert.match(missing.errorMessage ?? '', /HTTP 404/)
    assert.equal(blocked.errorCode, 'fetch_blocked')
  } finally {
    global.fetch = originalFetch
  }
})

test('fetchArticleContent maps too-large and empty HTML responses', async () => {
  const originalFetch = global.fetch
  const responses = [
    new Response('<html></html>', {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-length': '2000001',
      },
    }),
    new Response('<html><body><article></article></body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  ]
  global.fetch = (async () => responses.shift() ?? new Response('', { status: 500 })) as typeof fetch

  try {
    const tooLarge = await fetchArticleContent('https://example.com/too-large')
    const empty = await fetchArticleContent('https://example.com/empty')

    assert.equal(tooLarge.errorCode, 'fetch_too_large')
    assert.equal(empty.errorCode, 'fetch_empty')
  } finally {
    global.fetch = originalFetch
  }
})

function recordingSupabase(): {
  client: { from: (table: string) => { insert: (payload: Record<string, unknown>) => Promise<{ error: null }> } }
  inserts: Array<{ table: string; payload: Record<string, unknown> }>
} {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = []
  return {
    inserts,
    client: {
      from(table: string) {
        return {
          async insert(payload: Record<string, unknown>) {
            inserts.push({ table, payload })
            return { error: null }
          },
        }
      },
    },
  }
}

test('writeArticleAttempt supports stage=fetch rows', async () => {
  const { client, inserts } = recordingSupabase()
  const startedAt = new Date('2026-05-02T10:00:00.000Z')

  await writeArticleAttempt(client as never, {
    articleId: 'article-1',
    stage: 'fetch',
    attemptNo: 2,
    startedAt,
    resultStatus: 'failed',
    errorCode: 'fetch_5xx',
    errorMessage: 'HTTP 503 for https://example.com/story',
    payload: { run_id: 'run-1', phase: 'fetch' },
  })

  assert.equal(inserts.length, 1)
  assert.equal(inserts[0]!.table, 'article_attempts')
  assert.equal(inserts[0]!.payload.stage, 'fetch')
  assert.equal(inserts[0]!.payload.result_status, 'failed')
  assert.equal(inserts[0]!.payload.error_code, 'fetch_5xx')
})

test('writeFetchAttempt records article URL, run id and next attempt number', async () => {
  const { client, inserts } = recordingSupabase()
  const article = {
    id: 'article-2',
    original_url: 'https://example.com/story',
    attempt_count: 1,
    claim_token: 'claim-1',
  } as Article

  await writeFetchAttempt(
    client as never,
    article,
    'run-2',
    new Date('2026-05-02T10:00:00.000Z'),
    'fetch_404',
    'HTTP 404 for https://example.com/story',
  )

  assert.equal(inserts.length, 1)
  const payload = inserts[0]!.payload
  assert.equal(payload.stage, 'fetch')
  assert.equal(payload.attempt_no, 2)
  assert.equal(payload.claim_token, 'claim-1')
  assert.deepEqual(payload.payload, {
    run_id: 'run-2',
    phase: 'fetch',
    url: 'https://example.com/story',
  })
})
