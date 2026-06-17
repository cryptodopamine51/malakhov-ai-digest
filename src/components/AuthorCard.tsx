import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  CONTACTS_URL,
  EDITOR_IMAGE_PATH,
  EDITOR_NAME,
  EDITOR_PATH,
  PERSONAL_TELEGRAM_URL,
  SERVICES_PATH,
} from '../../lib/site'

const EDITOR_ROLE = 'AI-архитектор · внедряю ИИ в бизнес'

type AuthorCtaContext = {
  medium?: string
  campaign?: string
  content?: string
  articleSlug?: string | null
  articleTitle?: string | null
  guideSlug?: string | null
  guideTitle?: string | null
}

// Single author card shared by guides and news. Personal Telegram stays
// separate from consultation and implementation requests so analytics can
// distinguish low-friction contact from lead-form intent.
export default function AuthorCard({
  consultationHref = 'contacts',
  ctaContext,
  className = '',
}: {
  consultationHref?: 'services' | 'contacts'
  ctaContext?: AuthorCtaContext
  className?: string
}) {
  const consultationUrl = consultationHref === 'contacts'
    ? buildContactUrl('consultation', 'Консультация', ctaContext)
    : buildServicesUrl('consultation', ctaContext)
  const implementationUrl = buildContactUrl('implementation_request', 'Заявка на внедрение', ctaContext)

  return (
    <aside
      className={`flex flex-col gap-4 rounded border border-line bg-surface p-5 sm:flex-row sm:items-center ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={EDITOR_IMAGE_PATH}
        alt={EDITOR_NAME}
        width={72}
        height={72}
        loading="lazy"
        className="h-[72px] w-[72px] flex-shrink-0 rounded-full border border-line object-cover"
      />
      <div className="flex-1">
        <Link href={EDITOR_PATH} className="text-base font-semibold text-ink hover:text-accent">
          {EDITOR_NAME}
        </Link>
        <p className="mt-0.5 text-sm text-muted">{EDITOR_ROLE}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={PERSONAL_TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className={secondaryButtonClass}>
            Личный Telegram
          </a>
          <ActionLink href={consultationUrl} className={secondaryButtonClass}>
            Консультация
          </ActionLink>
          <a href={implementationUrl} target="_blank" rel="noopener noreferrer" className={primaryButtonClass}>
            Заявка на внедрение
          </a>
        </div>
      </div>
    </aside>
  )
}

const secondaryButtonClass =
  'inline-flex rounded border border-line px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent'
const primaryButtonClass =
  'inline-flex rounded border border-ink px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-ink hover:text-[var(--base)]'

function ActionLink({
  href,
  className,
  children,
}: {
  href: string
  className: string
  children: ReactNode
}) {
  if (href.startsWith('http')) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    )
  }

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  )
}

function buildServicesUrl(intent: string, context?: AuthorCtaContext): string {
  const params = buildTrackingParams(intent, context)
  return `${SERVICES_PATH}?${params.toString()}`
}

function buildContactUrl(intent: string, action: string, context?: AuthorCtaContext): string {
  const url = new URL(CONTACTS_URL)
  const params = buildTrackingParams(intent, context)
  params.set('cta_action', action)
  params.forEach((value, key) => url.searchParams.set(key, value))
  return url.toString()
}

function buildTrackingParams(intent: string, context?: AuthorCtaContext): URLSearchParams {
  const params = new URLSearchParams()
  params.set('utm_source', 'news_malakhovai_ru')
  params.set('utm_medium', context?.medium ?? 'author_card')
  params.set('utm_campaign', context?.campaign ?? 'author_card')
  params.set('utm_content', [context?.content, intent].filter(Boolean).join('_') || intent)
  params.set('lead_source', 'news_author_card')
  params.set('intent', intent)

  if (context?.articleSlug) params.set('article_slug', context.articleSlug)
  if (context?.articleTitle) params.set('article_title', context.articleTitle)
  if (context?.guideSlug) params.set('guide_slug', context.guideSlug)
  if (context?.guideTitle) params.set('guide_title', context.guideTitle)

  return params
}
