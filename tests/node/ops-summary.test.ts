import test from 'node:test'
import assert from 'node:assert/strict'

import {
  _internals,
  evaluateOpsStatus,
  formatOpsSummaryForTelegram,
  getMetrikaTrafficSummary,
  resolveOpsReportKind,
  shouldShowFixPrompt,
  type OpsSummary,
} from '../../lib/ops-summary'

function baseSummary(overrides: Partial<OpsSummary> = {}): OpsSummary {
  const summary: OpsSummary = {
    generatedAt: '2026-05-11T18:00:00.000Z',
    reportKind: 'evening',
    mskDateKey: '2026-05-11',
    health: {
      server_time: '2026-05-11T18:00:00.000Z',
      ingest: { finished_at: '2026-05-11T17:29:00.000Z', status: 'ok' },
      enrich: { finished_at: '2026-05-11T17:45:00.000Z', status: 'ok', run_kind: 'batch_collect' },
      telegram: {
        delivery_date: '2026-05-11',
        status: 'success',
        slots_success: 5,
        slots_failed: 0,
        slots_planned: 0,
        slots_total: 5,
        sent_at: '2026-05-11T18:00:00.000Z',
      },
      digest: { digest_date: '2026-05-11', status: 'success', sent_at: '2026-05-11T06:30:00.000Z' },
      alerts_open: 0,
      batches_open: 0,
      oldest_pending_age_minutes: 20,
      articles_published_today: 5,
      articles_rejected_today_by_reason: {},
      cost_today_usd: 0.42,
      live_window_6h_count: 2,
      top_open_alerts: [],
    },
    status: { level: 'green', emoji: '🟢', label: 'зеленый', reasons: ['ok'] },
    articles: {
      created24h: 12,
      byEnrichStatus: { enriched_ok: 5, failed: 1 },
      byPublishStatus: { live: 5, draft: 7 },
      currentQueue: { pending: 1, retry_wait: 0, processing: 2 },
      publishedTodayCount: 5,
      recentPublished: [
        {
          ru_title: 'OpenAI <test> & partners launch new model',
          source_name: 'OpenAI News',
          primary_category: 'ai-labs',
          published_at: '2026-05-11T17:30:00.000Z',
          slug: 'openai-test',
        },
      ],
      topSources24h: [{ key: 'OpenAI News', count: 3 }],
      topCategories24h: [{ key: 'ai-labs', count: 4 }],
    },
    latestIngest: {
      started_at: '2026-05-11T17:29:00.000Z',
      finished_at: '2026-05-11T17:30:00.000Z',
      status: 'ok',
      feeds_total: 26,
      feeds_failed: 0,
      items_seen: 10,
      items_inserted: 4,
      items_duplicates: 6,
      items_failed: 0,
      error_summary: null,
    },
    latestEnrich: {
      started_at: '2026-05-11T17:40:00.000Z',
      finished_at: '2026-05-11T17:45:00.000Z',
      status: 'ok',
      run_kind: 'batch_collect',
      batch_size: 50,
      articles_claimed: 0,
      articles_enriched_ok: 2,
      articles_rejected: 0,
      articles_retryable: 0,
      articles_failed: 0,
      rejected_breakdown: {},
      estimated_cost_usd: 0.12,
      error_summary: null,
    },
    telegramToday: {
      delivery_date: '2026-05-11',
      expected_slots: 4,
      success_count: 4,
      failed_count: 0,
      skipped_count: 0,
      planned_count: 1,
      status: 'success',
      latest_sent_at: '2026-05-11T15:30:00.000Z',
      latest_error: null,
    },
    latestTelegram: null,
    digestToday: {
      created_at: '2026-05-11T06:30:00.000Z',
      digest_date: '2026-05-11',
      status: 'success',
      articles_count: 5,
      sent_at: '2026-05-11T06:31:00.000Z',
      failed_at: null,
      error_message: null,
    },
    latestDigest: null,
    openAlerts: [],
    alertGroups: [],
    costs: {
      totalCostUsd: 0.42,
      calls: 10,
      byProvider: [{ key: 'anthropic', costUsd: 0.4 }],
      byOperation: [{ key: 'editorial_batch_result', costUsd: 0.4 }],
    },
    sources: {
      runs24h: 20,
      failedRuns24h: 0,
      itemsSeen24h: 200,
      itemsInserted24h: 12,
      itemsRejected24h: 30,
      fetchErrors24h: 0,
      topProblemSources: [],
    },
    traffic: {
      status: 'ok',
      date: '2026-05-10',
      compareDate: '2026-05-09',
      visits: 270,
      users: 221,
      pageviews: 343,
      visitsChangePercent: 14,
      usersChangePercent: 9,
      pageviewsChangePercent: 12,
      sampled: false,
    },
  }

  return { ...summary, ...overrides }
}

test('resolveOpsReportKind maps auto to morning before 14:00 MSK and evening after', () => {
  assert.equal(resolveOpsReportKind('auto', new Date('2026-05-11T06:45:00.000Z')), 'morning')
  assert.equal(resolveOpsReportKind('auto', new Date('2026-05-11T17:30:00.000Z')), 'evening')
})

test('getMetrikaTrafficSummary reads yesterday traffic and deltas', async () => {
  let requestedUrl = ''
  let requestedAuth = ''
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrl = String(input)
    requestedAuth = String((init?.headers as Record<string, string>).Authorization)
    return new Response(JSON.stringify({
      sampled: false,
      data: [
        { dimensions: [{ name: '2026-05-31' }], metrics: [200, 180, 300] },
        { dimensions: [{ name: '2026-06-01' }], metrics: [270, 221, 343] },
      ],
    }), { status: 200 })
  }

  const traffic = await getMetrikaTrafficSummary(
    new Date('2026-06-02T18:00:00.000Z'),
    { ...process.env, YANDEX_METRIKA_OAUTH_TOKEN: 'token', YANDEX_METRIKA_COUNTER_ID: '123' },
    fetchImpl as typeof fetch,
  )

  assert.equal(traffic.status, 'ok')
  assert.equal(traffic.date, '2026-06-01')
  assert.equal(traffic.compareDate, '2026-05-31')
  assert.equal(traffic.visits, 270)
  assert.equal(traffic.users, 221)
  assert.equal(traffic.pageviews, 343)
  assert.equal(traffic.visitsChangePercent, 35)
  assert.equal(traffic.usersChangePercent, 23)
  assert.equal(traffic.pageviewsChangePercent, 14)
  assert.match(requestedUrl, /ids=123/)
  assert.match(requestedUrl, /date1=2026-05-31/)
  assert.match(requestedUrl, /date2=2026-06-01/)
  assert.equal(requestedAuth, 'OAuth token')
})

test('getMetrikaTrafficSummary handles missing token or counter', async () => {
  const traffic = await getMetrikaTrafficSummary(
    new Date('2026-06-02T18:00:00.000Z'),
    { NODE_ENV: process.env.NODE_ENV },
    (async () => {
      throw new Error('should not fetch')
    }) as typeof fetch,
  )

  assert.equal(traffic.status, 'not_configured')
  assert.equal(traffic.date, '2026-06-01')
  assert.equal(traffic.visits, null)
})

test('getMetrikaTrafficSummary handles API error', async () => {
  const traffic = await getMetrikaTrafficSummary(
    new Date('2026-06-02T18:00:00.000Z'),
    { ...process.env, YANDEX_METRIKA_OAUTH_TOKEN: 'token', NEXT_PUBLIC_METRIKA_ID: '123' },
    (async () => new Response(JSON.stringify({ message: 'bad counter' }), { status: 403 })) as typeof fetch,
  )

  assert.equal(traffic.status, 'error')
  assert.match(traffic.errorMessage ?? '', /bad counter/)
})

test('getMetrikaTrafficSummary marks delta as null when previous day is zero', async () => {
  const traffic = await getMetrikaTrafficSummary(
    new Date('2026-06-02T18:00:00.000Z'),
    { ...process.env, YANDEX_METRIKA_OAUTH_TOKEN: 'token', YANDEX_METRIKA_COUNTER_ID: '123' },
    (async () => new Response(JSON.stringify({
      data: [
        { dimensions: [{ name: '2026-05-31' }], metrics: [0, 0, 0] },
        { dimensions: [{ name: '2026-06-01' }], metrics: [5, 4, 8] },
      ],
    }), { status: 200 })) as typeof fetch,
  )

  assert.equal(traffic.status, 'ok')
  assert.equal(traffic.visitsChangePercent, null)
  assert.equal(traffic.usersChangePercent, null)
  assert.equal(traffic.pageviewsChangePercent, null)
})

test('evaluateOpsStatus returns green when core pipeline is healthy', () => {
  const summary = baseSummary()
  const status = evaluateOpsStatus(summary)
  assert.equal(status.level, 'green')
  assert.equal(status.emoji, '🟢')
})

test('evaluateOpsStatus does not keep yellow only for recovered source failures', () => {
  const summary = baseSummary({
    sources: {
      runs24h: 20,
      failedRuns24h: 5,
      itemsSeen24h: 200,
      itemsInserted24h: 12,
      itemsRejected24h: 30,
      fetchErrors24h: 0,
      topProblemSources: [{ key: 'The Decoder', count: 5 }],
    },
  })
  const status = evaluateOpsStatus(summary)
  assert.equal(status.level, 'green')
})

test('evaluateOpsStatus returns yellow for warning alerts without critical conditions', () => {
  const summary = baseSummary({
    openAlerts: [{
      alert_type: 'claude_parse_failed',
      severity: 'warning',
      entity_key: 'batch-1',
      message: 'validation failed',
      occurrence_count: 1,
      first_seen_at: '2026-05-11T16:00:00.000Z',
      last_seen_at: '2026-05-11T12:00:00.000Z',
    }],
    alertGroups: [{ key: 'claude_parse_failed', severity: 'warning', count: 1 }],
  })
  const status = evaluateOpsStatus(summary)
  assert.equal(status.level, 'yellow')
  assert.equal(status.emoji, '🟡')
})

test('evaluateOpsStatus returns red for critical alerts', () => {
  const summary = baseSummary({
    openAlerts: [{
      alert_type: 'publish_verify_failed',
      severity: 'critical',
      entity_key: 'article-1',
      message: 'verification failed',
      occurrence_count: 1,
      first_seen_at: '2026-05-11T12:00:00.000Z',
      last_seen_at: '2026-05-11T12:00:00.000Z',
    }],
    alertGroups: [{ key: 'publish_verify_failed', severity: 'critical', count: 1 }],
  })
  const status = evaluateOpsStatus(summary)
  assert.equal(status.level, 'red')
  assert.equal(status.emoji, '🔴')
})

test('formatOpsSummaryForTelegram renders traffic-light header and escapes HTML', () => {
  const summary = baseSummary()
  summary.status = evaluateOpsStatus(summary)
  const text = formatOpsSummaryForTelegram(summary)

  assert.match(text, /^🟢 <b>Отчет за день · 11\.05<\/b>/)
  assert.match(text, /Период: сегодня 00:00-21:00 МСК · трафик: вчера 10\.05/)
  assert.match(text, /<b>Главное:<\/b> все ключевые контуры работают\./)
  assert.match(text, /<b>✅ Что работает<\/b>/)
  assert.match(text, /<b>📈 Трафик вчера<\/b>/)
  assert.match(text, /Визиты: 270 \(\+14%\)/)
  assert.doesNotMatch(text, /<blockquote expandable>/)
  assert.doesNotMatch(text, /<pre>/)
})

test('formatOpsSummaryForTelegram keeps transient yellow status compact without prompt', () => {
  const summary = baseSummary({
    health: {
      ...baseSummary().health,
      batches_open: 2,
    },
    openAlerts: [{
      alert_type: 'claude_parse_failed',
      severity: 'warning',
      entity_key: 'batch-1',
      message: 'validation failed',
      occurrence_count: 1,
      first_seen_at: '2026-05-11T16:00:00.000Z',
      last_seen_at: '2026-05-11T17:00:00.000Z',
    }],
    alertGroups: [{ key: 'claude_parse_failed', severity: 'warning', count: 1 }],
  })
  summary.status = evaluateOpsStatus(summary)

  const text = formatOpsSummaryForTelegram(summary)
  assert.equal(summary.status.level, 'yellow')
  assert.equal(shouldShowFixPrompt(summary), false)
  assert.match(text, /^🟢 <b>Отчет за день/)
  assert.match(text, /<b>Главное:<\/b> все ключевые контуры работают\./)
  assert.match(text, /Ничего существенного не вижу\./)
  assert.match(text, /Ничего не делать\./)
  assert.doesNotMatch(text, /Открытых пакетных задач обработки: 2/)
  assert.doesNotMatch(text, /Claude вернул невалидный результат/)
  assert.doesNotMatch(text, /Действие: наблюдать/)
  assert.doesNotMatch(text, /<blockquote expandable>/)
  assert.ok(text.length < 4096)
})

test('formatOpsSummaryForTelegram adds expandable prompt for persistent yellow status', () => {
  const summary = baseSummary({
    openAlerts: [{
      alert_type: 'claude_parse_failed',
      severity: 'warning',
      entity_key: 'batch-1',
      message: 'validation failed <unsafe>',
      occurrence_count: 3,
      first_seen_at: '2026-05-11T10:00:00.000Z',
      last_seen_at: '2026-05-11T17:00:00.000Z',
    }],
    alertGroups: [{ key: 'claude_parse_failed', severity: 'warning', count: 1 }],
  })
  summary.status = evaluateOpsStatus(summary)

  const text = formatOpsSummaryForTelegram(summary)
  assert.equal(shouldShowFixPrompt(summary), true)
  assert.match(text, /есть проблема, которую стоит разобрать системно/)
  assert.match(text, /🛠 <b>Есть готовый промпт для Codex<\/b>/)
  assert.match(text, /<blockquote expandable>/)
  assert.match(text, /Разбери и исправь production-проблему Malakhov AI Digest\./)
  assert.match(text, /validation failed &lt;unsafe&gt;/)
  assert.doesNotMatch(text, /<pre>/)
  assert.doesNotMatch(text, /validation failed <unsafe>/)
  assert.ok(text.length < 4096)
})

test('formatOpsSummaryForTelegram explains red critical failures', () => {
  const summary = baseSummary({
    openAlerts: [{
      alert_type: 'publish_verify_failed',
      severity: 'critical',
      entity_key: 'article-1',
      message: 'article returned 500 <bad>',
      occurrence_count: 1,
      first_seen_at: '2026-05-11T12:00:00.000Z',
      last_seen_at: '2026-05-11T12:00:00.000Z',
    }],
    alertGroups: [{ key: 'publish_verify_failed', severity: 'critical', count: 1 }],
  })
  summary.status = evaluateOpsStatus(summary)

  const text = formatOpsSummaryForTelegram(summary)
  assert.equal(shouldShowFixPrompt(summary), true)
  assert.match(text, /есть критическая проблема/)
  assert.match(text, /критическая ошибка публикации/)
  assert.match(text, /article returned 500 &lt;bad&gt;/)
  assert.match(text, /<blockquote expandable>/)
  assert.match(text, /Фокус: Publication \/ live verification/)
  assert.match(text, /Не трогай unrelated changes\./)
})

test('groupAlerts sorts by severity and count', () => {
  const groups = _internals.groupAlerts([
    {
      alert_type: 'warning_a',
      severity: 'warning',
      entity_key: null,
      message: 'a',
      occurrence_count: 1,
      first_seen_at: '2026-05-11T12:00:00Z',
      last_seen_at: '2026-05-11T12:00:00Z',
    },
    {
      alert_type: 'critical_b',
      severity: 'critical',
      entity_key: null,
      message: 'b',
      occurrence_count: 1,
      first_seen_at: '2026-05-11T12:00:00Z',
      last_seen_at: '2026-05-11T12:00:00Z',
    },
  ])

  assert.deepEqual(groups.map((group) => group.key), ['critical_b', 'warning_a'])
})
