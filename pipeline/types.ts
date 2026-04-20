import type { EnrichStatus, PublishStatus } from '../lib/supabase'

export const LEASE_DURATION_MS = 10 * 60 * 1000 // 10 minutes

export const RETRY_POLICY = {
  maxAttempts: 3,
  backoffMs: [5 * 60 * 1000, 30 * 60 * 1000, 2 * 60 * 60 * 1000], // 5m, 30m, 2h
} as const

export const STUCK_THRESHOLD_MS = 15 * 60 * 1000 // lease + 5 min grace

export type ErrorCode =
  | 'fetch_failed'
  | 'fetch_timeout'
  | 'claude_api_error'
  | 'claude_rate_limit'
  | 'claude_parse_failed'
  | 'editorial_parse_failed'
  | 'quality_reject'
  | 'lease_expired'
  | 'unhandled_error'

export const RETRYABLE_ERRORS: ErrorCode[] = [
  'fetch_failed',
  'fetch_timeout',
  'claude_api_error',
  'claude_rate_limit',
  'lease_expired',
]

export const PERMANENT_ERRORS: ErrorCode[] = [
  'editorial_parse_failed',
  'quality_reject',
]

export function isRetryable(code: ErrorCode): boolean {
  return RETRYABLE_ERRORS.includes(code)
}

export function nextRetryAt(attemptCount: number): Date {
  const delayMs =
    RETRY_POLICY.backoffMs[Math.min(attemptCount, RETRY_POLICY.backoffMs.length - 1)]
  return new Date(Date.now() + delayMs)
}

export function leaseExpiresAt(): Date {
  return new Date(Date.now() + LEASE_DURATION_MS)
}

export function isExhausted(attemptCount: number): boolean {
  return attemptCount >= RETRY_POLICY.maxAttempts
}

export interface ClaimResult {
  articleId: string
  claimToken: string
}

export interface EnrichOutcome {
  status: EnrichStatus
  publishStatus: PublishStatus
  errorCode?: ErrorCode
  errorMessage?: string
}
