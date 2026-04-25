import Link from 'next/link'
import { getArticlePath } from '../../lib/article-slugs'
import type { Article } from '../../lib/supabase'
import RelativeTime from './RelativeTime'
import { TOPIC_LABELS } from './TopicBadge'

interface PulseListProps {
  articles: Article[]
}

export default function PulseList({ articles }: PulseListProps) {
  if (!articles.length) return null

  return (
    <ul className="divide-y divide-line border-y border-line">
      {articles.map((article) => (
        <PulseListItem key={article.id} article={article} />
      ))}
    </ul>
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
