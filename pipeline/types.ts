import type { EnrichStatus, PublishStatus } from '../lib/supabase'

export const LEASE_DURATION_MS = 10 * 60 * 1000 // 10 minutes

export const RETRY_POLICY = {
  maxAttempts: 3,
  backoffMs: [5 * 60 * 1000, 30 * 60 * 1000, 2 * 60 * 60 * 1000], // 5m, 30m, 2h
} as const

export const STUCK_THRESHOLD_MS = 15 * 60 * 1000 // lease + 5 min grace

export type ErrorCode =
  | 'fetch_failed'
  | 'fetch_404'
  | 'fetch_5xx'
  | 'fetch_timeout'
  | 'fetch_aborted'
  | 'fetch_too_large'
  | 'fetch_empty'
  | 'fetch_blocked'
  | 'fetch_unknown'
  | 'claude_api_error'
  | 'provider_invalid_request'
  | 'claude_rate_limit'
  | 'claude_truncated'
  | 'batch_expired'
  | 'batch_canceled'
  | 'batch_apply_failed'
  | 'claude_parse_failed'
  | 'editorial_parse_failed'
  | 'quality_reject'
  | 'lease_expired'
  | 'unhandled_error'

export const RETRYABLE_ERRORS: ErrorCode[] = [
  'fetch_failed',
  'fetch_404',
  'fetch_5xx',
  'fetch_timeout',
  'fetch_aborted',
  'fetch_too_large',
  'fetch_empty',
  'fetch_blocked',
  'fetch_unknown',
  'claude_api_error',
  'claude_rate_limit',
  'claude_truncated',
  'batch_expired',
  'batch_canceled',
  'batch_apply_failed',
  'lease_expired',
]

export const PERMANENT_ERRORS: ErrorCode[] = [
  'claude_parse_failed',
  'editorial_parse_failed',
  'provider_invalid_request',
  'quality_reject',
]

export function isRetryable(code: ErrorCode): boolean {
  return RETRYABLE_ERRORS.includes(code)
}

export function retryDelayMs(attemptCount: number): number {
  const index = Math.max(0, attemptCount - 1)
  return RETRY_POLICY.backoffMs[Math.min(index, RETRY_POLICY.backoffMs.length - 1)]
}

export function nextRetryAt(attemptCount: number): Date {
  return new Date(Date.now() + retryDelayMs(attemptCount))
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
