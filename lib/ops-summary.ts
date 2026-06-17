import type { SupabaseClient } from '@supabase/supabase-js'

import { getHealthSummary, type HealthSummary } from './health-summary'
import { getMoscowDateKey, pluralize, truncate } from './utils'

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000
const METRIKA_API_URL = 'https://api-metrika.yandex.net/stat/v1/data'
const FIX_PROMPT_MIN_ALERT_AGE_HOURS = 6
const FIX_PROMPT_MIN_OCCURRENCES = 3

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

export interface OpsTelegramPostRow {
  created_at: string
  delivery_date: string | null
  slot_no: number | null
  status: string
  article_id: string | null
  sent_at: string | null
  failed_at: string | null
  error_message: string | null
}

export interface OpsTelegramDelivery {
  delivery_date: string
  expected_slots: number
  success_count: number
  failed_count: number
  skipped_count: number
  planned_count: number
  status: string
  latest_sent_at: string | null
  latest_error: string | null
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

export interface OpsQualitySummary {
  scoresToday: number
  averageScore: number | null
  byWriterPath: Array<{ key: string; averageScore: number; count: number }>
  worst: Array<{ articleId: string; title: string; slug: string | null; score: number; reason: string | null }>
  feedback7d: { strong: number; normal: number; weak: number; total: number }
  judgeOwnerGap7d: number | null
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

export interface OpsTrafficSummary {
  status: 'ok' | 'not_configured' | 'error'
  date: string
  compareDate: string
  visits: number | null
  users: number | null
  pageviews: number | null
  visitsChangePercent: number | null
  usersChangePercent: number | null
  pageviewsChangePercent: number | null
  sampled: boolean
  errorMessage?: string
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
  telegramToday: OpsTelegramDelivery | null
  latestTelegram: OpsTelegramDelivery | null
  digestToday: OpsDigestRunRow | null
  latestDigest: OpsDigestRunRow | null
  openAlerts: OpsAlertRow[]
  alertGroups: Array<{ key: string; severity: OpsAlertRow['severity']; count: number }>
  costs: OpsCostSummary
  quality: OpsQualitySummary
  sources: OpsSourceSummary
  traffic: OpsTrafficSummary
}

type ArticleFunnelRow = {
  enrich_status: string | null
  publish_status: string | null
  source_name: string | null
  primary_category: string | null
}

type QueueRow = { enrich_status: string | null }
type CostRow = { provider: string | null; operation: string | null; estimated_cost_usd: number | string | null }
type QualityScoreRow = {
  article_id: string | null
  score: number | string | null
  writer_path: string | null
  reasons: Record<string, unknown> | null
  articles?: { ru_title?: string | null; original_title?: string | null; slug?: string | null } | null
}
type FeedbackRow = {
  article_id: string | null
  rating: number | string | null
  created_at: string | null
}
type SourceRunRow = {
  source_name: string | null
  status: string | null
  items_seen: number | null
  items_new: number | null
  items_rejected_count: number | null
  fetch_errors_count: number | null
}
type MetrikaDataRow = {
  dimensions?: Array<{ name?: string | null }>
  metrics?: Array<number | string | null>
}
type MetrikaApiResponse = {
  data?: MetrikaDataRow[]
  sampled?: boolean
  sample_share?: number
  sampleShare?: number
  message?: string
  errors?: Array<{ message?: string }>
}
type TrafficDayMetrics = {
  visits: number
  users: number
  pageviews: number
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

export async function getMetrikaTrafficSummary(
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<OpsTrafficSummary> {
  const date = mskDateKeyDaysAgo(now, 1)
  const compareDate = mskDateKeyDaysAgo(now, 2)
  const token = env.YANDEX_METRIKA_OAUTH_TOKEN
  const counterId = env.YANDEX_METRIKA_COUNTER_ID || env.NEXT_PUBLIC_METRIKA_ID

  if (!token || !counterId) {
    return emptyTrafficSummary('not_configured', date, compareDate)
  }

  const url = new URL(METRIKA_API_URL)
  url.searchParams.set('ids', counterId)
  url.searchParams.set('metrics', 'ym:s:visits,ym:s:users,ym:s:pageviews')
  url.searchParams.set('dimensions', 'ym:s:date')
  url.searchParams.set('date1', compareDate)
  url.searchParams.set('date2', date)
  url.searchParams.set('sort', 'ym:s:date')
  url.searchParams.set('accuracy', 'full')
  url.searchParams.set('limit', '10')

  try {
    const res = await fetchImpl(url, {
      headers: { Authorization: `OAuth ${token}` },
    })
    const data = await res.json().catch(() => null) as MetrikaApiResponse | null
    if (!res.ok) {
      return emptyTrafficSummary('error', date, compareDate, metrikaErrorMessage(data) || `HTTP ${res.status}`)
    }

    const rows = new Map<string, TrafficDayMetrics>()
    for (const row of data?.data ?? []) {
      const key = row.dimensions?.[0]?.name
      if (!key) continue
      rows.set(key, {
        visits: metricNumber(row.metrics?.[0]),
        users: metricNumber(row.metrics?.[1]),
        pageviews: metricNumber(row.metrics?.[2]),
      })
    }

    const current = rows.get(date) ?? { visits: 0, users: 0, pageviews: 0 }
    const previous = rows.get(compareDate) ?? { visits: 0, users: 0, pageviews: 0 }
    return {
      status: 'ok',
      date,
      compareDate,
      visits: current.visits,
      users: current.users,
      pageviews: current.pageviews,
      visitsChangePercent: percentChange(current.visits, previous.visits),
      usersChangePercent: percentChange(current.users, previous.users),
      pageviewsChangePercent: percentChange(current.pageviews, previous.pageviews),
      sampled: Boolean(data?.sampled || Number(data?.sample_share ?? data?.sampleShare ?? 1) < 1),
    }
  } catch (error) {
    return emptyTrafficSummary(
      'error',
      date,
      compareDate,
      error instanceof Error ? error.message : String(error),
    )
  }
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
    telegramRowsRes,
    digestRowsRes,
    openAlertsRes,
    sourceRowsRes,
    costRowsRes,
    qualityScoresRes,
    feedbackRowsRes,
    traffic,
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
      .from('telegram_channel_posts')
      .select('created_at, delivery_date, slot_no, status, article_id, sent_at, failed_at, error_message')
      .order('delivery_date', { ascending: false })
      .order('slot_no', { ascending: false })
      .limit(30),
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
    supabase
      .from('article_quality_scores')
      .select('article_id, score, writer_path, reasons, articles(ru_title, original_title, slug)')
      .gte('created_at', mskDayStart)
      .order('score', { ascending: true })
      .limit(500),
    supabase
      .from('article_feedback')
      .select('article_id, rating, created_at')
      .gte('created_at', new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .limit(1000),
    getMetrikaTrafficSummary(now),
  ])

  const articleRows = rowsOrThrow<ArticleFunnelRow>(articleRowsRes, 'articles funnel')
  const queueRows = rowsOrThrow<QueueRow>(queueRowsRes, 'articles queue')
  const publishedTodayRows = rowsOrThrow<OpsArticleFunnel['recentPublished'][number]>(publishedTodayRes, 'published today')
  const ingestRows = rowsOrThrow<OpsIngestRunRow>(ingestRowsRes, 'ingest runs')
  const enrichRows = rowsOrThrow<OpsEnrichRunRow>(enrichRowsRes, 'enrich runs')
  const telegramRows = rowsOrEmptyOnMissing<OpsTelegramPostRow>(telegramRowsRes)
  const digestRows = rowsOrThrow<OpsDigestRunRow>(digestRowsRes, 'digest runs')
  const openAlerts = rowsOrThrow<OpsAlertRow>(openAlertsRes, 'pipeline alerts')
  const sourceRows = rowsOrThrow<SourceRunRow>(sourceRowsRes, 'source runs')
  const costRows = rowsOrThrow<CostRow>(costRowsRes, 'llm usage logs')
  const qualityRows = rowsOrEmptyOnMissing<QualityScoreRow>(qualityScoresRes)
  const feedbackRows = rowsOrEmptyOnMissing<FeedbackRow>(feedbackRowsRes)

  const digestToday = selectRepresentativeDigestRun(digestRows.filter((row) => row.digest_date === mskDateKey))
  const latestDigest = selectRepresentativeDigestRun(digestRows)
  const telegramToday = summarizeTelegramDelivery(
    telegramRows.filter((row) => row.delivery_date === mskDateKey),
    mskDateKey,
    expectedTelegramSlots(now),
  )
  const latestTelegramDate = telegramRows[0]?.delivery_date ?? null
  const latestTelegram = latestTelegramDate
    ? summarizeTelegramDelivery(
        telegramRows.filter((row) => row.delivery_date === latestTelegramDate),
        latestTelegramDate,
        latestTelegramDate === mskDateKey ? expectedTelegramSlots(now) : 5,
      )
    : null
  const articles = summarizeArticles(articleRows, queueRows, publishedTodayRows, publishedTodayRes.count)
  const alertGroups = groupAlerts(openAlerts)
  const costs = summarizeCosts(costRows)
  const quality = summarizeQuality(qualityRows, feedbackRows)
  const sources = summarizeSources(sourceRows)

  const baseSummary: Omit<OpsSummary, 'status'> = {
    generatedAt: now.toISOString(),
    reportKind,
    mskDateKey,
    health,
    articles,
    latestIngest: ingestRows[0] ?? null,
    latestEnrich: enrichRows[0] ?? null,
    telegramToday,
    latestTelegram,
    digestToday,
    latestDigest,
    openAlerts,
    alertGroups,
    costs,
    quality,
    sources,
    traffic,
  }

  const status = evaluateOpsStatus(baseSummary)
  return { ...baseSummary, status }
}

function rowsOrThrow<T>(response: unknown, label: string): T[] {
  const typed = response as { data?: T[] | null; error?: { message?: string } | null }
  if (typed.error) throw new Error(`${label} query failed: ${typed.error.message ?? 'unknown error'}`)
  return typed.data ?? []
}

function rowsOrEmptyOnMissing<T>(response: unknown): T[] {
  const typed = response as { data?: T[] | null; error?: { message?: string; code?: string } | null }
  if (typed.error) return []
  return typed.data ?? []
}

function startOfMskDayUtcIso(now: Date): string {
  const msk = new Date(now.getTime() + MSK_OFFSET_MS)
  msk.setUTCHours(0, 0, 0, 0)
  return new Date(msk.getTime() - MSK_OFFSET_MS).toISOString()
}

function mskDateKeyDaysAgo(now: Date, daysAgo: number): string {
  const msk = new Date(now.getTime() + MSK_OFFSET_MS)
  msk.setUTCHours(0, 0, 0, 0)
  msk.setUTCDate(msk.getUTCDate() - daysAgo)
  return [
    msk.getUTCFullYear(),
    String(msk.getUTCMonth() + 1).padStart(2, '0'),
    String(msk.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

function emptyTrafficSummary(
  status: OpsTrafficSummary['status'],
  date: string,
  compareDate: string,
  errorMessage?: string,
): OpsTrafficSummary {
  return {
    status,
    date,
    compareDate,
    visits: null,
    users: null,
    pageviews: null,
    visitsChangePercent: null,
    usersChangePercent: null,
    pageviewsChangePercent: null,
    sampled: false,
    errorMessage,
  }
}

function metricNumber(value: number | string | null | undefined): number {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? Math.round(numeric) : 0
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return Math.round(((current - previous) / previous) * 100)
}

function metrikaErrorMessage(data: MetrikaApiResponse | null): string | null {
  return data?.errors?.[0]?.message ?? data?.message ?? null
}

export function expectedTelegramSlots(now: Date): number {
  const mskHour = new Date(now.getTime() + MSK_OFFSET_MS).getUTCHours()
  const mskMinute = new Date(now.getTime() + MSK_OFFSET_MS).getUTCMinutes()
  const minutes = mskHour * 60 + mskMinute
  if (minutes >= 21 * 60) return 5
  if (minutes >= 18 * 60 + 30) return 4
  if (minutes >= 15 * 60 + 30) return 3
  if (minutes >= 12 * 60 + 30) return 2
  if (minutes >= 9 * 60 + 30) return 1
  return 0
}

function summarizeTelegramDelivery(
  rows: OpsTelegramPostRow[],
  deliveryDate: string,
  expectedSlots: number,
): OpsTelegramDelivery | null {
  if (rows.length === 0) return null

  const success = rows.filter((row) => row.status === 'success')
  const failed = rows.filter((row) => row.status.startsWith('failed'))
  const skipped = rows.filter((row) => row.status.startsWith('skipped'))
  const planned = rows.filter((row) => row.status === 'planned' || row.status === 'sending')
  const latestSentAt = success
    .map((row) => row.sent_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null
  const latestError = failed[0]?.error_message ?? null

  let status = rows[0]?.status ?? 'unknown'
  if (failed.length > 0) status = 'failed'
  else if (success.length >= Math.max(1, expectedSlots) && expectedSlots > 0) status = 'success'
  else if (success.length > 0) status = 'partial_success'
  else if (skipped.some((row) => row.status === 'skipped_low_articles')) status = 'skipped_low_articles'
  else if (planned.length > 0) status = 'planned'

  return {
    delivery_date: deliveryDate,
    expected_slots: expectedSlots,
    success_count: success.length,
    failed_count: failed.length,
    skipped_count: skipped.length,
    planned_count: planned.length,
    status,
    latest_sent_at: latestSentAt,
    latest_error: latestError,
  }
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

function summarizeQuality(rows: QualityScoreRow[], feedbackRows: FeedbackRow[]): OpsQualitySummary {
  const numericScores = rows
    .map((row) => Number(row.score ?? 0))
    .filter((score) => Number.isFinite(score) && score > 0)
  const averageScore = numericScores.length
    ? roundOne(numericScores.reduce((sum, score) => sum + score, 0) / numericScores.length)
    : null
  const byWriter = new Map<string, { total: number; count: number }>()
  for (const row of rows) {
    const score = Number(row.score ?? 0)
    if (!Number.isFinite(score) || score <= 0) continue
    const key = row.writer_path ?? 'unknown'
    const existing = byWriter.get(key) ?? { total: 0, count: 0 }
    existing.total += score
    existing.count += 1
    byWriter.set(key, existing)
  }

  const feedback = { strong: 0, normal: 0, weak: 0, total: 0 }
  const feedbackByArticle = new Map<string, number>()
  for (const row of feedbackRows) {
    const rating = Number(row.rating ?? -1)
    if (rating === 2) feedback.strong += 1
    else if (rating === 1) feedback.normal += 1
    else if (rating === 0) feedback.weak += 1
    else continue
    feedback.total += 1
    if (row.article_id) feedbackByArticle.set(row.article_id, rating)
  }

  const gaps: number[] = []
  for (const row of rows) {
    if (!row.article_id || !feedbackByArticle.has(row.article_id)) continue
    const judgeScore = Number(row.score ?? 0)
    const ownerScore = (feedbackByArticle.get(row.article_id) ?? 0) * 2 + 1
    if (judgeScore > 0) gaps.push(Math.abs(judgeScore - ownerScore))
  }

  return {
    scoresToday: numericScores.length,
    averageScore,
    byWriterPath: [...byWriter.entries()]
      .map(([key, value]) => ({ key, averageScore: roundOne(value.total / value.count), count: value.count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    worst: rows
      .slice(0, 3)
      .map((row) => ({
        articleId: row.article_id ?? '',
        title: row.articles?.ru_title ?? row.articles?.original_title ?? row.article_id ?? 'unknown',
        slug: row.articles?.slug ?? null,
        score: Number(row.score ?? 0),
        reason: typeof row.reasons?.overall === 'string' ? row.reasons.overall : null,
      })),
    feedback7d: feedback,
    judgeOwnerGap7d: gaps.length
      ? roundOne(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length)
      : null,
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
  const sourceDownWarnings = warningAlerts.filter((alert) => alert.alert_type === 'source_down')
  const latestDigest = summary.digestToday ?? summary.latestDigest
  const telegram = summary.telegramToday ?? summary.latestTelegram
  const expectedSlotsNow = expectedTelegramSlots(new Date(summary.generatedAt))

  if (criticalAlerts.length > 0) {
    redReasons.push(`есть ${criticalAlerts.length} critical ${pluralize(criticalAlerts.length, 'алёрт', 'алёрта', 'алёртов')}`)
  }
  if (summary.latestIngest?.status === 'failed') redReasons.push('последний сбор источников завершился ошибкой')
  if (summary.latestEnrich?.status === 'failed') redReasons.push('последняя обработка статей завершилась ошибкой')
  if (!telegram && latestDigest?.status?.startsWith('failed')) {
    redReasons.push(`Telegram-дайджест не отправился: ${humanDigestStatus(latestDigest.status)}`)
  }
  if (telegram?.status === 'failed') {
    redReasons.push(`Telegram-пост не отправился${telegram.latest_error ? `: ${telegram.latest_error}` : ''}`)
  }

  if (summary.reportKind === 'morning' && expectedSlotsNow > 0) {
    if (!summary.telegramToday) yellowReasons.push('нет записи о Telegram-постах за сегодня')
    else if (summary.telegramToday.success_count < summary.telegramToday.expected_slots && summary.telegramToday.status !== 'skipped_low_articles') {
      yellowReasons.push(`Telegram-посты: отправлено ${summary.telegramToday.success_count}/${summary.telegramToday.expected_slots}`)
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
  if (summary.sources.failedRuns24h > 0 && sourceDownWarnings.length > 0) {
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
  return {
    level: 'green',
    emoji: '🟢',
    label: 'зеленый',
    reasons: ['всё ок: публикации идут, критических ошибок и открытых предупреждений нет'],
  }
}

export function formatOpsSummaryForTelegram(summary: OpsSummary): string {
  const lines: string[] = []
  const promptDecision = getFixPromptDecision(summary)
  const displayStatus = getDisplayStatus(summary, promptDecision.show)
  const title = reportTitle(summary)

  lines.push(`${displayStatus.emoji} <b>${title} · ${formatDateKeyShort(summary.mskDateKey)}</b>`)
  lines.push(`Период: сегодня 00:00-${formatMskTime(summary.generatedAt)} МСК · трафик: вчера ${formatDateKeyShort(summary.traffic.date)}`)
  lines.push('')
  lines.push(`<b>Главное:</b> ${escapeHtml(compactMainLine(summary, promptDecision.show, displayStatus))}`)
  lines.push('')
  lines.push('<b>✅ Что работает</b>')
  for (const line of buildWhatWorksLines(summary)) lines.push(`• ${escapeHtml(line)}`)
  lines.push('')
  lines.push('<b>⚠️ Что не идеально</b>')
  for (const line of buildCompactIssueLines(summary, promptDecision.show, displayStatus)) lines.push(`• ${escapeHtml(line)}`)
  lines.push('')
  lines.push('<b>📈 Трафик вчера</b>')
  for (const line of formatTrafficLines(summary.traffic)) lines.push(`• ${escapeHtml(line)}`)
  lines.push('')
  lines.push('<b>📊 Контент</b>')
  for (const line of buildContentMetricLines(summary)) lines.push(`• ${escapeHtml(line)}`)
  lines.push('')
  lines.push('<b>💸 Расходы</b>')
  lines.push(`• ИИ сегодня: ${formatUsd(summary.costs.totalCostUsd)}`)
  lines.push('')
  lines.push('<b>🧪 Качество</b>')
  for (const line of formatQualityLines(summary.quality)) lines.push(`• ${escapeHtml(line)}`)
  lines.push('')
  lines.push('<b>🎯 Что делать</b>')
  lines.push(escapeHtml(compactActionLine(promptDecision.show, displayStatus)))
  if (promptDecision.show) {
    lines.push('')
    lines.push(...formatCodexPromptBlock(summary, promptDecision.reason))
  }

  return lines.join('\n')
}

export function shouldShowFixPrompt(summary: OpsSummary): boolean {
  return getFixPromptDecision(summary).show
}

function getDisplayStatus(summary: OpsSummary, hasPrompt: boolean): OpsStatus {
  if (summary.status.level === 'yellow' && !hasPrompt) {
    return {
      level: 'green',
      emoji: '🟢',
      label: 'зеленый',
      reasons: ['нет проблем, требующих действий'],
    }
  }
  return summary.status
}

function getFixPromptDecision(summary: OpsSummary): { show: boolean; reason: string } {
  const expectedSlots = expectedTelegramSlots(new Date(summary.generatedAt))
  const telegram = summary.telegramToday ?? summary.latestTelegram

  if (summary.status.level === 'red') return { show: true, reason: 'critical status' }
  if (summary.latestIngest?.status === 'failed') return { show: true, reason: 'ingest failed' }
  if (summary.latestEnrich?.status === 'failed') return { show: true, reason: 'enrich failed' }
  if (telegram?.status === 'failed') return { show: true, reason: 'telegram failed' }
  if (expectedSlots > 0 && !summary.telegramToday) return { show: true, reason: 'telegram slot missing' }
  if (summary.telegramToday && summary.telegramToday.success_count < summary.telegramToday.expected_slots && summary.telegramToday.status !== 'skipped_low_articles') {
    return { show: true, reason: 'telegram slots below plan' }
  }

  const persistentAlert = summary.openAlerts.find((alert) => isPersistentFixAlert(alert, summary.generatedAt))
  if (persistentAlert) {
    return { show: true, reason: `persistent alert: ${humanAlertType(persistentAlert.alert_type)}` }
  }

  return { show: false, reason: 'no actionable persistent incident' }
}

function isPersistentFixAlert(alert: OpsAlertRow, generatedAt: string): boolean {
  if (alert.severity === 'critical') return true
  if (alert.severity === 'info') return false
  if (alert.occurrence_count >= FIX_PROMPT_MIN_OCCURRENCES) return true
  const ageMs = new Date(generatedAt).getTime() - new Date(alert.first_seen_at).getTime()
  return ageMs >= FIX_PROMPT_MIN_ALERT_AGE_HOURS * 60 * 60 * 1000
}

function reportTitle(summary: OpsSummary): string {
  if (summary.reportKind === 'morning') return 'Утренний отчет'
  if (summary.reportKind === 'evening') return 'Отчет за день'
  return 'Ручной отчет'
}

function compactMainLine(summary: OpsSummary, hasPrompt: boolean, displayStatus: OpsStatus): string {
  if (displayStatus.level === 'green') return 'все ключевые контуры работают.'
  if (displayStatus.level === 'red') {
    return `есть критическая проблема: ${summary.status.reasons[0] ?? 'требуется проверка'}.`
  }
  if (hasPrompt) return 'есть проблема, которую стоит разобрать системно.'
  return 'все ключевые контуры работают.'
}

function buildWhatWorksLines(summary: OpsSummary): string[] {
  const criticalCount = summary.openAlerts.filter((alert) => alert.severity === 'critical').length
  const deliveryProblems = buildDeliveryProblems(summary)
  const lines = [
    `Telegram: ${formatTelegramDeliveryForWorks(summary)}`,
    `Сайт: ${formatSiteFreshnessShort(summary)}`,
    `Доставка: ${deliveryProblems.length ? 'есть вопросы, смотри ниже' : 'потерь не видно'}`,
    `Критические алерты: ${criticalCount}`,
  ]
  return lines
}

function buildContentMetricLines(summary: OpsSummary): string[] {
  const today = summary.articles.publishedTodayCount
  const window6h = summary.health.live_window_6h_count
  const created24h = summary.articles.created24h

  return [
    `Сегодня с 00:00 МСК: ${today} live-${pluralize(today, 'публикация', 'публикации', 'публикаций')}`,
    `Последние 6ч: ${window6h} live-${pluralize(window6h, 'публикация', 'публикации', 'публикаций')}`,
    `Последние 24ч: ${created24h} ${pluralize(created24h, 'материал создан', 'материала создано', 'материалов создано')}`,
  ]
}

function formatQualityLines(quality: OpsQualitySummary): string[] {
  if (quality.scoresToday === 0) return ['Judge сегодня ещё не записал оценки.']
  const lines = [
    `Judge: ${quality.averageScore?.toFixed(1) ?? 'n/a'}/5 по ${quality.scoresToday} ${pluralize(quality.scoresToday, 'статье', 'статьям', 'статьям')}`,
  ]
  if (quality.byWriterPath.length) {
    lines.push(`По writer-path: ${quality.byWriterPath.map((row) => `${row.key} ${row.averageScore.toFixed(1)} (${row.count})`).join(', ')}`)
  }
  if (quality.worst.length) {
    const worst = quality.worst[0]!
    lines.push(`Худшая: ${worst.score}/5 — ${truncate(worst.title, 90)}${worst.reason ? ` (${truncate(worst.reason, 90)})` : ''}`)
  }
  if (quality.feedback7d.total > 0) {
    lines.push(
      `Оценки владельца 7д: 🔥 ${quality.feedback7d.strong}, 👌 ${quality.feedback7d.normal}, 👎 ${quality.feedback7d.weak}` +
      (quality.judgeOwnerGap7d !== null ? `; средний разрыв ${quality.judgeOwnerGap7d.toFixed(1)}` : ''),
    )
  }
  return lines
}

function buildCompactIssueLines(summary: OpsSummary, hasPrompt: boolean, displayStatus: OpsStatus): string[] {
  if (displayStatus.level === 'green' && !hasPrompt) return ['Ничего существенного не вижу.']

  const issues = buildAdminIssueLines(summary)
    .map((line) => line.replace(/`/g, ''))
    .slice(0, 3)

  if (!issues.length) {
    return ['Ничего существенного не вижу.']
  }

  const lines = issues.map((line) => truncate(line, 160))
  lines.push(hasPrompt ? 'Действие: ниже есть промпт для Codex.' : 'Действие: наблюдать, промпт не нужен.')
  return lines
}

function formatTrafficLines(traffic: OpsTrafficSummary): string[] {
  if (traffic.status === 'not_configured') return ['Трафик: данные Метрики не получены.']
  if (traffic.status === 'error') {
    const suffix = traffic.errorMessage ? ` (${truncate(traffic.errorMessage, 100)})` : ''
    return [`Трафик: данные Метрики не получены${suffix}.`]
  }
  return [
    `Визиты: ${traffic.visits ?? 0} (${formatPercentDelta(traffic.visitsChangePercent)})`,
    `Посетители: ${traffic.users ?? 0} (${formatPercentDelta(traffic.usersChangePercent)})`,
    `Просмотры: ${traffic.pageviews ?? 0} (${formatPercentDelta(traffic.pageviewsChangePercent)})${traffic.sampled ? ' · выборка' : ''}`,
  ]
}

function compactActionLine(hasPrompt: boolean, displayStatus: OpsStatus): string {
  if (hasPrompt) return 'Запустить Codex-промпт ниже: он уже содержит контекст, файлы и проверки.'
  if (displayStatus.level === 'green') return 'Ничего не делать.'
  return 'Если сигнал повторится или станет критичным, появится промпт для фикса.'
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
      '<b>Итог:</b> всё ок. Статьи публикуются, критических ошибок и открытых предупреждений нет.',
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

  lines.push(`• Telegram-посты: ${formatTelegramDelivery(summary.telegramToday ?? summary.latestTelegram)}`)
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
    lines.push('• Проблем не вижу: сбор источников, обработка и публикации в норме.')
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

function formatCodexPromptBlock(summary: OpsSummary, reason: string): string[] {
  return [
    '🛠 <b>Есть готовый промпт для Codex</b>',
    `<pre><code>${escapeHtml(buildCodexPrompt(summary, reason))}</code></pre>`,
  ]
}

function buildGreenPathActions(summary: OpsSummary): string[] {
  const actions: string[] = []
  const criticalAlerts = summary.openAlerts.filter((alert) => alert.severity === 'critical')
  const warningAlerts = summary.openAlerts.filter((alert) => alert.severity === 'warning')
  const telegram = summary.telegramToday ?? summary.latestTelegram

  if (criticalAlerts.length) {
    actions.push(`устранить ${criticalAlerts.length} critical ${pluralize(criticalAlerts.length, 'алёрт', 'алёрта', 'алёртов')} и закрыть его в pipeline_alerts`)
  }
  if (summary.latestIngest?.status === 'failed') actions.push('починить последний сбор источников')
  if (summary.latestEnrich?.status === 'failed') actions.push('починить последнюю обработку статей')
  if (telegram?.status === 'failed') actions.push('починить отправку Telegram-поста')
  if (summary.reportKind === 'morning' && expectedTelegramSlots(new Date(summary.generatedAt)) > 0 && !summary.telegramToday) {
    actions.push('добиться записи success в telegram_channel_posts за текущий слот')
  }
  if (summary.telegramToday && summary.telegramToday.success_count < summary.telegramToday.expected_slots && summary.telegramToday.status !== 'skipped_low_articles') {
    actions.push('довести Telegram-посты до ожидаемого количества отправленных слотов')
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
  if (
    summary.sources.failedRuns24h > 0 &&
    warningAlerts.some((alert) => alert.alert_type === 'source_down')
  ) {
    actions.push('починить источники, которые падали за последние 24 часа')
  }

  return actions
}

function formatTelegramPromptFact(summary: OpsSummary): string {
  if (summary.telegramToday) return stripTags(formatTelegramDelivery(summary.telegramToday))

  const expectedToday = expectedTelegramSlots(new Date(summary.generatedAt))
  if (expectedToday === 0) return 'сегодня слотов ещё не было'
  if (!summary.latestTelegram) return 'сегодня нет данных'

  return `сегодня нет данных; последний день ${summary.latestTelegram.delivery_date}: ${stripTags(formatTelegramDelivery(summary.latestTelegram))}`
}

function buildCodexPrompt(summary: OpsSummary, reason: string): string {
  const focus = resolveFixPromptFocus(summary)
  const facts = [
    `Сигнал: ${summary.status.emoji} ${summary.status.label}`,
    `Триггер промпта: ${reason}`,
    `Причины: ${summary.status.reasons.join('; ')}`,
    `Telegram: ${formatTelegramPromptFact(summary)}`,
    `Публикации: сегодня ${summary.articles.publishedTodayCount}, за 6ч ${summary.health.live_window_6h_count}`,
    `Очередь: pending ${count(summary.articles.currentQueue, 'pending')}, retry ${count(summary.articles.currentQueue, 'retry_wait')}, processing ${count(summary.articles.currentQueue, 'processing')}`,
    `Open batches: ${summary.health.batches_open}`,
    `Алерты: ${formatAlertGroups(summary.alertGroups)}`,
    `Детали алертов: ${formatAlertDetailsForPrompt(summary.openAlerts)}`,
    `Метрика вчера: ${trafficPromptFact(summary.traffic)}`,
  ].join('\n')

  return [
    'Разбери и исправь production-проблему Malakhov AI Digest.',
    'Репозиторий: /Users/malast/malakhov-ai-digest',
    `Фокус: ${focus.title}`,
    facts,
    'Задача:',
    '1. Найди root cause, а не просто закрой алерт.',
    `2. Проверь: ${focus.checks.join(', ')}.`,
    '3. Внеси системный фикс, добавь или обнови тесты.',
    '4. Проверь dry-run: npm run ops:report -- --dry-run --kind=manual.',
    '5. Обнови docs/OPERATIONS.md, если изменилось поведение.',
    'Не трогай unrelated changes.',
  ].join('\n')
}

function resolveFixPromptFocus(summary: OpsSummary): { title: string; checks: string[] } {
  const alertTypes = new Set(summary.openAlerts.map((alert) => alert.alert_type))
  const expectedSlots = expectedTelegramSlots(new Date(summary.generatedAt))

  if (
    summary.telegramToday?.status === 'failed' ||
    (expectedSlots > 0 && !summary.telegramToday) ||
    (summary.telegramToday && summary.telegramToday.success_count < summary.telegramToday.expected_slots && summary.telegramToday.status !== 'skipped_low_articles')
  ) {
    return {
      title: 'Telegram delivery',
      checks: ['telegram_channel_posts', 'pg_cron', 'bot/channel-post-core.ts', 'app/api/cron/tg-channel-post/route.ts', 'GitHub Actions'],
    }
  }

  if (summary.latestIngest?.status === 'failed' || alertTypes.has('source_down')) {
    return {
      title: 'RSS/source ingest',
      checks: ['ingest_runs', 'source_runs', 'pipeline/ingest.ts', 'pipeline/rss-parser.ts', 'pipeline/source-health.ts'],
    }
  }

  if (
    summary.latestEnrich?.status === 'failed' ||
    alertTypes.has('provider_invalid_request') ||
    alertTypes.has('provider_rate_limit') ||
    alertTypes.has('enrich_failed_spike') ||
    alertTypes.has('batch_submit_failed') ||
    alertTypes.has('batch_collect_failed') ||
    alertTypes.has('batch_poll_stuck') ||
    alertTypes.has('batch_apply_stuck') ||
    alertTypes.has('claude_parse_failed')
  ) {
    return {
      title: 'Article enrichment / batch processing',
      checks: ['pipeline_alerts', 'anthropic_batches', 'anthropic_batch_items', 'enrich_runs', 'pipeline/enrich-submit-batch.ts', 'pipeline/enrich-collect-batch.ts', 'pipeline/recover-batch-stuck.ts'],
    }
  }

  if (
    summary.articles.publishedTodayCount === 0 ||
    summary.health.live_window_6h_count === 0 ||
    alertTypes.has('publish_verify_failed') ||
    alertTypes.has('publish_verify_failed_warn') ||
    alertTypes.has('published_low_window')
  ) {
    return {
      title: 'Publication / live verification',
      checks: ['articles', 'publish_status/verified_live', 'pipeline/publish-verify.ts', 'app/api/feed', 'live article URLs'],
    }
  }

  if (alertTypes.has('claude_daily_budget_exceeded') || alertTypes.has('enrich_submit_blocked_budget')) {
    return {
      title: 'LLM budget guard',
      checks: ['llm_usage_logs', 'pipeline/cost-guard.ts', 'pipeline/enrich-submit-batch.ts', 'CLAUDE_DAILY_BUDGET_USD'],
    }
  }

  return {
    title: 'General ops signal',
    checks: ['pipeline_alerts', 'anthropic_batches', 'telegram_channel_posts', 'pg_cron', 'GitHub Actions'],
  }
}

function trafficPromptFact(traffic: OpsTrafficSummary): string {
  if (traffic.status !== 'ok') return 'нет данных'
  return `${traffic.date}: visits=${traffic.visits ?? 0}, users=${traffic.users ?? 0}, pageviews=${traffic.pageviews ?? 0}`
}

function formatAlertDetailsForPrompt(alerts: OpsAlertRow[]): string {
  if (!alerts.length) return 'нет открытых алертов'
  return alerts
    .slice(0, 3)
    .map((alert) => `${humanAlertType(alert.alert_type)} / ${alert.severity} / count=${alert.occurrence_count}: ${truncate(alert.message, 180)}`)
    .join(' | ')
}

function buildDeliveryProblems(summary: OpsSummary): string[] {
  const problems: string[] = []
  const expectedSlots = expectedTelegramSlots(new Date(summary.generatedAt))

  if (!summary.telegramToday && expectedSlots > 0) {
    problems.push('нет подтверждения, что текущий Telegram-слот сегодня отправлялся')
  } else if (summary.telegramToday?.status === 'failed') {
    problems.push(`Telegram-пост не отправился${summary.telegramToday.latest_error ? `: ${summary.telegramToday.latest_error}` : ''}`)
  } else if (summary.telegramToday && summary.telegramToday.success_count < summary.telegramToday.expected_slots && summary.telegramToday.status !== 'skipped_low_articles') {
    problems.push(`Telegram-посты сегодня ниже плана: ${summary.telegramToday.success_count}/${summary.telegramToday.expected_slots}`)
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
  const expectedSlots = expectedTelegramSlots(new Date(summary.generatedAt))

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
  if (summary.telegramToday?.status === 'failed') {
    lines.push(`Telegram-пост не отправился${summary.telegramToday.latest_error ? `: ${summary.telegramToday.latest_error}` : ''}.`)
  }

  if (expectedSlots > 0 && !summary.telegramToday) {
    lines.push('Нет записи о сегодняшних Telegram-постах: нужно проверить pg_cron `tg-channel-post-*` и таблицу `telegram_channel_posts`.')
  } else if (summary.telegramToday && summary.telegramToday.success_count < summary.telegramToday.expected_slots && summary.telegramToday.status !== 'skipped_low_articles') {
    lines.push(`Telegram-посты сегодня ниже плана: ${summary.telegramToday.success_count}/${summary.telegramToday.expected_slots}.`)
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
  if (summary.telegramToday?.status === 'failed' || (expectedTelegramSlots(new Date(summary.generatedAt)) > 0 && !summary.telegramToday)) return 'проверь pg_cron и отправку Telegram-постов'
  if (summary.health.batches_open > 0) return 'проверь пакетную обработку Anthropic/Claude'
  if (summary.openAlerts.some((alert) => alert.severity === 'warning')) return 'посмотри группы warning-алёртов в блоке "Проблемы"'
  if (summary.health.live_window_6h_count === 0) return 'проверь, почему нет свежих live-публикаций'
  return 'смотри технические метрики ниже'
}

function formatTelegramDelivery(row: OpsTelegramDelivery | null): string {
  if (!row) return 'нет данных о слотах'
  const expected = row.expected_slots > 0 ? row.expected_slots : 5
  const countText = `${row.success_count}/${expected} ${pluralize(expected, 'слот', 'слота', 'слотов')}`
  if (row.status === 'success') {
    return `по плану, отправлено ${countText}${row.latest_sent_at ? `, последний в ${formatMskTime(row.latest_sent_at)}` : ''}`
  }
  if (row.status === 'partial_success') {
    return `частично отправлено ${countText}${row.latest_sent_at ? `, последний в ${formatMskTime(row.latest_sent_at)}` : ''}`
  }
  if (row.status === 'skipped_low_articles') {
    return `не отправлялись: мало подходящих статей (${row.skipped_count} слотов skipped)`
  }
  if (row.status === 'failed') {
    return `ошибка отправки: ${row.latest_error ?? 'без деталей'}`
  }
  return `ожидает отправки: ${countText}, статус ${escapeHtml(row.status)}`
}

function formatTelegramDeliveryShort(row: OpsTelegramDelivery | null): string {
  if (!row) return 'нет данных'
  const expected = row.expected_slots > 0 ? row.expected_slots : 5
  if (row.status === 'success') return `${row.success_count}/${expected} постов отправлены`
  if (row.status === 'partial_success') return `${row.success_count}/${expected} постов отправлены`
  if (row.status === 'skipped_low_articles') return 'не отправлялись: мало подходящих статей'
  if (row.status === 'failed') return 'есть ошибка отправки'
  return `${row.success_count}/${expected} постов, статус ${row.status}`
}

function formatTelegramDeliveryForWorks(summary: OpsSummary): string {
  if (summary.telegramToday) return formatTelegramDeliveryShort(summary.telegramToday)

  const expectedToday = expectedTelegramSlots(new Date(summary.generatedAt))
  if (expectedToday === 0) {
    return 'сегодня слотов ещё не было'
  }

  return 'сегодня нет данных'
}

function formatSiteFreshnessShort(summary: OpsSummary): string {
  const today = summary.articles.publishedTodayCount
  const window6h = summary.health.live_window_6h_count
  if (window6h > 0) return `свежие live-публикации есть: ${window6h} за 6ч`
  if (today > 0) return `сегодня опубликовано ${today}, но за 6ч новых нет`
  return 'сегодня и за 6ч новых live-публикаций нет'
}

function formatPublicationDelivery(summary: OpsSummary): string {
  const today = summary.articles.publishedTodayCount
  const window6h = summary.health.live_window_6h_count
  if (today === 0) return 'сегодня новых live-статей нет'
  return `сегодня опубликовано ${today} ${pluralize(today, 'статья', 'статьи', 'статей')}; за последние 6 часов ${window6h} ${pluralize(window6h, 'статья', 'статьи', 'статей')}`
}

function formatPercentDelta(value: number | null): string {
  if (value === null) return 'нет базы'
  if (value > 0) return `+${value}%`
  return `${value}%`
}

function formatDateKeyShort(dateKey: string): string {
  const [, month, day] = dateKey.split('-')
  if (!month || !day) return dateKey
  return `${day}.${month}`
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

function roundOne(value: number): number {
  return Number(value.toFixed(1))
}

function severityRank(severity: OpsAlertRow['severity']): number {
  if (severity === 'critical') return 3
  if (severity === 'warning') return 2
  return 1
}

export const _internals = {
  evaluateOpsStatus,
  expectedTelegramSlots,
  formatDigest,
  formatTelegramDelivery,
  getFixPromptDecision,
  groupAlerts,
  mskDateKeyDaysAgo,
  resolveOpsReportKind,
  selectRepresentativeDigestRun,
  shouldShowFixPrompt,
  summarizeTelegramDelivery,
  startOfMskDayUtcIso,
}
