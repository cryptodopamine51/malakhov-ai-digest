import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { config, parse as parseDotenv } from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import type { Message } from '@anthropic-ai/sdk/resources/messages/messages'
import OpenAI from 'openai'

config({ path: resolve(process.cwd(), '.env.local') })
config({ path: resolve(process.cwd(), '.env') })
loadExtraEnv(resolve(process.cwd(), 'malakhov-ai-keys.env'))

import { getServerClient } from '../lib/supabase'
import {
  buildEditorialSystemPrompt,
  buildEditorialUserMessage,
  parseEditorialJson,
  validateEditorial,
  type EditorialOutput,
  type EditorialRequest,
} from '../pipeline/claude'
import { fetchArticleContent } from '../pipeline/fetcher'
import { estimateTextCostUsd, type TextProvider, type TextUsageForCost } from '../pipeline/model-pricing'

type Mode = 'claude-full' | 'deepseek-full' | 'hybrid'

interface Args {
  apply: boolean
  limit: number
  modes: Mode[]
  slugs: string[]
  outDir: string
  claudeModel: string
  deepseekModel: string
  missingCoverOnly: boolean
}

interface ArticleRow {
  id: string
  slug: string | null
  original_url: string
  original_title: string
  original_text: string | null
  source_name: string
  source_lang: 'en' | 'ru'
  topics: string[] | null
  primary_category: string | null
  secondary_categories: string[] | null
  cover_image_url: string | null
  ru_title: string | null
  editorial_body: string | null
  score: number | null
  created_at: string
}

interface StepResult {
  provider: TextProvider
  model: string
  operation: string
  usage: TextUsageForCost
  estimatedCostUsd: number
  status: 'ok' | 'failed'
  error?: string
}

interface ModeResult {
  mode: Mode
  status: 'planned' | 'ok' | 'failed'
  validationError: string | null
  qualityOk: boolean | null
  outputPath: string | null
  totalCostUsd: number
  steps: StepResult[]
  error?: string
}

interface ArticleReport {
  article: {
    id: string
    slug: string | null
    title: string
    source: string
    category: string | null
    hasCover: boolean
    textChars: number
  }
  modes: ModeResult[]
}

const args = parseArgs()

function loadExtraEnv(path: string): void {
  if (!existsSync(path)) return

  const raw = readFileSync(path, 'utf8')
  const parsed = safeParseEnv(raw)
  if (/^\\{\\rtf/.test(raw)) {
    try {
      const plain = execFileSync('textutil', ['-convert', 'txt', '-stdout', path], { encoding: 'utf8' })
      Object.assign(parsed, safeParseEnv(plain))
    } catch {
      // Raw RTF often still contains plain KEY=value runs; use those if textutil is unavailable.
    }
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (!process.env[key]) process.env[key] = value
  }
}

function safeParseEnv(text: string): Record<string, string> {
  const parsed: Record<string, string> = {}
  Object.assign(parsed, parseDotenv(text))

  const keyValueRe = /([A-Z][A-Z0-9_]{2,})=([^\\\r\n{}]+)/g
  for (const match of text.matchAll(keyValueRe)) {
    const key = match[1]
    const value = match[2].trim().replace(/^["']|["']$/g, '')
    if (key && value) parsed[key] = value
  }
  return parsed
}

function parseArgs(): Args {
  const flags = new Map<string, string | boolean>()
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--') && arg.includes('=')) {
      const raw = arg.slice(2)
      const idx = raw.indexOf('=')
      flags.set(raw.slice(0, idx), raw.slice(idx + 1))
    } else if (arg.startsWith('--')) {
      flags.set(arg.slice(2), true)
    }
  }

  const modes = String(flags.get('modes') ?? 'claude-full,deepseek-full,hybrid')
    .split(',')
    .map((mode) => mode.trim())
    .filter((mode): mode is Mode => mode === 'claude-full' || mode === 'deepseek-full' || mode === 'hybrid')

  return {
    apply: flags.has('apply'),
    limit: numberFlag(flags, 'limit', 3),
    modes: modes.length ? modes : ['claude-full', 'deepseek-full', 'hybrid'],
    slugs: String(flags.get('slugs') ?? '')
      .split(',')
      .map((slug) => slug.trim())
      .filter(Boolean),
    outDir: resolve(process.cwd(), String(flags.get('out-dir') ?? `tmp/model-routing-lab-${Date.now()}`)),
    claudeModel: String(flags.get('claude-model') ?? process.env.CLAUDE_EDITORIAL_MODEL ?? 'claude-sonnet-4-6'),
    deepseekModel: String(flags.get('deepseek-model') ?? process.env.DEEPSEEK_WRITER_MODEL ?? 'deepseek-v4-flash'),
    missingCoverOnly: flags.has('missing-cover-only'),
  }
}

function numberFlag(flags: Map<string, string | boolean>, name: string, fallback: number): number {
  const raw = flags.get(name)
  const value = typeof raw === 'string' ? Number(raw) : fallback
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function roundUsd(value: number): number {
  return Number(value.toFixed(6))
}

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function safeName(value: string | null, fallback: string): string {
  return (value || fallback).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100)
}

function usageCost(provider: TextProvider, model: string, usage: TextUsageForCost): number {
  return estimateTextCostUsd({ provider, model, usage })
}

function plannedStep(
  provider: TextProvider,
  model: string,
  operation: string,
  inputText: string,
  outputTokens: number,
): StepResult {
  const usage = {
    inputTokens: approxTokens(inputText),
    outputTokens,
  }
  return {
    provider,
    model,
    operation,
    usage,
    estimatedCostUsd: usageCost(provider, model, usage),
    status: 'ok',
  }
}

function plannedResult(mode: Mode, steps: StepResult[]): ModeResult {
  return {
    mode,
    status: 'planned',
    validationError: null,
    qualityOk: null,
    outputPath: null,
    totalCostUsd: roundUsd(steps.reduce((sum, step) => sum + step.estimatedCostUsd, 0)),
    steps,
  }
}

function extractAnthropicText(message: Pick<Message, 'content'>): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { text: string }).text)
    .join('\n')
}

function anthropicUsage(message: Pick<Message, 'usage'>): TextUsageForCost {
  const raw = message.usage as unknown as Record<string, number>
  return {
    inputTokens: raw.input_tokens ?? 0,
    outputTokens: raw.output_tokens ?? 0,
    cacheReadTokens: raw.cache_read_input_tokens ?? 0,
    cacheCreateTokens: raw.cache_creation_input_tokens ?? 0,
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

function requestFor(article: ArticleRow, originalText: string): EditorialRequest {
  return {
    originalTitle: article.original_title,
    originalText,
    sourceName: article.source_name,
    sourceLang: article.source_lang,
    topics: article.topics ?? [],
    primaryCategory: article.primary_category,
    secondaryCategories: article.secondary_categories ?? [],
  }
}

async function selectArticles(): Promise<ArticleRow[]> {
  const supabase = getServerClient()
  let query = supabase
    .from('articles')
    .select('id, slug, original_url, original_title, original_text, source_name, source_lang, topics, primary_category, secondary_categories, cover_image_url, ru_title, editorial_body, score, created_at')
    .eq('quality_ok', true)
    .not('slug', 'is', null)
    .order('created_at', { ascending: false })
    .limit(Math.max(args.limit * 5, 30))

  if (args.slugs.length) query = query.in('slug', args.slugs)
  if (args.missingCoverOnly) query = query.is('cover_image_url', null)

  const { data, error } = await query
  if (error) throw new Error(`article query failed: ${error.message}`)

  const rows = ((data ?? []) as ArticleRow[]).slice(0, args.limit)
  if (args.slugs.length) {
    const order = new Map(args.slugs.map((slug, index) => [slug, index]))
    rows.sort((a, b) => (order.get(a.slug ?? '') ?? 0) - (order.get(b.slug ?? '') ?? 0))
  }
  return rows
}

async function hydrateText(article: ArticleRow): Promise<string> {
  if (article.original_text && article.original_text.trim().length > 500) return article.original_text
  const fetched = await fetchArticleContent(article.original_url)
  return fetched.text || article.original_text || article.editorial_body || ''
}

function outputResult(
  article: ArticleRow,
  mode: Mode,
  output: EditorialOutput | null,
  steps: StepResult[],
): ModeResult {
  const validationError = output ? validateEditorial(output) : 'missing output'
  const filename = `${safeName(article.slug, article.id)}-${mode}.json`
  const outputPath = output ? join(args.outDir, filename) : null
  if (output && outputPath) writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`)

  return {
    mode,
    status: validationError ? 'failed' : 'ok',
    validationError,
    qualityOk: output?.quality_ok ?? null,
    outputPath,
    totalCostUsd: roundUsd(steps.reduce((sum, step) => sum + step.estimatedCostUsd, 0)),
    steps,
  }
}

async function runClaudeFull(article: ArticleRow, originalText: string): Promise<ModeResult> {
  const request = requestFor(article, originalText)
  const params = {
    model: args.claudeModel,
    max_tokens: 4000,
    temperature: 0.4,
    system: buildEditorialSystemPrompt(),
    messages: [{ role: 'user' as const, content: buildEditorialUserMessage(request) }],
  }

  if (!args.apply) {
    return plannedResult('claude-full', [
      plannedStep('anthropic', args.claudeModel, 'claude_full_article', `${params.system}\n${params.messages[0].content}`, 2800),
    ])
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const message = await client.messages.create(params as any) as Message
  const usage = anthropicUsage(message)
  const step: StepResult = {
    provider: 'anthropic',
    model: args.claudeModel,
    operation: 'claude_full_article',
    usage,
    estimatedCostUsd: usageCost('anthropic', args.claudeModel, usage),
    status: 'ok',
  }
  return outputResult(article, 'claude-full', parseEditorialJson(extractAnthropicText(message)), [step])
}

function deepSeekClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DEE PSEEK_API_KEY is missing'.replace('DEE PSEEK', 'DEEPSEEK'))
  return new OpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
  })
}

function validateApplyEnv(): void {
  if (!args.apply) return

  const needsDeepSeek = args.modes.some((mode) => mode === 'deepseek-full' || mode === 'hybrid')
  const needsAnthropic = args.modes.some((mode) => mode === 'claude-full' || mode === 'hybrid')

  if (needsDeepSeek && !process.env.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY is missing')
  }
  if (needsAnthropic && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is missing')
  }
}

async function deepSeekJson(params: {
  operation: string
  system: string
  user: string
  maxTokens: number
}): Promise<{ text: string; step: StepResult }> {
  const client = deepSeekClient()
  const response = await client.chat.completions.create({
    model: args.deepseekModel,
    temperature: 0.4,
    max_tokens: params.maxTokens,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: params.system },
      { role: 'user', content: params.user },
    ],
  } as any)

  const usage = deepSeekUsage(response.usage)
  const text = response.choices[0]?.message?.content ?? ''
  return {
    text,
    step: {
      provider: 'deepseek',
      model: args.deepseekModel,
      operation: params.operation,
      usage,
      estimatedCostUsd: usageCost('deepseek', args.deepseekModel, usage),
      status: text ? 'ok' : 'failed',
      error: text ? undefined : 'empty response',
    },
  }
}

async function runDeepSeekFull(article: ArticleRow, originalText: string): Promise<ModeResult> {
  const request = requestFor(article, originalText)
  const system = buildEditorialSystemPrompt()
  const user = buildEditorialUserMessage(request)

  if (!args.apply) {
    return plannedResult('deepseek-full', [
      plannedStep('deepseek', args.deepseekModel, 'deepseek_full_article', `${system}\n${user}`, 2800),
    ])
  }

  const { text, step } = await deepSeekJson({
    operation: 'deepseek_full_article',
    system,
    user,
    maxTokens: 4000,
  })

  return outputResult(article, 'deepseek-full', parseEditorialJson(text), [step])
}

function orchestratorPrompt(article: ArticleRow, originalText: string): { system: string; user: string } {
  return {
    system:
      'You are an editorial planning desk for Malakhov AI Digest. Produce compact JSON only. ' +
      'Do not write the article. Extract the strongest angle, must-use facts, risks, and context gaps for a Russian AI-news article.',
    user:
      `Source: ${article.source_name}\n` +
      `Title: ${article.original_title}\n` +
      `Categories: ${[article.primary_category, ...(article.secondary_categories ?? [])].filter(Boolean).join(', ')}\n\n` +
      `Source text:\n${originalText.slice(0, 9000)}\n\n` +
      'Return JSON: {"angle":string,"must_include_facts":string[],"context_to_add":string[],"fact_risks":string[],"style_notes":string[],"image_brief":string}.',
  }
}

function draftFromBriefPrompt(article: ArticleRow, originalText: string, briefJson: string): { system: string; user: string } {
  return {
    system: buildEditorialSystemPrompt(),
    user:
      'Use this editorial brief as planning context, but preserve the required final JSON schema.\n\n' +
      `Brief JSON:\n${briefJson}\n\n` +
      buildEditorialUserMessage(requestFor(article, originalText)),
  }
}

function polishPrompt(article: ArticleRow, originalText: string, draftJson: string): { system: string; user: string } {
  return {
    system:
      buildEditorialSystemPrompt() +
      '\n\nYou are now the final reviewer. Polish the supplied draft into publication-ready JSON. ' +
      'Fix Russian style, remove banned phrasing, keep only source-supported facts, and return the same JSON schema only.',
    user:
      `Original source title: ${article.original_title}\n` +
      `Original source excerpt:\n${originalText.slice(0, 7000)}\n\n` +
      `Draft JSON:\n${draftJson}`,
  }
}

async function runHybrid(article: ArticleRow, originalText: string): Promise<ModeResult> {
  const orch = orchestratorPrompt(article, originalText)

  if (!args.apply) {
    const plannedOrchestrator = plannedStep('anthropic', args.claudeModel, 'claude_orchestrator_brief', `${orch.system}\n${orch.user}`, 700)
    const plannedDraft = plannedStep('deepseek', args.deepseekModel, 'deepseek_draft_from_brief', `${buildEditorialSystemPrompt()}\n${originalText}`, 2800)
    const plannedPolish = plannedStep('anthropic', args.claudeModel, 'claude_polish_deepseek_draft', `${buildEditorialSystemPrompt()}\n${originalText}`, 2600)
    return plannedResult('hybrid', [plannedOrchestrator, plannedDraft, plannedPolish])
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const briefMessage = await anthropic.messages.create({
    model: args.claudeModel,
    max_tokens: 900,
    temperature: 0.2,
    system: orch.system,
    messages: [{ role: 'user', content: orch.user }],
  } as any) as Message
  const briefUsage = anthropicUsage(briefMessage)
  const briefText = extractAnthropicText(briefMessage)
  const steps: StepResult[] = [{
    provider: 'anthropic',
    model: args.claudeModel,
    operation: 'claude_orchestrator_brief',
    usage: briefUsage,
    estimatedCostUsd: usageCost('anthropic', args.claudeModel, briefUsage),
    status: briefText ? 'ok' : 'failed',
    error: briefText ? undefined : 'empty brief',
  }]

  const draftPrompt = draftFromBriefPrompt(article, originalText, briefText)
  const draft = await deepSeekJson({
    operation: 'deepseek_draft_from_brief',
    system: draftPrompt.system,
    user: draftPrompt.user,
    maxTokens: 4000,
  })
  steps.push(draft.step)

  const polish = polishPrompt(article, originalText, draft.text)
  const polishMessage = await anthropic.messages.create({
    model: args.claudeModel,
    max_tokens: 4000,
    temperature: 0.2,
    system: polish.system,
    messages: [{ role: 'user', content: polish.user }],
  } as any) as Message
  const polishUsage = anthropicUsage(polishMessage)
  steps.push({
    provider: 'anthropic',
    model: args.claudeModel,
    operation: 'claude_polish_deepseek_draft',
    usage: polishUsage,
    estimatedCostUsd: usageCost('anthropic', args.claudeModel, polishUsage),
    status: 'ok',
  })

  return outputResult(article, 'hybrid', parseEditorialJson(extractAnthropicText(polishMessage)), steps)
}

async function runMode(article: ArticleRow, originalText: string, mode: Mode): Promise<ModeResult> {
  try {
    if (mode === 'claude-full') return await runClaudeFull(article, originalText)
    if (mode === 'deepseek-full') return await runDeepSeekFull(article, originalText)
    return await runHybrid(article, originalText)
  } catch (error) {
    return {
      mode,
      status: 'failed',
      validationError: null,
      qualityOk: null,
      outputPath: null,
      totalCostUsd: 0,
      steps: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function main(): Promise<void> {
  validateApplyEnv()
  mkdirSync(args.outDir, { recursive: true })
  const articles = await selectArticles()
  const reports: ArticleReport[] = []

  console.log(JSON.stringify({
    mode: args.apply ? 'apply' : 'dry-run',
    limit: args.limit,
    modes: args.modes,
    claude_model: args.claudeModel,
    deepseek_model: args.deepseekModel,
    out_dir: args.outDir,
    selected: articles.map((article) => ({
      slug: article.slug,
      title: article.ru_title ?? article.original_title,
      source: article.source_name,
      category: article.primary_category,
      has_cover: Boolean(article.cover_image_url),
    })),
  }, null, 2))

  for (const [index, article] of articles.entries()) {
    const originalText = await hydrateText(article)
    console.log(`\nARTICLE ${index + 1}/${articles.length}: ${article.slug ?? article.id}`)
    const modes: ModeResult[] = []

    for (const mode of args.modes) {
      console.log(`  ${args.apply ? 'run' : 'plan'} ${mode}`)
      const result = await runMode(article, originalText, mode)
      modes.push(result)
      console.log(`    ${result.status} cost=$${result.totalCostUsd.toFixed(6)}${result.error ? ` error=${result.error}` : ''}`)
    }

    reports.push({
      article: {
        id: article.id,
        slug: article.slug,
        title: article.ru_title ?? article.original_title,
        source: article.source_name,
        category: article.primary_category,
        hasCover: Boolean(article.cover_image_url),
        textChars: originalText.length,
      },
      modes,
    })
  }

  const totalsByMode = new Map<Mode, { count: number; cost: number; ok: number }>()
  for (const report of reports) {
    for (const mode of report.modes) {
      const current = totalsByMode.get(mode.mode) ?? { count: 0, cost: 0, ok: 0 }
      current.count += 1
      current.cost = roundUsd(current.cost + mode.totalCostUsd)
      if (mode.status === 'ok' || mode.status === 'planned') current.ok += 1
      totalsByMode.set(mode.mode, current)
    }
  }

  const finalReport = {
    generated_at: new Date().toISOString(),
    execution_mode: args.apply ? 'apply' : 'dry-run',
    pricing_note:
      'Dry-run token counts are approximate. Apply mode uses provider usage from API responses and current local pricing constants.',
    totals_by_mode: Object.fromEntries(totalsByMode.entries()),
    articles: reports,
  }

  const reportPath = join(args.outDir, 'report.json')
  writeFileSync(reportPath, `${JSON.stringify(finalReport, null, 2)}\n`)
  console.log(`\nreport: ${reportPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
