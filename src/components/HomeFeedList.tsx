'use client'

import { useState } from 'react'
import type { Article } from '../../lib/supabase'
import { getPaginationMeta, type PaginationMeta } from '../../lib/pagination'
import ArticleFeedList from './ArticleFeedList'

interface HomeFeedListProps {
  initialArticles: Article[]
  total: number
  perPage: number
  excludeId?: string | null
}

interface FeedResponse extends PaginationMeta {
  articles: Article[]
}

export default function HomeFeedList({
  initialArticles,
  total,
  perPage,
  excludeId,
}: HomeFeedListProps) {
  const [articles, setArticles] = useState<Article[]>(initialArticles)
  const [currentPage, setCurrentPage] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pagination = getPaginationMeta(total, currentPage, perPage)
  const canLoadMore = currentPage < pagination.totalPages

  async function loadMore() {
    if (!canLoadMore || isLoading) return

    const nextPage = currentPage + 1
    setIsLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ page: String(nextPage) })
      if (excludeId) params.set('excludeId', excludeId)
      const response = await fetch(`/api/feed?${params.toString()}`, {
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error('load_failed')

      const payload = (await response.json()) as FeedResponse
      setArticles((prev) => [...prev, ...payload.articles])
      setCurrentPage(nextPage)

      // Mirror CategoryArticleList: update the URL so users can bookmark or
      // share their current scroll position. The server still ignores the
      // `?page=` param (page 1 is the only server-rendered state) and
      // canonical URL stays on `/`, so this is purely UX — no SEO impact.
      if (typeof window !== 'undefined') {
        window.history.pushState(null, '', `/?page=${nextPage}`)
      }
    } catch {
      setError('Не удалось загрузить следующую страницу')
    } finally {
      setIsLoading(false)
    }
  }

  if (articles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center text-muted">
        <span className="text-4xl mb-3">📡</span>
        <p className="text-lg">Статьи появятся совсем скоро</p>
      </div>
    )
  }

  return (
    <>
      <ArticleFeedList articles={articles} featuredFirst={true} />

      {error && (
        <p className="mt-4 text-center text-sm text-muted">
          {error}
        </p>
      )}

      {canLoadMore && (
        <div className="mt-10 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={isLoading}
            className="min-w-[132px] rounded border border-line px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? 'Загрузка...' : 'Показать ещё'}
          </button>
        </div>
      )}
    </>
  )
}
