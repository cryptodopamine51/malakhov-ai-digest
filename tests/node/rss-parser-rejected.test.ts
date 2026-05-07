import test from 'node:test'
import assert from 'node:assert/strict'
import RSSParser from 'rss-parser'

import { keywordMatches, parseFeed, parseFeedWithRetry } from '../../pipeline/rss-parser'
import { buildSourceRejectedStats, writeSourceRun } from '../../pipeline/ingest'
import type { FeedConfig } from '../../pipeline/feeds.config'
import type { SourceFeedResult } from '../../pipeline/rss-parser'

/**
 * Wave 3.2 — RSS rejected counters.
 */

const feed: FeedConfig = {
  name: 'Test RU Feed',
  url: 'https://example.com/rss.xml',
  lang: 'ru',
  topics: ['ai-industry'],
  needsKeywordFilter: true,
  keywords: ['ии'],
  keywordSearchFields: 'title',
  requireDateInUrl: true,
}

test('parseFeed returns rejected breakdown for keyword and URL-date filters', async () => {
  const originalFetch = global.fetch
  global.fetch = (async () => new Response(`
    <rss version="2.0">
      <channel>
        <item>
          <title>Обычные новости рынка</title>
          <link>https://example.com/2026/05/market</link>
          <pubDate>Sat, 02 May 2026 10:00:00 GMT</pubDate>
          <description>Без релевантных ключевых слов.</description>
        </item>
        <item>
          <title>ИИ меняет корпоративный рынок</title>
          <link>https://example.com/no-date/ai-story</link>
          <pubDate>Sat, 02 May 2026 10:10:00 GMT</pubDate>
          <description>ИИ и агенты.</description>
        </item>
        <item>
          <title>ИИ запускает новый сервис</title>
          <link>https://example.com/2026/05/ai-service</link>
          <pubDate>Sat, 02 May 2026 10:20:00 GMT</pubDate>
          <description>ИИ и агенты.</description>
        </item>
      </channel>
    </rss>
  `, { status: 200 })) as typeof fetch

  try {
    const parser = new RSSParser()
    const result = await parseFeed(parser, feed, new Date('2026-05-02T09:00:00.000Z'))

    assert.equal(result.items.length, 1)
    assert.equal(result.sourceResult.itemsSeen, 3)
    assert.equal(result.sourceResult.itemsReturned, 1)
    assert.deepEqual(
      Object.fromEntries(result.rejected.map((entry) => [entry.reason, entry.count])),
      { keyword_filter: 1, requireDateInUrl: 1 },
    )
    assert.match(result.rejected.find((entry) => entry.reason === 'keyword_filter')?.examples[0] ?? '', /Обычные новости/)
  } finally {
    global.fetch = originalFetch
  }
})

test('parseFeedWithRetry retries failed feed responses before returning source result', async () => {
  const originalFetch = global.fetch
  let calls = 0
  global.fetch = (async () => {
    calls++
    if (calls === 1) return new Response('temporary error', { status: 503 })
    return new Response(`
      <rss version="2.0">
        <channel>
          <item>
            <title>ИИ запускает новый сервис</title>
            <link>https://example.com/2026/05/ai-service</link>
            <pubDate>Sat, 02 May 2026 10:20:00 GMT</pubDate>
            <description>ИИ и агенты.</description>
          </item>
        </channel>
      </rss>
    `, { status: 200 })
  }) as typeof fetch

  try {
    const parser = new RSSParser()
    const result = await parseFeedWithRetry(parser, feed, new Date('2026-05-02T09:00:00.000Z'), 0)

    assert.equal(calls, 2)
    assert.equal(result.sourceResult.status, 'ok')
    assert.equal(result.items.length, 1)
  } finally {
    global.fetch = originalFetch
  }
})

test('keywordMatches keeps short ии boundary-safe and supports vc.ru variants', () => {
  assert.equal(keywordMatches('Проверка инициативы в ритейле', 'ии'), false)
  assert.equal(keywordMatches('Юрист OpenAI рассказал о переходе компании', 'openai'), true)
  assert.equal(keywordMatches('ИИ-агент помогает аналитикам', 'ии'), true)
  assert.equal(keywordMatches('Нейронка автоматизировала отчёты', 'нейронк'), true)
  assert.equal(keywordMatches('Новый ИИ-ассистент для бизнеса', 'ии-ассистент'), true)
})


test('buildSourceRejectedStats adds ingest dedup to parser rejects', () => {
  const stats = buildSourceRejectedStats({
    rejected: [
      { reason: 'keyword_filter', count: 2, examples: ['a', 'b'] },
      { reason: 'requireDateInUrl', count: 1, examples: ['c'] },
    ],
  }, 3)

  assert.equal(stats.count, 6)
  assert.deepEqual(stats.breakdown, {
    keyword_filter: 2,
    requireDateInUrl: 1,
    dedup: 3,
  })
})

function makeSourceResult(rejected: SourceFeedResult['rejected']): SourceFeedResult {
  return {
    sourceName: 'Test Source',
    feedUrl: 'https://example.com/rss.xml',
    status: 'ok',
    itemsSeen: 4,
    itemsReturned: 2,
    rejected,
    httpStatus: 200,
    errorMessage: null,
    responseTimeMs: 10,
  }
}

function recordingSupabase(firstError: { message: string } | null = null): {
  client: { from: (table: string) => { insert: (payload: Record<string, unknown>) => Promise<{ error: { message: string } | null }> } }
  inserts: Array<{ table: string; payload: Record<string, unknown> }>
} {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = []
  let call = 0
  return {
    inserts,
    client: {
      from(table: string) {
        return {
          async insert(payload: Record<string, unknown>) {
            inserts.push({ table, payload })
            call++
            if (call === 1 && firstError) return { error: firstError }
            return { error: null }
          },
        }
      },
    },
  }
}

test('writeSourceRun writes rejected count and breakdown into source_runs', async () => {
  const { client, inserts } = recordingSupabase()
  await writeSourceRun(
    client as never,
    'run-1',
    makeSourceResult([{ reason: 'keyword_filter', count: 2, examples: [] }]),
    1,
    3,
  )

  assert.equal(inserts.length, 1)
  const payload = inserts[0]!.payload
  assert.equal(payload.items_rejected_count, 5)
  assert.deepEqual(payload.items_rejected_breakdown, { keyword_filter: 2, dedup: 3 })
})

test('writeSourceRun retries legacy insert when rejected columns are absent', async () => {
  const { client, inserts } = recordingSupabase({ message: 'column "items_rejected_count" does not exist' })
  await writeSourceRun(
    client as never,
    'run-1',
    makeSourceResult([{ reason: 'requireDateInUrl', count: 1, examples: [] }]),
    1,
    0,
  )

  assert.equal(inserts.length, 2)
  assert.equal(inserts[0]!.payload.items_rejected_count, 1)
  assert.ok(!('items_rejected_count' in inserts[1]!.payload))
  assert.ok(!('items_rejected_breakdown' in inserts[1]!.payload))
})
