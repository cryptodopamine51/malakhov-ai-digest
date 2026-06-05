import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildChannelPostPlan,
  buildTelegramCaption,
  deliverPlannedChannelPost,
  sendTelegramPhoto,
  type ChannelPostCandidate,
  type TelegramChannelPostRow,
} from '../../bot/channel-post'

function article(overrides: Partial<ChannelPostCandidate> & { id: string; original_title: string }): ChannelPostCandidate {
  return {
    id: overrides.id,
    source_name: overrides.source_name ?? 'The Decoder',
    original_title: overrides.original_title,
    ru_title: overrides.ru_title ?? null,
    lead: overrides.lead ?? 'Lead',
    tg_teaser: overrides.tg_teaser ?? 'Коротко объясняем, почему это важно и что будет в материале.',
    primary_category: overrides.primary_category ?? 'ai-industry',
    secondary_categories: overrides.secondary_categories ?? [],
    topics: overrides.topics ?? ['ai-industry'],
    score: overrides.score ?? 5,
    pub_date: overrides.pub_date ?? '2026-05-31T10:00:00.000Z',
    slug: overrides.slug ?? `slug-${overrides.id}`,
    cover_image_url: overrides.cover_image_url ?? `https://cdn.example.com/${overrides.id}.webp`,
  }
}

function plan(candidates: ChannelPostCandidate[]) {
  return buildChannelPostPlan(candidates, [], {
    deliveryDate: '2026-06-01',
    contentDate: '2026-05-31',
    channelId: '@channel',
    siteUrl: 'https://news.example.com',
    plannedAt: '2026-06-01T06:30:00.000Z',
  })
}

test('buildChannelPostPlan creates five planned rows when enough candidates exist', () => {
  const rows = plan([
    article({ id: 'a1', source_name: 'OpenAI News', original_title: 'OpenAI launches GPT-5.5 for developers' }),
    article({ id: 'a2', source_name: 'Google Blog', original_title: 'Google releases Gemini 3 for Workspace' }),
    article({ id: 'a3', source_name: 'Mistral News', original_title: 'Mistral introduces Le Chat enterprise tools' }),
    article({ id: 'a4', source_name: 'Nvidia Blog', original_title: 'Nvidia announces new Blackwell accelerator' }),
    article({ id: 'a5', source_name: 'Yandex Blog', original_title: 'Yandex presents YandexGPT update' }),
  ])

  assert.equal(rows.length, 5)
  assert.deepEqual(rows.map((row) => row.status), ['planned', 'planned', 'planned', 'planned', 'planned'])
  assert.deepEqual(rows.map((row) => row.slot_no), [1, 2, 3, 4, 5])
  assert.match(rows[0]!.article_url ?? '', /utm_source=tg&utm_medium=channel&utm_campaign=dayfeed_20260601&utm_content=slot_1/)
})

test('buildChannelPostPlan records skipped_low_articles for every slot below minimum', () => {
  const rows = plan([
    article({ id: 'a1', original_title: 'OpenAI launches GPT-5.5 for developers' }),
    article({ id: 'a2', original_title: 'Google releases Gemini 3 for Workspace' }),
  ])

  assert.equal(rows.length, 5)
  assert.equal(rows.every((row) => row.status === 'skipped_low_articles'), true)
  assert.equal(rows.every((row) => row.article_id === null), true)
})

test('buildChannelPostPlan deduplicates the same strong story across slots', () => {
  const rows = plan([
    article({
      id: 'anthropic-crunchbase',
      source_name: 'Crunchbase News',
      original_title: 'Anthropic Nears $1T Valuation With $65B Funding Round',
      ru_title: 'Оценка Anthropic достигла $965 млрд после раунда на $65 млрд',
      score: 9,
    }),
    article({
      id: 'anthropic-techcrunch',
      source_name: 'TechCrunch AI',
      original_title: 'Anthropic raises $65 Billion, nears $1T valuation ahead of IPO',
      ru_title: 'Anthropic привлёк $65 млрд при оценке почти $1 трлн',
      score: 8,
    }),
    article({ id: 'openai', original_title: 'OpenAI launches GPT-5.5 for developers' }),
    article({ id: 'google', original_title: 'Google releases Gemini 3 for Workspace' }),
    article({ id: 'mistral', original_title: 'Mistral introduces Le Chat enterprise tools' }),
  ])

  assert.equal(rows.filter((row) => row.article_id === 'anthropic-crunchbase').length, 1)
  assert.equal(rows.some((row) => row.article_id === 'anthropic-techcrunch'), false)
})

test('buildTelegramCaption keeps valid HTML under Telegram photo caption limit', () => {
  const caption = buildTelegramCaption({
    original_title: 'OpenAI <test> & partners launch new model',
    ru_title: null,
    tg_teaser: 'x'.repeat(2_000),
  })

  assert.ok(caption.length <= 1024)
  assert.match(caption, /^<b>OpenAI &lt;test&gt; &amp; partners launch new model<\/b>/)
  assert.doesNotMatch(caption, /OpenAI <test> & partners/)
})

test('buildTelegramCaption adds an editorial angle and reading hook', () => {
  const caption = buildTelegramCaption({
    original_title: 'Water access is now a risk factor in SpaceX IPO',
    ru_title: 'SpaceX включила доступ к воде в факторы риска для IPO',
    lead: 'Вода нужна для охлаждения дата-центров xAI.',
    tg_teaser: 'SpaceX добавила в IPO-проспект новый риск: без воды не охладить дата-центры для ИИ xAI.',
    primary_category: 'ai-industry',
    topics: ['ai-industry'],
  })

  assert.match(caption, /ИИ-инфраструктура упирается не только в GPU/)
  assert.match(caption, /<b>Зачем открыть:<\/b>/)
  assert.ok(caption.length <= 1024)
})

test('buildTelegramCaption does not confuse выводам with water access', () => {
  const caption = buildTelegramCaption({
    original_title: 'Как Claude убедил заказчиков, что я некомпетентен',
    ru_title: 'Как Claude убедил заказчиков уволить разработчика',
    lead: 'Заказчики проверили работу через Claude и поверили выводам модели больше, чем специалисту.',
    tg_teaser: 'Фрилансер сделал бот, но заказчики уволили его по совету нейросети.',
    primary_category: 'ai-russia',
    topics: ['ai-russia', 'coding'],
  })

  assert.match(caption, /отдают модели право судить о компетентности/)
  assert.doesNotMatch(caption, /ИИ-инфраструктура упирается/)
})

type Operation = {
  table: string
  kind: 'update'
  payload: Record<string, unknown>
  filters: Array<[string, unknown]>
}

function createSupabaseMock(row: TelegramChannelPostRow) {
  const operations: Operation[] = []

  return {
    operations,
    from(table: string) {
      const state: Operation = { table, kind: 'update', payload: {}, filters: [] }
      const builder = {
        update(payload: Record<string, unknown>) {
          state.payload = payload
          operations.push(state)
          return builder
        },
        eq(column: string, value: unknown) {
          state.filters.push([column, value])
          return builder
        },
        in(column: string, value: unknown) {
          state.filters.push([column, value])
          return builder
        },
        select() {
          return builder
        },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          const response = (() => {
            if (table === 'telegram_channel_posts' && state.payload.status === 'sending') {
              return { data: [{ ...row, status: 'sending' }], error: null }
            }
            if (table === 'articles') {
              return { data: [{ id: row.article_id }], error: null }
            }
            return { data: [], error: null }
          })()
          return Promise.resolve(response).then(onFulfilled, onRejected)
        },
      }
      return builder
    },
  }
}

function plannedRow(overrides: Partial<TelegramChannelPostRow> = {}): TelegramChannelPostRow {
  return {
    id: 'post-1',
    delivery_date: '2026-06-01',
    content_date: '2026-05-31',
    slot_no: 1,
    channel_id: '@channel',
    article_id: 'article-1',
    status: 'planned',
    telegram_message_id: null,
    caption: '<b>Title</b>\n\nTeaser',
    caption_hash: 'hash',
    article_url: 'https://news.example.com/categories/ai/article?utm_source=tg',
    cover_image_url: 'https://cdn.example.com/cover.webp',
    story_key: 'openai:product_launch:test',
    planned_at: '2026-06-01T06:00:00.000Z',
    claimed_at: null,
    sent_at: null,
    failed_at: null,
    error_message: null,
    created_at: '2026-06-01T06:00:00.000Z',
    updated_at: '2026-06-01T06:00:00.000Z',
    ...overrides,
  }
}

test('deliverPlannedChannelPost does not send a row already marked success', async () => {
  const row = plannedRow({ status: 'success', telegram_message_id: 123 })
  const supabase = createSupabaseMock(row)
  let sent = false

  const result = await deliverPlannedChannelPost(
    supabase as never,
    row,
    'bot-token',
    async () => {
      sent = true
      return { result: { message_id: 456 } }
    },
  )

  assert.equal(result.status, 'skipped_already_sent')
  assert.equal(sent, false)
  assert.equal(supabase.operations.length, 0)
})

test('deliverPlannedChannelPost records success and marks article tg_sent', async () => {
  const row = plannedRow()
  const supabase = createSupabaseMock(row)

  const result = await deliverPlannedChannelPost(
    supabase as never,
    row,
    'bot-token',
    async () => ({ result: { message_id: 456 } }),
  )

  assert.equal(result.status, 'success')
  assert.equal(supabase.operations.some((op) => op.table === 'telegram_channel_posts' && op.payload.status === 'success'), true)
  assert.equal(supabase.operations.some((op) => op.table === 'articles' && op.payload.tg_sent === true), true)
})

test('deliverPlannedChannelPost failure does not mark article tg_sent', async () => {
  const row = plannedRow()
  const supabase = createSupabaseMock(row)

  const result = await deliverPlannedChannelPost(
    supabase as never,
    row,
    'bot-token',
    async () => {
      throw new Error('Telegram API down')
    },
  )

  assert.equal(result.status, 'failed')
  assert.equal(supabase.operations.some((op) => op.table === 'telegram_channel_posts' && op.payload.status === 'failed_send'), true)
  assert.equal(supabase.operations.some((op) => op.table === 'articles'), false)
})

test('sendTelegramPhoto uploads prefetched cover bytes instead of passing remote URL to Telegram', async () => {
  const previousFetch = globalThis.fetch
  const calls: Array<{ input: string; init?: RequestInit }> = []
  const imageBytes = new Uint8Array([1, 2, 3, 4])

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input: String(input), init })

    if (calls.length === 1) {
      assert.equal(String(input), 'https://cdn.example.com/cover.webp')
      return new Response(imageBytes, {
        status: 200,
        headers: {
          'content-type': 'image/webp',
          'content-length': String(imageBytes.byteLength),
        },
      })
    }

    assert.equal(String(input), 'https://api.telegram.org/botbot-token/sendPhoto')
    assert.equal(init?.method, 'POST')
    assert.ok(init?.body instanceof FormData)
    const body = init.body
    assert.equal(body.get('chat_id'), '@channel')
    assert.equal(body.get('caption'), '<b>Title</b>')
    assert.equal(body.get('parse_mode'), 'HTML')
    assert.deepEqual(JSON.parse(String(body.get('reply_markup'))), {
      inline_keyboard: [[{ text: 'Читать на сайте', url: 'https://news.example.com/article' }]],
    })

    const photo = body.get('photo')
    assert.ok(photo instanceof Blob)
    assert.equal(photo.type, 'image/webp')
    assert.equal(photo.size, imageBytes.byteLength)

    return new Response(JSON.stringify({ ok: true, result: { message_id: 789 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch

  try {
    const result = await sendTelegramPhoto(
      'bot-token',
      '@channel',
      'https://cdn.example.com/cover.webp',
      '<b>Title</b>',
      'https://news.example.com/article',
    )

    assert.equal(result.result.message_id, 789)
    assert.equal(calls.length, 2)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('sendTelegramPhoto fails before Telegram API when cover response is not an image', async () => {
  const previousFetch = globalThis.fetch
  let calls = 0

  globalThis.fetch = (async () => {
    calls += 1
    return new Response('<html>not found</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })
  }) as typeof fetch

  try {
    await assert.rejects(
      () => sendTelegramPhoto(
        'bot-token',
        '@channel',
        'https://cdn.example.com/cover.webp',
        '<b>Title</b>',
        'https://news.example.com/article',
      ),
      /unsupported content-type: text\/html/,
    )
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = previousFetch
  }
})
