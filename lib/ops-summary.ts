import type { SupabaseClient } from '@supabase/supabase-js'

import { getHealthSummary, type HealthSummary } from './health-summary'
import { getMoscowDateKey, pluralize, truncate } from './utils'

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000

export type OpsReportKind = 'morning' | 'evening' | 'manual'
export type OpsStatusLevel = 'green' | 'yellow' | 'red'

export interface OpsStatus {
  level: OpsStatusLevel
  emoji: '🟢' | '🟡' | '🔴'
  label: string
  reasons: string[]
}

export interface OpsArticleFunnel {
  created24h: number
  byEnrichStatus: Record<string, number>
  byPublishStatus: Record<string, number>
  currentQueue: Record<string, number>
  publishedTodayCount: number
  recentPublished: Array<{
    ru_title: string | null
    source_name: string | null
    primary_category: string | null
    published_at: string | null
    slug: string | null
  }>
  topSources24h: Array<{ key: string; count: number }>
  topCategories24h: Array<{ key: string; count: number }>
}

export interface OpsRunRow {
  started_at: string | null
  finished_at: string | null
  status: string
  error_summary?: string | null
}

export interface OpsIngestRunRow extends OpsRunRow {
  feeds_total: number | null
  feeds_failed: number | null
  items_seen: number | null
  items_inserted: number | null
  items_duplicates: number | null
  items_failed: number | null
}

export interface OpsEnrichRunRow extends OpsRunRow {
  run_kind: string | null
  batch_size: number | null
  articles_claimed: number | null
  articles_enriched_ok: number | null
  articles_rejected: number | null
  articles_retryable: number | null
  articles_failed: number | null
  rejected_breakdown: Record<string, number> | null
  estimated_cost_usd: number | null
}

export interface OpsDigestRunRow {
  created_at: string
  digest_date: string | null
  status: string
  articles_count: number | null
  sent_at: string | null
  failed_at: string | null
  error_message: string | null
}

export interface OpsAlertRow {
  alert_type: string
  severity: 'info' | 'warning' | 'critical'
  entity_key: string | null
  message: string
  occurrence_count: number
  first_seen_at: string
  last_seen_at: string
}

export interface OpsCostSummary {
  totalCostUsd: number
  calls: number
  byProvider: Array<{ key: string; costUsd: number }>
  byOperation: Array<{ key: string; costUsd: number }>
}

export interface OpsSourceSummary {
  runs24h: number
  failedRuns24h: number
  itemsSeen24h: number
  itemsInserted24h: number
  itemsRejected24h: number
  fetchErrors24h: number
  topProblemSources: Array<{ key: string; count: number }>
}

export interface OpsSummary {
  generatedAt: string
  reportKind: OpsReportKind
  mskDateKey: string
  health: HealthSummary
  status: OpsStatus
  articles: OpsArticleFunnel
  latestIngest: OpsIngestRunRow | null
  latestEnrich: OpsEnrichRunRow | null
  digestToday: OpsDigestRunRow | null
  latestDigest: OpsDigestRunRow | null
  openAlerts: OpsAlertRow[]
  alertGroups: Array<{ key: string; severity: OpsAlertRow['severity']; count: number }>
  costs: OpsCostSummary
  sources: OpsSourceSummary
}

type ArticleFunnelRow = {
  enrich_status: string | null
  publish_status: string | null
  source_name: string | null
  primary_category: string | null
}

type QueueRow = { enrich_status: string | null }
type CostRow = { provider: string | null; operation: string | null; estimated_cost_usd: number | string | null }
type SourceRunRow = {
  source_name: string | null
  status: string | null
  items_seen: number | null
  items_new: number | null
  items_rejected_count: number | null
  fetch_errors_count: number | null
}

export interface GetOpsSummaryOptions {
  now?: Date
  reportKind?: OpsReportKind
}

export function resolveOpsReportKind(raw: string | undefined, now = new Date()): OpsReportKind {
  if (raw === 'morning' || raw === 'evening' || raw === 'manual') return raw
  const mskHour = new Date(now.getTime() + MSK_OFFSET_MS).getUTCHours()
  return mskHour < 14 ? 'morning' : 'evening'
}

export async function getOpsSummary(
  supabase: SupabaseClient,
  options: GetOpsSummaryOptions = {},
): Promise<OpsSummary> {
  const now = options.now ?? new Date()
  const reportKind = options.reportKind ?? resolveOpsReportKind(undefined, now)
  const mskDayStart = startOfMskDayUtcIso(now)
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const mskDateKey = getMoscowDateKey(now)

  const [
    health,
    articleRowsRes,
    queueRowsRes,
    publishedTodayRes,
    ingestRowsRes,
    enrichRowsRes,
    digestRowsRes,
    openAlertsRes,
    sourceRowsRes,
    costRowsRes,
  ] = await Promise.all([
    getHealthSummary(supabase),
    supabase
      .from('articles')
      .select('enrich_status, publish_status, source_name, primary_category')
      .gte('created_at', since24h)
      .limit(5_000),
    supabase
      .from('articles')
      .select('enrich_status')
      .in('enrich_status', ['pending', 'retry_wait', 'processing'])
      .limit(5_000),
    supabase
      .from('articles')
      .select('ru_title, source_name, primary_category, published_at, slug', { count: 'exact' })
      .eq('publish_status', 'live')
      .gte('published_at', mskDayStart)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(5),
    supabase
      .from('ingest_runs')
      .select('started_at, finished_at, status, feeds_total, feeds_failed, items_seen, items_inserted, items_duplicates, items_failed, error_summary')
      .order('started_at', { ascending: false })
      .limit(3),
    supabase
      .from('enrich_runs')
      .select('started_at, finished_at, status, run_kind, batch_size, articles_claimed, articles_enriched_ok, articles_rejected, articles_retryable, articles_failed, rejected_breakdown, estimated_cost_usd, error_summary')
      .order('started_at', { ascending: false })
      .limit(5),
    supabase
      .from('digest_runs')
      .select('created_at, digest_date, status, articles_count, sent_at, failed_at, error_message')
      .order('created_at', { ascending: false })
      .limit(12),
    supabase
      .from('pipeline_alerts')
      .select('alert_type, severity, entity_key, message, occurrence_count, first_seen_at, last_seen_at')
      .eq('status', 'open')
      .order('last_seen_at', { ascending: false })
      .limit(100),
    supabase
      .from('source_runs')
      .select('source_name, status, items_seen, items_new, items_rejected_count, fetch_errors_count')
      .gte('started_at', since24h)
      .limit(2_000),
    supabase
      .from('llm_usage_logs')
      .select('provider, operation, estimated_cost_usd')
      .gte('created_at', mskDayStart)
      .limit(20_000),
  ])

  const articleRows = rowsOrThrow<ArticleFunnelRow>(articleRowsRes, 'articles funnel')
  const queueRows = rowsOrThrow<QueueRow>(queueRowsRes, 'articles queue')
  const publishedTodayRows = rowsOrThrow<OpsArticleFunnel['recentPublished'][number]>(publishedTodayRes, 'published today')
  const ingestRows = rowsOrThrow<OpsIngestRunRow>(ingestRowsRes, 'ingest runs')
  const enrichRows = rowsOrThrow<OpsEnrichRunRow>(enrichRowsRes, 'enrich runs')
  const digestRows = rowsOrThrow<OpsDigestRunRow>(digestRowsRes, 'digest runs')
  const openAlerts = rowsOrThrow<OpsAlertRow>(openAlertsRes, 'pipeline alerts')
  const sourceRows = rowsOrThrow<SourceRunRow>(sourceRowsRes, 'source runs')
  const costRows = rowsOrThrow<CostRow>(costRowsRes, 'llm usage logs')

  const digestToday = selectRepresentativeDigestRun(digestRows.filter((row) => row.digest_date === mskDateKey))
  const latestDigest = selectRepresentativeDigestRun(digestRows)
  const articles = summarizeArticles(articleRows, queueRows, publishedTodayRows, publishedTodayRes.count)
  const alertGroups = groupAlerts(openAlerts)
  const costs = summarizeCosts(costRows)
  const sources = summarizeSources(sourceRows)

  const baseSummary: Omit<OpsSummary, 'status'> = {
    generatedAt: now.toISOString(),
    reportKind,
    mskDateKey,
    health,
    articles,
    latestIngest: ingestRows[0] ?? null,
    latestEnrich: enrichRows[0] ?? null,
    digestToday,
    latestDigest,
    openAlerts,
    alertGroups,
    costs,
    sources,
  }

  const status = evaluateOpsStatus(baseSummary)
  return { ...baseSummary, status }
}

function rowsOrThrow<T>(response: unknown, label: string): T[] {
  const typed = response as { data?: T[] | null; error?: { message?: string } | null }
  if (typed.error) throw new Error(`${label} query failed: ${typed.error.message ?? 'unknown error'}`)
  return typed.data ?? []
}

function startOfMskDayUtcIso(now: Date): string {
  const msk = new Date(now.getTime() + MSK_OFFSET_MS)
  msk.setUTCHours(0, 0, 0, 0)
  return new Date(msk.getTime() - MSK_OFFSET_MS).toISOString()
}

function summarizeArticles(
  articleRows: ArticleFunnelRow[],
  queueRows: QueueRow[],
  publishedTodayRows: OpsArticleFunnel['recentPublished'],
  publishedTodayCount: number | null,
): OpsArticleFunnel {
  const byEnrichStatus: Record<string, number> = {}
  const byPublishStatus: Record<string, number> = {}
  const currentQueue: Record<string, number> = {}
  const bySource: Record<string, number> = {}
  const byCategory: Record<string, number> = {}

  for (const row of articleRows) {
    bump(byEnrichStatus, row.enrich_status ?? 'unknown')
    bump(byPublishStatus, row.publish_status ?? 'unknown')
    bump(bySource, row.source_name ?? 'unknown')
    bump(byCategory, row.primary_category ?? 'unknown')
  }

  for (const row of queueRows) {
    bump(currentQueue, row.enrich_status ?? 'unknown')
  }

  return {
    created24h: articleRows.length,
    byEnrichStatus,
    byPublishStatus,
    currentQueue,
    publishedTodayCount: publishedTodayCount ?? publishedTodayRows.length,
    recentPublished: publishedTodayRows,
    topSources24h: topCounts(bySource, 5),
    topCategories24h: topCounts(byCategory, 5),
  }
}

function summarizeCosts(rows: CostRow[]): OpsCostSummary {
  const byProvider: Record<string, number> = {}
  const byOperation: Record<string, number> = {}
  let total = 0

  for (const row of rows) {
    const cost = Number(row.estimated_cost_usd ?? 0)
    if (!Number.isFinite(cost)) continue
    total += cost
    byProvider[row.provider ?? 'unknown'] = roundUsd((byProvider[row.provider ?? 'unknown'] ?? 0) + cost)
    byOperation[row.operation ?? 'unknown'] = roundUsd((byOperation[row.operation ?? 'unknown'] ?? 0) + cost)
  }

  return {
    totalCostUsd: roundUsd(total),
    calls: rows.length,
    byProvider: topCosts(byProvider, 5),
    byOperation: topCosts(byOperation, 6),
  }
}

function summarizeSources(rows: SourceRunRow[]): OpsSourceSummary {
  const problemSources: Record<string, number> = {}
  let failedRuns24h = 0
  let itemsSeen24h = 0
  let itemsInserted24h = 0
  let itemsRejected24h = 0
  let fetchErrors24h = 0

  for (const row of rows) {
    if (row.status === 'failed') {
      failedRuns24h += 1
      bump(problemSources, row.source_name ?? 'unknown')
    }
    itemsSeen24h += Number(row.items_seen ?? 0)
    itemsInserted24h += Number(row.items_new ?? 0)
    itemsRejected24h += Number(row.items_rejected_count ?? 0)
    fetchErrors24h += Number(row.fetch_errors_count ?? 0)
    if ((row.fetch_errors_count ?? 0) > 0) bump(problemSources, row.source_name ?? 'unknown', Number(row.fetch_errors_count ?? 0))
  }

  return {
    runs24h: rows.length,
    failedRuns24h,
    itemsSeen24h,
    itemsInserted24h,
    itemsRejected24h,
    fetchErrors24h,
    topProblemSources: topCounts(problemSources, 5),
  }
}

function groupAlerts(alerts: OpsAlertRow[]): OpsSummary['alertGroups'] {
  const groups = new Map<string, { key: string; severity: OpsAlertRow['severity']; count: number; rank: number }>()
  for (const alert of alerts) {
    const existing = groups.get(alert.alert_type)
    const rank = severityRank(alert.severity)
    if (existing) {
      existing.count += 1
      if (rank > existing.rank) {
        existing.severity = alert.severity
        existing.rank = rank
      }
    } else {
      groups.set(alert.alert_type, { key: alert.alert_type, severity: alert.severity, count: 1, rank })
    }
  }
  return Array.from(groups.values())
    .sort((a, b) => b.rank - a.rank || b.count - a.count || a.key.localeCompare(b.key))
    .map(({ key, severity, count }) => ({ key, severity, count }))
}

function selectRepresentativeDigestRun(rows: OpsDigestRunRow[]): OpsDigestRunRow | null {
  const latest = rows[0] ?? null
  if (!latest) return null
  if (latest.status === 'skipped_already_claimed' && latest.digest_date) {
    const sameDayMeaningful = rows.find((row) =>
      row.digest_date === latest.digest_date && row.status !== 'skipped_already_claimed'
    )
    if (sameDayMeaningful) return sameDayMeaningful
  }
  return latest
}

export function evaluateOpsStatus(summary: Omit<OpsSummary, 'status'>): OpsStatus {
  const redReasons: string[] = []
  const yellowReasons: string[] = []
  const criticalAlerts = summary.openAlerts.filter((alert) => alert.severity === 'critical')
  const warningAlerts = summary.openAlerts.filter((alert) => alert.severity === 'warning')
  const latestDigest = summary.digestToday ?? summary.latestDigest

  if (criticalAlerts.length > 0) {
    redReasons.push(`есть ${criticalAlerts.length} critical ${pluralize(criticalAlerts.length, 'алёрт', 'алёрта', 'алёртов')}`)
  }
  if (summary.latestIngest?.status === 'failed') redReasons.push('последний сбор источников завершился ошибкой')
  if (summary.latestEnrich?.status === 'failed') redReasons.push('последняя обработка статей завершилась ошибкой')
  if (latestDigest?.status?.startsWith('failed')) {
    redReasons.push(`Telegram-дайджест не отправился: ${humanDigestStatus(latestDigest.status)}`)
  }

  if (summary.reportKind === 'morning') {
    if (!summary.digestToday) yellowReasons.push('нет записи об утреннем Telegram-дайджесте за сегодня')
    else if (summary.digestToday.status !== 'success' && !summary.digestToday.status.startsWith('failed')) {
      yellowReasons.push(`утренний Telegram-дайджест в статусе ${humanDigestStatus(summary.digestToday.status)}`)
    }
  }

  if (summary.reportKind === 'evening' && summary.articles.publishedTodayCount === 0) {
    redReasons.push('сегодня нет live-публикаций на сайте')
  } else if (summary.reportKind === 'evening' && summary.articles.publishedTodayCount < 3) {
    yellowReasons.push(`сегодня опубликовано только ${summary.articles.publishedTodayCount} ${pluralize(summary.articles.publishedTodayCount, 'статья', 'статьи', 'статей')}`)
  }

  if (summary.health.live_window_6h_count === 0) yellowReasons.push('за последние 6 часов не вышло ни одной live-публикации')
  if (summary.health.batches_open > 0) {
    yellowReasons.push(`открытых пакетных задач обработки: ${summary.health.batches_open}`)
  }
  if ((summary.health.oldest_pending_age_minutes ?? 0) >= 360) {
    redReasons.push(`самая старая статья ждёт обработки ${summary.health.oldest_pending_age_minutes} мин`)
  } else if ((summary.health.oldest_pending_age_minutes ?? 0) >= 180) {
    yellowReasons.push(`самая старая статья ждёт обработки ${summary.health.oldest_pending_age_minutes} мин`)
  }
  if (warningAlerts.length > 0) {
    yellowReasons.push(`открытых предупреждений: ${warningAlerts.length}`)
  }
  if (summary.sources.failedRuns24h > 0) {
    yellowReasons.push(`ошибок источников за 24 часа: ${summary.sources.failedRuns24h}`)
  }

  const failed24h = summary.articles.byEnrichStatus.failed ?? 0
  if (summary.articles.created24h >= 5 && failed24h / summary.articles.created24h >= 0.5) {
    yellowReasons.push(`много failed-статей за 24 часа: ${failed24h}/${summary.articles.created24h}`)
  }

  if (redReasons.length > 0) {
    return { level: 'red', emoji: '🔴', label: 'красный', reasons: redReasons.slice(0, 4) }
  }
  if (yellowReasons.length > 0) {
    return { level: 'yellow', emoji: '🟡', label: 'желтый', reasons: yellowReasons.slice(0, 5) }
  }
  return { level: 'green', emoji: '🟢', label: 'зеленый', reasons: ['всё ок: дайджест отправлен, публикации идут, критических ошибок нет'] }
}

export function formatOpsSummaryForTelegram(summary: OpsSummary): string {
  const lines: string[] = []
  const kind = summary.reportKind === 'morning' ? 'утро' : summary.reportKind === 'evening' ? 'вечер' : 'ручной запуск'
  const criticalAlerts = summary.openAlerts.filter((alert) => alert.severity === 'critical')

  lines.push(`${summary.status.emoji} <b>Ops-сводка · ${kind} · ${formatMskDateTime(summary.generatedAt)}</b>`)
  lines.push(...formatAdminOverview(summary))
  lines.push('')
  lines.push(...formatDeliveryOverview(summary))
  lines.push('')
  lines.push(...formatProblemOverview(summary))
  if (summary.status.level !== 'green') {
    lines.push('')
    lines.push(...formatGreenPathOverview(summary))
    lines.push('')
    lines.push(...formatCodexPromptBlock(summary))
  }
  lines.push('')
  lines.push('<b>Публикации</b>')
  lines.push(`• сегодня опубликовано: <b>${summary.articles.publishedTodayCount}</b>; за 6ч: <b>${summary.health.live_window_6h_count}</b>`)
  lines.push(`• за 24ч создано: <b>${summary.articles.created24h}</b>; опубликовано: ${count(summary.articles.byPublishStatus, 'live')}; в работе: ${count(summary.articles.byEnrichStatus, 'processing')}; с ошибкой: ${count(summary.articles.byEnrichStatus, 'failed')}; отклонено: ${count(summary.articles.byEnrichStatus, 'rejected')}`)
  lines.push(`• дайджест: ${formatDigest(summary.digestToday ?? summary.latestDigest)}`)
  const rejectReasons = Object.entries(summary.health.articles_rejected_today_by_reason)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
  if (rejectReasons.length) {
    lines.push(`• причины отклонения: ${rejectReasons.map(([key, value]) => `${escapeHtml(humanRejectReason(key))}=${value}`).join(', ')}`)
  }

  if (summary.articles.recentPublished.length) {
    lines.push('• последние live:')
    for (const article of summary.articles.recentPublished.slice(0, 3)) {
      const title = escapeHtml(truncate(article.ru_title ?? 'без заголовка', 82))
      const source = escapeHtml(article.source_name ?? 'unknown')
      lines.push(`  ${formatMskTime(article.published_at)} · ${source} · ${title}`)
    }
  }

  lines.push('')
  lines.push('<b>Пайплайн</b>')
  lines.push(`• сбор источников: ${formatIngest(summary.latestIngest)}`)
  lines.push(`• обработка статей: ${formatEnrich(summary.latestEnrich)}`)
  lines.push(`• очередь: ждут ${count(summary.articles.currentQueue, 'pending')}, на повтор ${count(summary.articles.currentQueue, 'retry_wait')}, в работе ${count(summary.articles.currentQueue, 'processing')}; самая старая ${summary.health.oldest_pending_age_minutes ?? 0} мин`)
  lines.push(`• источники 24ч: новых ${summary.sources.itemsInserted24h}, просмотрено ${summary.sources.itemsSeen24h}, отсеяно ${summary.sources.itemsRejected24h}, ошибок загрузки ${summary.sources.fetchErrors24h}`)

  lines.push('')
  lines.push('<b>Расход</b>')
  lines.push(`• сегодня: <b>${formatUsd(summary.costs.totalCostUsd)}</b> · вызовов ${summary.costs.calls}`)
  if (summary.costs.byProvider.length) {
    lines.push(`• провайдеры: ${summary.costs.byProvider.map((row) => `${escapeHtml(row.key)} ${formatUsd(row.costUsd)}`).join(', ')}`)
  }

  lines.push('')
  lines.push('<b>Алерты</b>')
  if (!summary.openAlerts.length) {
    lines.push('• открытых алёртов нет')
  } else {
    lines.push(`• открыто: ${summary.openAlerts.length}; критических: ${criticalAlerts.length}; предупреждений: ${summary.openAlerts.filter((alert) => alert.severity === 'warning').length}`)
    lines.push(`• группы: ${summary.alertGroups.slice(0, 5).map((group) => `${escapeHtml(humanAlertType(group.key))}=${group.count}`).join(', ')}`)
    if (criticalAlerts.length) {
      lines.push('• критические:')
      for (const alert of criticalAlerts.slice(0, 3)) {
        lines.push(`  ${escapeHtml(humanAlertType(alert.alert_type))} · ${escapeHtml(truncate(alert.message, 130))}`)
      }
    } else {
      lines.push('• критических нет; предупреждения собраны здесь и не присылаются отдельными сообщениями')
    }
  }

  return lines.join('\n')
}

export function formatOpsAlertsForTelegram(summary: OpsSummary): string {
  const lines = [`${summary.status.emoji} <b>Ops alerts · ${formatMskDateTime(summary.generatedAt)}</b>`]
  if (!summary.openAlerts.length) {
    lines.push('Открытых алёртов нет.')
    return lines.join('\n')
  }

  lines.push(`Открыто: ${summary.openAlerts.length}`)
  for (const group of summary.alertGroups.slice(0, 10)) {
    lines.push(`• ${escapeHtml(group.key)} · ${group.severity} · ${group.count}`)
  }

  const critical = summary.openAlerts.filter((alert) => alert.severity === 'critical')
  if (critical.length) {
    lines.push('')
    lines.push('<b>Critical</b>')
    for (const alert of critical.slice(0, 5)) {
      lines.push(`• ${escapeHtml(alert.alert_type)}: ${escapeHtml(truncate(alert.message, 160))}`)
    }
  }

  return lines.join('\n')
}

export function formatOpsCostForTelegram(summary: OpsSummary): string {
  const lines = [`💸 <b>Ops cost · ${formatMskDateTime(summary.generatedAt)}</b>`]
  lines.push(`Сегодня: <b>${formatUsd(summary.costs.totalCostUsd)}</b>; calls ${summary.costs.calls}`)
  if (summary.costs.byProvider.length) {
    lines.push('Провайдеры:')
    for (const row of summary.costs.byProvider) lines.push(`• ${escapeHtml(row.key)}: ${formatUsd(row.costUsd)}`)
  }
  if (summary.costs.byOperation.length) {
    lines.push('Операции:')
    for (const row of summary.costs.byOperation.slice(0, 6)) lines.push(`• ${escapeHtml(row.key)}: ${formatUsd(row.costUsd)}`)
  }
  return lines.join('\n')
}

function formatAdminOverview(summary: OpsSummary): string[] {
  if (summary.status.level === 'green') {
    return [
      '<b>Итог:</b> всё ок. Дайджест отправлен, статьи публикуются, критических ошибок нет.',
      `• Почему зелёный: ${escapeHtml(summary.status.reasons.join('; '))}`,
    ]
  }

  if (summary.status.level === 'red') {
    return [
      `<b>Итог:</b> критическая проблема: ${escapeHtml(summary.status.reasons[0] ?? 'требуется проверка')}.`,
      `• Почему красный: ${escapeHtml(summary.status.reasons.join('; '))}`,
      `• Что проверить сначала: ${escapeHtml(firstRecommendedAction(summary))}`,
    ]
  }

  return [
    '<b>Итог:</b> портал работает, но есть проблемы без критического сбоя.',
    `• Почему жёлтый: ${escapeHtml(summary.status.reasons.join('; '))}`,
    `• Что проверить сначала: ${escapeHtml(firstRecommendedAction(summary))}`,
  ]
}

function formatDeliveryOverview(summary: OpsSummary): string[] {
  const lines = ['<b>Что отправилось / что нет</b>']
  const criticalAlerts = summary.openAlerts.filter((alert) => alert.severity === 'critical')
  const warningAlerts = summary.openAlerts.filter((alert) => alert.severity === 'warning')
  const deliveryProblems = buildDeliveryProblems(summary)

  lines.push(`• Telegram-дайджест: ${formatDigestDelivery(summary.digestToday ?? summary.latestDigest)}`)
  lines.push(`• Статьи на сайте: ${formatPublicationDelivery(summary)}`)

  if (deliveryProblems.length) {
    lines.push(`• Не отправилось/не дошло: ${deliveryProblems.map(escapeHtml).join('; ')}`)
  } else {
    lines.push('• Не отправилось/не дошло: явных потерь доставки не вижу.')
  }

  if (criticalAlerts.length) {
    lines.push(`• Критические алёрты: открыто ${criticalAlerts.length}, подробности ниже.`)
  } else if (warningAlerts.length) {
    lines.push(`• Предупреждения: ${warningAlerts.length}; они не присылаются отдельными сообщениями и собраны в этой сводке.`)
  } else {
    lines.push('• Алёрты: открытых проблем нет.')
  }

  return lines
}

function formatProblemOverview(summary: OpsSummary): string[] {
  const lines = ['<b>Проблемы</b>']
  if (summary.status.level === 'green') {
    lines.push('• Проблем не вижу: сбор источников, обработка, публикации и дайджест в норме.')
    return lines
  }

  const issues = buildAdminIssueLines(summary)
  if (!issues.length) {
    lines.push('• Есть нестандартный статус, но явную причину определить не удалось. Смотри технические метрики ниже.')
    return lines
  }

  for (const issue of issues.slice(0, 8)) {
    lines.push(`• ${escapeHtml(issue)}`)
  }
  return lines
}

function formatGreenPathOverview(summary: OpsSummary): string[] {
  const lines = ['<b>Что нужно для зелёного</b>']
  const actions = buildGreenPathActions(summary)
  if (!actions.length) {
    lines.push('• Убрать нестандартный статус: явных блокеров уже не видно, проверь свежий dry-run.')
    return lines
  }
  for (const action of actions.slice(0, 6)) lines.push(`• ${escapeHtml(action)}`)
  return lines
}

function formatCodexPromptBlock(summary: OpsSummary): string[] {
  return [
    '<b>Промпт для Codex</b>',
    'Нажми на блок ниже и скопируй:',
    `<pre>${escapeHtml(buildCodexPrompt(summary))}</pre>`,
  ]
}

function buildGreenPathActions(summary: OpsSummary): string[] {
  const actions: string[] = []
  const criticalAlerts = summary.openAlerts.filter((alert) => alert.severity === 'critical')
  const warningAlerts = summary.openAlerts.filter((alert) => alert.severity === 'warning')
  const latestDigest = summary.digestToday ?? summary.latestDigest

  if (criticalAlerts.length) {
    actions.push(`устранить ${criticalAlerts.length} critical ${pluralize(criticalAlerts.length, 'алёрт', 'алёрта', 'алёртов')} и закрыть его в pipeline_alerts`)
  }
  if (summary.latestIngest?.status === 'failed') actions.push('починить последний сбор источников')
  if (summary.latestEnrich?.status === 'failed') actions.push('починить последнюю обработку статей')
  if (latestDigest?.status?.startsWith('failed')) actions.push('починить отправку Telegram-дайджеста')
  if (summary.reportKind === 'morning' && !summary.digestToday) actions.push('добиться записи success в digest_runs за сегодняшний дайджест')
  if (summary.reportKind === 'morning' && summary.digestToday && summary.digestToday.status !== 'success') {
    actions.push('довести утренний Telegram-дайджест до статуса success')
  }
  if (summary.reportKind === 'evening' && summary.articles.publishedTodayCount === 0) {
    actions.push('выпустить хотя бы одну live-статью сегодня')
  }
  if (summary.health.live_window_6h_count === 0) actions.push('восстановить свежие live-публикации за последние 6 часов')
  if (summary.health.batches_open > 0) {
    actions.push(`дособрать или корректно завершить ${summary.health.batches_open} ${pluralize(summary.health.batches_open, 'пакетную задачу обработки', 'пакетные задачи обработки', 'пакетных задач обработки')}`)
  }
  if ((summary.health.oldest_pending_age_minutes ?? 0) >= 180) actions.push('разобрать старую очередь pending/retry статей')
  if (warningAlerts.length) {
    actions.push(`разобрать и закрыть ${warningAlerts.length} warning ${pluralize(warningAlerts.length, 'алёрт', 'алёрта', 'алёртов')}: ${formatAlertGroups(summary.alertGroups.filter((group) => group.severity === 'warning'))}`)
  }
  if (summary.sources.failedRuns24h > 0) actions.push('починить источники, которые падали за последние 24 часа')

  return actions
}

function buildCodexPrompt(summary: OpsSummary): string {
  const facts = [
    `Сигнал: ${summary.status.emoji} ${summary.status.label}`,
    `Причины: ${summary.status.reasons.join('; ')}`,
    `Дайджест: ${stripTags(formatDigestDelivery(summary.digestToday ?? summary.latestDigest))}`,
    `Публикации: сегодня ${summary.articles.publishedTodayCount}, за 6ч ${summary.health.live_window_6h_count}`,
    `Очередь: pending ${count(summary.articles.currentQueue, 'pending')}, retry ${count(summary.articles.currentQueue, 'retry_wait')}, processing ${count(summary.articles.currentQueue, 'processing')}`,
    `Open batches: ${summary.health.batches_open}`,
    `Алерты: ${formatAlertGroups(summary.alertGroups)}`,
  ].join('\n')

  return [
    'Разбери ops-сигнал Malakhov AI Digest.',
    'Репозиторий: /Users/malast/malakhov-ai-digest',
    facts,
    'Задача: найти root cause, объяснить простым языком, что сломалось, и по возможности исправить до зелёного статуса.',
    'Начни с dry-run: npm run ops:report -- --dry-run --kind=manual',
    'Проверь pipeline_alerts, anthropic_batches, digest_runs и GitHub Actions. Не трогай unrelated changes.',
  ].join('\n')
}

function buildDeliveryProblems(summary: OpsSummary): string[] {
  const problems: string[] = []
  const digest = summary.digestToday ?? summary.latestDigest

  if (!summary.digestToday && summary.reportKind === 'morning') {
    problems.push('нет подтверждения, что утренний Telegram-дайджест сегодня отправлялся')
  } else if (digest?.status?.startsWith('failed')) {
    problems.push(`Telegram-дайджест не отправился: ${humanDigestStatus(digest.status)}`)
  } else if (summary.reportKind === 'morning' && digest && digest.status !== 'success') {
    problems.push(`Telegram-дайджест сегодня не в статусе "отправлен": ${humanDigestStatus(digest.status)}`)
  }

  if (summary.reportKind === 'evening' && summary.articles.publishedTodayCount === 0) {
    problems.push('сегодня на сайт не вышла ни одна live-статья')
  }
  if (summary.health.live_window_6h_count === 0) {
    problems.push('за последние 6 часов на сайт не вышла ни одна live-статья')
  }

  return problems
}

function buildAdminIssueLines(summary: OpsSummary): string[] {
  const lines: string[] = []
  const criticalAlerts = summary.openAlerts.filter((alert) => alert.severity === 'critical')
  const warningAlerts = summary.openAlerts.filter((alert) => alert.severity === 'warning')
  const latestDigest = summary.digestToday ?? summary.latestDigest

  if (criticalAlerts.length) {
    lines.push(`Критические алёрты: ${criticalAlerts.length}. ${formatAlertGroups(summary.alertGroups.filter((group) => group.severity === 'critical'))}.`)
    for (const alert of criticalAlerts.slice(0, 2)) {
      lines.push(`${humanAlertType(alert.alert_type)}: ${truncate(alert.message, 150)}`)
    }
  }

  if (summary.latestIngest?.status === 'failed') {
    lines.push(`Сбор источников упал. Последняя ошибка: ${summary.latestIngest.error_summary ?? 'детали не записаны'}.`)
  }
  if (summary.latestEnrich?.status === 'failed') {
    lines.push(`Обработка статей упала. Последняя ошибка: ${summary.latestEnrich.error_summary ?? 'детали не записаны'}.`)
  }
  if (latestDigest?.status?.startsWith('failed')) {
    lines.push(`Telegram-дайджест не отправился: ${humanDigestStatus(latestDigest.status)}${latestDigest.error_message ? `; ${latestDigest.error_message}` : ''}.`)
  }

  if (summary.reportKind === 'morning' && !summary.digestToday) {
    lines.push('Нет записи о сегодняшнем утреннем дайджесте: нужно проверить GitHub Actions `tg-digest.yml` и таблицу `digest_runs`.')
  } else if (summary.reportKind === 'morning' && summary.digestToday?.status !== 'success') {
    lines.push(`Утренний дайджест сегодня не подтверждён как отправленный: ${humanDigestStatus(summary.digestToday?.status ?? 'unknown')}.`)
  }

  if (summary.reportKind === 'evening' && summary.articles.publishedTodayCount === 0) {
    lines.push('Сегодня нет live-публикаций: пользователи не увидели новых статей на сайте.')
  } else if (summary.reportKind === 'evening' && summary.articles.publishedTodayCount < 3) {
    lines.push(`Сегодня мало live-публикаций: ${summary.articles.publishedTodayCount} ${pluralize(summary.articles.publishedTodayCount, 'статья', 'статьи', 'статей')}.`)
  }

  if (summary.health.live_window_6h_count === 0) {
    lines.push('За последние 6 часов не было live-публикаций: проверь enrich/publish-verify, если это не ночное окно.')
  }
  if (summary.health.batches_open > 0) {
    lines.push(`Открытых пакетных задач обработки: ${summary.health.batches_open}. Это статьи, которые ждут результата пакетной обработки Anthropic/Claude.`)
  }
  if ((summary.health.oldest_pending_age_minutes ?? 0) >= 180) {
    lines.push(`Самая старая статья в очереди ждёт ${formatMinutes(summary.health.oldest_pending_age_minutes ?? 0)}.`)
  }
  if (warningAlerts.length) {
    lines.push(`Предупреждения: ${warningAlerts.length}. ${formatAlertGroups(summary.alertGroups.filter((group) => group.severity === 'warning'))}.`)
  }
  if (summary.sources.failedRuns24h > 0) {
    const sources = summary.sources.topProblemSources.length
      ? ` Проблемные источники: ${summary.sources.topProblemSources.map((row) => `${row.key}=${row.count}`).join(', ')}.`
      : ''
    lines.push(`Ошибки источников за 24 часа: ${summary.sources.failedRuns24h}.${sources}`)
  }

  const failed24h = summary.articles.byEnrichStatus.failed ?? 0
  if (summary.articles.created24h >= 5 && failed24h / summary.articles.created24h >= 0.5) {
    lines.push(`Много failed-статей за 24 часа: ${failed24h} из ${summary.articles.created24h}.`)
  }

  return lines
}

function firstRecommendedAction(summary: OpsSummary): string {
  if (summary.openAlerts.some((alert) => alert.severity === 'critical')) return 'открой критические алёрты ниже и проверь последнюю ошибку'
  if (summary.latestIngest?.status === 'failed') return 'проверь сбор RSS/источников'
  if (summary.latestEnrich?.status === 'failed') return 'проверь обработку статей и ключи LLM-провайдеров'
  const digest = summary.digestToday ?? summary.latestDigest
  if (digest?.status?.startsWith('failed') || (summary.reportKind === 'morning' && !summary.digestToday)) return 'проверь workflow Telegram-дайджеста'
  if (summary.health.batches_open > 0) return 'проверь пакетную обработку Anthropic/Claude'
  if (summary.openAlerts.some((alert) => alert.severity === 'warning')) return 'посмотри группы warning-алёртов в блоке "Проблемы"'
  if (summary.health.live_window_6h_count === 0) return 'проверь, почему нет свежих live-публикаций'
  return 'смотри технические метрики ниже'
}

function formatDigestDelivery(row: OpsDigestRunRow | null): string {
  if (!row) return 'нет данных о запуске'
  if (row.status === 'success') {
    const countText = row.articles_count === null || row.articles_count === undefined
      ? ''
      : `, ${row.articles_count} ${pluralize(row.articles_count, 'статья', 'статьи', 'статей')}`
    return `отправлен в ${formatMskTime(row.sent_at ?? row.created_at)}${countText}`
  }
  if (row.status.startsWith('failed')) {
    return `не отправился: ${humanDigestStatus(row.status)}${row.error_message ? ` (${row.error_message})` : ''}`
  }
  return `не подтверждён как отправленный: ${humanDigestStatus(row.status)}`
}

function formatPublicationDelivery(summary: OpsSummary): string {
  const today = summary.articles.publishedTodayCount
  const window6h = summary.health.live_window_6h_count
  if (today === 0) return 'сегодня новых live-статей нет'
  return `сегодня опубликовано ${today} ${pluralize(today, 'статья', 'статьи', 'статей')}; за последние 6 часов ${window6h} ${pluralize(window6h, 'статья', 'статьи', 'статей')}`
}

function formatAlertGroups(groups: OpsSummary['alertGroups']): string {
  if (!groups.length) return 'группы не определены'
  return groups.slice(0, 5).map((group) => `${humanAlertType(group.key)} — ${group.count}`).join('; ')
}

function humanDigestStatus(status: string): string {
  const map: Record<string, string> = {
    success: 'отправлен',
    running: 'запущен и ещё не завершился',
    skipped: 'пропущен',
    skipped_already_claimed: 'пропущен, потому что другой запуск уже забрал слот',
    skipped_no_articles: 'не отправлен, потому что не было подходящих статей',
    low_articles: 'отправлен с малым числом статей',
    failed: 'ошибка отправки',
    failed_send: 'ошибка отправки в Telegram',
    failed_pipeline_stalled: 'пайплайн не подготовил статьи к отправке',
    error: 'ошибка',
  }
  return map[status] ?? status
}

function humanRunStatus(status: string): string {
  const map: Record<string, string> = {
    ok: 'ok',
    success: 'ok',
    partial: 'частично ok',
    failed: 'ошибка',
    running: 'в работе',
  }
  return map[status] ?? status
}

function humanRunKind(kind: string | null): string {
  const map: Record<string, string> = {
    sync: 'обычная обработка',
    batch_submit: 'отправка пакетной задачи',
    batch_collect: 'сбор результата пакетной задачи',
  }
  return kind ? (map[kind] ?? kind) : 'обработка'
}

function humanAlertType(type: string): string {
  const map: Record<string, string> = {
    source_down: 'источник/RSS упал',
    backlog_high: 'очередь статей выросла',
    provider_invalid_request: 'LLM-провайдер отклонил запрос',
    provider_rate_limit: 'LLM-провайдер упёрся в лимит',
    enrich_failed_spike: 'много ошибок обработки статей',
    batch_submit_failed: 'не удалось отправить пакетную задачу',
    batch_collect_failed: 'не удалось забрать результаты пакетной задачи',
    batch_poll_stuck: 'пакетная обработка давно не обновлялась',
    batch_apply_stuck: 'результаты пакетной обработки не применяются к статьям',
    claude_parse_failed: 'Claude вернул невалидный результат',
    claude_daily_budget_exceeded: 'превышен дневной бюджет Claude',
    publish_verify_failed: 'критическая ошибка публикации',
    publish_verify_failed_warn: 'предупреждение публикации',
    publish_rpc_bypass_active: 'включён аварийный bypass публикации',
    published_low_window: 'нет свежих live-публикаций',
    digest_low_articles: 'в дайджесте мало статей',
    digest_pipeline_stalled: 'дайджест заблокирован пайплайном',
    enrich_submit_blocked_budget: 'обработка остановлена бюджетом',
    llm_usage_log_write_failed: 'не записался лог расхода LLM',
    lease_expired_spike: 'много зависших задач восстановлено',
  }
  return map[type] ?? type
}

function humanRejectReason(reason: string): string {
  const map: Record<string, string> = {
    quality_reject: 'качество/релевантность',
    research_too_short: 'исследование слишком короткое',
    no_content: 'нет текста',
    duplicate: 'дубликат',
  }
  return map[reason] ?? reason
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`
}

function formatDigest(row: OpsDigestRunRow | null): string {
  if (!row) return 'нет данных'
  const time = formatMskTime(row.sent_at ?? row.failed_at ?? row.created_at)
  const countText = row.articles_count === null || row.articles_count === undefined
    ? ''
    : `, ${row.articles_count} ${pluralize(row.articles_count, 'статья', 'статьи', 'статей')}`
  return `<b>${escapeHtml(humanDigestStatus(row.status))}</b>${countText}${time !== '-' ? `, ${time}` : ''}`
}

function formatIngest(row: OpsIngestRunRow | null): string {
  if (!row) return 'нет данных'
  return `<b>${escapeHtml(humanRunStatus(row.status))}</b>, ${formatMskTime(row.finished_at ?? row.started_at)} · фиды: ${row.feeds_total ?? 0} всего, ${row.feeds_failed ?? 0} с ошибкой · новых статей ${row.items_inserted ?? 0}/${row.items_seen ?? 0}`
}

function formatEnrich(row: OpsEnrichRunRow | null): string {
  if (!row) return 'нет данных'
  return `${escapeHtml(humanRunKind(row.run_kind))} <b>${escapeHtml(humanRunStatus(row.status))}</b>, ${formatMskTime(row.finished_at ?? row.started_at)} · взято ${row.articles_claimed ?? 0}, готово ${row.articles_enriched_ok ?? 0}, отклонено ${row.articles_rejected ?? 0}, ошибок ${row.articles_failed ?? 0}`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, '')
}

function formatMskDateTime(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatMskTime(value: string | null | undefined): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatUsd(value: number): string {
  return `$${value.toFixed(3)}`
}

function count(map: Record<string, number>, key: string): number {
  return map[key] ?? 0
}

function bump(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by
}

function topCounts(map: Record<string, number>, limit: number): Array<{ key: string; count: number }> {
  return Object.entries(map)
    .map(([key, value]) => ({ key, count: value }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit)
}

function topCosts(map: Record<string, number>, limit: number): Array<{ key: string; costUsd: number }> {
  return Object.entries(map)
    .map(([key, value]) => ({ key, costUsd: roundUsd(value) }))
    .sort((a, b) => b.costUsd - a.costUsd || a.key.localeCompare(b.key))
    .slice(0, limit)
}

function roundUsd(value: number): number {
  return Number(value.toFixed(6))
}

function severityRank(severity: OpsAlertRow['severity']): number {
  if (severity === 'critical') return 3
  if (severity === 'warning') return 2
  return 1
}

export const _internals = {
  evaluateOpsStatus,
  formatDigest,
  groupAlerts,
  resolveOpsReportKind,
  selectRepresentativeDigestRun,
  startOfMskDayUtcIso,
}
