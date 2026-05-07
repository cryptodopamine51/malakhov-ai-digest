import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sanitizeArticleMedia } from '../../pipeline/media-sanitizer'
import { writeMediaSanitizeAttempt } from '../../pipeline/enrich-runtime'

const context = {
  sourceName: 'Example Source',
  originalUrl: 'https://example.com/story',
  originalTitle: 'OpenAI launches new GPT research system for enterprise agents',
  ruTitle: 'OpenAI запускает новую систему GPT для корпоративных агентов',
  lead: 'Материал о GPT, OpenAI и корпоративных AI-агентах.',
  summary: ['OpenAI представила систему для enterprise agents.', 'Новый продукт связан с GPT.'],
  originalText: 'OpenAI GPT enterprise agents research product screenshot chart benchmark.',
}

test('sanitizeArticleMedia rejects Habr career course banner', () => {
  const result = sanitizeArticleMedia({
    coverImageUrl: null,
    articleImages: [{
      src: 'https://habrastorage.org/getpro/habr/upload_files/banner-career-courses.png',
      alt: 'Хабр Карьера Курсы',
      parentHref: 'https://career.habr.com/courses',
      width: 1200,
      height: 300,
    }],
    context: { ...context, sourceName: 'Habr AI', originalUrl: 'https://habr.com/ru/articles/1/' },
  })

  assert.equal(result.articleImages.length, 0)
  assert.equal(result.rejects[0]?.reason, 'ad_url')
})

test('sanitizeArticleMedia rejects generic ad URLs', () => {
  const result = sanitizeArticleMedia({
    coverImageUrl: null,
    articleImages: [{
      src: 'https://ads.example.com/adfox/banner-123.jpg',
      alt: 'Advertisement',
      parentClassName: 'content-ad banner',
      width: 970,
      height: 250,
    }],
    context,
  })

  assert.equal(result.articleImages.length, 0)
  assert.equal(result.rejects[0]?.reason, 'ad_url')
})

test('sanitizeArticleMedia rejects UI icon SVGs and placeholder text covers', () => {
  const result = sanitizeArticleMedia({
    coverImageUrl: 'https://www.cnews.ru/img/design2008/placeholderimage.jpg',
    articleImages: [
      { src: 'https://example.com/assets/icons/share.svg', alt: '', width: 320, height: 320 },
      { src: 'https://example.com/sprite.svg#arrow', alt: '', width: 320, height: 320 },
      { src: 'https://example.com/static/arrow.svg', alt: '', width: 320, height: 320 },
      { src: 'https://filearchive.cnews.ru/img/cnews/2021/02/03/path7204.svg', alt: '', parentClassName: 'article-btn' },
    ],
    context: {
      ...context,
      sourceName: 'CNews',
      originalUrl: 'https://www.cnews.ru/news/line/2026-05-05_ii_dlya_hr_biznes-partnerov',
    },
  })

  assert.equal(result.coverImageUrl, null)
  assert.equal(result.articleImages.length, 0)
  assert.deepEqual(result.rejects.map((reject) => reject.reason), [
    'text_cover',
    'ui_icon',
    'ui_icon',
    'ui_icon',
    'ui_icon',
  ])
})

test('sanitizeArticleMedia rejects SVG cover even outside text-cover sources', () => {
  const result = sanitizeArticleMedia({
    coverImageUrl: 'https://example.com/article/share-image.svg?ver=1',
    articleImages: null,
    context,
  })

  assert.equal(result.coverImageUrl, null)
  assert.equal(result.rejects[0]?.reason, 'svg_cover')
})

test('sanitizeArticleMedia rejects default cover for text-cover sources', () => {
  const result = sanitizeArticleMedia({
    coverImageUrl: 'https://static.cnews.ru/img/default-cover.png',
    articleImages: null,
    context: { ...context, sourceName: 'CNews' },
  })

  assert.equal(result.coverImageUrl, null)
  assert.equal(result.rejects[0]?.reason, 'text_cover')
})

test('sanitizeArticleMedia rejects Ars Technica author portraits', () => {
  const result = sanitizeArticleMedia({
    coverImageUrl: null,
    articleImages: [{
      src: 'https://cdn.arstechnica.net/wp-content/uploads/author-stephen-clark.jpg',
      alt: 'Photo of Stephen Clark',
      caption: 'Photo of Stephen Clark',
      parentClassName: 'byline author',
      width: 320,
      height: 420,
    }],
    context: {
      ...context,
      sourceName: 'Ars Technica',
      originalTitle: 'SpaceX tests Starship flight system',
      lead: 'Материал о Starship, а не о корреспонденте.',
    },
  })

  assert.equal(result.articleImages.length, 0)
  assert.equal(result.rejects[0]?.reason, 'author_photo')
})

test('sanitizeArticleMedia rejects author portraits detected from URLs', () => {
  const result = sanitizeArticleMedia({
    coverImageUrl: null,
    articleImages: [{
      src: 'https://www.zdnet.com/a/img/resize/example/vala-afshar-author.jpg?width=192',
      alt: '',
      width: 192,
      height: 192,
    }],
    context: {
      ...context,
      sourceName: 'ZDNet AI',
      originalTitle: 'Enterprise AI agents reshape consulting workflows',
    },
  })

  assert.equal(result.articleImages.length, 0)
  assert.equal(result.rejects[0]?.reason, 'author_photo')
})

test('sanitizeArticleMedia keeps relevant product screenshots', () => {
  const result = sanitizeArticleMedia({
    coverImageUrl: null,
    articleImages: [{
      src: 'https://example.com/openai-gpt-agent-screenshot.jpg',
      alt: 'OpenAI GPT enterprise agents dashboard screenshot',
      width: 1280,
      height: 720,
    }],
    context,
  })

  assert.deepEqual(result.articleImages, [{
    src: 'https://example.com/openai-gpt-agent-screenshot.jpg',
    alt: 'OpenAI GPT enterprise agents dashboard screenshot',
  }])
})

test('sanitizeArticleMedia keeps relevant research chart', () => {
  const result = sanitizeArticleMedia({
    coverImageUrl: null,
    articleImages: [{
      src: 'https://example.com/gpt-benchmark-chart.webp',
      caption: 'GPT benchmark chart for enterprise agent tasks',
      width: 900,
      height: 600,
    }],
    context,
  })

  assert.equal(result.articleImages.length, 1)
  assert.equal(result.rejects.length, 0)
})

test('sanitizeArticleMedia keeps trusted editorial images with generic captions', () => {
  const result = sanitizeArticleMedia({
    coverImageUrl: null,
    articleImages: [{
      src: 'https://www.zdnet.com/a/img/resize/example/img-5114.jpg?width=1280',
      alt: 'img-5114',
      width: 1280,
      height: 720,
    }],
    context: {
      ...context,
      sourceName: 'ZDNet AI',
      originalTitle: 'XR headsets and foldable phones replace laptop workflows',
    },
  })

  assert.equal(result.articleImages.length, 1)
  assert.equal(result.rejects.length, 0)
})

test('sanitizeArticleMedia keeps Habr inline images without captions', () => {
  const result = sanitizeArticleMedia({
    coverImageUrl: null,
    articleImages: [{
      src: 'https://habrastorage.org/r/w1560/getpro/habr/upload_files/606/a5b/db9/example.png',
      alt: '',
      width: 1280,
      height: 720,
    }],
    context: { ...context, sourceName: 'Habr AI', originalUrl: 'https://habr.com/ru/articles/1/' },
  })

  assert.equal(result.articleImages.length, 1)
  assert.equal(result.rejects.length, 0)
})

test('sanitizeArticleMedia rejects Habr branding assets', () => {
  const result = sanitizeArticleMedia({
    coverImageUrl: null,
    articleImages: [{
      src: 'https://habrastorage.org/getpro/habr/branding/02f/e1d/532/02fe1d532ddc779057189ddbf73a3fbe.png',
      alt: '',
      width: 1200,
      height: 630,
    }],
    context: { ...context, sourceName: 'Habr AI', originalUrl: 'https://habr.com/ru/articles/1/' },
  })

  assert.equal(result.articleImages.length, 0)
  assert.equal(result.rejects[0]?.reason, 'ui_icon')
})

test('sanitizeArticleMedia does not treat model training copy as promo text', () => {
  const result = sanitizeArticleMedia({
    coverImageUrl: null,
    articleImages: [{
      src: 'https://the-decoder.com/wp-content/uploads/2026/05/openai-training-system.png',
      alt: 'OpenAI разобрала механизм сбоя в обучении модели',
      width: 1200,
      height: 675,
    }],
    context: {
      ...context,
      sourceName: 'The Decoder',
      originalTitle: 'OpenAI explains a failure mechanism in model training',
      ruTitle: 'OpenAI разобрала механизм сбоя в обучении модели',
    },
  })

  assert.equal(result.articleImages.length, 1)
  assert.equal(result.rejects.length, 0)
})

test('sanitizeArticleMedia does not treat high-profile story captions as author profiles', () => {
  const result = sanitizeArticleMedia({
    coverImageUrl: null,
    articleImages: [{
      src: 'https://platform.theverge.com/wp-content/uploads/sites/2/2026/01/openai-trial.jpg',
      alt: 'Elon Musk takes the stand in high-profile trial against OpenAI',
      width: 1200,
      height: 800,
    }],
    context: {
      ...context,
      sourceName: 'The Verge AI',
      originalTitle: 'Musk against OpenAI trial enters witness phase',
    },
  })

  assert.equal(result.articleImages.length, 1)
  assert.equal(result.rejects.length, 0)
})

test('sanitizeArticleMedia rejects empty and generic captions', () => {
  const result = sanitizeArticleMedia({
    coverImageUrl: null,
    articleImages: [
      { src: 'https://example.com/photo.jpg', alt: 'Photo', width: 800, height: 600 },
      { src: 'https://example.com/empty.jpg', alt: '', width: 800, height: 600 },
    ],
    context,
  })

  assert.equal(result.articleImages.length, 0)
  assert.deepEqual(result.rejects.map((reject) => reject.reason), ['generic_caption', 'generic_caption'])
})

test('sanitizeArticleMedia supports legacy { src, alt } image shape', () => {
  const result = sanitizeArticleMedia({
    coverImageUrl: 'https://example.com/cover.jpg',
    articleImages: [{
      src: 'https://example.com/openai-product.png',
      alt: 'OpenAI product interface for GPT agents',
    }],
    context,
  })

  assert.equal(result.coverImageUrl, 'https://example.com/cover.jpg')
  assert.equal(result.articleImages.length, 1)
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

test('writeMediaSanitizeAttempt records ok result with rejected media payload', async () => {
  const { client, inserts } = recordingSupabase()

  await writeMediaSanitizeAttempt(client as never, {
    articleId: 'article-1',
    batchItemId: 'batch-item-1',
    attemptNo: 1,
    startedAt: new Date('2026-05-02T10:00:00.000Z'),
    resultStatus: 'ok',
    runId: 'run-1',
    phase: 'collect',
    rejects: [{ src: 'https://example.com/ad.jpg', reason: 'ad_url' }],
    remainingMedia: { coverImageUrl: true, articleImages: 1 },
  })

  assert.equal(inserts.length, 1)
  const payload = inserts[0]!.payload
  assert.equal(payload.stage, 'media_sanitize')
  assert.equal(payload.result_status, 'ok')
  assert.equal(payload.error_code, null)
  assert.deepEqual(payload.payload, {
    run_id: 'run-1',
    phase: 'collect',
    rejects: [{ src: 'https://example.com/ad.jpg', reason: 'ad_url' }],
    remaining_media: { coverImageUrl: true, articleImages: 1 },
  })
})

test('writeMediaSanitizeAttempt records rejected when sanitizer caused pre-submit media reject', async () => {
  const { client, inserts } = recordingSupabase()

  await writeMediaSanitizeAttempt(client as never, {
    articleId: 'article-2',
    attemptNo: 2,
    startedAt: new Date('2026-05-02T10:00:00.000Z'),
    resultStatus: 'rejected',
    claimToken: 'claim-1',
    runId: 'run-2',
    phase: 'submit',
    rejects: [{ src: 'https://example.com/banner.jpg', reason: 'banner_ratio' }],
    remainingMedia: { coverImageUrl: false, articleImages: 0 },
    errorMessage: 'media_sanitize: all media rejected before submit',
  })

  assert.equal(inserts.length, 1)
  const payload = inserts[0]!.payload
  assert.equal(payload.stage, 'media_sanitize')
  assert.equal(payload.result_status, 'rejected')
  assert.equal(payload.error_code, 'media_sanitize_rejected')
  assert.equal(payload.error_message, 'media_sanitize: all media rejected before submit')
})
