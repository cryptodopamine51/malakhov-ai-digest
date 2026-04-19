import Link from 'next/link'
import type { Article } from '../../lib/supabase'
import { formatRelativeTime } from '../../lib/utils'
import TopicBadge, { TOPIC_LABELS } from './TopicBadge'
import SafeImage from './SafeImage'

interface ArticleCardProps {
  article: Article
  variant?: 'default' | 'compact' | 'featured' | 'related'
}

// Источники, чьи og:image содержат текст заголовка — не используем их как обложку в карточках
const SOURCES_WITH_TEXT_COVERS = new Set(['Habr AI', 'vc.ru', 'CNews'])

function getCardImageUrl(article: Article): string | null {
  if (SOURCES_WITH_TEXT_COVERS.has(article.source_name)) return null
  return article.cover_image_url ?? null
}

function SourceLabel({ name }: { name: string }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-[0.05em]">
      {name}
    </span>
  )
}

function ImagePlaceholder() {
  return (
    <div className="w-full h-full bg-surface flex items-center justify-center">
      <svg className="text-line w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    </div>
  )
}

/* ─── Featured card: full-width with overlay (image) or light editorial (no image) ─── */
function FeaturedCard({ article }: { article: Article }) {
  const href    = `/articles/${article.slug}`
  const title   = article.ru_title ?? article.original_title
  const time    = formatRelativeTime(article.pub_date ?? article.created_at)
  const teaser  = article.lead ?? article.card_teaser
  const imageUrl = getCardImageUrl(article)

  if (imageUrl) {
    return (
      <Link href={href} className="group block">
        <article className="relative overflow-hidden rounded border border-line" style={{ minHeight: 340 }}>
          <div className="absolute inset-0 bg-surface">
            <SafeImage
              src={imageUrl}
              alt={title}
              fill
              sizes="(max-width: 768px) 100vw, 70vw"
              className="object-cover"
            />
          </div>

          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

          <div className="relative flex flex-col justify-end h-full p-6" style={{ minHeight: 340 }}>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {(article.topics ?? []).slice(0, 3).map((t) => (
                <span
                  key={t}
                  className="px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] border border-white/40 text-white/90 rounded-sm"
                >
                  {TOPIC_LABELS[t] ?? t}
                </span>
              ))}
            </div>

            <h2 className="font-serif font-bold text-white text-xl md:text-2xl leading-tight mb-3 group-hover:text-white/90 transition-colors line-clamp-3">
              {title}
            </h2>

            {teaser && (
              <p className="text-white/70 text-sm leading-relaxed line-clamp-2 mb-4 hidden sm:block">
                {teaser}
              </p>
            )}

            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 rounded border border-white/40 px-4 py-1.5 text-xs font-medium text-white uppercase tracking-[0.06em] group-hover:bg-white group-hover:text-black transition-colors">
                Читать
              </span>
              <div className="flex items-center gap-2 text-white/50 text-xs">
                <SourceLabel name={article.source_name} />
                <span>·</span>
                <span>{time}</span>
              </div>
            </div>
          </div>
        </article>
      </Link>
    )
  }

  /* ── Light editorial variant (no image / text-cover source) ── */
  return (
    <Link href={href} className="group block">
      <article
        className="relative overflow-hidden rounded border border-line bg-surface"
        style={{ minHeight: 340 }}
      >
        {/* Subtle wireframe decoration — right side */}
        <svg
          viewBox="0 0 640 340"
          className="absolute inset-0 h-full w-full opacity-[0.07] pointer-events-none"
          aria-hidden
        >
          {/* Simple neural net nodes */}
          {[
            { cx: 420, cy: 170 },
            { cx: 510, cy: 110 }, { cx: 510, cy: 170 }, { cx: 510, cy: 230 },
            { cx: 590, cy: 140 }, { cx: 590, cy: 200 },
          ].map(({ cx, cy }, i) => (
            <circle key={i} cx={cx} cy={cy} r={i === 0 ? 18 : 13} fill="none" stroke="var(--ink)" strokeWidth="1.2" />
          ))}
          {[
            [420,170,510,110],[420,170,510,170],[420,170,510,230],
            [510,110,590,140],[510,110,590,200],
            [510,170,590,140],[510,170,590,200],
            [510,230,590,140],[510,230,590,200],
          ].map(([x1,y1,x2,y2], i) => (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink)" strokeWidth="0.8" strokeDasharray="5 3" />
          ))}
        </svg>

        {/* Gradient: right side fades to transparent (wireframe visible on right) */}
        <div
          className="absolute inset-0 z-[1]"
          style={{ background: 'linear-gradient(to right, var(--surface) 50%, color-mix(in srgb, var(--surface) 40%, transparent) 75%, transparent 100%)' }}
        />

        <div className="relative z-10 flex flex-col justify-between h-full p-6 md:max-w-[65%]" style={{ minHeight: 340 }}>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {(article.topics ?? []).slice(0, 3).map((t) => (
              <span
                key={t}
                className="px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] border border-line text-muted rounded-sm"
              >
                {TOPIC_LABELS[t] ?? t}
              </span>
            ))}
          </div>

          <div className="flex-1 flex flex-col justify-center">
            <h2 className="font-serif font-bold text-ink text-xl md:text-2xl leading-tight mb-3 group-hover:text-accent transition-colors line-clamp-3">
              {title}
            </h2>

            {teaser && (
              <p className="text-muted text-sm leading-relaxed line-clamp-3 hidden sm:block">
                {teaser}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between mt-4">
            <span className="inline-flex items-center gap-2 rounded border border-line px-4 py-1.5 text-xs font-medium text-ink uppercase tracking-[0.06em] group-hover:border-accent group-hover:text-accent transition-colors">
              Читать
            </span>
            <div className="flex items-center gap-2 text-muted text-xs">
              <SourceLabel name={article.source_name} />
              <span>·</span>
              <span>{time}</span>
            </div>
          </div>
        </div>
      </article>
    </Link>
  )
}

/* ─── Default card: image + text ─── */
function DefaultCard({ article }: { article: Article }) {
  const href    = `/articles/${article.slug}`
  const title   = article.ru_title ?? article.original_title
  const time    = formatRelativeTime(article.pub_date ?? article.created_at)
  const imageUrl = getCardImageUrl(article)

  const isTop = article.score >= 7

  return (
    <Link href={href} className="group block h-full">
      <article
        className={`flex flex-col h-full border border-line rounded overflow-hidden bg-base hover:-translate-y-0.5 hover:shadow-sm transition-all duration-150 ${isTop ? 'border-l-[3px] border-l-accent' : ''}`}
      >
        <div className="relative aspect-video bg-surface flex-shrink-0">
          {imageUrl ? (
            <SafeImage
              src={imageUrl}
              alt={title}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className="object-cover"
            />
          ) : (
            <ImagePlaceholder />
          )}
        </div>

        <div className="flex flex-col flex-1 p-4 gap-2">
          <div className="flex flex-wrap gap-1.5">
            {(article.topics ?? []).slice(0, 2).map((t) => (
              <TopicBadge key={t} topic={t} />
            ))}
          </div>

          <h2 className="text-[15px] font-semibold text-ink leading-snug group-hover:text-accent transition-colors line-clamp-3">
            {title}
          </h2>

          {article.card_teaser && (
            <p className="text-[13px] text-muted line-clamp-2 flex-1 leading-relaxed">
              {article.card_teaser}
            </p>
          )}

          <div className="flex items-center justify-between mt-auto pt-2 text-[12px] text-muted border-t border-line">
            <SourceLabel name={article.source_name} />
            <span>{time}</span>
          </div>
        </div>
      </article>
    </Link>
  )
}

/* ─── Related card: thumbnail + title (for "Читать также") ─── */
function RelatedCard({ article }: { article: Article }) {
  const href    = `/articles/${article.slug}`
  const title   = article.ru_title ?? article.original_title
  const time    = formatRelativeTime(article.pub_date ?? article.created_at)
  const topic   = (article.topics ?? [])[0]
  const imageUrl = getCardImageUrl(article)

  return (
    <Link href={href} className="group block h-full">
      <article className="flex h-full flex-col overflow-hidden rounded border border-line bg-base transition-all duration-150 hover:border-accent/40 hover:shadow-sm">
        {/* Thumbnail */}
        <div className="relative aspect-[16/9] flex-shrink-0 overflow-hidden bg-surface">
          {imageUrl ? (
            <SafeImage
              src={imageUrl}
              alt={title}
              fill
              sizes="(max-width: 640px) 100vw, 33vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
          ) : (
            <ImagePlaceholder />
          )}
          {/* Topic overlay badge — only when there IS a real image */}
          {imageUrl && topic && (
            <span className="absolute bottom-2 left-2 rounded-sm border border-white/30 bg-black/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-white/90 backdrop-blur-sm">
              {TOPIC_LABELS[topic] ?? topic}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col gap-2 p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className="font-medium uppercase tracking-[0.04em]">{article.source_name}</span>
            <span className="text-line">·</span>
            <span>{time}</span>
          </div>
          <h3 className="line-clamp-3 text-[14px] font-semibold leading-snug text-ink transition-colors group-hover:text-accent">
            {title}
          </h3>
        </div>
      </article>
    </Link>
  )
}

/* ─── Compact card: text-only row ─── */
function CompactCard({ article }: { article: Article }) {
  const href  = `/articles/${article.slug}`
  const title = article.ru_title ?? article.original_title
  const time  = formatRelativeTime(article.pub_date ?? article.created_at)

  return (
    <Link href={href} className="group block">
      <article className="border-b border-line py-4 hover:bg-surface transition-colors px-1">
        <div className="flex items-center gap-2 mb-1.5 text-[11px] text-muted">
          <SourceLabel name={article.source_name} />
          <span>·</span>
          <span>{time}</span>
          {(article.topics ?? []).slice(0, 1).map((t) => (
            <TopicBadge key={t} topic={t} />
          ))}
        </div>

        <h2 className="text-[15px] font-semibold text-ink group-hover:text-accent transition-colors leading-snug">
          {title}
        </h2>

        {article.card_teaser && (
          <p className="mt-1 text-[13px] text-muted line-clamp-2 leading-relaxed">
            {article.card_teaser}
          </p>
        )}
      </article>
    </Link>
  )
}

export default function ArticleCard({ article, variant = 'default' }: ArticleCardProps) {
  if (variant === 'featured') return <FeaturedCard article={article} />
  if (variant === 'compact')  return <CompactCard  article={article} />
  if (variant === 'related')  return <RelatedCard  article={article} />
  return <DefaultCard article={article} />
}

/* ─── Skeleton loaders ─── */

export function ArticleCardSkeleton() {
  return (
    <div className="flex flex-col h-full border border-line rounded overflow-hidden animate-pulse">
      <div className="aspect-video bg-surface" />
      <div className="p-4 space-y-2.5">
        <div className="flex gap-1.5">
          <div className="h-4 w-16 rounded-sm bg-surface" />
          <div className="h-4 w-12 rounded-sm bg-surface" />
        </div>
        <div className="h-4 w-full rounded bg-surface" />
        <div className="h-4 w-5/6 rounded bg-surface" />
        <div className="h-4 w-3/4 rounded bg-surface" />
        <div className="mt-auto pt-2 border-t border-line flex justify-between">
          <div className="h-3 w-20 rounded bg-surface" />
          <div className="h-3 w-14 rounded bg-surface" />
        </div>
      </div>
    </div>
  )
}

export function ArticleCardSkeletonCompact() {
  return (
    <div className="border-b border-line py-4 animate-pulse px-1">
      <div className="flex gap-2 mb-2">
        <div className="h-3 w-16 rounded bg-surface" />
        <div className="h-3 w-12 rounded bg-surface" />
      </div>
      <div className="h-4 w-full rounded bg-surface mb-1.5" />
      <div className="h-4 w-4/5 rounded bg-surface" />
    </div>
  )
}
