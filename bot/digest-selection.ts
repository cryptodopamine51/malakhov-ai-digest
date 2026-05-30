import type { Article } from '../lib/supabase'

export type DigestSelectionArticle = Pick<
  Article,
  | 'id'
  | 'source_name'
  | 'original_title'
  | 'ru_title'
  | 'lead'
  | 'tg_teaser'
  | 'primary_category'
  | 'secondary_categories'
  | 'topics'
  | 'score'
  | 'pub_date'
>

export type DigestEventType =
  | 'funding'
  | 'model_release'
  | 'product_launch'
  | 'benchmark'
  | 'research'
  | 'regulation'
  | 'security'
  | 'partnership'
  | 'acquisition'
  | 'business_case'
  | 'other'

export interface DigestStory {
  primaryEntity: string | null
  eventType: DigestEventType
  numericAnchors: string[]
  signature: string | null
  storyKey: string | null
  strong: boolean
}

export interface DigestSelectionSkipped {
  articleId: string
  title: string
  sourceName: string
  reason: 'source_cap' | 'duplicate_story' | 'recent_story_duplicate' | 'primary_entity_cap'
  storyKey: string | null
  primaryEntity: string | null
}

export interface DigestSelectionDiagnostics {
  candidateCount: number
  recentMemoryCount: number
  selectedCount: number
  sourceDistribution: Record<string, number>
  primaryEntityDistribution: Record<string, number>
  storyKeys: string[]
  skipped: DigestSelectionSkipped[]
}

interface DigestSelectionOptions {
  target?: number
  perSourceCap?: number
  perPrimaryEntityCap?: number
}

interface EntityDefinition {
  canonical: string
  label: string
  re: RegExp
}

const ENTITY_DEFINITIONS: EntityDefinition[] = [
  { canonical: 'anthropic', label: 'Anthropic', re: /\b(?:anthropic|claude|opus|sonnet|haiku)\b/i },
  { canonical: 'openai', label: 'OpenAI', re: /\b(?:openai|chatgpt|gpt-?\d(?:\.\d)?|sora|codex)\b/i },
  { canonical: 'google', label: 'Google', re: /\b(?:google|gemini|deepmind|veo|imagen)\b/i },
  { canonical: 'nvidia', label: 'Nvidia', re: /\b(?:nvidia|blackwell|cuda)\b/i },
  { canonical: 'groq', label: 'Groq', re: /\bgroq\b/i },
  { canonical: 'mistral', label: 'Mistral', re: /\b(?:mistral|le\s?chat|vibe)\b/i },
  { canonical: 'meta', label: 'Meta', re: /\b(?:meta|llama)\b/i },
  { canonical: 'microsoft', label: 'Microsoft', re: /\b(?:microsoft|copilot|phi-?\d)\b/i },
  { canonical: 'xai', label: 'xAI', re: /\b(?:xai|x\.ai|grok)\b/i },
  { canonical: 'yandex', label: 'Yandex', re: /\b(?:yandex|яндекс|alice|алиса|yandexgpt)\b/i },
  { canonical: 'sber', label: 'Sber', re: /\b(?:sber|сбер|gigachat|гигачат)\b/i },
  { canonical: 'amazon', label: 'Amazon', re: /\b(?:amazon|aws|bedrock|sagemaker)\b/i },
  { canonical: 'adobe', label: 'Adobe', re: /\badobe\b/i },
  { canonical: 'alibaba', label: 'Alibaba', re: /\b(?:alibaba|qwen)\b/i },
]

const MODEL_TOKEN_RE =
  /\b(?:claude\s+(?:opus|sonnet|haiku)\s*\d(?:\.\d)?|opus\s*\d(?:\.\d)?|gpt-?\d(?:\.\d)?|gemini\s*\d(?:\.\d)?(?:\s*(?:flash|pro|ultra))?|llama\s*\d(?:\.\d)?|qwen\s*\d(?:\.\d)?(?:-[a-z]+)?|mistral\s+[a-z0-9.-]+|grok\s*\d(?:\.\d)?|phi-?\d(?:\.\d)?|sora|veo\s*\d?|imagen\s*\d?)\b/i

const FUNDING_RE =
  /(?:^|[^\p{L}\p{N}])(?:funding|raises?|raised|raising|series\s+[a-z]|round|valuation|ipo|invest(?:ment|ors?)?|привлек[а-я]*|раунд[а-я]*|оценк[а-я]*|инвестиц[а-я]*|млрд|млн|трлн)(?=$|[^\p{L}\p{N}])/iu

const MODEL_RELEASE_RE =
  /\b(?:ships?|launch(?:es|ed)?|release(?:s|d)?|announce(?:s|d)?|unveil(?:s|ed)?|introduce(?:s|d)?|debut(?:s|ed)?|выпуст(?:ил|ила|или|ит)?|представ(?:ил|ила|или|ит)?|анонсир[а-я]*|запуст(?:ил|ила|или|ит)?)\b/i

const PRODUCT_LAUNCH_RE =
  /\b(?:launch(?:es|ed)?|release(?:s|d)?|announce(?:s|d)?|introduce(?:s|d)?|rolls?\s+out|rebrands?|запуст(?:ил|ила|или|ит)?|представ(?:ил|ила|или|ит)?|выпуст(?:ил|ила|или|ит)?|переименовал[а-я]*|релиз)\b/i

const BENCHMARK_RE = /\b(?:benchmark|benchmarks|eval|test|tests|swe-bench|бенчмарк[а-я]*|тест[а-я]*|обходит|догнал|сравнялся)\b/i
const RESEARCH_RE = /\b(?:study|research|paper|scientists?|исследован[а-я]*|учен[а-я]*|учён[а-я]*|статья|работа)\b/i
const REGULATION_RE = /\b(?:regulat|policy|law|act|senate|court|закон[а-я]*|регулирован[а-я]*|суд[а-я]*|регулятор[а-я]*)\b/i
const SECURITY_RE = /\b(?:security|attack|hack|vulnerab|jailbreak|safety|misalignment|dark\s+patterns?|безопасност[а-я]*|атака[а-я]*|взлом[а-я]*|уязвим[а-я]*|манипулятивн[а-я]*)\b/i
const PARTNERSHIP_RE = /\b(?:partner(?:ship)?|teams?\s+up|collaborat|deal|партнерств[а-я]*|партнёрств[а-я]*|объединил[а-я]*|сделк[а-я]*)\b/i
const ACQUISITION_RE = /\b(?:acqui(?:res|red|sition)|merger|buys?|not-aqui-hire|покупа[а-я]*|купил[а-я]*|приобр[а-я]*|слиян[а-я]*)\b/i
const BUSINESS_CASE_RE = /\b(?:revenue|arr|profit|cash-flow|customers?|выручк[а-я]*|прибыл[а-я]*|клиент[а-я]*|окупаем[а-я]*)\b/i

const RU_LATIN_UNITS: Record<string, string> = {
  b: 'b',
  bn: 'b',
  billion: 'b',
  billions: 'b',
  млрд: 'b',
  m: 'm',
  mn: 'm',
  million: 'm',
  millions: 'm',
  млн: 'm',
  t: 't',
  tn: 't',
  trillion: 't',
  trillions: 't',
  трлн: 't',
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/ё/g, 'е')
    .toLowerCase()
}

function titleText(article: DigestSelectionArticle): string {
  return [article.ru_title, article.original_title]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
}

function broaderText(article: DigestSelectionArticle): string {
  return [article.ru_title, article.original_title, article.lead, article.tg_teaser]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
}

function detectEntities(text: string): EntityDefinition[] {
  return ENTITY_DEFINITIONS
    .map((definition) => {
      const match = text.match(definition.re)
      return match?.index === undefined ? null : { definition, index: match.index }
    })
    .filter((value): value is { definition: EntityDefinition; index: number } => value !== null)
    .sort((a, b) => a.index - b.index)
    .map((value) => value.definition)
}

function detectPrimaryEntity(article: DigestSelectionArticle, eventType: DigestEventType): EntityDefinition | null {
  const entities = detectEntities(titleText(article))
  if (entities.length === 0) return null

  // Lists like "ChatGPT, Gemini, Claude and other chatbots" are usually category stories,
  // not stories about a single company. Keep them out of entity caps unless a concrete launch
  // or funding signal makes the lead entity meaningful.
  const unique = [...new Map(entities.map((entity) => [entity.canonical, entity])).values()]
  if (unique.length > 1 && !['funding', 'model_release', 'product_launch', 'acquisition', 'partnership'].includes(eventType)) {
    return null
  }

  return unique[0] ?? null
}

function detectEventType(text: string): DigestEventType {
  if (FUNDING_RE.test(text)) return 'funding'
  if (ACQUISITION_RE.test(text)) return 'acquisition'
  if (PARTNERSHIP_RE.test(text)) return 'partnership'
  if (MODEL_TOKEN_RE.test(text) && MODEL_RELEASE_RE.test(text)) return 'model_release'
  if (PRODUCT_LAUNCH_RE.test(text)) return 'product_launch'
  if (BENCHMARK_RE.test(text)) return 'benchmark'
  if (SECURITY_RE.test(text)) return 'security'
  if (REGULATION_RE.test(text)) return 'regulation'
  if (RESEARCH_RE.test(text)) return 'research'
  if (BUSINESS_CASE_RE.test(text)) return 'business_case'
  return 'other'
}

export function extractNumericAnchors(text: string): string[] {
  const anchors = new Set<string>()
  const normalized = normalizeText(text).replace(',', '.')
  const re = /(?:[$€£]\s*)?(\d+(?:\.\d+)?)\s*(billion|billions|bn|b|млрд|million|millions|mn|m|млн|trillion|trillions|tn|t|трлн)(?=$|[^\p{L}\p{N}])/giu
  let match: RegExpExecArray | null
  while ((match = re.exec(normalized)) !== null) {
    const value = match[1]?.replace(/\.0$/, '')
    const unit = match[2] ? RU_LATIN_UNITS[match[2].toLowerCase()] : null
    if (value && unit) anchors.add(`${value}${unit}`)
  }

  if (/\b(?:nears?|near|почти|приближа[а-я]*)\b[^.]{0,40}(?:1\s*(?:trillion|tn|t|трлн)|\$?\s*1t)\b/iu.test(normalized)) {
    anchors.add('1t')
  }
  if (/\b(?:trillion-dollar|триллионн[а-я]*)\b/iu.test(normalized)) {
    anchors.add('1t')
  }

  return [...anchors].sort()
}

function normalizeAmountAnchor(value: string | undefined, unit: string | undefined): string | null {
  if (!value || !unit) return null
  const normalizedUnit = RU_LATIN_UNITS[unit.toLowerCase()]
  return normalizedUnit ? `${value.replace(/\.0$/, '')}${normalizedUnit}` : null
}

function extractFundingAmountAnchor(text: string): string | null {
  const normalized = normalizeText(text).replace(',', '.')
  const amount = String.raw`(\d+(?:\.\d+)?)\s*(billion|billions|bn|b|млрд|million|millions|mn|m|млн|trillion|trillions|tn|t|трлн)`
  const afterVerb = new RegExp(String.raw`\b(?:raises?|raised|raising|привлек[а-я]*|поднял[а-я]*)\b[^.]{0,40}?(?:[$€£]\s*)?${amount}(?=$|[^\p{L}\p{N}])`, 'iu')
  const beforeRound = new RegExp(
    String.raw`(?:[$€£]\s*)?${amount}(?=$|[^\p{L}\p{N}])(?:\s+(?![$€£]?\d)[\p{L}-]+){0,3}\s+\b(?:funding\s+round|round|раунд[а-я]*)\b`,
    'iu',
  )

  const afterMatch = normalized.match(afterVerb)
  const afterAnchor = normalizeAmountAnchor(afterMatch?.[1], afterMatch?.[2])
  if (afterAnchor) return afterAnchor

  const beforeMatch = normalized.match(beforeRound)
  return normalizeAmountAnchor(beforeMatch?.[1], beforeMatch?.[2])
}

function extractModelSignature(text: string): string | null {
  const match = text.match(MODEL_TOKEN_RE)
  if (!match?.[0]) return null
  return normalizeSignature(match[0])
}

function normalizeSignature(value: string): string {
  return normalizeText(value)
    .replace(/[$€£]/g, '')
    .replace(/[^a-zа-я0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function compactTitleSignature(text: string): string | null {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'after',
    'как', 'что', 'это', 'для', 'при', 'после', 'почти', 'новый', 'новая', 'новые',
  ])
  const words = normalizeText(text)
    .replace(/[^a-zа-я0-9.\s-]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word))
    .slice(0, 8)

  return words.length > 0 ? normalizeSignature(words.join('-')) : null
}

export function deriveDigestStory(article: DigestSelectionArticle): DigestStory {
  const title = titleText(article)
  const text = broaderText(article)
  const normalizedTitle = normalizeText(title)
  const normalizedText = normalizeText(text)
  const eventType = detectEventType(normalizedText)
  const primaryEntity = detectPrimaryEntity(article, eventType)
  const numericAnchors = extractNumericAnchors(text)

  let signature: string | null = null
  if (eventType === 'funding' && numericAnchors.length > 0) {
    signature = extractFundingAmountAnchor(text) ?? numericAnchors.join('-')
  } else if (eventType === 'model_release') {
    signature = extractModelSignature(normalizedTitle)
  } else if (eventType !== 'other') {
    signature = compactTitleSignature(title)
  }

  const strong = Boolean(primaryEntity && eventType !== 'other' && signature)
  const storyKey = strong && primaryEntity ? `${primaryEntity.canonical}:${eventType}:${signature}` : null

  return {
    primaryEntity: primaryEntity?.label ?? null,
    eventType,
    numericAnchors,
    signature,
    storyKey,
    strong,
  }
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function mapToRecord(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

export function validateDigestComposition(articles: DigestSelectionArticle[]): {
  ok: boolean
  duplicateStoryKeys: string[]
  sourceDistribution: Record<string, number>
  primaryEntityDistribution: Record<string, number>
} {
  const storyCounts = new Map<string, number>()
  const sourceCounts = new Map<string, number>()
  const entityCounts = new Map<string, number>()

  for (const article of articles) {
    increment(sourceCounts, article.source_name)
    const story = deriveDigestStory(article)
    if (story.storyKey) increment(storyCounts, story.storyKey)
    if (story.primaryEntity) increment(entityCounts, story.primaryEntity)
  }

  const duplicateStoryKeys = [...storyCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)

  return {
    ok: duplicateStoryKeys.length === 0,
    duplicateStoryKeys,
    sourceDistribution: mapToRecord(sourceCounts),
    primaryEntityDistribution: mapToRecord(entityCounts),
  }
}

export function selectDigestArticles<T extends DigestSelectionArticle>(
  candidates: T[],
  recentSentArticles: DigestSelectionArticle[] = [],
  options: DigestSelectionOptions = {},
): { articles: T[]; diagnostics: DigestSelectionDiagnostics } {
  const target = options.target ?? 5
  const perSourceCap = options.perSourceCap ?? 2
  const perPrimaryEntityCap = options.perPrimaryEntityCap ?? 2

  const selected: T[] = []
  const skipped: DigestSelectionSkipped[] = []
  const sourceCounts = new Map<string, number>()
  const entityCounts = new Map<string, number>()
  const selectedStoryKeys = new Set<string>()
  const recentStoryKeys = new Set(
    recentSentArticles
      .map((article) => deriveDigestStory(article))
      .filter((story) => story.strong && story.storyKey)
      .map((story) => story.storyKey as string),
  )

  for (const article of candidates) {
    if (selected.length >= target) break

    const story = deriveDigestStory(article)
    const sourceCount = sourceCounts.get(article.source_name) ?? 0
    if (sourceCount >= perSourceCap) {
      skipped.push(skippedEntry(article, 'source_cap', story))
      continue
    }

    if (story.storyKey && selectedStoryKeys.has(story.storyKey)) {
      skipped.push(skippedEntry(article, 'duplicate_story', story))
      continue
    }

    if (story.storyKey && recentStoryKeys.has(story.storyKey)) {
      skipped.push(skippedEntry(article, 'recent_story_duplicate', story))
      continue
    }

    const entityCount = story.primaryEntity ? (entityCounts.get(story.primaryEntity) ?? 0) : 0
    if (story.primaryEntity && entityCount >= perPrimaryEntityCap) {
      skipped.push(skippedEntry(article, 'primary_entity_cap', story))
      continue
    }

    selected.push(article)
    increment(sourceCounts, article.source_name)
    if (story.primaryEntity) increment(entityCounts, story.primaryEntity)
    if (story.storyKey) selectedStoryKeys.add(story.storyKey)
  }

  return {
    articles: selected,
    diagnostics: {
      candidateCount: candidates.length,
      recentMemoryCount: recentStoryKeys.size,
      selectedCount: selected.length,
      sourceDistribution: mapToRecord(sourceCounts),
      primaryEntityDistribution: mapToRecord(entityCounts),
      storyKeys: [...selectedStoryKeys].sort(),
      skipped,
    },
  }
}

function skippedEntry(
  article: DigestSelectionArticle,
  reason: DigestSelectionSkipped['reason'],
  story: DigestStory,
): DigestSelectionSkipped {
  return {
    articleId: article.id,
    title: article.ru_title ?? article.original_title,
    sourceName: article.source_name,
    reason,
    storyKey: story.storyKey,
    primaryEntity: story.primaryEntity,
  }
}
