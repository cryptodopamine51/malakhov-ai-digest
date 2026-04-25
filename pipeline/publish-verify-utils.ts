import type { Article } from '../lib/supabase'
import { getArticleUrl } from '../lib/article-slugs'

export type VerifyCandidateKind = 'new_candidate' | 'legacy_backfill' | 'live_sample'

export function getVerifyCandidateKind(article: Pick<Article, 'publish_status' | 'verified_live'>): VerifyCandidateKind {
  if (article.publish_status === 'publish_ready') return 'new_candidate'
  if (article.publish_status === 'live' && article.verified_live === true) return 'live_sample'
  return 'legacy_backfill'
}

/**
 * Public URL для verify. После волны 2.2 верифицируем уже на канонический
 * `/categories/<primary>/<slug>`, а не на legacy `/articles/<slug>` —
 * чтобы не считать прошедший 301-редирект как ok-сэмпл.
 *
 * Internal verify (`/internal/articles/<slug>`) сохраняем как было: это серверный
 * pre-publish health-check, ему категория не нужна.
 */
export function buildVerifyUrl(
  siteUrl: string,
  slug: string,
  primaryCategory: string | null | undefined,
  candidateKind: VerifyCandidateKind,
): string {
  if (candidateKind === 'live_sample') {
    return getArticleUrl(siteUrl, slug, primaryCategory)
  }

  return `${siteUrl}/internal/articles/${slug}`
}
