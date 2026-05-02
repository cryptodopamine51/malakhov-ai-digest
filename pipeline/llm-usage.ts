import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fireAlert } from './alerts'

const MOSCOW_TZ = 'Europe/Moscow'

export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreateTokens: number
  estimatedCostUsd: number
}

export const ZERO_USAGE_TOTALS: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreateTokens: 0,
  estimatedCostUsd: 0,
}

export interface LlmUsageLogParams {
  supabase?: SupabaseClient
  provider: string
  model: string
  operation: string
  runKind?: string | null
  enrichRunId?: string | null
  articleId?: string | null
  batchItemId?: string | null
  sourceName?: string | null
  sourceLang?: string | null
  originalTitle?: string | null
  resultStatus?: string | null
  metadata?: Record<string, unknown>
  createdAt?: string
  usage: UsageTotals
}

export interface CostReportEntry {
  at: string
  operation: string
  sourceName: string | null
  originalTitle: string | null
  resultStatus: string | null
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreateTokens: number
}

export interface CostReportAggregate {
  key: string
  costUsd: number
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreateTokens: number
}

export interface ClaudeCostReport {
  mode: 'llm_usage_logs' | 'anthropic_batch_items' | 'legacy_sync_runs'
  window: {
    since: string
    until: string
  }
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheCreateTokens: number
  totalCalls: number
  byDay: CostReportAggregate[]
  byOperation: CostReportAggregate[]
  bySource: CostReportAggregate[]
  topEntries: CostReportEntry[]
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function getMoscowDayKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MOSCOW_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value ?? '0000'
  const month = parts.find((part) => part.type === 'month')?.value ?? '00'
  const day = parts.find((part) => part.type === 'day')?.value ?? '00'
  return `${year}-${month}-${day}`
}

export function addUsageTotals(
  current: UsageTotals,
  next: Partial<UsageTotals> | null | undefined,
): UsageTotals {
  if (!next) return current

  return {
    inputTokens: current.inputTokens + Number(next.inputTokens ?? 0),
    outputTokens: current.outputTokens + Number(next.outputTokens ?? 0),
    cacheReadTokens: current.cacheReadTokens + Number(next.cacheReadTokens ?? 0),
    cacheCreateTokens: current.cacheCreateTokens + Number(next.cacheCreateTokens ?? 0),
    estimatedCostUsd: roundUsd(current.estimatedCostUsd + Number(next.estimatedCostUsd ?? 0)),
  }
}

export function formatUsageSummary(usage: Partial<UsageTotals> | null | undefined): string {
  const normalized = addUsageTotals(ZERO_USAGE_TOTALS, usage)
  return (
    `tokens: in=${normalized.inputTokens}` +
    ` out=${normalized.outputTokens}` +
    ` cache_read=${normalized.cacheReadTokens}` +
    ` cache_create=${normalized.cacheCreateTokens}; ` +
    `cost=$${normalized.estimatedCostUsd.toFixed(4)}`
  )
}

let usageLogClient: SupabaseClient | null | undefined

function getUsageLogClient(): SupabaseClient | null {
  if (usageLogClient !== undefined) return usageLogClient

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    usageLogClient = null
    return usageLogClient
  }

  usageLogClient = createClient(url, key, {
    auth: { persistSession: false },
  })
  return usageLogClient
}

function formatUsageLogError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    return [record.message, record.code, record.details, record.hint]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' | ') || JSON.stringify(record)
  }
  return String(error)
}

async function reportUsageLogWriteFailure(
  supabase: SupabaseClient,
  params: LlmUsageLogParams,
  error: unknown,
): Promise<void> {
  const message = formatUsageLogError(error)
  console.error(`[llm-usage] insert failed: ${message}`)
  await fireAlert({
    supabase,
    alertType: 'llm_usage_log_write_failed',
    severity: 'warning',
    entityKey: params.enrichRunId ?? params.batchItemId ?? params.articleId ?? params.operation,
    message: `llm_usage_logs write failed for ${params.operation}: ${message}`,
    payload: {
      provider: params.provider,
      model: params.model,
      operation: params.operation,
      runKind: params.runKind ?? null,
      enrichRunId: params.enrichRunId ?? null,
      articleId: params.articleId ?? null,
      batchItemId: params.batchItemId ?? null,
      resultStatus: params.resultStatus ?? null,
      error: message,
    },
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID,
  })
}

export async function writeLlmUsageLog(params: LlmUsageLogParams): Promise<void> {
  const supabase = params.supabase ?? getUsageLogClient()
  if (!supabase) return

  const usage = addUsageTotals(ZERO_USAGE_TOTALS, params.usage)
  const createdAt = params.createdAt ?? new Date().toISOString()

  try {
    const { error } = await supabase
      .from('llm_usage_logs')
      .insert({
        provider: params.provider,
        model: params.model,
        operation: params.operation,
        run_kind: params.runKind ?? null,
        enrich_run_id: params.enrichRunId ?? null,
        article_id: params.articleId ?? null,
        batch_item_id: params.batchItemId ?? null,
        source_name: params.sourceName ?? null,
        source_lang: params.sourceLang ?? null,
        original_title: params.originalTitle ?? null,
        result_status: params.resultStatus ?? null,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cache_read_tokens: usage.cacheReadTokens,
        cache_creation_tokens: usage.cacheCreateTokens,
        estimated_cost_usd: usage.estimatedCostUsd,
        metadata: params.metadata ?? {},
        created_at: createdAt,
      })

    if (error) {
      await reportUsageLogWriteFailure(supabase, params, error)
    }
  } catch (error) {
    await reportUsageLogWriteFailure(supabase, params, error)
  }
}

export async function refreshAnthropicBatchUsageTotals(
  supabase: SupabaseClient,
  batchId: string,
): Promise<UsageTotals> {
  const { data, error } = await supabase
    .from('anthropic_batch_items')
    .select('input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, estimated_cost_usd')
    .eq('batch_id', batchId)

  if (error) {
    throw new Error(`batch usage totals fetch failed: ${error.message}`)
  }

  let totals = ZERO_USAGE_TOTALS
  for (const row of data ?? []) {
    totals = addUsageTotals(totals, {
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      cacheReadTokens: Number(row.cache_read_tokens ?? 0),
      cacheCreateTokens: Number(row.cache_creation_tokens ?? 0),
      estimatedCostUsd: Number(row.estimated_cost_usd ?? 0),
    })
  }

  const { error: updateError } = await supabase
    .from('anthropic_batches')
    .update({
      total_input_tokens: totals.inputTokens,
      total_output_tokens: totals.outputTokens,
      total_cache_read_tokens: totals.cacheReadTokens,
      total_cache_creation_tokens: totals.cacheCreateTokens,
      estimated_cost_usd: totals.estimatedCostUsd,
      updated_at: new Date().toISOString(),
    })
    .eq('id', batchId)

  if (updateError) {
    throw new Error(`batch usage totals update failed: ${updateError.message}`)
  }

  return totals
}

function aggregateRows(rows: CostReportEntry[]): Omit<ClaudeCostReport, 'mode' | 'window'> {
  const byDay = new Map<string, CostReportAggregate>()
  const byOperation = new Map<string, CostReportAggregate>()
  const bySource = new Map<string, CostReportAggregate>()

  let totals = ZERO_USAGE_TOTALS

  for (const row of rows) {
    totals = addUsageTotals(totals, {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheCreateTokens: row.cacheCreateTokens,
      estimatedCostUsd: row.costUsd,
    })

    const groupTargets: Array<[Map<string, CostReportAggregate>, string]> = [
      [byDay, getMoscowDayKey(row.at)],
      [byOperation, row.operation],
      [bySource, row.sourceName ?? 'unknown'],
    ]

    for (const [store, key] of groupTargets) {
      const existing = store.get(key) ?? {
        key,
        costUsd: 0,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
      }

      existing.costUsd = roundUsd(existing.costUsd + row.costUsd)
      existing.calls += 1
      existing.inputTokens += row.inputTokens
      existing.outputTokens += row.outputTokens
      existing.cacheReadTokens += row.cacheReadTokens
      existing.cacheCreateTokens += row.cacheCreateTokens
      store.set(key, existing)
    }
  }

  const topEntries = [...rows]
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 15)

  const sortGroups = (values: Iterable<CostReportAggregate>) =>
    Array.from(values).sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls)

  return {
    totalCostUsd: totals.estimatedCostUsd,
    totalInputTokens: totals.inputTokens,
    totalOutputTokens: totals.outputTokens,
    totalCacheReadTokens: totals.cacheReadTokens,
    totalCacheCreateTokens: totals.cacheCreateTokens,
    totalCalls: rows.length,
    byDay: sortGroups(byDay.values()),
    byOperation: sortGroups(byOperation.values()),
    bySource: sortGroups(bySource.values()),
    topEntries,
  }
}

async function fetchReportFromUsageLogs(
  supabase: SupabaseClient,
  sinceIso: string,
  untilIso: string,
): Promise<ClaudeCostReport | null> {
  const { data, error } = await supabase
    .from('llm_usage_logs')
    .select('created_at, operation, source_name, original_title, result_status, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, estimated_cost_usd')
    .eq('provider', 'anthropic')
    .gte('created_at', sinceIso)
    .lte('created_at', untilIso)
    .order('created_at', { ascending: false })
    .limit(10_000)

  if (error) {
    if (error.message.includes('llm_usage_logs')) {
      return null
    }
    throw new Error(`llm_usage_logs query failed: ${error.message}`)
  }

  const rows = (data ?? []).map((row) => ({
    at: String(row.created_at),
    operation: String(row.operation ?? 'unknown'),
    sourceName: row.source_name ? String(row.source_name) : null,
    originalTitle: row.original_title ? String(row.original_title) : null,
    resultStatus: row.result_status ? String(row.result_status) : null,
    costUsd: Number(row.estimated_cost_usd ?? 0),
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    cacheReadTokens: Number(row.cache_read_tokens ?? 0),
    cacheCreateTokens: Number(row.cache_creation_tokens ?? 0),
  }))

  if (rows.length === 0) return null

  return {
    mode: 'llm_usage_logs',
    window: { since: sinceIso, until: untilIso },
    ...aggregateRows(rows),
  }
}

async function fetchReportFromBatchItems(
  supabase: SupabaseClient,
  sinceIso: string,
  untilIso: string,
): Promise<ClaudeCostReport | null> {
  const { data, error } = await supabase
    .from('anthropic_batch_items')
    .select('result_imported_at, status, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, estimated_cost_usd, request_payload')
    .not('result_imported_at', 'is', null)
    .gte('result_imported_at', sinceIso)
    .lte('result_imported_at', untilIso)
    .order('result_imported_at', { ascending: false })
    .limit(10_000)

  if (error) {
    throw new Error(`anthropic_batch_items query failed: ${error.message}`)
  }

  const rows = (data ?? []).map((row) => {
    const requestPayload = (row.request_payload ?? {}) as Record<string, unknown>
    const articleContext = ((requestPayload.article_context ?? {}) as Record<string, unknown>)
    return {
      at: String(row.result_imported_at),
      operation: 'editorial_batch_result',
      sourceName: articleContext.source_name ? String(articleContext.source_name) : null,
      originalTitle: articleContext.original_title ? String(articleContext.original_title) : null,
      resultStatus: row.status ? String(row.status) : null,
      costUsd: Number(row.estimated_cost_usd ?? 0),
      inputTokens: Number(row.input_tokens ?? 0),
      outputTokens: Number(row.output_tokens ?? 0),
      cacheReadTokens: Number(row.cache_read_tokens ?? 0),
      cacheCreateTokens: Number(row.cache_creation_tokens ?? 0),
    }
  })

  if (rows.length === 0) return null

  return {
    mode: 'anthropic_batch_items',
    window: { since: sinceIso, until: untilIso },
    ...aggregateRows(rows),
  }
}

async function fetchReportFromLegacySyncRuns(
  supabase: SupabaseClient,
  sinceIso: string,
  untilIso: string,
): Promise<ClaudeCostReport> {
  const { data, error } = await supabase
    .from('enrich_runs')
    .select('started_at, error_summary')
    .eq('run_kind', 'sync')
    .gte('started_at', sinceIso)
    .lte('started_at', untilIso)
    .order('started_at', { ascending: false })
    .limit(10_000)

  if (error) {
    throw new Error(`enrich_runs legacy query failed: ${error.message}`)
  }

  const rows: CostReportEntry[] = []
  for (const row of data ?? []) {
    const summary = String(row.error_summary ?? '')
    const inputTokens = Number(summary.match(/\bin=(\d+)/)?.[1] ?? 0)
    const outputTokens = Number(summary.match(/\bout=(\d+)/)?.[1] ?? 0)
    const cacheReadTokens = Number(summary.match(/\bcache_read=(\d+)/)?.[1] ?? 0)
    const cacheCreateTokens = Number(summary.match(/\bcache_create=(\d+)/)?.[1] ?? 0)
    const costUsd = Number(summary.match(/\bcost=\$(\d+(?:\.\d+)?)/)?.[1] ?? 0)

    if (
      inputTokens === 0 &&
      outputTokens === 0 &&
      cacheReadTokens === 0 &&
      cacheCreateTokens === 0 &&
      costUsd === 0
    ) {
      continue
    }

    rows.push({
      at: String(row.started_at),
      operation: 'editorial_sync_legacy',
      sourceName: null,
      originalTitle: null,
      resultStatus: null,
      costUsd,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreateTokens,
    })
  }

  return {
    mode: 'legacy_sync_runs',
    window: { since: sinceIso, until: untilIso },
    ...aggregateRows(rows),
  }
}

export async function queryClaudeCostReport(
  supabase: SupabaseClient,
  since: Date,
  until = new Date(),
): Promise<ClaudeCostReport> {
  const sinceIso = since.toISOString()
  const untilIso = until.toISOString()

  const usageLogReport = await fetchReportFromUsageLogs(supabase, sinceIso, untilIso)
  if (usageLogReport) return usageLogReport

  const batchReport = await fetchReportFromBatchItems(supabase, sinceIso, untilIso)
  if (batchReport) return batchReport

  return fetchReportFromLegacySyncRuns(supabase, sinceIso, untilIso)
}
