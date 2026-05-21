import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  getAllGuides,
  getGuideAbsoluteUrl,
  getGuideBySlug,
  type Guide,
  type GuideCta as GuideCtaConfig,
  type GuideImage,
} from '../../../lib/guides'
import { getGuideRelatedArticles } from '../../../lib/articles'
import { absoluteUrl, SITE_LOGO_URL, SITE_NAME, SITE_URL } from '../../../lib/site'
import ArticleRecommendations from '../../../src/components/ArticleRecommendations'
import { GuideBackToTop, GuideDesktopToc, GuideMobileToc } from '../../../src/components/GuideScrollTools'
import GuideTrackedLink from '../../../src/components/GuideTrackedLink'
import { guideArticleStyles } from '../../../src/components/guideArticleStyles'

export const revalidate = 86400

type HeadingBlock = { type: 'heading'; level: number; text: string; id: string }
type ParagraphBlock = { type: 'paragraph'; text: string }
type QuoteBlock = { type: 'blockquote'; text: string }
type ListBlock = { type: 'list'; ordered: boolean; items: string[] }
type TableBlock = { type: 'table'; headers: string[]; rows: string[][] }
type HrBlock = { type: 'hr' }
type MarkdownBlock = HeadingBlock | ParagraphBlock | QuoteBlock | ListBlock | TableBlock | HrBlock

const DIGEST_TELEGRAM_URL = process.env.NEXT_PUBLIC_TELEGRAM_CHANNEL_URL ?? 'https://t.me/malakhovaidigest'
const PERSONAL_TELEGRAM_URL = process.env.NEXT_PUBLIC_PERSONAL_TELEGRAM_URL ?? 'https://t.me/malakhovai'
const CONTACTS_URL = 'https://malakhovai.ru/contacts'
const METRIKA_ID = process.env.NEXT_PUBLIC_METRIKA_ID

export function generateStaticParams() {
  return getAllGuides({ includeNoindex: true }).map((guide) => ({ slug: guide.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const guide = getGuideBySlug(slug)
  if (!guide) return {}

  return {
    title: guide.seoTitle,
    description: guide.description,
    robots: guide.noindex
      ? {
          index: false,
          follow: false,
          googleBot: {
            index: false,
            follow: false,
          },
        }
      : undefined,
    alternates: { canonical: guide.path },
    openGraph: {
      title: guide.seoTitle,
      description: guide.ogDescription,
      type: 'article',
      url: getGuideAbsoluteUrl(guide),
      publishedTime: guide.publishedAt,
      modifiedTime: guide.updatedAt,
      images: [
        {
          url: guide.cover.src,
          width: guide.cover.width,
          height: guide.cover.height,
          alt: guide.cover.alt,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: guide.seoTitle,
      description: guide.ogDescription,
      images: [guide.cover.src],
    },
    other: {
      'twitter:url': getGuideAbsoluteUrl(guide),
    },
  }
}

export default async function GuideArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const guide = getGuideBySlug(slug)
  if (!guide) notFound()

  const rawBlocks = parseMarkdown(guide.markdown)
  const blocks = stripInlineToc(rawBlocks)
  if ((guide.inlineCtas?.length ?? 0) > 2) {
    console.warn(`[guides] ${guide.slug}: inlineCtas.length=${guide.inlineCtas?.length}, expected ≤ 2`)
  }
  const updatedDate = formatRuDate(guide.updatedAt)
  const verifiedDate = formatRuDate(guide.verifiedAt)
  const wordCount = countWords(guide.markdown)
  const jsonLd = buildJsonLd(guide, wordCount)
  const tocHeadings = blocks
    .filter(
      (block): block is HeadingBlock =>
        block.type === 'heading' && block.level === 2 && block.text !== 'Источники и данные',
    )
    .map(({ id, text }) => ({ id, text }))
  const relatedArticles = await getGuideRelatedArticles(guide.relatedArticleCategories ?? [])

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <article id="top" className={guideArticleStyles.article}>
        <nav className={guideArticleStyles.breadcrumbs} aria-label="Хлебные крошки">
          <Link href="/" className="transition-colors hover:text-ink">Главная</Link>
          <span aria-hidden>→</span>
          <Link href="/guides" className="transition-colors hover:text-ink">Гайды</Link>
          <span aria-hidden>→</span>
          <span>{guide.category}</span>
        </nav>

        <header className={guideArticleStyles.header}>
          <p className={guideArticleStyles.eyebrow}>
            Гайд · {guide.category}
          </p>
          <h1 className={guideArticleStyles.title}>
            {guide.title}
          </h1>
          <p className={guideArticleStyles.heroLead}>
            {guide.heroLead}
          </p>
          <div className={guideArticleStyles.meta}>
            <span>Обновлено: {updatedDate}</span>
            <span>Актуальность проверена: {verifiedDate}</span>
            <span>{guide.readingMinutes} мин чтения</span>
            <span>{guide.tags.slice(0, 2).join(' · ')}</span>
          </div>
        </header>

        <figure className={guideArticleStyles.cover}>
          <Image
            src={guide.cover.src}
            alt={guide.cover.alt}
            width={guide.cover.width}
            height={guide.cover.height}
            priority
            sizes="(max-width: 768px) 100vw, 1120px"
            className="h-auto w-full object-cover"
          />
          <figcaption className="border-t border-line px-4 py-3 text-sm text-muted">
            {guide.cover.caption}
          </figcaption>
        </figure>

        <GuideMobileToc headings={tocHeadings} />

        <div className={guideArticleStyles.layout}>
          <GuideDesktopToc headings={tocHeadings} />

          <div className={guideArticleStyles.content}>
            <MarkdownBlocks
              blocks={blocks}
              guide={guide}
              digestTelegramUrl={DIGEST_TELEGRAM_URL}
              personalTelegramUrl={PERSONAL_TELEGRAM_URL}
              contactsUrl={CONTACTS_URL}
            />
            <FinalGuideCta
              guide={guide}
              digestTelegramUrl={DIGEST_TELEGRAM_URL}
              personalTelegramUrl={PERSONAL_TELEGRAM_URL}
              contactsUrl={CONTACTS_URL}
            />
            <RelatedLinks guide={guide} />
            <RelatedGuideArticles articles={relatedArticles} />
          </div>
        </div>
      </article>
      <GuideBackToTop />
    </>
  )
}

function MarkdownBlocks({
  blocks,
  guide,
  digestTelegramUrl,
  personalTelegramUrl,
  contactsUrl,
}: {
  blocks: MarkdownBlock[]
  guide: Guide
  digestTelegramUrl: string
  personalTelegramUrl: string
  contactsUrl: string
}) {
  const nodes: ReactNode[] = []
  const sourceNodes: ReactNode[] = []
  let currentH2 = ''
  let collectingSources = false

  blocks.forEach((block, index) => {
    if (block.type === 'heading') {
      if (block.level === 1) return
      if (block.level === 2 && block.text === 'Источники и данные') {
        collectingSources = true
        return
      }
      if (block.level === 2) {
        collectingSources = false
        currentH2 = block.id
      }

      const targetNodes = collectingSources ? sourceNodes : nodes
      const image = guide.inlineImagesByHeading[block.id]
      const HeadingTag = block.level === 2 ? 'h2' : 'h3'
      targetNodes.push(
        <HeadingTag
          key={`heading-${block.id}-${index}`}
          id={block.id}
          className={
            block.level === 2
              ? guideArticleStyles.h2
              : guideArticleStyles.h3
          }
        >
          {renderInline(block.text)}
        </HeadingTag>,
      )

      if (image) {
        targetNodes.push(<GuideImageFigure key={`image-${block.id}`} image={image} />)
      }
      return
    }

    const targetNodes = collectingSources ? sourceNodes : nodes

    if (block.type === 'paragraph') {
      targetNodes.push(
        <p key={`paragraph-${index}`} className={guideArticleStyles.paragraph}>
          {renderInline(block.text)}
        </p>,
      )
      return
    }

    if (block.type === 'blockquote') {
      targetNodes.push(
        <blockquote key={`quote-${index}`} className={guideArticleStyles.quote}>
          {renderInline(block.text)}
        </blockquote>,
      )
      return
    }

    if (block.type === 'list') {
      const ListTag = block.ordered ? 'ol' : 'ul'
      targetNodes.push(
        <ListTag
          key={`list-${index}`}
          className={`${guideArticleStyles.list} ${block.ordered ? 'list-decimal' : 'list-disc'}`}
        >
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ListTag>,
      )
      return
    }

    if (block.type === 'table') {
      targetNodes.push(<MarkdownTable key={`table-${index}`} table={block} />)
      return
    }

    if (block.type === 'hr') {
      targetNodes.push(<hr key={`hr-${index}`} className={guideArticleStyles.separator} />)
      if (collectingSources) return
      guide.inlineCtas
        ?.filter((cta) => cta.afterHeading === currentH2)
        .forEach((cta, ctaIndex) => {
          nodes.push(
            <GuideCta
              key={`inline-cta-${currentH2}-${ctaIndex}`}
              cta={cta}
              guide={guide}
              digestTelegramUrl={digestTelegramUrl}
              personalTelegramUrl={personalTelegramUrl}
              contactsUrl={contactsUrl}
              placement="inline"
            />,
          )
        })
    }
  })

  return (
    <>
      {nodes}
      {sourceNodes.length > 0 && <SourcesDisclosure>{sourceNodes}</SourcesDisclosure>}
    </>
  )
}

function SourcesDisclosure({ children }: { children: ReactNode }) {
  return (
    <details className="mt-12 border-t border-line pt-6 text-sm text-muted">
      <summary className="cursor-pointer select-none font-semibold text-muted transition-colors hover:text-ink">
        Источники и данные
      </summary>
      <div className="mt-5 text-[15px] leading-relaxed text-muted [&_a]:text-accent [&_a]:underline [&_a]:decoration-accent/35">
        {children}
      </div>
    </details>
  )
}

function MarkdownTable({ table }: { table: TableBlock }) {
  return (
    <div className={guideArticleStyles.tableWrap}>
      <table className="min-w-[640px] w-full text-left text-sm text-ink">
        <thead className="bg-surface">
          <tr>
            {table.headers.map((header, index) => (
              <th key={index} className="border-b border-line px-4 py-3 font-semibold">
                {renderInline(header)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-line last:border-b-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-4 py-3 align-top">
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GuideImageFigure({ image }: { image: GuideImage }) {
  return (
    <figure className={guideArticleStyles.mediaFigure}>
      <Image
        src={image.src}
        alt={image.alt}
        width={image.width}
        height={image.height}
        loading="lazy"
        sizes="(max-width: 768px) 100vw, 760px"
        className="h-auto w-full"
      />
      <figcaption className="border-t border-line px-4 py-3 text-sm text-muted">
        {image.caption}
      </figcaption>
    </figure>
  )
}

function GuideCta({
  cta,
  guide,
  digestTelegramUrl,
  personalTelegramUrl,
  contactsUrl,
  placement,
}: {
  cta: GuideCtaConfig
  guide: Guide
  digestTelegramUrl: string
  personalTelegramUrl: string
  contactsUrl: string
  placement: string
}) {
  const href = resolveCtaHref(cta.href, guide, cta, placement, {
    contactsUrl,
    digestTelegramUrl,
    personalTelegramUrl,
  })
  const isExternal = href.startsWith('http')
  const tracking = buildCtaTracking(guide, cta, placement)

  return (
    <section className={guideArticleStyles.inlineCta}>
      <p className="mb-2 text-[12px] font-semibold uppercase text-accent">
        {cta.eyebrow ?? 'Следующий шаг'}
      </p>
      <h2 className="font-serif text-xl font-bold text-ink">
        {cta.title}
      </h2>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        {cta.text}
      </p>
      <GuideTrackedLink
        href={href}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noopener noreferrer' : undefined}
        goal={tracking.goal}
        metrikaId={METRIKA_ID}
        params={tracking.params}
        className="mt-4 inline-flex rounded border border-ink px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-ink hover:text-[var(--base)]"
      >
        {cta.action}
      </GuideTrackedLink>
    </section>
  )
}

const DEFAULT_FINAL_CTA_CARDS: GuideCtaConfig[] = [
  {
    title: 'Чеклист за 30 минут',
    text: 'Быстро выберите первый ИИ-проект и подготовьте пилот на 30-90 дней.',
    action: 'Получить чеклист',
    href: 'telegram-personal',
    intent: 'implementation_checklist',
  },
  {
    title: 'AI-новости в TG',
    text: 'Подписка на короткий дайджест главных событий, инструментов и кейсов ИИ.',
    action: 'Подписаться на дайджест',
    href: 'telegram-digest',
    intent: 'daily_ai_news_digest',
  },
  {
    title: 'Архитектурный разбор ИИ',
    text: 'Разберите процессы, данные, риски и экономику до старта разработки.',
    action: 'Оставить заявку',
    href: 'contacts',
    intent: 'architecture_review',
  },
]

function FinalGuideCta({
  guide,
  digestTelegramUrl,
  personalTelegramUrl,
  contactsUrl,
}: {
  guide: Guide
  digestTelegramUrl: string
  personalTelegramUrl: string
  contactsUrl: string
}) {
  const items = guide.ctaCards?.length ? guide.ctaCards : DEFAULT_FINAL_CTA_CARDS

  return (
    <section className={guideArticleStyles.endSection}>
      <p className="mb-2 text-[12px] font-semibold uppercase text-accent">Дальше</p>
      <h2 className="font-serif text-[26px] font-bold text-ink">Что можно сделать после чтения</h2>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {items.map((item) => {
          const href = resolveCtaHref(item.href, guide, item, 'final', {
            contactsUrl,
            digestTelegramUrl,
            personalTelegramUrl,
          })
          const isExternal = href.startsWith('http')
          const tracking = buildCtaTracking(guide, item, 'final')
          return (
            <div key={item.title} className="rounded border border-line bg-base p-5">
              <h3 className="text-base font-semibold text-ink">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{item.text}</p>
              <GuideTrackedLink
                href={href}
                target={isExternal ? '_blank' : undefined}
                rel={isExternal ? 'noopener noreferrer' : undefined}
                goal={tracking.goal}
                metrikaId={METRIKA_ID}
                params={tracking.params}
                className="mt-4 inline-flex text-sm font-semibold text-accent hover:underline"
              >
                {item.action}
              </GuideTrackedLink>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function resolveCtaHref(
  href: string,
  guide: Guide,
  cta: GuideCtaConfig,
  placement: string,
  urls: {
    contactsUrl: string
    digestTelegramUrl: string
    personalTelegramUrl: string
  },
): string {
  if (href === 'telegram' || href === 'telegram-personal') return urls.personalTelegramUrl
  if (href === 'telegram-digest') return urls.digestTelegramUrl
  if (href === 'contacts') return buildContactsUrl(urls.contactsUrl, guide, cta, placement)
  return href
}

function buildContactsUrl(baseUrl: string, guide: Guide, cta: GuideCtaConfig, placement: string): string {
  const url = new URL(baseUrl)
  url.searchParams.set('utm_source', 'news_malakhovai_ru')
  url.searchParams.set('utm_medium', 'guide_cta')
  url.searchParams.set('utm_campaign', `guide_${guide.slug}`)
  url.searchParams.set('utm_content', `${placement}_${slugifyTrackingValue(cta.title)}`)
  url.searchParams.set('lead_source', 'news_guide')
  url.searchParams.set('article_slug', guide.slug)
  url.searchParams.set('article_title', guide.title)
  url.searchParams.set('cta_title', cta.title)
  url.searchParams.set('cta_action', cta.action)
  url.searchParams.set('intent', cta.intent ?? slugifyTrackingValue(cta.title))
  url.searchParams.set(
    'lead_context',
    `Заявка со статьи "${guide.title}", CTA "${cta.title}", intent "${cta.intent ?? slugifyTrackingValue(cta.title)}"`,
  )
  return url.toString()
}

function buildCtaTracking(guide: Guide, cta: GuideCtaConfig, placement: string) {
  const isContact = cta.href === 'contacts'
  return {
    goal: isContact ? 'guide_contact_click' : 'guide_telegram_click',
    params: {
      article_slug: guide.slug,
      article_title: guide.title,
      cta_title: cta.title,
      cta_action: cta.action,
      cta_href: cta.href,
      intent: cta.intent ?? slugifyTrackingValue(cta.title),
      placement,
    },
  }
}

function slugifyTrackingValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
}

function RelatedLinks({ guide }: { guide: Guide }) {
  return (
    <section className={guideArticleStyles.endSection}>
      <p className="mb-2 text-[12px] font-semibold uppercase text-muted">Что читать дальше</p>
      <h2 className="font-serif text-[26px] font-bold text-ink">Связанные разделы</h2>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {guide.relatedLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded border border-line p-5 transition-colors hover:border-accent"
          >
            <h3 className="text-base font-semibold text-ink">{link.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{link.description}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}

function RelatedGuideArticles({ articles }: { articles: Awaited<ReturnType<typeof getGuideRelatedArticles>> }) {
  if (articles.length === 0) return null

  return (
    <section className={guideArticleStyles.endSection}>
      <p className="mb-2 text-[12px] font-semibold uppercase text-muted">По теме</p>
      <h2 className="font-serif text-[26px] font-bold text-ink">Связанные статьи</h2>
      <div className="mt-5">
        <ArticleRecommendations articles={articles} />
      </div>
    </section>
  )
}

function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.split(/\r?\n/)
  const blocks: MarkdownBlock[] = []
  const headingCounts = new Map<string, number>()
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed)
    if (heading) {
      const text = heading[2].trim()
      const baseId = slugifyHeading(text)
      const count = headingCounts.get(baseId) ?? 0
      headingCounts.set(baseId, count + 1)
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        text,
        id: count === 0 ? baseId : `${baseId}-${count + 1}`,
      })
      index += 1
      continue
    }

    if (trimmed === '---') {
      blocks.push({ type: 'hr' })
      index += 1
      continue
    }

    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = []
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push({ type: 'blockquote', text: quoteLines.join(' ') })
      continue
    }

    if (isTableStart(lines, index)) {
      const headers = splitTableRow(lines[index])
      index += 2
      const rows: string[][] = []
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        rows.push(splitTableRow(lines[index]))
        index += 1
      }
      blocks.push({ type: 'table', headers, rows })
      continue
    }

    const unordered = /^-\s+(.+)$/.exec(trimmed)
    const ordered = /^\d+\.\s+(.+)$/.exec(trimmed)
    if (unordered || ordered) {
      const isOrdered = Boolean(ordered)
      const items: string[] = []
      while (index < lines.length) {
        const itemLine = lines[index].trim()
        const match = isOrdered ? /^\d+\.\s+(.+)$/.exec(itemLine) : /^-\s+(.+)$/.exec(itemLine)
        if (!match) break
        items.push(match[1])
        index += 1
      }
      blocks.push({ type: 'list', ordered: isOrdered, items })
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length && !isBlockStart(lines, index)) {
      const paragraphLine = lines[index].trim()
      if (paragraphLine) paragraphLines.push(paragraphLine)
      index += 1
    }

    if (paragraphLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') })
    }
  }

  return blocks
}

function isBlockStart(lines: string[], index: number): boolean {
  const trimmed = lines[index]?.trim() ?? ''
  if (!trimmed) return true
  return (
    /^#{1,3}\s+/.test(trimmed) ||
    trimmed === '---' ||
    trimmed.startsWith('>') ||
    /^-\s+/.test(trimmed) ||
    /^\d+\.\s+/.test(trimmed) ||
    isTableStart(lines, index)
  )
}

function isTableStart(lines: string[], index: number): boolean {
  const current = lines[index]?.trim() ?? ''
  const next = lines[index + 1]?.trim() ?? ''
  return current.startsWith('|') && isTableSeparator(next)
}

function isTableSeparator(line: string): boolean {
  if (!line.startsWith('|')) return false
  const cells = splitTableRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s-]+/gu, '')
    .trim()
    .replace(/[\s-]+/g, '-')
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const tokenPattern = /(\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`]+)`|https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }

    const [token, , linkLabel, href, boldText, italicText, codeText] = match
    const key = `${match.index}-${token}`

    if (linkLabel && href) {
      nodes.push(renderLink(href, linkLabel, key))
    } else if (boldText) {
      nodes.push(<strong key={key} className="font-semibold">{boldText}</strong>)
    } else if (italicText) {
      nodes.push(<em key={key}>{italicText}</em>)
    } else if (codeText) {
      nodes.push(<code key={key} className="rounded bg-surface px-1 py-0.5 font-mono text-[0.9em]">{codeText}</code>)
    } else if (token.startsWith('http')) {
      nodes.push(renderLink(token, token, key))
    }

    lastIndex = tokenPattern.lastIndex
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes
}

function renderLink(href: string, label: string, key: string): ReactNode {
  if (href.startsWith('#')) {
    return (
      <a key={key} href={href} className="text-accent underline decoration-accent/35 hover:decoration-accent">
        {label}
      </a>
    )
  }

  if (href.startsWith('/')) {
    return (
      <Link key={key} href={href} className="text-accent underline decoration-accent/35 hover:decoration-accent">
        {label}
      </Link>
    )
  }

  return (
    <a
      key={key}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent underline decoration-accent/35 hover:decoration-accent"
    >
      {label}
    </a>
  )
}

function formatRuDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value))
}

function countWords(markdown: string): number {
  const tokens = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#>*_|\-]+/g, ' ')
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token))
  return tokens.length
}

function stripInlineToc(blocks: MarkdownBlock[]): MarkdownBlock[] {
  const result: MarkdownBlock[] = []
  let i = 0
  while (i < blocks.length) {
    const block = blocks[i]
    if (block.type === 'heading' && block.text === 'Оглавление') {
      let j = i + 1
      if (blocks[j]?.type === 'list') j += 1
      if (result[result.length - 1]?.type === 'hr' && blocks[j]?.type === 'hr') {
        j += 1
      }
      i = j
      continue
    }
    result.push(block)
    i += 1
  }
  return result
}

function buildJsonLd(guide: Guide, wordCount: number) {
  const url = getGuideAbsoluteUrl(guide)
  const personId = `${SITE_URL}/about#person`
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: guide.title,
    description: guide.description,
    image: [absoluteUrl(guide.cover.src)],
    datePublished: guide.publishedAt,
    dateModified: guide.updatedAt,
    inLanguage: 'ru-RU',
    mainEntityOfPage: url,
    articleSection: guide.category,
    keywords: guide.tags.join(', '),
    wordCount,
    author: {
      '@type': 'Person',
      '@id': personId,
      name: 'Иван Малахов',
      url: `${SITE_URL}/about`,
      jobTitle: 'Editor, Malakhov AI Digest',
    },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
      logo: { '@type': 'ImageObject', url: SITE_LOGO_URL },
    },
  }

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Главная',
        item: SITE_URL,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Гайды',
        item: `${SITE_URL}/guides`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: guide.title,
        item: url,
      },
    ],
  }

  if (guide.faq.length === 0) {
    return [articleSchema, breadcrumbSchema]
  }

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: guide.faq.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  }

  return [articleSchema, faqSchema, breadcrumbSchema]
}
