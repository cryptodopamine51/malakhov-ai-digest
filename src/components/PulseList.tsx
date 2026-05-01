'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { getArticlePath } from '../../lib/article-slugs'
import type { Article } from '../../lib/supabase'
import RelativeTime from './RelativeTime'
import { TOPIC_LABELS } from './TopicBadge'

interface PulseListProps {
  articles: Article[]
  pageSize?: number
}

export default function PulseList({ articles, pageSize = 4 }: PulseListProps) {
  const [page, setPage] = useState(0)

  const totalPages = Math.max(1, Math.ceil(articles.length / pageSize))
  const currentArticles = useMemo(() => {
    const start = page * pageSize
    return articles.slice(start, start + pageSize)
  }, [articles, page, pageSize])

  if (!articles.length) return null

  return (
    <div>
      <ul className="divide-y divide-line border-y border-line" aria-live="polite">
        {currentArticles.map((article) => (
          <PulseListItem key={article.id} article={article} />
        ))}
      </ul>

      {articles.length > pageSize && (
        <button
          type="button"
          onClick={() => setPage((current) => (current + 1) % totalPages)}
          className="mt-3 inline-flex w-full items-center justify-center rounded border border-line px-4 py-2 text-xs font-medium uppercase tracking-[0.06em] text-muted transition-colors hover:border-ink hover:text-ink"
        >
          Ещё
        </button>
      )}
    </div>
  )
}

function PulseListItem({ article }: { article: Article }) {
  const href = article.slug ? getArticlePath(article.slug, article.primary_category) : '#'
  const title = article.ru_title ?? article.original_title
  const topic = (article.topics ?? [])[0]
  const date = article.pub_date ?? article.created_at

  return (
    <li>
      <Link href={href} className="group block py-3">
        <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.06em] text-muted">
          {topic && (
            <span className="font-medium">{TOPIC_LABELS[topic] ?? topic}</span>
          )}
          {topic && <span aria-hidden>·</span>}
          <RelativeTime date={date} className="font-mono" />
        </div>
        <h3 className="line-clamp-3 text-[15px] font-semibold leading-snug text-ink transition-colors group-hover:text-accent">
          {title}
        </h3>
      </Link>
    </li>
  )
}
