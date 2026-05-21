import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

type Topic = {
  id: number
  status: string
  cluster: string
  title: string
  primaryKeyword: string
  supportingKeywords: string[]
  intent: string
  audience: string[]
  targetSlug: string
  priority: string
  cta: string
  notes: string
}

type GuideImage = {
  src?: unknown
  width?: unknown
  height?: unknown
  alt?: unknown
  caption?: unknown
}

type GuideMetadata = {
  slug?: unknown
  path?: unknown
  noindex?: unknown
  title?: unknown
  seoTitle?: unknown
  description?: unknown
  verifiedAt?: unknown
  caseSourcing?: unknown
  updatedAt?: unknown
  cover?: GuideImage
  inlineImagesByHeading?: unknown
  relatedLinks?: unknown
  faq?: unknown
  inlineCtas?: unknown
  ctaCards?: unknown
}

const COVER_MIN_BYTES = 80 * 1024
const VERIFIED_MAX_AGE_DAYS = 180
const NOINDEX_MAX_AGE_DAYS = 14
const VALID_CASE_SOURCING = new Set(['public', 'anonymized', 'editorial'])

const REQUIRED_PACKAGE_FILES = [
  '00-topic.json',
  '01-seo-brief.md',
  '02-serp-research.md',
  '03-source-notes.md',
  '04-outline.md',
  '05-draft.md',
  '06-editorial-pass.md',
  '07-final-article.md',
  '08-metadata.json',
  '09-image-brief.md',
  '10-codex-publication-task.md',
  '11-publication-checklist.md',
]

const VALID_STATUSES = new Set([
  'planned',
  'researching',
  'drafted',
  'editing',
  'ready_for_codex',
  'published',
  'needs_update',
  'blocked',
])

const VALID_INTENTS = new Set(['informational', 'practical', 'news/context', 'commercial-adjacent'])
const VALID_PRIORITIES = new Set(['high', 'medium', 'low'])

const root = process.cwd()

function getArgValue(name: string): string | undefined {
  const exactIndex = process.argv.indexOf(name)
  if (exactIndex !== -1) return process.argv[exactIndex + 1]

  const prefix = `${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length) : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function validateTopic(value: unknown, slug: string, errors: string[]): value is Topic {
  if (!isRecord(value)) {
    errors.push('00-topic.json must be a JSON object')
    return false
  }

  const required = [
    'id',
    'status',
    'cluster',
    'title',
    'primaryKeyword',
    'supportingKeywords',
    'intent',
    'audience',
    'targetSlug',
    'priority',
    'cta',
    'notes',
  ]

  for (const field of required) {
    if (!(field in value)) errors.push(`00-topic.json missing required field: ${field}`)
  }

  if (!Number.isInteger(value.id)) errors.push('00-topic.json id must be an integer')
  if (typeof value.status !== 'string' || !VALID_STATUSES.has(value.status)) {
    errors.push('00-topic.json status is invalid')
  }
  if (typeof value.intent !== 'string' || !VALID_INTENTS.has(value.intent)) {
    errors.push('00-topic.json intent is invalid')
  }
  if (typeof value.priority !== 'string' || !VALID_PRIORITIES.has(value.priority)) {
    errors.push('00-topic.json priority is invalid')
  }
  if (typeof value.targetSlug !== 'string' || !isAsciiSlug(value.targetSlug)) {
    errors.push('00-topic.json targetSlug must be an ASCII slug')
  }
  if (typeof value.targetSlug === 'string' && value.targetSlug !== slug) {
    errors.push(`00-topic.json targetSlug (${value.targetSlug}) does not match --slug (${slug})`)
  }

  for (const field of ['cluster', 'title', 'primaryKeyword', 'cta', 'notes']) {
    if (typeof value[field] !== 'string') errors.push(`00-topic.json ${field} must be a string`)
  }

  if (!Array.isArray(value.supportingKeywords) || value.supportingKeywords.length < 3) {
    errors.push('00-topic.json supportingKeywords must contain at least 3 items')
  }
  if (!Array.isArray(value.audience) || value.audience.length < 1) {
    errors.push('00-topic.json audience must contain at least 1 item')
  }

  return errors.length === 0
}

function isAsciiSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
}

function validateMetadata(value: unknown, label: string, errors: string[], warnings: string[]): GuideMetadata | null {
  if (!isRecord(value)) {
    errors.push(`${label} must be a JSON object`)
    return null
  }

  const metadata = value as GuideMetadata
  for (const field of ['slug', 'path', 'title', 'seoTitle', 'description']) {
    const fieldValue = metadata[field as keyof GuideMetadata]
    if (typeof fieldValue !== 'string' || fieldValue.trim().length === 0) {
      errors.push(`${label} ${field} must be a non-empty string`)
    }
  }

  if (!isRecord(metadata.cover)) {
    errors.push(`${label} cover must be an object`)
  } else {
    validateImage(metadata.cover, `${label} cover`, errors)
    checkLocalImageExists(metadata.cover, `${label} cover`, errors)
  }

  if (metadata.inlineImagesByHeading !== undefined && !isRecord(metadata.inlineImagesByHeading)) {
    errors.push(`${label} inlineImagesByHeading must be an object when present`)
  }

  if (isRecord(metadata.inlineImagesByHeading)) {
    for (const [heading, image] of Object.entries(metadata.inlineImagesByHeading)) {
      if (!isRecord(image)) {
        errors.push(`${label} inline image for ${heading} must be an object`)
      } else {
        validateImage(image, `${label} inline image for ${heading}`, errors)
        checkLocalImageExists(image, `${label} inline image for ${heading}`, errors)
      }
    }
  }

  if (metadata.noindex !== undefined && typeof metadata.noindex !== 'boolean') {
    errors.push(`${label} noindex must be boolean when present`)
  }

  if (typeof metadata.verifiedAt !== 'string' || metadata.verifiedAt.trim().length === 0) {
    errors.push(`${label} verifiedAt must be a non-empty ISO date string`)
  } else {
    const verifiedAt = new Date(metadata.verifiedAt)
    if (Number.isNaN(verifiedAt.getTime())) {
      errors.push(`${label} verifiedAt must be a valid date (got: ${metadata.verifiedAt})`)
    } else {
      const ageDays = Math.floor((Date.now() - verifiedAt.getTime()) / (1000 * 60 * 60 * 24))
      if (ageDays > VERIFIED_MAX_AGE_DAYS) {
        warnings.push(
          `${label} verifiedAt is older than ${VERIFIED_MAX_AGE_DAYS} days (age=${ageDays}d)`,
        )
      }
    }
  }

  if (
    metadata.caseSourcing !== undefined &&
    (typeof metadata.caseSourcing !== 'string' || !VALID_CASE_SOURCING.has(metadata.caseSourcing))
  ) {
    errors.push(
      `${label} caseSourcing must be one of: public, anonymized, editorial (got: ${String(metadata.caseSourcing)})`,
    )
  }

  if (metadata.inlineCtas !== undefined && !Array.isArray(metadata.inlineCtas)) {
    errors.push(`${label} inlineCtas must be an array when present`)
  }
  if (metadata.ctaCards !== undefined && !Array.isArray(metadata.ctaCards)) {
    errors.push(`${label} ctaCards must be an array when present`)
  }

  const inlineCtaCount = Array.isArray(metadata.inlineCtas) ? metadata.inlineCtas.length : 0
  const ctaCardCount = Array.isArray(metadata.ctaCards) ? metadata.ctaCards.length : 0
  if (inlineCtaCount > 2) {
    warnings.push(`${label} inlineCtas should be ≤ 2 (got ${inlineCtaCount})`)
  }
  if (inlineCtaCount + ctaCardCount > 5) {
    warnings.push(
      `${label} CTA total should be ≤ 5 (inlineCtas=${inlineCtaCount} + ctaCards=${ctaCardCount})`,
    )
  }

  if (metadata.faq !== undefined && !Array.isArray(metadata.faq)) {
    errors.push(`${label} faq must be an array when present`)
  }

  if (Array.isArray(metadata.faq)) {
    for (const [index, item] of metadata.faq.entries()) {
      if (!isRecord(item)) {
        errors.push(`${label} faq[${index}] must be an object`)
        continue
      }
      if (typeof item.question !== 'string' || item.question.trim().length === 0) {
        errors.push(`${label} faq[${index}].question must be non-empty`)
      }
      if (typeof item.answer !== 'string' || item.answer.trim().length === 0) {
        errors.push(`${label} faq[${index}].answer must be non-empty`)
      }
    }
  }

  if (metadata.relatedLinks !== undefined && !Array.isArray(metadata.relatedLinks)) {
    errors.push(`${label} relatedLinks must be an array when present`)
  }

  if (Array.isArray(metadata.relatedLinks) && metadata.relatedLinks.length > 5) {
    warnings.push(`${label} relatedLinks has more than 5 items`)
  }

  return metadata
}

function validateImage(image: Record<string, unknown>, label: string, errors: string[]) {
  if (typeof image.src !== 'string' || image.src.trim().length === 0) {
    errors.push(`${label} src must be non-empty`)
  }
  if (typeof image.alt !== 'string' || image.alt.trim().length === 0) {
    errors.push(`${label} alt must be non-empty`)
  }
  if (typeof image.caption !== 'string' || image.caption.trim().length === 0) {
    errors.push(`${label} caption must be non-empty`)
  }
}

function checkLocalImageExists(image: Record<string, unknown>, label: string, errors: string[]) {
  if (typeof image.src !== 'string' || !image.src.startsWith('/images/')) return

  const imagePath = join(root, 'public', image.src)
  if (!existsSync(imagePath)) {
    errors.push(`${label} points to missing local image: public${image.src}`)
  }
}

function markdownExpectsFaq(markdown: string): boolean {
  return /^##\s+FAQ\s*$/im.test(markdown) || /^##\s+Частые вопросы\s*$/im.test(markdown)
}

function faqCount(metadata: GuideMetadata | null): number {
  return Array.isArray(metadata?.faq) ? metadata.faq.length : 0
}

function extractGuideLinksFromMarkdown(markdown: string): string[] {
  const slugs = new Set<string>()
  const linkPattern = /\]\(\/guides\/([a-z0-9-]+)(?:#[^)]+)?\)/g
  let match: RegExpExecArray | null
  while ((match = linkPattern.exec(markdown)) !== null) {
    slugs.add(match[1])
  }
  return Array.from(slugs)
}

function extractGuideLinksFromMetadata(metadata: GuideMetadata | null): string[] {
  if (!Array.isArray(metadata?.relatedLinks)) return []

  const slugs = new Set<string>()
  for (const item of metadata.relatedLinks) {
    if (!isRecord(item) || typeof item.href !== 'string') continue
    const match = /^\/guides\/([a-z0-9-]+)(?:#.*)?$/.exec(item.href)
    if (match) slugs.add(match[1])
  }
  return Array.from(slugs)
}

export function leadHasAnchor(markdown: string): boolean {
  const afterH1 = markdown.replace(/^#\s+.+\n+/m, '')
  const window = afterH1.slice(0, 700)
  return /\d/.test(window) || /[A-ZА-ЯЁ]{2,}/.test(window)
}

export function hasCaseBlock(markdown: string): boolean {
  if (/^###\s+(Кейс|Сценарий|Ситуация|Мини-кейс)/im.test(markdown)) return true
  return /Редакционный пример/i.test(markdown)
}

export function hasCounterStrategy(markdown: string): boolean {
  const headingPattern = /^##\s+(.+)$/gm
  let match: RegExpExecArray | null
  while ((match = headingPattern.exec(markdown)) !== null) {
    const heading = match[1].trim()
    if (/(не стоит|не окупится|не подходит|когда не)/i.test(heading)) return true
    if (/ошибки внедрения/i.test(heading)) return true
  }
  return false
}

export function countInlineInternalLinks(markdown: string): number {
  const pattern = /\]\((\/(?:guides|categories|russia)(?:\/[a-z0-9-]+(?:\/[a-z0-9-]+)?)?\/?)(?:#[^)]*)?\)/g
  const unique = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = pattern.exec(markdown)) !== null) {
    const normalized = match[1].replace(/\/$/, '') || '/'
    unique.add(normalized)
  }
  return unique.size
}

export function gitFirstTouchTimestamp(filePath: string): number | null {
  try {
    const output = execFileSync(
      'git',
      ['log', '--diff-filter=A', '--follow', '--format=%ct', '--', filePath],
      { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .toString()
      .trim()
    if (!output) return null
    const lines = output.split('\n').filter(Boolean)
    const last = lines[lines.length - 1]
    const seconds = Number.parseInt(last, 10)
    if (!Number.isFinite(seconds)) return null
    return seconds * 1000
  } catch {
    return null
  }
}

function checkGuideLinks(slugs: string[], errors: string[]) {
  for (const guideSlug of slugs) {
    const markdownPath = join(root, 'content', 'guides', `${guideSlug}.md`)
    if (!existsSync(markdownPath)) {
      errors.push(`Internal link points to missing local guide markdown: /guides/${guideSlug}`)
    }
  }
}

function main() {
  const slug = getArgValue('--slug')
  if (!slug) {
    throw new Error('Usage: npm run evergreen:check -- --slug=<slug>')
  }

  const errors: string[] = []
  const warnings: string[] = []

  if (!isAsciiSlug(slug)) {
    errors.push(`Slug must be ASCII and URL-safe: ${slug}`)
  }

  const packageDir = join(root, 'content', 'evergreen', 'packages', slug)
  if (!existsSync(packageDir)) {
    errors.push(`Package does not exist: content/evergreen/packages/${slug}`)
  }

  for (const file of REQUIRED_PACKAGE_FILES) {
    const path = join(packageDir, file)
    if (!existsSync(path)) {
      errors.push(`Missing package file: content/evergreen/packages/${slug}/${file}`)
    }
  }

  let packageMetadata: GuideMetadata | null = null
  const topicPath = join(packageDir, '00-topic.json')
  if (existsSync(topicPath)) {
    try {
      validateTopic(readJson(topicPath), slug, errors)
    } catch (error) {
      errors.push(`00-topic.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const packageMetadataPath = join(packageDir, '08-metadata.json')
  if (existsSync(packageMetadataPath)) {
    try {
      packageMetadata = validateMetadata(readJson(packageMetadataPath), '08-metadata.json', errors, warnings)
    } catch (error) {
      errors.push(`08-metadata.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const packageFinalArticlePath = join(packageDir, '07-final-article.md')
  if (existsSync(packageFinalArticlePath)) {
    const packageMarkdown = readFileSync(packageFinalArticlePath, 'utf8')
    if (markdownExpectsFaq(packageMarkdown) && faqCount(packageMetadata) === 0) {
      errors.push('08-metadata.json faq must not be empty because 07-final-article.md contains a FAQ section')
    }
    checkGuideLinks(extractGuideLinksFromMarkdown(packageMarkdown), errors)
  }
  checkGuideLinks(extractGuideLinksFromMetadata(packageMetadata), errors)

  const productionMarkdownPath = join(root, 'content', 'guides', `${slug}.md`)
  const productionMetadataPath = join(root, 'content', 'guides', 'meta', `${slug}.json`)
  const hasProductionMarkdown = existsSync(productionMarkdownPath)
  const hasProductionMetadata = existsSync(productionMetadataPath)

  if (hasProductionMarkdown || hasProductionMetadata) {
    if (!hasProductionMarkdown) {
      errors.push(`Production guide metadata exists but markdown is missing: content/guides/${slug}.md`)
    }
    if (!hasProductionMetadata) {
      errors.push(`Production guide markdown exists but metadata registry is missing: content/guides/meta/${slug}.json`)
    }
  }

  let productionMetadata: GuideMetadata | null = null
  if (hasProductionMetadata) {
    try {
      productionMetadata = validateMetadata(
        readJson(productionMetadataPath),
        `content/guides/meta/${slug}.json`,
        errors,
        warnings,
      )
    } catch (error) {
      errors.push(
        `content/guides/meta/${slug}.json is invalid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  if (hasProductionMarkdown) {
    const productionMarkdown = readFileSync(productionMarkdownPath, 'utf8')
    if (markdownExpectsFaq(productionMarkdown) && faqCount(productionMetadata) === 0) {
      errors.push(`Production metadata faq must not be empty because content/guides/${slug}.md contains a FAQ section`)
    }
    if (faqCount(productionMetadata) > 0 && !markdownExpectsFaq(productionMarkdown)) {
      errors.push(`Production metadata has FAQ but content/guides/${slug}.md does not render a FAQ section`)
    }
    checkGuideLinks(extractGuideLinksFromMarkdown(productionMarkdown), errors)

    if (!leadHasAnchor(productionMarkdown)) {
      warnings.push(
        `content/guides/${slug}.md lead has no factual anchor (number / proper-noun) in the first 700 chars after H1`,
      )
    }
    if (!hasCaseBlock(productionMarkdown)) {
      warnings.push(
        `content/guides/${slug}.md has no case block (H3 starting with "Кейс/Сценарий/Ситуация/Мини-кейс" or "Редакционный пример" marker)`,
      )
    }
    if (!hasCounterStrategy(productionMarkdown)) {
      warnings.push(
        `content/guides/${slug}.md has no counter-strategy H2 ("не стоит/не окупится/не подходит/когда не/Ошибки внедрения")`,
      )
    }
    const inlineLinks = countInlineInternalLinks(productionMarkdown)
    if (inlineLinks < 2) {
      warnings.push(
        `content/guides/${slug}.md has only ${inlineLinks} inline internal links to /guides|/categories|/russia (expected ≥ 2)`,
      )
    }
  }
  checkGuideLinks(extractGuideLinksFromMetadata(productionMetadata), errors)

  if (productionMetadata && isRecord(productionMetadata.cover)) {
    const coverSrc = productionMetadata.cover.src
    if (typeof coverSrc === 'string' && coverSrc.startsWith('/images/')) {
      const coverPath = join(root, 'public', coverSrc)
      if (existsSync(coverPath)) {
        try {
          const size = statSync(coverPath).size
          if (size < COVER_MIN_BYTES) {
            warnings.push(
              `Cover ${coverSrc} is ${size} bytes (< ${COVER_MIN_BYTES}); regenerate via ChatGPT subscription`,
            )
          }
        } catch {
          // ignore stat errors
        }
      }
    }
  }

  if (productionMetadata?.noindex === true && hasProductionMarkdown) {
    const firstTouchMs = gitFirstTouchTimestamp(`content/guides/${slug}.md`)
    if (firstTouchMs !== null) {
      const ageDays = Math.floor((Date.now() - firstTouchMs) / (1000 * 60 * 60 * 24))
      if (ageDays > NOINDEX_MAX_AGE_DAYS) {
        warnings.push(
          `content/guides/${slug}.md is noindex for ${ageDays} days (> ${NOINDEX_MAX_AGE_DAYS}); review and lift the flag`,
        )
      }
    }
  }

  if (warnings.length > 0) {
    console.warn('evergreen:check warnings')
    for (const warning of warnings) console.warn(`- ${warning}`)
  }

  if (errors.length > 0) {
    console.error('evergreen:check failed')
    for (const error of errors) console.error(`- ${error}`)
    process.exit(1)
  }

  console.log(`evergreen:check ok: ${slug}`)
}

const isDirectInvocation = (() => {
  const argv1 = process.argv[1] ?? ''
  return argv1.endsWith('/scripts/evergreen-check.ts') || argv1.endsWith('\\scripts\\evergreen-check.ts')
})()

if (isDirectInvocation) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
