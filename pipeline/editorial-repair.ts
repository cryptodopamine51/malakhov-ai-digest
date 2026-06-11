import OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EditorialOutput } from './claude'
import {
  EDITORIAL_BANNED_PHRASES,
  getFirstSentence,
  parseEditorialJson,
  sentenceHasAnchor,
  splitSentences,
  type EditorialValidationContext,
  type EditorialValidationResult,
} from './claude'
import { addUsageTotals, writeLlmUsageLog, ZERO_USAGE_TOTALS, type UsageTotals } from './llm-usage'
import { estimateTextCostUsd, type TextUsageForCost } from './model-pricing'

export interface EditorialRepairResult {
  output: EditorialOutput
  fixes: string[]
}

export interface DeepSeekEditorialRepairParams {
  supabase: SupabaseClient
  articleId: string
  runId: string
  sourceName: string
  sourceLang: string
  originalTitle: string
  originalText: string
  output: EditorialOutput
  validation: EditorialValidationResult
  validationContext?: EditorialValidationContext
  model?: string
  runKind?: string | null
  batchItemId?: string | null
  operation?: string
  createCompletion?: (params: {
    model: string
    system: string
    user: string
  }) => Promise<{ text: string; usage: TextUsageForCost }>
}

export interface DeepSeekEditorialRepairResult {
  output: EditorialOutput | null
  rawText: string | null
  usage: UsageTotals
  costUsd: number
  error: string | null
}

const DEFAULT_DEEPSEEK_REPAIR_MODEL = 'deepseek-v4-flash'

export function repairEditorialOutput(input: EditorialOutput): EditorialRepairResult {
  const output: EditorialOutput = {
    ...input,
    summary: Array.isArray(input.summary) ? [...input.summary] : input.summary,
    glossary: Array.isArray(input.glossary) ? input.glossary.map((entry) => ({ ...entry })) : input.glossary,
    link_anchors: Array.isArray(input.link_anchors) ? [...input.link_anchors] : input.link_anchors,
    article_tables: Array.isArray(input.article_tables)
      ? input.article_tables.map((table) => ({
        headers: [...table.headers],
        rows: table.rows.map((row) => [...row]),
      }))
      : input.article_tables,
  }
  const fixes: string[] = []

  for (const field of ['ru_title', 'lead', 'card_teaser', 'tg_teaser', 'editorial_body', 'quality_reason'] as const) {
    const repaired = removeBannedPhrases(replaceStandaloneAi(output[field]))
    if (repaired !== output[field]) {
      output[field] = repaired
      fixes.push(`repair_text:${field}`)
    }
  }

  if (output.ru_title.length > 90) {
    const shortened = shortenTitle(output.ru_title)
    if (shortened !== output.ru_title) {
      output.ru_title = shortened
      fixes.push('shorten_ru_title')
    }
  }

  // Promote an anchored sentence to the front of the lead when the first
  // sentence lacks a concrete anchor (number / date / product / proper name).
  // The validator requires the anchor in the FIRST sentence; the model often
  // puts it in the second. Reordering salvages the article deterministically
  // instead of letting it fail terminally. Runs before shortenLead so the
  // anchored sentence survives any length trim.
  if (typeof output.lead === 'string') {
    const reordered = reorderLeadForAnchor(output.lead)
    if (reordered !== output.lead) {
      output.lead = reordered
      fixes.push('reorder_lead_anchor')
    }
  }

  if (output.lead.length > 400) {
    const shortened = shortenLead(output.lead)
    if (shortened !== output.lead) {
      output.lead = shortened
      fixes.push('shorten_lead')
    }
  }

  if (Array.isArray(output.summary)) {
    output.summary = output.summary.map((item, index) => {
      const repaired = removeBannedPhrases(replaceStandaloneAi(item))
      if (repaired !== item) fixes.push(`repair_text:summary.${index}`)
      return repaired
    })
  }

  if (Array.isArray(output.glossary)) {
    output.glossary = output.glossary.map((entry, index) => {
      const term = removeBannedPhrases(replaceStandaloneAi(entry.term))
      const definition = removeBannedPhrases(replaceStandaloneAi(entry.definition))
      if (term !== entry.term) fixes.push(`repair_text:glossary.${index}.term`)
      if (definition !== entry.definition) fixes.push(`repair_text:glossary.${index}.definition`)
      return { term, definition }
    })
  }

  if (Array.isArray(output.link_anchors) && typeof output.editorial_body === 'string') {
    const before = output.link_anchors.length
    output.link_anchors = output.link_anchors
      .map(replaceStandaloneAi)
      .filter((anchor) => output.editorial_body.includes(anchor))
    if (output.link_anchors.length !== before) fixes.push('drop_invalid_link_anchors')
  }

  if (typeof output.editorial_body === 'string') {
    const restored = restoreParagraphs(output.editorial_body)
    if (restored !== output.editorial_body) {
      output.editorial_body = restored
      fixes.push('restore_editorial_body_paragraphs')
    }
  }

  return { output, fixes: [...new Set(fixes)] }
}

export function buildDeepSeekEditorialRepairPrompt(params: {
  originalTitle: string
  originalText: string
  output: EditorialOutput
  errors: string[]
}): { system: string; user: string } {
  return {
    system: [
      'Ты редакционный repair-pass для Malakhov AI Digest.',
      'Исправь только перечисленные ошибки валидатора в JSON статьи.',
      'Не добавляй новые факты, которых нет в источнике. Не меняй смысл и структуру без необходимости.',
      'Верни только валидный JSON в исходной схеме, без пояснений.',
    ].join(' '),
    user: [
      `Оригинальный заголовок:\n${params.originalTitle}`,
      '',
      `Ошибки валидатора:\n${params.errors.map((error) => `- ${error}`).join('\n')}`,
      '',
      `Фрагмент источника:\n${params.originalText.replace(/\s+/g, ' ').slice(0, 6000)}`,
      '',
      'JSON статьи:',
      JSON.stringify(params.output, null, 2),
    ].join('\n'),
  }
}

export async function repairEditorialWithDeepSeek(
  params: DeepSeekEditorialRepairParams,
): Promise<DeepSeekEditorialRepairResult> {
  const model = params.model ?? process.env.DEEPSEEK_REPAIR_MODEL ?? process.env.DEEPSEEK_WRITER_MODEL ?? DEFAULT_DEEPSEEK_REPAIR_MODEL
  const prompt = buildDeepSeekEditorialRepairPrompt({
    originalTitle: params.originalTitle,
    originalText: params.originalText,
    output: params.output,
    errors: params.validation.errors,
  })
  const startedAt = new Date().toISOString()

  if (!process.env.DEEPSEEK_API_KEY && !params.createCompletion) {
    return { output: null, rawText: null, usage: ZERO_USAGE_TOTALS, costUsd: 0, error: 'DEEPSEEK_API_KEY missing' }
  }

  try {
    const completion = params.createCompletion
      ? await params.createCompletion({ model, system: prompt.system, user: prompt.user })
      : await callDeepSeekRepairCompletion(model, prompt.system, prompt.user)
    const costUsd = estimateTextCostUsd({
      provider: 'deepseek',
      model,
      usage: completion.usage,
    })
    const usage = addUsageTotals(ZERO_USAGE_TOTALS, {
      inputTokens: completion.usage.inputTokens,
      outputTokens: completion.usage.outputTokens,
      cacheReadTokens: completion.usage.cacheReadTokens,
      cacheCreateTokens: completion.usage.cacheCreateTokens,
      estimatedCostUsd: costUsd,
    })
    const parsed = completion.text ? parseEditorialJson(completion.text) : null

    await writeLlmUsageLog({
      supabase: params.supabase,
      provider: 'deepseek',
      model,
      operation: params.operation ?? 'deepseek_editorial_repair',
      runKind: params.runKind ?? 'editorial_repair',
      enrichRunId: params.runId,
      articleId: params.articleId,
      batchItemId: params.batchItemId ?? null,
      sourceName: params.sourceName,
      sourceLang: params.sourceLang,
      originalTitle: params.originalTitle,
      resultStatus: parsed ? 'ok' : 'failed',
      metadata: {
        validation_errors: params.validation.errors,
        prompt_chars: prompt.system.length + prompt.user.length,
      },
      createdAt: startedAt,
      usage,
    })

    return {
      output: parsed,
      rawText: completion.text,
      usage,
      costUsd,
      error: parsed ? null : 'repair JSON parse failed',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await writeLlmUsageLog({
      supabase: params.supabase,
      provider: 'deepseek',
      model,
      operation: params.operation ?? 'deepseek_editorial_repair',
      runKind: params.runKind ?? 'editorial_repair',
      enrichRunId: params.runId,
      articleId: params.articleId,
      batchItemId: params.batchItemId ?? null,
      sourceName: params.sourceName,
      sourceLang: params.sourceLang,
      originalTitle: params.originalTitle,
      resultStatus: 'failed',
      metadata: {
        validation_errors: params.validation.errors,
        error: message,
      },
      createdAt: startedAt,
      usage: ZERO_USAGE_TOTALS,
    })
    return { output: null, rawText: null, usage: ZERO_USAGE_TOTALS, costUsd: 0, error: message }
  }
}

async function callDeepSeekRepairCompletion(
  model: string,
  system: string,
  user: string,
): Promise<{ text: string; usage: TextUsageForCost }> {
  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    timeout: numberEnv('DEEPSEEK_REPAIR_TIMEOUT_MS', 90_000),
    maxRetries: numberEnv('DEEPSEEK_REPAIR_MAX_RETRIES', 1),
  })
  const response = await client.chat.completions.create({
    model,
    temperature: 0.1,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  } as any)

  return {
    text: response.choices[0]?.message?.content ?? '',
    usage: deepSeekUsage(response.usage),
  }
}

function deepSeekUsage(value: unknown): TextUsageForCost {
  const raw = (value ?? {}) as Record<string, unknown>
  const promptTokens = Number(raw.prompt_tokens ?? 0)
  const completionTokens = Number(raw.completion_tokens ?? 0)
  const cacheHit = Number(raw.prompt_cache_hit_tokens ?? 0)
  const cacheMiss = Number(raw.prompt_cache_miss_tokens ?? Math.max(0, promptTokens - cacheHit))
  return {
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    cacheHitInputTokens: cacheHit,
    cacheMissInputTokens: cacheMiss,
  }
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function replaceStandaloneAi(value: string): string {
  return value
    .replace(/\bAI[-‑–—](?=[\p{L}\p{N}])/giu, 'ИИ-')
    .replace(/(?<![.@])\bAI\b/giu, 'ИИ')
}

function removeBannedPhrases(value: string): string {
  let repaired = value
  for (const phrase of EDITORIAL_BANNED_PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    repaired = repaired.replace(new RegExp(`${escaped}[,:;]?\\s*`, 'giu'), '')
  }
  return repaired
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.!?;:])/g, '$1').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function shortenTitle(value: string): string {
  const normalized = value.trim()
  const splitters = [' — ', ': ', '; ']
  for (const splitter of splitters) {
    const head = normalized.split(splitter)[0]?.trim()
    if (head && head.length >= 20 && head.length <= 90) return head
  }
  if (normalized.length <= 90) return normalized
  const words = normalized.split(/\s+/)
  let result = ''
  for (const word of words) {
    const next = result ? `${result} ${word}` : word
    if (next.length > 87) break
    result = next
  }
  return result.length >= 20 ? result.replace(/[,:;.-]+$/, '') : normalized.slice(0, 87).trim()
}

function reorderLeadForAnchor(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized || sentenceHasAnchor(getFirstSentence(normalized))) return value

  const sentences = splitSentences(normalized)
  if (sentences.length < 2) return value

  const anchorIndex = sentences.findIndex((sentence) => sentenceHasAnchor(sentence))
  if (anchorIndex <= 0) return value

  const reordered = [
    sentences[anchorIndex],
    ...sentences.slice(0, anchorIndex),
    ...sentences.slice(anchorIndex + 1),
  ]
  return reordered.join(' ')
}

function shortenLead(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 400) return normalized

  const sentences = normalized
    .match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? []

  if (sentences.length > 1 && sentences[0] && sentences[0].length >= 100 && sentences[0].length <= 400) {
    return sentences[0]
  }

  let result = ''
  for (const word of normalized.split(/\s+/)) {
    const next = result ? `${result} ${word}` : word
    if (next.length > 397) break
    result = next
  }
  return result.length >= 100 ? `${result.replace(/[,:;.-]+$/, '')}.` : normalized.slice(0, 397).trim()
}

function restoreParagraphs(value: string): string {
  const paragraphs = value.split('\n\n').filter((paragraph) => paragraph.trim())
  if (paragraphs.length >= 3 || value.length < 1200) return value

  const sentences = value
    .replace(/\s+/g, ' ')
    .trim()
    .match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? []
  if (sentences.length < 6) return value

  const targetParagraphs = sentences.length >= 10 ? 5 : sentences.length >= 8 ? 4 : 3
  const perParagraph = Math.ceil(sentences.length / targetParagraphs)
  const restored: string[] = []
  for (let index = 0; index < sentences.length; index += perParagraph) {
    restored.push(sentences.slice(index, index + perParagraph).join(' '))
  }
  return restored.join('\n\n')
}
