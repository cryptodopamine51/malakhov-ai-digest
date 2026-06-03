import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyGeneratedCaptionsToPlan,
  buildChannelPostPlan,
  buildTelegramCaption,
  buildTelegramCaptionFromDeepSeekJson,
  deliverPlannedChannelPost,
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

  assert.equal(updated[0]!.caption, '<b>OpenAI launches GPT-5.5 for developers</b>\n\nGenerated caption 1')
  assert.notEqual(updated[0]!.caption_hash, rows[0]!.caption_hash)
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
