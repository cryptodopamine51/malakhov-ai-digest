import { createClient, SupabaseClient } from '@supabase/supabase-js'

export interface Article {
  id: string
  original_url: string
  original_title: string
  original_text: string | null
  source_name: string
  source_lang: 'en' | 'ru'
  topics: string[] | null
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
  status: 'running' | 'ok' | 'partial' | 'failed'
  batch_size: number
  articles_claimed: number
  articles_enriched_ok: number
  articles_rejected: number
  articles_retryable: number
  articles_failed: number
  oldest_pending_age_minutes: number | null
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
  stage: 'enrich' | 'verify'
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

let browserClientInstance: SupabaseClient | null = null

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

export function getServerClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY

  if (!url || !key) {
    throw new Error('Supabase: отсутствуют SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL или SUPABASE_SERVICE_KEY')
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  })
}
