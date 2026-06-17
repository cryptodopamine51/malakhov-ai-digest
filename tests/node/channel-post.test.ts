import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyGeneratedCaptionsToPlan,
  buildChannelPostPlan,
  buildTelegramCaption,
  buildTelegramCaptionFromDeepSeekJson,
  deliverDueChannelPostRows,
  deliverPlannedChannelPost,
  sendTelegramPhoto,
  selectDueChannelPostRows,
  type ChannelPostCandidate,
  type TelegramChannelPostRow,
} from '../../bot/channel-post'

function article(overrides: Partial<ChannelPostCandidate> & { id: string; original_title: string }): ChannelPostCandidate {
  return {
    id: overrides.id,
    source_name: overrides.source_name ?? 'The Decoder',
    source_lang: overrides.source_lang ?? 'en',
    original_title: overrides.original_title,
    ru_title: overrides.ru_title ?? null,
    lead: overrides.lead ?? 'Lead',
    card_teaser: overrides.card_teaser ?? 'Короткий teaser для карточки статьи.',
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

test('buildTelegramCaption uses plain two-paragraph fallback without service labels', () => {
  const caption = buildTelegramCaption({
    original_title: 'Water access is now a risk factor in SpaceX IPO',
    ru_title: 'SpaceX включила доступ к воде в факторы риска для IPO',
    lead: 'Вода нужна для охлаждения дата-центров xAI.',
    tg_teaser: 'SpaceX добавила в IPO-проспект новый риск: без воды не охладить дата-центры для ИИ xAI.',
    primary_category: 'ai-industry',
    topics: ['ai-industry'],
  })

  assert.match(caption, /^<b>SpaceX включила доступ к воде в факторы риска для IPO<\/b>\n\nSpaceX/)
  assert.doesNotMatch(caption, /Зачем открыть/)
  assert.doesNotMatch(caption, /Главное не|не просто|не только/)
  assert.ok(caption.length <= 1024)
})

test('buildTelegramCaption trims dangling title prepositions', () => {
  const caption = buildTelegramCaption({
    original_title: 'Anthropic scales Project Glasswing to hunt critical software flaws',
    ru_title: 'Anthropic расширяет Project Glasswing до 150 партнёров для поиска уязвимостей в',
    lead: 'Claude Mythos нашёл более 10 000 уязвимостей.',
    tg_teaser: 'Anthropic подключает 150 партнёров из 15 стран к поиску уязвимостей в критической инфраструктуре.',
  })

  assert.match(caption, /^<b>Anthropic расширяет Project Glasswing до 150 партнёров для поиска уязвимостей<\/b>/)
  assert.doesNotMatch(caption, / в<\/b>/)
})

test('buildTelegramCaptionFromDeepSeekJson accepts valid JSON and escapes HTML', () => {
  const caption = buildTelegramCaptionFromDeepSeekJson(
    {
      original_title: 'OpenAI <test> & partners',
      ru_title: 'OpenAI <test> & партнёры',
      tg_teaser: 'Fallback',
    },
    {
      title: 'OpenAI <test> & партнёры',
      body: 'Компания показала обновление для разработчиков. В тексте разбираем, что изменилось и где это может пригодиться.',
    },
  )

  assert.equal(
    caption,
    '<b>OpenAI &lt;test&gt; &amp; партнёры</b>\n\nКомпания показала обновление для разработчиков. В тексте разбираем, что изменилось и где это может пригодиться.',
  )
})

test('buildTelegramCaptionFromDeepSeekJson rejects forbidden template phrases', () => {
  const caption = buildTelegramCaptionFromDeepSeekJson(
    {
      original_title: 'Google launches Gemini Spark',
      ru_title: 'Google запустила Gemini Spark',
      tg_teaser: 'Fallback',
    },
    {
      title: 'Google запустила Gemini Spark',
      body: 'Это не просто анонс: смотрим не на хайп, а на то, какой сдвиг показывает новость.',
    },
  )

  assert.equal(caption, null)
})

test('applyGeneratedCaptionsToPlan updates planned rows and caption hashes', async () => {
  const candidates = [
    article({ id: 'a1', source_name: 'OpenAI News', original_title: 'OpenAI launches GPT-5.5 for developers' }),
    article({ id: 'a2', source_name: 'Google Blog', original_title: 'Google releases Gemini 3 for Workspace' }),
    article({ id: 'a3', source_name: 'Mistral News', original_title: 'Mistral introduces Le Chat enterprise tools' }),
    article({ id: 'a4', source_name: 'Nvidia Blog', original_title: 'Nvidia announces new Blackwell accelerator' }),
    article({ id: 'a5', source_name: 'Yandex Blog', original_title: 'Yandex presents YandexGPT update' }),
  ]
  const rows = plan(candidates)

  const updated = await applyGeneratedCaptionsToPlan(
    rows,
    candidates,
    async (candidate, slotNo) => `<b>${candidate.original_title}</b>\n\nGenerated caption ${slotNo}`,
  )

  // План ранжируется по score+importance (rankDigestCandidates), поэтому ожидаемый
  // caption выводим из фактического article_id слота 1, а не из фиксированного порядка.
  const slot1 = candidates.find((c) => c.id === updated[0]!.article_id)!
  assert.equal(updated[0]!.caption, `<b>${slot1.original_title}</b>\n\nGenerated caption 1`)
  assert.notEqual(updated[0]!.caption_hash, rows[0]!.caption_hash)
})

type Operation = {
  table: string
  kind: 'update'
  payload: Record<string, unknown>
  filters: Array<[string, unknown]>
}

function createSupabaseMock(inputRows: TelegramChannelPostRow | TelegramChannelPostRow[]) {
  const operations: Operation[] = []
  const rows = Array.isArray(inputRows) ? [...inputRows] : [inputRows]

  function filterValue(state: Operation, column: string): unknown {
    return state.filters.find(([key]) => key === column)?.[1]
  }

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
              const id = filterValue(state, 'id')
              const status = filterValue(state, 'status')
              const row = rows.find((item) => item.id === id && item.status === status)
              if (!row) return { data: [], error: null }
              Object.assign(row, state.payload)
              return { data: [{ ...row }], error: null }
            }
            if (table === 'telegram_channel_posts') {
              const id = filterValue(state, 'id')
              const row = rows.find((item) => item.id === id)
              if (row) Object.assign(row, state.payload)
              return { data: [], error: null }
            }
            if (table === 'articles') {
              const ids = filterValue(state, 'id')
              return {
                data: (Array.isArray(ids) ? ids : []).map((id) => ({ id })),
                error: null,
              }
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

test('selectDueChannelPostRows includes missed planned slots before requested slot', () => {
  const rows = [
    plannedRow({ id: 'post-1', slot_no: 1, status: 'planned' }),
    plannedRow({ id: 'post-2', slot_no: 2, status: 'success', telegram_message_id: 123 }),
    plannedRow({ id: 'post-3', slot_no: 3, status: 'planned' }),
  ]

  assert.deepEqual(selectDueChannelPostRows(rows, 3).map((row) => row.slot_no), [1, 3])
})

test('selectDueChannelPostRows includes retryable failed_send slots before requested slot', () => {
  const rows = [
    plannedRow({ id: 'post-1', slot_no: 1, status: 'failed_send', error_message: 'Telegram timeout' }),
    plannedRow({ id: 'post-2', slot_no: 2, status: 'success', telegram_message_id: 123 }),
    plannedRow({ id: 'post-3', slot_no: 3, status: 'planned' }),
  ]

  assert.deepEqual(selectDueChannelPostRows(rows, 3).map((row) => row.slot_no), [1, 3])
})

test('selectDueChannelPostRows checks earlier missed slots even when requested slot already succeeded', () => {
  const rows = [
    plannedRow({ id: 'post-1', slot_no: 1, status: 'planned' }),
    plannedRow({ id: 'post-2', slot_no: 2, status: 'success', telegram_message_id: 123 }),
  ]

  assert.deepEqual(selectDueChannelPostRows(rows, 2).map((row) => row.slot_no), [1, 2])
})

test('deliverDueChannelPostRows catches up missed planned slots before requested slot', async () => {
  const rows = [
    plannedRow({ id: 'post-1', slot_no: 1, article_id: 'article-1', article_url: 'https://news.example.com/article-1?utm_content=slot_1' }),
    plannedRow({ id: 'post-2', slot_no: 2, article_id: 'article-2', article_url: 'https://news.example.com/article-2?utm_content=slot_2' }),
  ]
  const supabase = createSupabaseMock(rows)
  const sentSlots: number[] = []

  const result = await deliverDueChannelPostRows(
    supabase as never,
    rows,
    2,
    'bot-token',
    async (_botToken, _channelId, _cover, _caption, articleUrlValue) => {
      sentSlots.push(Number(new URL(articleUrlValue).searchParams.get('utm_content')?.replace('slot_', '')))
      return { result: { message_id: 450 + sentSlots.length } }
    },
  )

  assert.equal(result.status, 'success')
  assert.equal(result.slot, 2)
  assert.deepEqual(sentSlots, [1, 2])
  assert.equal(
    supabase.operations.filter((op) => op.table === 'telegram_channel_posts' && op.payload.status === 'success').length,
    2,
  )
  assert.equal(
    supabase.operations.filter((op) => op.table === 'articles' && op.payload.tg_sent === true).length,
    2,
  )
})

test('deliverDueChannelPostRows retries failed_send catch-up slots', async () => {
  const rows = [
    plannedRow({
      id: 'post-1',
      slot_no: 1,
      status: 'failed_send',
      article_id: 'article-1',
      article_url: 'https://news.example.com/article-1?utm_content=slot_1',
      failed_at: '2026-06-01T06:35:00.000Z',
      error_message: 'Telegram timeout',
    }),
    plannedRow({ id: 'post-2', slot_no: 2, article_id: 'article-2', article_url: 'https://news.example.com/article-2?utm_content=slot_2' }),
  ]
  const supabase = createSupabaseMock(rows)
  const sentSlots: number[] = []

  const result = await deliverDueChannelPostRows(
    supabase as never,
    rows,
    2,
    'bot-token',
    async (_botToken, _channelId, _cover, _caption, articleUrlValue) => {
      sentSlots.push(Number(new URL(articleUrlValue).searchParams.get('utm_content')?.replace('slot_', '')))
      return { result: { message_id: 550 + sentSlots.length } }
    },
  )

  assert.equal(result.status, 'success')
  assert.equal(result.slot, 2)
  assert.deepEqual(sentSlots, [1, 2])
  assert.equal(
    supabase.operations.some((op) => (
      op.table === 'telegram_channel_posts' &&
      op.payload.status === 'sending' &&
      op.filters.some(([column, value]) => column === 'status' && value === 'failed_send')
    )),
    true,
  )
})

test('deliverDueChannelPostRows reports catch-up success when requested slot was already sent', async () => {
  const rows = [
    plannedRow({ id: 'post-1', slot_no: 1, article_id: 'article-1', article_url: 'https://news.example.com/article-1?utm_content=slot_1' }),
    plannedRow({
      id: 'post-2',
      slot_no: 2,
      status: 'success',
      telegram_message_id: 123,
      sent_at: '2026-06-01T09:30:00.000Z',
      article_id: 'article-2',
      article_url: 'https://news.example.com/article-2?utm_content=slot_2',
    }),
  ]
  const supabase = createSupabaseMock(rows)
  const sentSlots: number[] = []

  const result = await deliverDueChannelPostRows(
    supabase as never,
    rows,
    2,
    'bot-token',
    async (_botToken, _channelId, _cover, _caption, articleUrlValue) => {
      sentSlots.push(Number(new URL(articleUrlValue).searchParams.get('utm_content')?.replace('slot_', '')))
      return { result: { message_id: 650 + sentSlots.length } }
    },
  )

  assert.equal(result.status, 'success')
  assert.equal(result.slot, 1)
  assert.deepEqual(sentSlots, [1])
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

test('buildChannelPostPlan lifts an important multi-source story above higher-raw-score filler', () => {
  // Anthropic $65B funding из трёх источников против проходных заметок со score выше.
  const fundingStory = (id: string, source: string) =>
    article({
      id,
      original_title: 'Anthropic raises $65B funding round',
      ru_title: 'Anthropic привлекла $65 млрд',
      source_name: source,
      score: 4,
    })
  const filler = (id: string) =>
    article({
      id,
      original_title: `Generic ai productivity tips ${id}`,
      ru_title: `Подборка советов ${id}`,
      score: 6,
    })

  const rows = plan([
    filler('f1'),
    filler('f2'),
    filler('f3'),
    filler('f4'),
    filler('f5'),
    fundingStory('a1', 'TechCrunch AI'),
    fundingStory('a2', 'The Decoder'),
    fundingStory('a3', 'Crunchbase News'),
  ])

  assert.equal(rows[0]?.slot_no, 1)
  // Какая именно строка истории возьмёт слот — тай-брейк ранкера; важно, что слот 1
  // достался funding-истории, а не filler'у с более высоким raw score.
  assert.ok(['a1', 'a2', 'a3'].includes(rows[0]?.article_id ?? ''), `slot1=${rows[0]?.article_id}`)
})

test('год-санитайзер: бракует caption с прошлым годом, которого нет в источнике', async () => {
  const { hasStaleYearHallucination, buildTelegramCaptionFromDeepSeekJson } = await import('../../bot/channel-post')
  const now = new Date('2026-06-10T12:00:00.000Z')
  const a = article({ id: 'y1', original_title: 'Apple prepares new Siri with Gemini for WWDC' })

  assert.equal(hasStaleYearHallucination(a, 'Apple покажет Siri на WWDC 2025', now), true)
  // Текущий и будущий год — легитимны.
  assert.equal(hasStaleYearHallucination(a, 'Apple покажет Siri на WWDC 2026', now), false)
  assert.equal(hasStaleYearHallucination(a, 'Релиз перенесён на 2027 год', now), false)
  // Прошлый год, который есть в самом источнике, — легитимная ретроспектива.
  const withYear = article({ id: 'y2', original_title: 'After the 2024 launch, OpenAI updates GPT-4o' })
  assert.equal(hasStaleYearHallucination(withYear, 'После запуска 2024 года вышло обновление', now), false)

  // Интеграция: невалидный год -> caption бракуется (null), сработает retry/fallback.
  const rejected = buildTelegramCaptionFromDeepSeekJson(
    a,
    { title: 'Apple готовит Siri на WWDC 2025', body: 'Подробности интеграции с Gemini.' },
    1024,
    now,
  )
  assert.equal(rejected, null)
})
