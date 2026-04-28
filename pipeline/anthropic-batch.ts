import Anthropic from '@anthropic-ai/sdk'
import type {
  BatchCreateParams,
  MessageBatch,
  MessageBatchIndividualResponse,
  MessageBatchResult,
} from '@anthropic-ai/sdk/resources/messages/batches'
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages/messages'
import { MODEL, extractEditorialText, usageFromMessage } from './claude'

export const DEFAULT_MAX_REQUESTS_PER_BATCH = Number(process.env.ANTHROPIC_BATCH_MAX_REQUESTS ?? 15)

export interface BatchRequestContext {
  articleId: string
  attemptNo: number
  batchItemId: string
}

export interface BatchEditorialRequest extends BatchRequestContext {
  params: MessageCreateParamsNonStreaming
}

export interface NormalizedBatchResult {
  customId: string
  resultType: 'succeeded' | 'errored' | 'expired' | 'canceled'
  outputText: string | null
  errorCode: string | null
  errorMessage: string | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreateTokens: number
  estimatedCostUsd: number
  raw: MessageBatchIndividualResponse
}

const ANTHROPIC_CUSTOM_ID_MAX_LENGTH = 64

function compactUuid(value: string): string {
  const compact = value.replace(/-/g, '').toLowerCase()
  return /^[0-9a-f]{32}$/.test(compact) ? compact : value
}

function restoreUuid(value: string): string {
  if (!/^[0-9a-f]{32}$/.test(value)) return value
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20),
  ].join('-')
}

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY не задан')
  }

  return new Anthropic({ apiKey })
}

export function buildBatchCustomId({ attemptNo, batchItemId }: BatchRequestContext): string {
  const customId = `item:${compactUuid(batchItemId)}:attempt:${attemptNo}`
  if (customId.length > ANTHROPIC_CUSTOM_ID_MAX_LENGTH) {
    throw new Error(`Anthropic batch custom_id exceeds ${ANTHROPIC_CUSTOM_ID_MAX_LENGTH} chars: ${customId.length}`)
  }
  return customId
}

export function parseBatchCustomId(customId: string): BatchRequestContext | null {
  const compactMatch = customId.match(/^item:([^:]+):attempt:(\d+)$/)
  if (compactMatch) {
    return {
      articleId: '',
      attemptNo: Number(compactMatch[2] ?? '0'),
      batchItemId: restoreUuid(compactMatch[1] ?? ''),
    }
  }

  const legacyMatch = customId.match(/^article:([^:]+):attempt:(\d+):item:([^:]+)$/)
  if (!legacyMatch) return null

  return {
    articleId: legacyMatch[1] ?? '',
    attemptNo: Number(legacyMatch[2] ?? '0'),
    batchItemId: legacyMatch[3] ?? '',
  }
}

export function chunkBatchRequests<T>(items: T[], maxRequestsPerBatch = DEFAULT_MAX_REQUESTS_PER_BATCH): T[][] {
  if (maxRequestsPerBatch <= 0) throw new Error('maxRequestsPerBatch must be > 0')

  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += maxRequestsPerBatch) {
    chunks.push(items.slice(i, i + maxRequestsPerBatch))
  }
  return chunks
}

export async function createEditorialBatch(
  requests: BatchEditorialRequest[],
): Promise<MessageBatch> {
  const client = getClient()
  const body: BatchCreateParams = {
    requests: requests.map((request) => ({
      custom_id: buildBatchCustomId(request),
      params: request.params,
    })),
  }

  return client.messages.batches.create(body)
}

export async function retrieveBatch(batchId: string): Promise<MessageBatch> {
  return getClient().messages.batches.retrieve(batchId)
}

export async function listBatchResults(batchId: string): Promise<NormalizedBatchResult[]> {
  const decoder = await getClient().messages.batches.results(batchId)
  const results: NormalizedBatchResult[] = []

  for await (const line of decoder) {
    results.push(normalizeBatchResult(line))
  }

  return results
}

function providerErrorCode(result: MessageBatchResult): string | null {
  if (result.type === 'errored') {
    const status = result.error.error.type ?? 'provider_error'
    return status
  }
  if (result.type === 'expired') return 'batch_expired'
  if (result.type === 'canceled') return 'batch_canceled'
  return null
}

function providerErrorMessage(result: MessageBatchResult): string | null {
  if (result.type === 'errored') {
    return result.error.error.message ?? 'provider batch item errored'
  }
  if (result.type === 'expired') return 'provider batch item expired'
  if (result.type === 'canceled') return 'provider batch item canceled'
  return null
}

export function normalizeBatchResult(raw: MessageBatchIndividualResponse): NormalizedBatchResult {
  if (raw.result.type === 'succeeded') {
    const usage = usageFromMessage(raw.result.message)
    return {
      customId: raw.custom_id,
      resultType: 'succeeded',
      outputText: extractEditorialText(raw.result.message),
      errorCode: null,
      errorMessage: null,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreateTokens: usage.cacheCreateTokens,
      estimatedCostUsd: usage.estimatedCostUsd,
      raw,
    }
  }

  return {
    customId: raw.custom_id,
    resultType: raw.result.type,
    outputText: null,
    errorCode: providerErrorCode(raw.result),
    errorMessage: providerErrorMessage(raw.result),
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    estimatedCostUsd: 0,
    raw,
  }
}

export function buildBatchRequestParams(params: MessageCreateParamsNonStreaming): MessageCreateParamsNonStreaming {
  return {
    ...params,
    model: params.model ?? MODEL,
    stream: false,
  }
}
