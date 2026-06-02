import type { Article } from './supabase'

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

// ── Importance (вес важности истории) ──────────────────────────────────────────
//
// Общее ядро для ранжирования и сайта («Самое интересное», рекомендации,
// lib/interest-ranking.ts), и Telegram-дайджеста (bot/digest-selection.ts).
// Важность = масштаб события + денежный тир + узнаваемость игрока + подтверждение
// несколькими источниками по одному storyKey.

export interface ImportanceComponents {
  importanceScore: number
  eventTypeWeight: number
  magnitudeBonus: number
  entityBonus: number
  multiSourceBonus: number
}

// Вес важности по типу события. Крупные деньги/релизы моделей/сделки — высокий приоритет;
// продуктовые анонсы/регуляторика/безопасность/партнёрства — средний; бенчмарки/ресёрч/
// бизнес-кейсы — низкий; нераспознанное событие («other») не добавляет важности.
const EVENT_TYPE_WEIGHT: Record<DigestEventType, number> = {
  funding: 3,
  model_release: 3,
  acquisition: 3,
  product_launch: 2,
  partnership: 2,
  regulation: 2,
  security: 2,
  benchmark: 1,
  research: 1,
  business_case: 1,
  other: 0,
}

function magnitudeFromAnchors(anchors: string[]): number {
  let maxMillions = 0
  for (const anchor of anchors) {
    const match = anchor.match(/^(\d+(?:\.\d+)?)(b|m|t)$/)
    if (!match) continue
    const value = Number(match[1])
    const multiplier = match[2] === 't' ? 1_000_000 : match[2] === 'b' ? 1000 : 1
    maxMillions = Math.max(maxMillions, value * multiplier)
  }
  if (maxMillions >= 1000) return 3
  if (maxMillions >= 100) return 2
  if (maxMillions > 0) return 1
  return 0
}

function multiSourceBonusForCount(count: number): number {
  if (count >= 4) return 3
  if (count === 3) return 2
  if (count === 2) return 1
  return 0
}

// Карта storyKey → число РАЗЛИЧНЫХ источников по этой истории в текущем пуле кандидатов.
// Много независимых источников по одному сюжету = подтверждённая важная история.
export function buildStorySourceCounts(articles: DigestSelectionArticle[]): Map<string, number> {
  const sources = new Map<string, Set<string>>()
  for (const article of articles) {
    const story = deriveDigestStory(article)
    if (!story.storyKey) continue
    const set = sources.get(story.storyKey) ?? new Set<string>()
    set.add(article.source_name)
    sources.set(story.storyKey, set)
  }
  return new Map([...sources].map(([key, set]) => [key, set.size]))
}

export function getStoryImportance(
  article: DigestSelectionArticle,
  storySourceCounts?: Map<string, number>,
): ImportanceComponents {
  const story = deriveDigestStory(article)
  const eventTypeWeight = EVENT_TYPE_WEIGHT[story.eventType]
  const magnitudeBonus = magnitudeFromAnchors(story.numericAnchors)

  let entityBonus = 0
  if (story.primaryEntity) entityBonus += 1
  if (story.strong) entityBonus += 0.5

  const sourceCount = story.storyKey ? (storySourceCounts?.get(story.storyKey) ?? 0) : 0
  const multiSourceBonus = multiSourceBonusForCount(sourceCount)

  const importanceScore = eventTypeWeight + magnitudeBonus + entityBonus + multiSourceBonus

  return { importanceScore, eventTypeWeight, magnitudeBonus, entityBonus, multiSourceBonus }
}
