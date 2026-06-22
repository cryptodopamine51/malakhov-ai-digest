import assert from 'node:assert/strict'
import test from 'node:test'

import type { Article } from '../../lib/supabase'
import {
  buildWeekSummary,
  buildWeeklyReportMessage,
  runWeeklyReport,
  selectWeeklyReportArticles,
  weeklyReportWindow,
} from '../../bot/weekly-report-core'
import { parseWeeklyReportCliArgs } from '../../bot/weekly-report'

const SITE_URL = 'https://news.example.test'

function article(index: number, overrides: Partial<Article> = {}): Article {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    original_url: `https://source.example/${index}`,
    original_title: `Original AI event ${index}`,
    source_name: overrides.source_name ?? `Source ${index % 4}`,
    source_lang: 'ru',
    primary_category: overrides.primary_category ?? 'ai-industry',
    secondary_categories: [],
    topics: ['ai-industry'],
    pub_date: `2026-06-${String(15 + (index % 7)).padStart(2, '0')}T12:00:00.000Z`,
    ru_title: overrides.ru_title ?? `Важная новость индустрии ИИ номер ${index}`,
    lead: overrides.lead ?? `Событие ${index} меняет рынок ИИ и условия работы компаний.`,
    tg_teaser: overrides.tg_teaser ?? `Коротко о событии ${index}: что произошло и почему это важно для рынка.`,
    card_teaser: null,
    score: overrides.score ?? 100 - index,
    slug: overrides.slug ?? `important-ai-event-${index}`,
    published: true,
    quality_ok: true,
    verified_live: true,
    publish_status: 'live',
    published_at: '2026-06-18T12:00:00.000Z',
    ...overrides,
  } as Article
}

test('weeklyReportWindow returns the previous complete Moscow Monday-Sunday week', () => {
  assert.deepEqual(weeklyReportWindow('2026-06-22'), {
    weekStart: '2026-06-15',
    weekEnd: '2026-06-21',
    from: '2026-06-14T21:00:00.000Z',
    to: '2026-06-21T21:00:00.000Z',
  })
  assert.throws(() => weeklyReportWindow('2026-06-22', '2026-06-16'), /понедельником/)
})

test('selection returns six deduplicated stories and moves the pinned article to position 6', () => {
  const candidates = Array.from({ length: 12 }, (_, index) => article(index + 1))
  const pin = candidates[7]
  const selection = selectWeeklyReportArticles(candidates, pin.slug!)

  assert.equal(selection.articles.length, 6)
  assert.equal(selection.articles[5].id, pin.id)
  assert.equal(new Set(selection.articles.map((item) => item.id)).size, 6)
})

test('weekly selection keeps editorial score above incidental importance anchors', () => {
  const candidates = [
    article(1, { score: 8, ru_title: 'OpenAI выпустила новую модель' }),
    article(2, { score: 8, ru_title: 'Google запустила новый ИИ-сервис' }),
    article(3, { score: 7, ru_title: 'Anthropic обновила платформу для бизнеса' }),
    article(4, { score: 7, ru_title: 'Исследователи проверили безопасность агентов' }),
    article(5, { score: 7, ru_title: 'AWS представила инфраструктуру для ИИ' }),
    article(6, { score: 6, ru_title: 'Кадровое событие в лаборатории' }),
    article(7, { score: 5, ru_title: 'Фильм упомянул инвестиции Amazon на $50 млрд' }),
    article(8, { score: 10, ru_title: 'Android вышел для смартфонов Pixel' }),
  ]
  const selection = selectWeeklyReportArticles(candidates)
  assert.doesNotMatch(selection.articles.map((item) => item.ru_title).join('\n'), /Фильм/)
  assert.doesNotMatch(selection.articles.map((item) => item.ru_title).join('\n'), /Android/)
})

test('all three report formats contain six linked titles, summary, CTA, and fit Telegram', () => {
  const articles = Array.from({ length: 6 }, (_, index) => article(index + 1))
  const window = weeklyReportWindow('2026-06-22')

  for (const format of ['signal', 'business', 'channel'] as const) {
    const message = buildWeeklyReportMessage(format, articles, window, {
      siteUrl: SITE_URL,
      channelUrl: 'https://t.me/example',
    })
    assert.equal((message.match(/utm_medium=weekly_report/g) ?? []).length, 6)
    assert.match(message, /Неделя запомнилась/)
    assert.match(message, /https:\/\/t\.me\/example/)
    assert.ok(message.length <= 4_000)
  }
})

test('week summary reflects editorial themes rather than repeating titles', () => {
  const summary = buildWeekSummary([
    article(1, { ru_title: 'Стартап привлёк раунд $300 млн', primary_category: 'ai-investments' }),
    article(2, { ru_title: 'Новый бенчмарк показал лишь 3% успеха', primary_category: 'ai-research' }),
    article(3, { ru_title: 'OpenAI выпустила новый сервис' }),
  ])
  assert.match(summary, /ставками/)
  assert.match(summary, /ограничений и рисков|исследованиями/)
})

test('CLI requires explicit delivery and validates scheduled format', () => {
  assert.deepEqual(parseWeeklyReportCliArgs([
    '--week-start=2026-06-15',
    '--format=all',
    '--send=admin',
    '--markers',
    '--pin=important-ai-event-8',
  ]), {
    weekStart: '2026-06-15',
    format: 'all',
    delivery: 'preview',
    marker: true,
    pinnedArticle: 'important-ai-event-8',
  })
  assert.throws(() => parseWeeklyReportCliArgs([]), /Требуется/)
  assert.throws(() => parseWeeklyReportCliArgs(['--scheduled', '--format=all']), /не поддерживает/)
})

test('preview sends three marked messages without claiming a scheduled run', async () => {
  const candidates = Array.from({ length: 10 }, (_, index) => article(index + 1))
  const sent: string[] = []
  const result = await runWeeklyReport({
    weekStart: '2026-06-15',
    format: 'all',
    delivery: 'preview',
    marker: true,
    pinnedArticle: candidates[7].slug!,
    siteUrl: SITE_URL,
    channelUrl: 'https://t.me/example',
    supabase: {} as never,
    botToken: 'token',
    adminChatId: 'chat',
    fetchCandidates: async () => candidates,
    sendMessage: async (_token, _chat, message) => {
      sent.push(message)
      return { result: { message_id: sent.length } }
    },
  })

  assert.equal(result.status, 'preview-sent')
  assert.equal(sent.length, 3)
  assert.ok(sent.every((message, index) => message.includes(`Тест ${index + 1}/3`)))
  assert.ok(sent.every((message) => message.includes(candidates[7].ru_title!)))
})
