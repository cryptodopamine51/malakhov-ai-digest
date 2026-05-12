import test from 'node:test'
import assert from 'node:assert/strict'

import {
  _internals,
  evaluateOpsStatus,
  formatOpsSummaryForTelegram,
  resolveOpsReportKind,
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
  }

  return { ...summary, ...overrides }
}

test('resolveOpsReportKind maps auto to morning before 14:00 MSK and evening after', () => {
  assert.equal(resolveOpsReportKind('auto', new Date('2026-05-11T06:45:00.000Z')), 'morning')
  assert.equal(resolveOpsReportKind('auto', new Date('2026-05-11T17:30:00.000Z')), 'evening')
})

test('evaluateOpsStatus returns green when core pipeline is healthy', () => {
  const summary = baseSummary()
  const status = evaluateOpsStatus(summary)
  assert.equal(status.level, 'green')
  assert.equal(status.emoji, '🟢')
})

test('evaluateOpsStatus returns yellow for warning alerts without critical conditions', () => {
  const summary = baseSummary({
    openAlerts: [{
      alert_type: 'claude_parse_failed',
      severity: 'warning',
      entity_key: 'batch-1',
      message: 'validation failed',
      occurrence_count: 1,
      first_seen_at: '2026-05-11T12:00:00.000Z',
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

  assert.match(text, /^🟢 <b>Ops-сводка/)
  assert.match(text, /<b>Итог:<\/b> всё ок/)
  assert.match(text, /<b>Что отправилось \/ что нет<\/b>/)
  assert.match(text, /<b>Публикации<\/b>/)
  assert.match(text, /OpenAI &lt;test&gt; &amp; partners/)
  assert.doesNotMatch(text, /OpenAI <test> & partners/)
})

test('formatOpsSummaryForTelegram explains yellow status in admin language', () => {
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
      first_seen_at: '2026-05-11T12:00:00.000Z',
      last_seen_at: '2026-05-11T12:00:00.000Z',
    }],
    alertGroups: [{ key: 'claude_parse_failed', severity: 'warning', count: 1 }],
  })
  summary.status = evaluateOpsStatus(summary)

  const text = formatOpsSummaryForTelegram(summary)
  assert.match(text, /Почему жёлтый/)
  assert.match(text, /портал работает, но есть проблемы/)
  assert.match(text, /Открытых пакетных задач обработки: 2/)
  assert.match(text, /Claude вернул невалидный результат/)
  assert.match(text, /они не присылаются отдельными сообщениями/)
  assert.match(text, /<b>Что нужно для зелёного<\/b>/)
  assert.match(text, /дособрать или корректно завершить 2 пакетные задачи обработки/)
  assert.match(text, /<b>Промпт для Codex<\/b>/)
  assert.match(text, /<pre>Разбери ops-сигнал Malakhov AI Digest\./)
  assert.match(text, /Репозиторий: \/Users\/malast\/malakhov-ai-digest/)
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
  assert.match(text, /критическая проблема/)
  assert.match(text, /Почему красный/)
  assert.match(text, /критическая ошибка публикации/)
  assert.match(text, /article returned 500 &lt;bad&gt;/)
  assert.match(text, /устранить 1 critical алёрт/)
  assert.match(text, /<pre>Разбери ops-сигнал Malakhov AI Digest\./)
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
