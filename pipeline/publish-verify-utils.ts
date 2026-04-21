import type { Article } from '../lib/supabase'

export type VerifyCandidateKind = 'new_candidate' | 'legacy_backfill' | 'live_sample'

export function getVerifyCandidateKind(article: Pick<Article, 'publish_status' | 'verified_live'>): VerifyCandidateKind {
  if (article.publish_status === 'publish_ready') return 'new_candidate'
  if (article.publish_status === 'live' && article.verified_live === true) return 'live_sample'
  return 'legacy_backfill'
}

export function buildVerifyUrl(
  siteUrl: string,
  slug: string,
  candidateKind: VerifyCandidateKind,
): string {
  if (candidateKind === 'live_sample') {
    return `${siteUrl}/articles/${slug}`
  }

  return `${siteUrl}/internal/articles/${slug}`
}
