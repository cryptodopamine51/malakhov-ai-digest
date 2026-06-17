import Anthropic from '@anthropic-ai/sdk'
import type { Message } from '@anthropic-ai/sdk/resources/messages/messages'
import { config } from 'dotenv'
import { resolve } from 'path'
import { pathToFileURL } from 'url'

config({ path: resolve(process.cwd(), '.env.local') })
config({ path: resolve(process.cwd(), '.env') })

import { getAdminClient } from '../lib/supabase'
import {
  findDanglingTitleEnding,
  normalizeArticleTitle,
  validateArticleTitle,
} from '../pipeline/title-quality'

const DEFAULT_TITLE_FIX_MODEL = 'claude-haiku-4-5'
const PAGE_SIZE = 1000
const MAX_TITLE_FIX_ATTEMPTS = 3

interface ArticleTitleRow {
  id: string
  slug: string | null
  ru_title: string | null
  original_title: string | null
  card_teaser: string | null
  lead: string | null
  source_name: string | null
  published_at: string | null
  primary_category: string | null
}

interface TitleFixPlan {
  article: ArticleTitleRow
  replacement: string | null
  rawText: string | null
  error: string | null
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function arg(name: string): string | undefined {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
}

function textFromAnthropicMessage(message: Message): string {
  return message.content
    .map((block) => block.type === 'text' ? block.text : '')
    .filter(Boolean)
    .join('\n')
    .trim()
}

function parseTitleResponse(raw: string): { title: string | null; sourceGrounded: boolean } {
  const text = raw.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/u)
    if (!match) return { title: null, sourceGrounded: false }
    try {
      parsed = JSON.parse(match[0])
    } catch {
      return { title: null, sourceGrounded: false }
    }
  }

  const record = parsed as Record<string, unknown>
  return {
    title: typeof record.ru_title === 'string' ? record.ru_title : null,
    sourceGrounded: record.source_grounded === true,
  }
}

function shortenTitleCandidate(value: string): string {
  const title = normalizeArticleTitle(value).replace(/[\s"'«»“”‘’.,:;!?…()[\]{}]+$/u, '')
  if (title.length <= 90) return title

  const hardBreak = title
    .split(/\s*[:;]\s*/u)[0]
    ?.trim()
  if (hardBreak && hardBreak.length >= 20 && hardBreak.length <= 90) return hardBreak

  const softBreak = title
    .split(/\s+[—-]\s+/u)
    .slice(0, 2)
    .join(' — ')
    .trim()
  if (softBreak.length >= 20 && softBreak.length <= 90) return softBreak

  const words = title.split(/\s+/u)
  let out = ''
  for (const word of words) {
    const next = out ? `${out} ${word}` : word
    if (next.length > 90) break
    out = next
  }
  return normalizeArticleTitle(out)
}

function buildDeterministicFallback(article: ArticleTitleRow): string | null {
  const candidates = [
    article.card_teaser,
    article.lead?.split(/(?<=[.!?])\s+/u)[0] ?? null,
    article.ru_title ? article.ru_title.replace(/\s+\S+\s*$/u, '') : null,
  ]

  for (const candidate of candidates) {
    const title = shortenTitleCandidate(candidate ?? '')
    const validation = validateArticleTitle(title)
    if (validation.ok && title !== normalizeArticleTitle(article.ru_title)) return title
  }

  return null
}

async function loadLiveArticles(): Promise<ArticleTitleRow[]> {
  const supabase = getAdminClient()
  const rows: ArticleTitleRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('articles')
      .select('id,slug,ru_title,original_title,card_teaser,lead,source_name,published_at,primary_category')
      .eq('published', true)
      .eq('quality_ok', true)
      .eq('verified_live', true)
      .eq('publish_status', 'live')
      .not('ru_title', 'is', null)
      .order('published_at', { ascending: false, nullsFirst: false })
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw new Error(`articles query failed: ${error.message}`)
    rows.push(...((data ?? []) as ArticleTitleRow[]))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}

function buildTitleFixPrompt(
  article: ArticleTitleRow,
  previousError: string | null = null,
  previousTitle: string | null = null,
): { system: string; user: string } {
  const retryBlock = previousError
    ? [
        '',
        'Предыдущая попытка не прошла автоматическую проверку.',
        `Ошибка: ${previousError}`,
        previousTitle ? `Предыдущий вариант: ${previousTitle}` : null,
        'Сгенерируй новый вариант, который точно проходит все требования.',
      ].filter(Boolean)
    : []

  return {
    system: [
      'Ты выпускающий редактор Malakhov AI Digest.',
      'Нужно исправить только русский заголовок статьи.',
      'Сохрани смысл, не добавляй факты, которых нет в данных ниже.',
      'Верни только JSON.',
    ].join(' '),
    user: [
      'Текущий заголовок оборван на служебном слове. Перепиши его как законченный русский заголовок.',
      'Требования: 20-90 символов, целевой диапазон 55-80 символов, без точки в конце, без кликбейта, не заканчивается на предлог или союз.',
      'Заголовок должен быть грамматически корректным и звучать как редакционный русский: исправляй падежи, не копируй ошибочную конструкцию из текущего заголовка.',
      'Проверяй управление предлогов: например, правильно "в кибероперациях", а не "в киберопераций".',
      'Не меняй URL/slug и не придумывай новые сущности.',
      '',
      `Источник: ${article.source_name ?? 'не указан'}`,
      `Текущий ru_title: ${article.ru_title ?? ''}`,
      `Original title: ${article.original_title ?? ''}`,
      `Card teaser: ${article.card_teaser ?? ''}`,
      `Lead: ${article.lead ?? ''}`,
      ...retryBlock,
      '',
      'Верни JSON строго такого вида:',
      '{"ru_title":"исправленный заголовок","source_grounded":true}',
    ].join('\n'),
  }
}

async function generateReplacement(article: ArticleTitleRow, anthropic: Anthropic, model: string): Promise<TitleFixPlan> {
  let previousError: string | null = null
  let previousTitle: string | null = null
  let lastRawText: string | null = null

  for (let attempt = 1; attempt <= MAX_TITLE_FIX_ATTEMPTS; attempt += 1) {
    const prompt = buildTitleFixPrompt(article, previousError, previousTitle)
    try {
      const message = await anthropic.messages.create({
        model,
        max_tokens: 300,
        temperature: 0,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
      })
      const rawText = textFromAnthropicMessage(message as Message)
      lastRawText = rawText
      const parsed = parseTitleResponse(rawText)
      if (!parsed.sourceGrounded) {
        previousError = 'source_grounded is not true'
        previousTitle = parsed.title
        continue
      }

      const title = normalizeArticleTitle(parsed.title)
      const validation = validateArticleTitle(title)
      if (!validation.ok) {
        previousError = validation.error ?? 'invalid title'
        previousTitle = title
        continue
      }
      if (title === normalizeArticleTitle(article.ru_title)) {
        previousError = 'replacement is unchanged'
        previousTitle = title
        continue
      }

      return { article, replacement: title, rawText, error: null }
    } catch (error) {
      return {
        article,
        replacement: null,
        rawText: lastRawText,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  const fallback = buildDeterministicFallback(article)
  return { article, replacement: fallback, rawText: lastRawText, error: fallback ? null : previousError ?? 'failed to generate valid title' }
}

async function applyReplacement(plan: TitleFixPlan): Promise<void> {
  if (!plan.replacement) throw new Error(`no replacement for ${plan.article.slug ?? plan.article.id}`)
  const supabase = getAdminClient()
  const { data, error } = await supabase
    .from('articles')
    .update({
      ru_title: plan.replacement,
      updated_at: new Date().toISOString(),
    })
    .eq('id', plan.article.id)
    .eq('ru_title', plan.article.ru_title)
    .select('id')

  if (error) throw new Error(`title update failed for ${plan.article.slug ?? plan.article.id}: ${error.message}`)
  if (!data?.length) throw new Error(`title update affected 0 rows for ${plan.article.slug ?? plan.article.id}`)
}

function printPlan(plan: TitleFixPlan): void {
  const slug = plan.article.slug ?? plan.article.id
  const dangling = findDanglingTitleEnding(plan.article.ru_title)
  if (plan.replacement) {
    console.log(`[accept] ${slug}`)
    console.log(`  from: ${plan.article.ru_title}`)
    console.log(`  to:   ${plan.replacement}`)
    return
  }

  console.log(`[reject] ${slug} (${dangling ?? 'n/a'}): ${plan.error ?? 'unknown error'}`)
  console.log(`  from: ${plan.article.ru_title}`)
  if (plan.rawText) console.log(`  raw:  ${plan.rawText.replace(/\s+/g, ' ').slice(0, 240)}`)
}

async function main(): Promise<void> {
  const dryRun = hasFlag('dry-run')
  const apply = hasFlag('apply')
  const detectOnly = hasFlag('detect-only')
  if ([dryRun, apply, detectOnly].filter(Boolean).length !== 1) {
    throw new Error('Pass exactly one of --dry-run, --apply, --detect-only')
  }

  const limit = arg('limit') ? Number(arg('limit')) : null
  const onlySlug = arg('slug')
  const allRows = await loadLiveArticles()
  let broken = allRows.filter((article) => findDanglingTitleEnding(article.ru_title))
  if (onlySlug) broken = broken.filter((article) => article.slug === onlySlug)
  if (limit && Number.isFinite(limit) && limit > 0) broken = broken.slice(0, limit)

  console.log(`[titles-fix] scanned=${allRows.length} broken=${broken.length}${onlySlug ? ` slug=${onlySlug}` : ''}`)
  if (detectOnly || broken.length === 0) {
    for (const article of broken) {
      console.log(`[broken] ${article.slug ?? article.id}: ${article.ru_title}`)
    }
    return
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing')

  const model = arg('model') ?? process.env.TITLE_FIX_MODEL ?? DEFAULT_TITLE_FIX_MODEL
  const anthropic = new Anthropic({ apiKey })
  const plans: TitleFixPlan[] = []
  for (const article of broken) {
    const plan = await generateReplacement(article, anthropic, model)
    plans.push(plan)
    printPlan(plan)
  }

  const accepted = plans.filter((plan) => plan.replacement)
  const rejected = plans.filter((plan) => !plan.replacement)
  console.log(`[titles-fix] accepted=${accepted.length} rejected=${rejected.length} mode=${apply ? 'apply' : 'dry-run'}`)

  if (rejected.length > 0) {
    throw new Error(`Rejected ${rejected.length} generated title replacement(s); not applying partial backfill`)
  }

  if (apply) {
    for (const plan of accepted) {
      await applyReplacement(plan)
      console.log(`[updated] ${plan.article.slug ?? plan.article.id}`)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
