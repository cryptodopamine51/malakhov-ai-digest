import Link from 'next/link'
import type { Article } from '../../lib/supabase'
import { formatRelativeTime, truncate } from '../../lib/utils'
import TopicBadge from './TopicBadge'
import SafeImage from './SafeImage'

interface ArticleCardProps {
  article: Article
  variant?: 'default' | 'compact' | 'featured'
}

// ── Бейдж источника ───────────────────────────────────────────────────────────

function SourceBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-accent text-white">
      {name}
    </span>
  )
}

// ── Заглушка (для случая без картинки) ───────────────────────────────────────

function ImagePlaceholder() {
  return (
    <div className="w-full h-full bg-surface flex items-center justify-center">
      <svg className="text-muted/40 w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    </div>
  )
}

// ── variant='featured' ────────────────────────────────────────────────────────

function FeaturedCard({ article }: { article: Article }) {
  const href = `/articles/${article.slug}`
  const title = article.ru_title ?? article.original_title
  const time = formatRelativeTime(article.pub_date ?? article.created_at)

  return (
    <Link href={href} className="group block">
      <article className="flex flex-col md:flex-row rounded-xl overflow-hidden bg-surface hover:bg-[#222222] transition-colors border border-white/5">
        {/* Картинка — 40% */}
        <div className="relative md:w-2/5 aspect-video md:aspect-auto md:min-h-[260px] flex-shrink-0 bg-[#111]">
          {article.cover_image_url ? (
            <SafeImage
              src={article.cover_image_url}
              alt={title}
              fill
              sizes="(max-width: 768px) 100vw, 40vw"
              className="object-cover group-hover:opacity-90 transition-opacity"
            />
          ) : (
            <ImagePlaceholder />
          )}
        </div>

        {/* Текст — 60% */}
        <div className="flex flex-col justify-between p-5 md:p-6 gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <SourceBadge name={article.source_name} />
            {(article.topics ?? []).map((t) => (
              <TopicBadge key={t} topic={t} />
            ))}
            <span>{time}</span>
          </div>

          <h2 className="text-xl md:text-2xl font-bold text-[#e5e5e5] leading-snug group-hover:text-white transition-colors">
            {title}
          </h2>

          {article.why_it_matters && (
            <p className="text-sm text-muted line-clamp-2">
              {article.why_it_matters}
            </p>
          )}
        </div>
      </article>
    </Link>
  )
}

// ── variant='default' ─────────────────────────────────────────────────────────

function DefaultCard({ article }: { article: Article }) {
  const href = `/articles/${article.slug}`
  const title = article.ru_title ?? article.original_title
  const time = formatRelativeTime(article.pub_date ?? article.created_at)

  return (
    <Link href={href} className="group block h-full">
      <article className="flex flex-col h-full rounded-xl overflow-hidden bg-surface hover:bg-[#222222] transition-colors border border-white/5">
        {/* Картинка 16:9 */}
        <div className="relative aspect-video bg-[#111] flex-shrink-0">
          {article.cover_image_url ? (
            <SafeImage
              src={article.cover_image_url}
              alt={title}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className="object-cover group-hover:opacity-90 transition-opacity"
            />
          ) : (
            <ImagePlaceholder />
          )}
        </div>

        {/* Текст */}
        <div className="flex flex-col flex-1 p-4 gap-2">
          <h2 className="text-base font-semibold text-[#e5e5e5] leading-snug group-hover:text-white transition-colors line-clamp-3">
            {title}
          </h2>

          {article.why_it_matters && (
            <p className="text-sm text-muted line-clamp-2 flex-1">
              {truncate(article.why_it_matters, 120)}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted mt-auto pt-2">
            <SourceBadge name={article.source_name} />
            <span>{time}</span>
          </div>
        </div>
      </article>
    </Link>
  )
}

// ── variant='compact' ─────────────────────────────────────────────────────────

function CompactCard({ article }: { article: Article }) {
  const href = `/articles/${article.slug}`
  const title = article.ru_title ?? article.original_title
  const time = formatRelativeTime(article.pub_date ?? article.created_at)

  return (
    <Link href={href} className="group block">
      <article className="rounded-lg p-4 bg-surface hover:bg-[#222222] transition-colors border border-white/5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted mb-1.5">
          <SourceBadge name={article.source_name} />
          <span>{time}</span>
        </div>

        <h2 className="text-base font-semibold text-[#e5e5e5] group-hover:text-white transition-colors leading-snug">
          {title}
        </h2>

        {article.why_it_matters && (
          <p className="mt-1 text-sm text-muted line-clamp-2">
            {article.why_it_matters}
          </p>
        )}
      </article>
    </Link>
  )
}

// ── Экспорт ───────────────────────────────────────────────────────────────────

export default function ArticleCard({ article, variant = 'default' }: ArticleCardProps) {
  if (variant === 'featured') return <FeaturedCard article={article} />
  if (variant === 'compact')  return <CompactCard  article={article} />
  return <DefaultCard article={article} />
}
