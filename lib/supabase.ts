import { createClient, SupabaseClient } from '@supabase/supabase-js'

export interface Article {
  id: string
  original_url: string
  original_title: string
  original_text: string | null
  source_name: string
  source_lang: 'en' | 'ru'
  topics: string[] | null
  primary_category: string
  secondary_categories: string[]
  pub_date: string | null
  cover_image_url: string | null
  ru_title: string | null
  ru_text: string | null
  why_it_matters: string | null
  // Content engine v2
  lead: string | null
  summary: string[] | null
  card_teaser: string | null
  tg_teaser: string | null
  editorial_body: string | null
  editorial_model: string | null
  glossary: { term: string; definition: string }[] | null
  link_anchors: string[] | null
  article_tables: { headers: string[]; rows: string[][] }[] | null
  article_images: { src: string; alt: string }[] | null
  article_videos?: {
    provider: 'youtube' | 'vimeo' | 'rutube' | 'vk' | 'direct'
    embedUrl: string
    sourceUrl: string
    title: string | null
    poster: string | null
  }[] | null
  quality_ok: boolean
  quality_reason: string | null
  // Legacy flags (kept for backward compat, new code uses status fields)
  dedup_hash: string | null
  enriched: boolean
  published: boolean
  tg_sent: boolean
  score: number
  slug: string | null
  created_at: string
  updated_at: string
  // Pipeline reliability fields (migration 005)
  ingest_status: IngestStatus
  enrich_status: EnrichStatus
  publish_status: PublishStatus
  first_seen_at: string
  last_seen_at: string
  discover_count: number
  attempt_count: number
  processing_started_at: string | null
  processing_finished_at: string | null
  processing_by: string | null
  claim_token: string | null
  lease_expires_at: string | null
  last_error: string | null
  last_error_code: string | null
  next_retry_at: string | null
  publish_ready_at: string | null
  verified_live: boolean | null
  verified_live_at: string | null
  live_check_error: string | null
  current_batch_item_id: string | null
}

export type ArticleInsert = Omit<Article, 'id' | 'created_at' | 'updated_at'>

export type IngestStatus = 'ingested' | 'ingest_failed'

export type EnrichStatus =
  | 'pending'
  | 'processing'
  | 'retry_wait'
  | 'enriched_ok'
  | 'rejected'
  | 'failed'
  | 'stuck'

export type PublishStatus =
  | 'draft'
  | 'publish_ready'
  | 'verifying'
  | 'live'
  | 'verification_failed'
  | 'withdrawn'

export interface IngestRun {
  id: string
  started_at: string
  finished_at: string | null
  status: 'running' | 'ok' | 'partial' | 'failed'
  feeds_total: number
  feeds_failed: number
  items_seen: number
  items_inserted: number
  items_duplicates: number
  items_failed: number
  error_summary: string | null
}

export interface EnrichRun {
  id: string
  started_at: string
  finished_at: string | null
  run_kind: 'sync' | 'batch_submit' | 'batch_collect'
  status: 'running' | 'ok' | 'partial' | 'failed'
  batch_size: number
  articles_claimed: number
  articles_enriched_ok: number
  articles_rejected: number
  articles_retryable: number
  articles_failed: number
  oldest_pending_age_minutes: number | null
  total_input_tokens: number
  total_output_tokens: number
  total_cache_read_tokens: number
  total_cache_creation_tokens: number
  estimated_cost_usd: number
  error_summary: string | null
}

export interface SourceRun {
  id: string
  ingest_run_id: string | null
  source_name: string
  started_at: string
  finished_at: string | null
  status: 'ok' | 'empty' | 'failed'
  items_seen: number
  items_new: number
  items_duplicates: number
  http_status: number | null
  error_message: string | null
  response_time_ms: number | null
}

export interface PipelineAlert {
  id: string
  alert_type: string
  severity: 'info' | 'warning' | 'critical'
  status: 'open' | 'resolved' | 'suppressed'
  entity_key: string | null
  dedupe_key: string
  message: string
  payload: Record<string, unknown>
  occurrence_count: number
  first_seen_at: string
  last_seen_at: string
  cooldown_until: string | null
  created_at: string
  resolved_at: string | null
}

export interface ArticleAttempt {
  id: string
  article_id: string
  batch_item_id: string | null
  stage: 'enrich' | 'verify' | 'verify_sample'
  attempt_no: number
  worker_id: string | null
  claim_token: string | null
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  result_status: 'ok' | 'retryable' | 'rejected' | 'failed'
  error_code: string | null
  error_message: string | null
  payload: Record<string, unknown>
}

export type AnthropicBatchStatus = 'submitted' | 'completed' | 'partial' | 'failed' | 'canceled'

export type AnthropicBatchProcessingStatus = 'in_progress' | 'canceling' | 'ended'

export type AnthropicBatchItemStatus =
  | 'queued_for_batch'
  | 'batch_submitted'
  | 'batch_processing'
  | 'batch_result_ready'
  | 'applying'
  | 'applied'
  | 'batch_failed'
  | 'apply_failed_retriable'
  | 'apply_failed_terminal'

export type AnthropicBatchResultType = 'succeeded' | 'errored' | 'expired' | 'canceled'

export interface AnthropicBatch {
  id: string
  run_id: string | null
  provider_batch_id: string
  status: AnthropicBatchStatus
  processing_status: AnthropicBatchProcessingStatus
  created_at: string
  submitted_at: string
  finished_at: string | null
  expires_at: string | null
  archived_at: string | null
  cancel_initiated_at: string | null
  results_url: string | null
  last_polled_at: string | null
  poll_attempts: number
  request_count: number
  success_count: number
  failed_count: number
  errored_count: number
  expired_count: number
  canceled_count: number
  total_input_tokens: number
  total_output_tokens: number
  total_cache_read_tokens: number
  total_cache_creation_tokens: number
  estimated_cost_usd: number
  error_summary: string | null
  created_by: string | null
  updated_at: string
}

export interface AnthropicBatchItem {
  id: string
  batch_id: string | null
  article_id: string
  request_custom_id: string
  status: AnthropicBatchItemStatus
  result_type: AnthropicBatchResultType | null
  error_code: string | null
  error_message: string | null
  request_payload: Record<string, unknown>
  response_payload: Record<string, unknown> | null
  submitted_at: string | null
  result_imported_at: string | null
  applied_at: string | null
  apply_attempts: number
  last_apply_error: string | null
  last_apply_error_code: string | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  estimated_cost_usd: number
  created_at: string
  updated_at: string
}

export interface LlmUsageLog {
  id: string
  provider: string
  model: string
  operation: string
  run_kind: string | null
  enrich_run_id: string | null
  article_id: string | null
  batch_item_id: string | null
  source_name: string | null
  source_lang: string | null
  original_title: string | null
  result_status: string | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  estimated_cost_usd: number
  metadata: Record<string, unknown>
  created_at: string
}

let browserClientInstance: SupabaseClient | null = null
let publicReadClientInstance: SupabaseClient | null = null

export function getBrowserClient(): SupabaseClient {
  if (browserClientInstance) return browserClientInstance

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error('Supabase: отсутствуют SUPABASE_URL или SUPABASE_ANON_KEY')
  }

  browserClientInstance = createClient(url, key)
  return browserClientInstance
}

export function getPublicReadClient(): SupabaseClient {
  if (publicReadClientInstance) return publicReadClientInstance

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error('Supabase: NEXT_PUBLIC_SUPABASE_URL или NEXT_PUBLIC_SUPABASE_ANON_KEY не заданы')
  }

  publicReadClientInstance = createClient(url, key, {
    auth: { persistSession: false },
  })
  return publicReadClientInstance
}

export function getAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY

  if (!url || !key) {
    throw new Error('Supabase: отсутствуют SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL или SUPABASE_SERVICE_KEY')
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  })
}

export const getServerClient = getAdminClient
