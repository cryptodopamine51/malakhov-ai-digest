import type { SupabaseClient } from '@supabase/supabase-js'
import type { Article } from '../lib/supabase'
import {
  parseEditorialJson,
  validateEditorialDetailed,
  type EditorialOutput,
  type EditorialValidationContext,
  type EditorialValidationResult,
} from './claude'
import { releaseClaim } from './claims'
import { repairEditorialOutput } from './editorial-repair'
import { writeEnrichAttempt, writeMediaSanitizeAttempt } from './enrich-runtime'
import { sanitizeArticleMedia, type ArticleImageCandidate } from './media-sanitizer'
import { mirrorCoverToR2, shouldMirrorCover } from './cover-mirror'
import { articleHasCategory } from './scorer.config'
import { assertAsciiSlug, ensureUniqueSlug } from './slug'

export interface EditorialParseRepairValidation {
  output: EditorialOutput | null
  validation: EditorialValidationResult
  repairs: string[]
  error: string | null
}

export interface EditorialApplySourceContext {
  originalText: string
  coverImageUrl: string | null
  articleTables?: EditorialOutput['article_tables'] | null
  articleImages?: ArticleImageCandidate[] | { src: string; alt?: string | null }[] | null
  articleVideos?: Article['article_videos'] | null
  score: number
  mediaRejects?: unknown[]
}

export interface PreparedEditorialApplication {
  output: EditorialOutput
  validation: EditorialValidationResult
  repairs: string[]
  slug: string
  sanitizedMedia: {
    coverImageUrl: string | null
    articleImages: { src: string; alt: string }[]
  }
  articleTables: EditorialOutput['article_tables'] | null
  articleVideos: Article['article_videos'] | null
  qualityStatus: 'ok' | 'rejected'
}

export interface ApplyEditorialDirectParams {
  supabase: SupabaseClient
  article: Article
  claimToken: string | null
  attemptNo: number
  startedAt: Date
  runId: string
  model: string
  sourceContext: EditorialApplySourceContext
  prepared: PreparedEditorialApplication
  payload?: Record<string, unknown>
}

function defaultValidation(errors: string[]): EditorialValidationResult {
  return { ok: false, errors, warnings: [], riskFlags: [] }
}

export function normalizeEditorialOutput(output: EditorialOutput): EditorialOutput {
  return {
    ...output,
    glossary: Array.isArray(output.glossary) ? output.glossary : [],
    link_anchors: Array.isArray(output.link_anchors) ? output.link_anchors : [],
    article_tables: Array.isArray(output.article_tables) ? output.article_tables : [],
  }
}

export function parseRepairValidateEditorial(
  raw: string,
  validationContext: EditorialValidationContext = {},
): EditorialParseRepairValidation {
  const parsed = parseEditorialJson(raw)
  if (!parsed) {
    return {
      output: null,
      validation: defaultValidation(['editorial JSON parse failed']),
      repairs: [],
      error: 'editorial JSON parse failed',
    }
  }

  const normalized = normalizeEditorialOutput(parsed)
  const repaired = repairEditorialOutput(normalized)
  const output = normalizeEditorialOutput(repaired.output)
  const validation = validateEditorialDetailed(output, validationContext)

  return {
    output,
    validation,
    repairs: repaired.fixes,
    error: validation.ok ? null : validation.errors[0] ?? 'validation failed',
  }
}

function emptyArrayToNull<T>(value: T[] | null | undefined): T[] | null {
  return Array.isArray(value) && value.length > 0 ? value : null
}

export async function prepareEditorialApplication(params: {
  supabase: SupabaseClient
  article: Article
  output: EditorialOutput
  validation: EditorialValidationResult
  repairs: string[]
  sourceContext: EditorialApplySourceContext
  runId: string
  phase: 'collect' | 'routing'
  attemptNo: number
  startedAt: Date
  batchItemId?: string | null
}): Promise<PreparedEditorialApplication> {
  const output = normalizeEditorialOutput({
    ...params.output,
    summary: Array.isArray(params.output.summary) ? [...params.output.summary] : params.output.summary,
    glossary: Array.isArray(params.output.glossary) ? params.output.glossary.map((entry) => ({ ...entry })) : [],
    link_anchors: Array.isArray(params.output.link_anchors) ? [...params.output.link_anchors] : [],
    article_tables: Array.isArray(params.output.article_tables)
      ? params.output.article_tables.map((table) => ({
        headers: [...table.headers],
        rows: table.rows.map((row) => [...row]),
      }))
      : [],
  })

  if (articleHasCategory(params.article, 'ai-research') && output.editorial_body.length < 1500) {
    output.quality_ok = false
    output.quality_reason = `research_too_short: ${output.editorial_body.length}`
  }

  const slug = await ensureUniqueSlug(
    params.supabase,
    output.ru_title || params.article.original_title,
    params.article.id,
  )
  assertAsciiSlug(slug)

  const mediaStartedAt = new Date()
  const sanitizedMedia = sanitizeArticleMedia({
    coverImageUrl: params.sourceContext.coverImageUrl,
    articleImages: params.sourceContext.articleImages ?? params.article.article_images,
    context: {
      sourceName: params.article.source_name,
      originalUrl: params.article.original_url,
      originalTitle: params.article.original_title,
      ruTitle: output.ru_title,
      lead: output.lead,
      summary: output.summary,
      originalText: params.sourceContext.originalText || params.article.original_text,
    },
  })

  if (sanitizedMedia.rejects.length > 0) {
    await writeMediaSanitizeAttempt(params.supabase, {
      articleId: params.article.id,
      batchItemId: params.batchItemId ?? null,
      attemptNo: params.attemptNo,
      startedAt: mediaStartedAt,
      resultStatus: 'ok',
      claimToken: params.article.claim_token,
      runId: params.runId,
      phase: params.phase,
      rejects: sanitizedMedia.rejects,
      remainingMedia: {
        coverImageUrl: Boolean(sanitizedMedia.coverImageUrl),
        articleImages: sanitizedMedia.articleImages.length,
      },
    })
  }

  const generatedTables = Array.isArray(output.article_tables) && output.article_tables.length > 0
    ? output.article_tables
    : null

  // Внешние cover-URL зеркалим в R2 (WebP 1200w + варианты) — см. pipeline/cover-mirror.ts.
  // Любой сбой (нет R2-env, timeout, не картинка) — остаёмся на исходном внешнем URL.
  let coverImageUrl = sanitizedMedia.coverImageUrl
  if (shouldMirrorCover(coverImageUrl)) {
    const mirrored = await mirrorCoverToR2(params.article.id, coverImageUrl, (msg) => console.log(`[${params.runId}] ${msg}`))
    if (mirrored) coverImageUrl = mirrored
  }

  return {
    output,
    validation: params.validation,
    repairs: params.repairs,
    slug,
    sanitizedMedia: {
      coverImageUrl,
      articleImages: sanitizedMedia.articleImages,
    },
    articleTables: generatedTables ?? params.sourceContext.articleTables ?? null,
    articleVideos: params.sourceContext.articleVideos ?? null,
    qualityStatus: output.quality_ok ? 'ok' : 'rejected',
  }
}

export async function applyEditorialDirect(params: ApplyEditorialDirectParams): Promise<boolean> {
  const prepared = params.prepared
  const output = prepared.output
  const now = new Date().toISOString()
  const qualityOk = output.quality_ok === true

  const released = await releaseClaim(params.supabase, params.article.id, params.claimToken, {
    enrich_status: qualityOk ? 'enriched_ok' : 'rejected',
    publish_status: qualityOk ? 'publish_ready' : 'draft',
    publish_ready_at: qualityOk ? now : null,
    score: params.sourceContext.score,
    cover_image_url: prepared.sanitizedMedia.coverImageUrl,
    original_text: params.sourceContext.originalText,
    ru_title: output.ru_title,
    ru_text: output.editorial_body,
    lead: output.lead,
    summary: output.summary,
    card_teaser: output.card_teaser,
    tg_teaser: output.tg_teaser,
    editorial_body: output.editorial_body,
    editorial_model: params.model,
    glossary: emptyArrayToNull(output.glossary),
    link_anchors: emptyArrayToNull(output.link_anchors),
    article_tables: emptyArrayToNull(prepared.articleTables),
    article_images: emptyArrayToNull(prepared.sanitizedMedia.articleImages),
    article_videos: emptyArrayToNull(prepared.articleVideos ?? null),
    quality_ok: qualityOk,
    quality_reason: output.quality_reason || null,
    slug: prepared.slug,
    enriched: true,
    published: qualityOk,
    current_batch_item_id: null,
    last_error: null,
    last_error_code: null,
    attempt_count: params.attemptNo,
  })

  if (!released) return false

  await writeEnrichAttempt(params.supabase, {
    articleId: params.article.id,
    attemptNo: params.attemptNo,
    startedAt: params.startedAt,
    resultStatus: qualityOk ? 'ok' : 'rejected',
    claimToken: params.claimToken,
    errorCode: qualityOk ? null : 'quality_reject',
    errorMessage: qualityOk ? null : output.quality_reason || 'quality_ok=false',
    payload: {
      run_id: params.runId,
      phase: 'editorial_routing',
      model: params.model,
      validator: params.prepared.validation,
      repairs: params.prepared.repairs,
      ...(params.payload ?? {}),
    },
  })

  return true
}
