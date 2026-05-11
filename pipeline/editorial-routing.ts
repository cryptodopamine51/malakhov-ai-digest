import type { EditorialOutput, EditorialRequest, EditorialValidationResult } from './claude'

export type EditorialRoutingMode = 'cheap' | 'balanced' | 'premium'
export type EditorialWriterProvider = 'deepseek' | 'anthropic'
export type EditorialReviewPolicy = 'none' | 'selective' | 'always'

export interface EditorialRoutingConfig {
  mode: EditorialRoutingMode
  writerProvider: EditorialWriterProvider
  reviewPolicy: EditorialReviewPolicy
}

export interface ArticleRoutingContext {
  sourceName: string
  originalTitle: string
  originalText: string
  topics: string[]
  primaryCategory?: string | null
  secondaryCategories?: string[] | null
  score?: number | null
  hasCover?: boolean | null
}

export interface ReviewerDecision {
  shouldReview: boolean
  reasons: string[]
}

export interface ClaudeReviewerResult {
  pass: boolean
  blocking_issues: string[]
  non_blocking_notes: string[]
  patch_suggestions: string[]
  publish_recommendation: 'publish' | 'fix' | 'premium_fallback' | 'manual_review'
}

const MONEY_RE = /\$|млн|млрд|оценк[аиу]|инвестиц|раунд|выручк|капитализац|акци[ияй]|IPO/i
const LEGAL_RE = /регулирован|закон|иск|судебн|правов|антимонопол|санкци|конфиденциальн|персональн|авторск|EU AI Act|AI Act/i
const RESEARCH_TOPIC_RE = /\bai-research\b|исследован/i
const MEDICAL_RE = /медицин|диагноз|пациент|лекарств|клиник|врач/i
const GEOPOLITICS_RE = /войн|геополит|выбор|государств|разведк|оборон|военн/i

export function getEditorialRoutingConfig(env: Record<string, string | undefined> = process.env): EditorialRoutingConfig {
  const mode = parseRoutingMode(env.EDITORIAL_ROUTING_MODE)
  const writerProvider = parseWriterProvider(env.EDITORIAL_WRITER_PROVIDER, mode)
  const reviewPolicy = parseReviewPolicy(env.EDITORIAL_REVIEW_POLICY, mode)
  return { mode, writerProvider, reviewPolicy }
}

function parseRoutingMode(value: string | undefined): EditorialRoutingMode {
  if (value === 'cheap' || value === 'balanced' || value === 'premium') return value
  return 'premium'
}

function parseWriterProvider(value: string | undefined, mode: EditorialRoutingMode): EditorialWriterProvider {
  if (value === 'deepseek' || value === 'anthropic') return value
  return mode === 'premium' ? 'anthropic' : 'deepseek'
}

function parseReviewPolicy(value: string | undefined, mode: EditorialRoutingMode): EditorialReviewPolicy {
  if (value === 'none' || value === 'selective' || value === 'always') return value
  if (mode === 'balanced') return 'selective'
  return 'none'
}

export function buildDeterministicEditorialBrief(context: ArticleRoutingContext): string {
  const categories = [context.primaryCategory, ...(context.secondaryCategories ?? [])]
    .filter(Boolean)
    .join(', ') || 'unknown'
  const riskFlags = detectEditorialRiskFlags(context)
  const excerpt = normalizeWhitespace(context.originalText).slice(0, 5000)

  return [
    `Source: ${context.sourceName}`,
    `Original title: ${context.originalTitle}`,
    `Categories: ${categories}`,
    `Score: ${context.score ?? 'unknown'}`,
    `Risk flags: ${riskFlags.length ? riskFlags.join(', ') : 'none'}`,
    '',
    'Editorial angle:',
    buildAngleHint(context, riskFlags),
    '',
    'Must keep:',
    '- Use only source-supported facts, plus conservative industry context.',
    '- Lead starts with a concrete name, number, date, product, or company.',
    '- Russian copy uses "ИИ"; keep model/product names in original spelling.',
    '- Avoid generic AI metaphors, marketing hype, and banned phrases from the style guide.',
    '- Link anchors must be verbatim phrases from editorial_body.',
    '',
    'Source excerpt:',
    excerpt,
  ].join('\n')
}

export function detectEditorialRiskFlags(context: ArticleRoutingContext): string[] {
  const text = [
    context.originalTitle,
    context.originalText,
    ...(context.topics ?? []),
    context.primaryCategory ?? '',
    ...(context.secondaryCategories ?? []),
  ].join('\n')
  const flags: string[] = []

  if (MONEY_RE.test(text)) flags.push('money')
  if (LEGAL_RE.test(text)) flags.push('legal_regulation')
  if (context.primaryCategory === 'ai-research' || (context.topics ?? []).some((topic) => RESEARCH_TOPIC_RE.test(topic))) {
    flags.push('research')
  }
  if (MEDICAL_RE.test(text)) flags.push('medical')
  if (GEOPOLITICS_RE.test(text)) flags.push('geopolitics')
  if ((context.score ?? 0) >= 8) flags.push('high_score')

  return [...new Set(flags)]
}

function buildAngleHint(context: ArticleRoutingContext, riskFlags: string[]): string {
  if (riskFlags.includes('research')) {
    return 'Explain the technical problem, approach, result, limitation, and why it matters without overselling.'
  }
  if (riskFlags.includes('money')) {
    return 'Focus on what the company/product does, why money or valuation matters, and what remains uncertain.'
  }
  if (riskFlags.includes('legal_regulation')) {
    return 'Separate confirmed legal facts from interpretation; avoid implying outcomes that are not in the source.'
  }
  if (context.primaryCategory === 'ai-startups') {
    return 'Make the product and competitive difference clear before funding or market context.'
  }
  return 'Turn the source into a useful AI-news article: what happened, why it matters, and what context a reader needs.'
}

export function shouldReviewWithClaude(params: {
  config: EditorialRoutingConfig
  context: ArticleRoutingContext
  validation: EditorialValidationResult
  output?: EditorialOutput | null
}): ReviewerDecision {
  if (params.config.reviewPolicy === 'none') return { shouldReview: false, reasons: [] }
  if (params.config.reviewPolicy === 'always') return { shouldReview: true, reasons: ['review_policy_always'] }

  const reasons = new Set<string>()
  if (!params.validation.ok) reasons.add('validator_failed')

  for (const flag of params.validation.riskFlags) reasons.add(`validator_${flag}`)
  for (const flag of detectEditorialRiskFlags(params.context)) reasons.add(`article_${flag}`)

  if (params.context.primaryCategory === 'ai-research') reasons.add('category_ai_research')
  if ((params.context.score ?? 0) >= 8) reasons.add('score_high')
  if (params.output?.quality_ok === false) reasons.add('quality_not_ok')

  return { shouldReview: reasons.size > 0, reasons: [...reasons].sort() }
}

export function buildClaudeReviewerPrompt(params: {
  context: ArticleRoutingContext
  output: EditorialOutput
  validation: EditorialValidationResult
  reasons: string[]
}): { system: string; user: string } {
  return {
    system:
      'You are a compact Russian editorial QA reviewer for Malakhov AI Digest. ' +
      'Do not rewrite the article. Routing reasons are risk signals, not mandatory sections. ' +
      'Do not demand legal, research, funding, or local-market context unless it is present in the source, category, or candidate claims. ' +
      'Return only valid JSON with pass/fail and concise issue lists.',
    user: [
      `Review reasons: ${params.reasons.join(', ') || 'none'}`,
      `Source: ${params.context.sourceName}`,
      `Original title: ${params.context.originalTitle}`,
      `Categories: ${[params.context.primaryCategory, ...(params.context.secondaryCategories ?? [])].filter(Boolean).join(', ') || 'unknown'}`,
      '',
      'Validator result:',
      JSON.stringify(params.validation, null, 2),
      '',
      'Source excerpt:',
      normalizeWhitespace(params.context.originalText).slice(0, 5000),
      '',
      'Candidate article JSON:',
      JSON.stringify(params.output, null, 2),
      '',
      'Return JSON exactly in this shape:',
      '{"pass":boolean,"blocking_issues":string[],"non_blocking_notes":string[],"patch_suggestions":string[],"publish_recommendation":"publish"|"fix"|"premium_fallback"|"manual_review"}',
    ].join('\n'),
  }
}

export function parseClaudeReviewerResult(raw: string): ClaudeReviewerResult | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const candidate = text.match(/\{[\s\S]*\}/)?.[0] ?? text
  try {
    const parsed = JSON.parse(candidate) as ClaudeReviewerResult
    if (typeof parsed.pass !== 'boolean') return null
    if (!Array.isArray(parsed.blocking_issues)) return null
    if (!Array.isArray(parsed.non_blocking_notes)) return null
    if (!Array.isArray(parsed.patch_suggestions)) return null
    if (!['publish', 'fix', 'premium_fallback', 'manual_review'].includes(parsed.publish_recommendation)) return null
    return parsed
  } catch {
    return null
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
