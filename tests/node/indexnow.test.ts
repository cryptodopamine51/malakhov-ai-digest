import test from 'node:test'
import assert from 'node:assert/strict'

import { pingIndexNow } from '../../lib/indexnow'

interface CapturedRequest {
  url: string
  body: { host: string; key: string; keyLocation: string; urlList: string[] }
  headers: Record<string, string>
}

async function withMockedFetch<T>(
  fn: (captured: CapturedRequest[], setResponse: (r: Response | (() => Response)) => void) => Promise<T>,
): Promise<T> {
  const captured: CapturedRequest[] = []
  let next: Response | (() => Response) = new Response(null, { status: 202 })
  const original = global.fetch
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const body = init?.body ? JSON.parse(String(init.body)) : null
    captured.push({ url, body, headers: (init?.headers as Record<string, string>) ?? {} })
    return typeof next === 'function' ? next() : next
  }) as typeof fetch

  try {
    return await fn(captured, (response) => {
      next = response
    })
  } finally {
    global.fetch = original
  }
}

test('pingIndexNow short-circuits when INDEXNOW_KEY is missing', async () => {
  const previous = process.env.INDEXNOW_KEY
  delete process.env.INDEXNOW_KEY
  try {
    const result = await pingIndexNow(['https://news.malakhovai.ru/categories/ai-research/foo'])
    assert.equal(result.ok, false)
    assert.equal(result.skipped, 'no_key')
    assert.equal(result.pinged, 0)
  } finally {
    if (previous !== undefined) process.env.INDEXNOW_KEY = previous
  }
})

test('pingIndexNow short-circuits on empty url list', async () => {
  process.env.INDEXNOW_KEY = 'testkey'
  const result = await pingIndexNow(['', '   '])
  assert.equal(result.ok, false)
  assert.equal(result.skipped, 'no_urls')
})

test('pingIndexNow POSTs deduped URLs with proper payload', async () => {
  process.env.INDEXNOW_KEY = 'abc123'
  await withMockedFetch(async (captured) => {
    const result = await pingIndexNow([
      'https://news.malakhovai.ru/a',
      'https://news.malakhovai.ru/a',
      'https://news.malakhovai.ru/b',
    ])
    assert.equal(result.ok, true)
    assert.equal(result.status, 202)
    assert.equal(result.pinged, 2)
    assert.equal(captured.length, 1)
    assert.equal(captured[0]!.url, 'https://api.indexnow.org/indexnow')
    assert.deepEqual(captured[0]!.body.urlList, [
      'https://news.malakhovai.ru/a',
      'https://news.malakhovai.ru/b',
    ])
    assert.equal(captured[0]!.body.host, 'news.malakhovai.ru')
    assert.equal(captured[0]!.body.key, 'abc123')
    assert.equal(captured[0]!.body.keyLocation, 'https://news.malakhovai.ru/indexnow.txt')
  })
})

test('pingIndexNow returns ok=false for non-2xx responses', async () => {
  process.env.INDEXNOW_KEY = 'abc123'
  await withMockedFetch(async (_captured, setResponse) => {
    setResponse(new Response('rate limited', { status: 429 }))
    const result = await pingIndexNow(['https://news.malakhovai.ru/c'])
    assert.equal(result.ok, false)
    assert.equal(result.status, 429)
  })
})

test('pingIndexNow returns ok=false on network error', async () => {
  process.env.INDEXNOW_KEY = 'abc123'
  await withMockedFetch(async (_captured, setResponse) => {
    setResponse(() => { throw new Error('network down') })
    const result = await pingIndexNow(['https://news.malakhovai.ru/d'])
    assert.equal(result.ok, false)
    assert.equal(result.status, null)
    assert.match(result.errorMessage ?? '', /network down/)
  })
})
