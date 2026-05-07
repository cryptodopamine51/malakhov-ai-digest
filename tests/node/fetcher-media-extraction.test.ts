import { test } from 'node:test'
import assert from 'node:assert/strict'

import { fetchArticleContent } from '../../pipeline/fetcher'

async function withMockedFetch(html: string, assertion: () => Promise<void>) {
  const originalFetch = global.fetch
  global.fetch = (async () => new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })) as typeof fetch

  try {
    await assertion()
  } finally {
    global.fetch = originalFetch
  }
}

test('fetchArticleContent extracts twitter:image and absolutizes relative URL', async () => {
  await withMockedFetch(`
    <html>
      <head><meta name="twitter:image" content="/media/cover.webp"></head>
      <body><article><p>Short body.</p></article></body>
    </html>
  `, async () => {
    const result = await fetchArticleContent('https://example.com/story', { includeText: false })

    assert.equal(result.imageUrl, 'https://example.com/media/cover.webp')
  })
})

test('fetchArticleContent uses JSON-LD image fallback', async () => {
  await withMockedFetch(`
    <html>
      <head>
        <script type="application/ld+json">
          {"@type":"NewsArticle","image":{"url":"/jsonld-cover.jpg"}}
        </script>
      </head>
      <body><article><p>Short body.</p></article></body>
    </html>
  `, async () => {
    const result = await fetchArticleContent('https://example.com/news/story', { includeText: false })

    assert.equal(result.imageUrl, 'https://example.com/jsonld-cover.jpg')
  })
})

test('fetchArticleContent reads picture source srcset when img has no src', async () => {
  await withMockedFetch(`
    <html>
      <body>
        <article>
          <picture>
            <source srcset="/large.webp 1200w, /small.webp 600w">
            <img alt="OpenAI GPT benchmark chart" width="1200" height="675">
          </picture>
        </article>
      </body>
    </html>
  `, async () => {
    const result = await fetchArticleContent('https://example.com/story', { includeText: false })

    assert.equal(result.inlineImages[0]?.src, 'https://example.com/large.webp')
    assert.equal(result.imageUrl, 'https://example.com/large.webp')
  })
})

test('fetchArticleContent excludes share button SVGs from inline media', async () => {
  await withMockedFetch(`
    <html>
      <body>
        <article>
          <a class="share-button" href="#"><img src="/icons/share.svg" width="200" height="200"></a>
          <button><img src="/arrow.svg" width="200" height="200"></button>
        </article>
      </body>
    </html>
  `, async () => {
    const result = await fetchArticleContent('https://example.com/story', { includeText: false })

    assert.equal(result.imageUrl, null)
    assert.equal(result.inlineImages.length, 0)
  })
})
