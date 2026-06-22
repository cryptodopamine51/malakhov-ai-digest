import assert from 'node:assert/strict'
import test from 'node:test'

import type { Article } from '../../lib/supabase'
import {
  buildWeekSummary,
  buildWeeklyReportMessage,
  completeWeeklyDescription,
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

test('all three report formats use the approved title, omit promo copy, and fit Telegram', () => {
  const articles = Array.from({ length: 6 }, (_, index) => article(index + 1))
  const window = weeklyReportWindow('2026-06-22')

  for (const format of ['signal', 'business', 'channel'] as const) {
    const message = buildWeeklyReportMessage(format, articles, window, {
      siteUrl: SITE_URL,
      channelUrl: 'https://t.me/example',
    })
    assert.equal((message.match(/utm_medium=weekly_report/g) ?? []).length, 6)
    assert.match(message, /6 новостей в ИИ, которые обсуждали на прошлой неделе/)
    assert.doesNotMatch(message, /За неделю обсуждали:/)
    assert.doesNotMatch(message, /без (?:информационного )?шума/iu)
    assert.doesNotMatch(message, /Подписывайтесь/iu)
    assert.doesNotMatch(message, /https:\/\/t\.me\/example/)
    assert.ok(message.length <= 4_000)
  }
})

test('weekly descriptions contain only complete sentences and never end with an ellipsis', () => {
  const description = completeWeeklyDescription(article(1, {
    tg_teaser: 'Первое предложение сообщает факт. Второе предложение слишком длинное и не должно обрываться посередине из-за ограничения длины текста.',
  }), 45)
  assert.equal(description, 'Первое предложение сообщает факт.')
  assert.match(description, /[.!?]$/)
  assert.doesNotMatch(description, /…/)

  const withoutPunctuation = completeWeeklyDescription(article(2, {
    tg_teaser: 'Компания запустила сервис для автоматизации продаж',
  }), 100)
  assert.equal(withoutPunctuation, 'Компания запустила сервис для автоматизации продаж.')
})

test('selection models produce distinct entrepreneur-facing collections', () => {
  const candidate = (index: number, overrides: Partial<Article>) => article(index, {
    score: 8,
    source_name: `Distinct Source ${index}`,
    ...overrides,
  })
  const candidates = [
    candidate(1, { ru_title: 'ИИ-стартап привлёк раунд $500 млн', primary_category: 'ai-investments' }),
    candidate(2, { ru_title: 'Новый закон ограничил экспорт ИИ-моделей', primary_category: 'ai-industry' }),
    candidate(3, { ru_title: 'Выручка ИИ-компании выросла до $2 млрд', primary_category: 'ai-startups' }),
    candidate(4, { ru_title: 'AWS выпустила API для корпоративных ИИ-агентов', primary_category: 'ai-industry' }),
    candidate(5, { ru_title: 'Облачная платформа автоматизирует поддержку клиентов', primary_category: 'ai-industry' }),
    candidate(6, { ru_title: 'ИИ-редактор кода получил интеграцию с GitHub', primary_category: 'ai-tools' }),
    candidate(7, { ru_title: 'CRM внедрила ИИ-агентов для продаж', primary_category: 'ai-business' }),
    candidate(8, { ru_title: 'Компании сократили расходы на поддержку после внедрения ИИ', primary_category: 'ai-business' }),
    candidate(9, { ru_title: 'Лаборатория представила новую мультимодальную модель', primary_category: 'ai-labs' }),
    candidate(10, { ru_title: 'Бенчмарк проверил точность рассуждений моделей', primary_category: 'ai-research' }),
    candidate(11, { ru_title: 'Новый ИИ-фильм вышел на смартфонах Pixel', score: 10 }),
    candidate(12, { ru_title: 'Ведущий исследователь перешёл из Google в OpenAI', primary_category: 'ai-industry' }),
  ]

  const market = selectWeeklyReportArticles(candidates, undefined, 'market').articles.map((item) => item.id)
  const business = selectWeeklyReportArticles(candidates, undefined, 'business-impact').articles.map((item) => item.id)
  const operator = selectWeeklyReportArticles(candidates, undefined, 'operator').articles.map((item) => item.id)

  assert.notDeepEqual(market, business)
  assert.notDeepEqual(business, operator)
  assert.ok(market.some((id) => candidates.slice(0, 3).some((item) => item.id === id)))
  assert.ok(operator.some((id) => candidates.slice(3, 6).some((item) => item.id === id)))
  assert.equal(business.length, 6)
  assert.ok([market, business, operator].every((ids) => !ids.includes(candidates[10].id)))
})

test('week summary reflects editorial themes rather than repeating titles', () => {
  const summary = buildWeekSummary([
    article(1, { ru_title: 'Стартап привлёк раунд $300 млн', primary_category: 'ai-investments' }),
    article(2, { ru_title: 'Новый бенчмарк показал лишь 3% успеха', primary_category: 'ai-research' }),
    article(3, { ru_title: 'OpenAI выпустила новый сервис' }),
  ])
  assert.match(summary, /инвестиции и экономика/)
  assert.match(summary, /ошибки и ограничения|результаты исследований/)
  assert.doesNotMatch(summary, /без шума/)
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
  assert.ok(sent.every((message, index) => message.includes(`Тест ${index + 1}/3 ·`)))
  assert.ok(sent.every((message) => message.includes(candidates[7].ru_title!)))
  assert.equal(new Set(sent).size, 3)
})
