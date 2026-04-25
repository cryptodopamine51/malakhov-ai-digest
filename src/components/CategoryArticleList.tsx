'use client'

import { useState } from 'react'
import type { Article } from '../../lib/supabase'
import type { PaginationMeta } from '../../lib/pagination'
import { getPaginationMeta } from '../../lib/pagination'
import ArticleCard from './ArticleCard'

interface CategoryArticleListProps {
  category: string
  basePath: string
  initialArticles: Article[]
  total: number
  initialPage: number
  perPage: number
}

interface CategoryArticlesResponse extends PaginationMeta {
  articles: Article[]
}

export default function CategoryArticleList({
  category,
  basePath,
  initialArticles,
  total,
  initialPage,
  perPage,
}: CategoryArticleListProps) {
  const [articles, setArticles] = useState<Article[]>(initialArticles)
  const [currentPage, setCurrentPage] = useState(initialPage)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pagination = getPaginationMeta(total, currentPage, perPage)
  const startedFromFirstPage = initialPage === 1
  const start = total === 0 ? 0 : startedFromFirstPage ? 1 : (initialPage - 1) * perPage + 1
  const end = total === 0
    ? 0
    : startedFromFirstPage
      ? Math.min(articles.length, total)
      : Math.min(start + articles.length - 1, total)
  const canLoadMore = currentPage < pagination.totalPages

  async function loadMore() {
    if (!canLoadMore || isLoading) return

    const nextPage = currentPage + 1
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/categories/${category}/articles?page=${nextPage}`, {
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error('load_failed')

      const payload = await response.json() as CategoryArticlesResponse
      setArticles((prev) => [...prev, ...payload.articles])
      setCurrentPage(nextPage)

      const nextUrl = `${basePath}?page=${nextPage}`
      window.history.pushState(null, '', nextUrl)
    } catch {
      setError('Не удалось загрузить следующую страницу')
    } finally {
      setIsLoading(false)
    }
  }

  if (articles.length === 0) {
    return (
      <div className="py-20 text-center text-muted">
        Статьи появятся совсем скоро
      </div>
    )
  }

  const firstArticle = startedFromFirstPage ? articles[0] : null
  const gridArticles = startedFromFirstPage ? articles.slice(1) : articles

  return (
    <>
      <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <p className="text-sm text-muted">
          {start}-{end} из {total}
        </p>
      </div>

      {firstArticle && (
        <div className="mb-4">
          <ArticleCard article={firstArticle} variant="featured" />
        </div>
      )}

      {gridArticles.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {gridArticles.map((article) => (
            <ArticleCard key={article.id} article={article} variant="default" />
          ))}
        </div>
      )}

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
