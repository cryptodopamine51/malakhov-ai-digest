export type TextProvider = 'anthropic' | 'deepseek'
export type ImageQuality = 'low' | 'medium' | 'high'
export type ImageSize = '1024x1024' | '1536x1024' | '1024x1536'

export interface TextUsageForCost {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheCreateTokens?: number
  cacheHitInputTokens?: number
  cacheMissInputTokens?: number
}

export interface TextCostParams {
  provider: TextProvider
  model: string
  usage: TextUsageForCost
  batch?: boolean
}

export interface ImageUsageForCost {
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: {
    text_tokens?: number
    image_tokens?: number
  }
}

interface AnthropicRate {
  input: number
  output: number
  cacheRead: number
  cacheCreate: number
}

interface DeepSeekRate {
  inputCacheHit: number
  inputCacheMiss: number
  output: number
}

const ANTHROPIC_RATES_USD_PER_MTOK: Record<string, AnthropicRate> = {
  'claude-sonnet-4-6': {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheCreate: 3.75,
  },
  'claude-sonnet-4.6': {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheCreate: 3.75,
  },
}

const DEEPSEEK_RATES_USD_PER_MTOK: Record<string, DeepSeekRate> = {
  'deepseek-v4-flash': {
    inputCacheHit: 0.0028,
    inputCacheMiss: 0.14,
    output: 0.28,
  },
  'deepseek-chat': {
    inputCacheHit: 0.0028,
    inputCacheMiss: 0.14,
    output: 0.28,
  },
  'deepseek-reasoner': {
    inputCacheHit: 0.0028,
    inputCacheMiss: 0.14,
    output: 0.28,
  },
  'deepseek-v4-pro': {
    inputCacheHit: 0.003625,
    inputCacheMiss: 0.435,
    output: 0.87,
  },
}

const OPENAI_IMAGE_PER_IMAGE_USD: Record<string, Record<ImageQuality, Record<ImageSize, number>>> = {
  'gpt-image-2': {
    low: { '1024x1024': 0.006, '1536x1024': 0.005, '1024x1536': 0.005 },
    medium: { '1024x1024': 0.053, '1536x1024': 0.041, '1024x1536': 0.041 },
    high: { '1024x1024': 0.211, '1536x1024': 0.165, '1024x1536': 0.165 },
  },
  'gpt-image-1.5': {
    low: { '1024x1024': 0.009, '1536x1024': 0.013, '1024x1536': 0.013 },
    medium: { '1024x1024': 0.034, '1536x1024': 0.05, '1024x1536': 0.05 },
    high: { '1024x1024': 0.133, '1536x1024': 0.2, '1024x1536': 0.2 },
  },
  'chatgpt-image-latest': {
    low: { '1024x1024': 0.009, '1536x1024': 0.013, '1024x1536': 0.013 },
    medium: { '1024x1024': 0.034, '1536x1024': 0.05, '1024x1536': 0.05 },
    high: { '1024x1024': 0.133, '1536x1024': 0.2, '1024x1536': 0.2 },
  },
  'gpt-image-1': {
    low: { '1024x1024': 0.016, '1536x1024': 0.016, '1024x1536': 0.016 },
    medium: { '1024x1024': 0.063, '1536x1024': 0.063, '1024x1536': 0.063 },
    high: { '1024x1024': 0.25, '1536x1024': 0.25, '1024x1536': 0.25 },
  },
  'gpt-image-1-mini': {
    low: { '1024x1024': 0.005, '1536x1024': 0.006, '1024x1536': 0.006 },
    medium: { '1024x1024': 0.011, '1536x1024': 0.015, '1024x1536': 0.015 },
    high: { '1024x1024': 0.036, '1536x1024': 0.052, '1024x1536': 0.052 },
  },
}

function roundUsd(value: number): number {
  return Number(value.toFixed(6))
}

function normalizeModel(model: string): string {
  return model.trim().toLowerCase()
}

export function estimateTextCostUsd(params: TextCostParams): number {
  const model = normalizeModel(params.model)
  const usage = params.usage

  if (params.provider === 'anthropic') {
    const rates = ANTHROPIC_RATES_USD_PER_MTOK[model]
    if (!rates) return 0
    const undiscounted =
      ((usage.inputTokens ?? 0) * rates.input) / 1_000_000 +
      ((usage.outputTokens ?? 0) * rates.output) / 1_000_000 +
      ((usage.cacheReadTokens ?? 0) * rates.cacheRead) / 1_000_000 +
      ((usage.cacheCreateTokens ?? 0) * rates.cacheCreate) / 1_000_000

    return roundUsd(params.batch ? undiscounted * 0.5 : undiscounted)
  }

  const rates = DEEPSEEK_RATES_USD_PER_MTOK[model]
  if (!rates) return 0
  const explicitCacheSplit =
    typeof usage.cacheHitInputTokens === 'number' ||
    typeof usage.cacheMissInputTokens === 'number'

  const cacheHit = explicitCacheSplit ? (usage.cacheHitInputTokens ?? 0) : (usage.cacheReadTokens ?? 0)
  const cacheMiss = explicitCacheSplit
    ? (usage.cacheMissInputTokens ?? 0)
    : Math.max(0, (usage.inputTokens ?? 0) - cacheHit)

  return roundUsd(
    (cacheHit * rates.inputCacheHit) / 1_000_000 +
    (cacheMiss * rates.inputCacheMiss) / 1_000_000 +
    ((usage.outputTokens ?? 0) * rates.output) / 1_000_000,
  )
}

export function estimateOpenAiImageCostUsd(params: {
  model: string
  quality: ImageQuality
  size: ImageSize
  usage?: ImageUsageForCost | null
}): number | null {
  const model = normalizeModel(params.model)
  const perImage = OPENAI_IMAGE_PER_IMAGE_USD[model]?.[params.quality]?.[params.size]
  if (typeof perImage === 'number') return perImage

  if (model === 'gpt-image-2' && params.usage) {
    const textInput = params.usage.input_tokens_details?.text_tokens ?? params.usage.input_tokens ?? 0
    const imageInput = params.usage.input_tokens_details?.image_tokens ?? 0
    const imageOutput = params.usage.output_tokens ?? 0
    return roundUsd((textInput * 5 + imageInput * 8 + imageOutput * 30) / 1_000_000)
  }

  return null
}

export function estimateOpenAiImageDailyBudgetCount(params: {
  budgetUsd: number
  model: string
  quality: ImageQuality
  size: ImageSize
}): number | null {
  const unit = estimateOpenAiImageCostUsd({
    model: params.model,
    quality: params.quality,
    size: params.size,
  })
  if (!unit || unit <= 0) return null
  return Math.floor(params.budgetUsd / unit)
}
