import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { SITE_URL } from './site'

export interface GuideImage {
  src: string
  width: number
  height: number
  alt: string
  caption: string
}

export interface GuideRelatedLink {
  title: string
  description: string
  href: string
}

export interface GuideFaqItem {
  question: string
  answer: string
}

export interface GuideCta {
  eyebrow?: string
  title: string
  text: string
  action: string
  href: string
}

export interface GuideInlineCta extends GuideCta {
  afterHeading: string
}

export type GuideCaseSourcing = 'public' | 'anonymized' | 'editorial'

export interface GuideMeta {
  slug: string
  path: string
  noindex?: boolean
  title: string
  seoTitle: string
  description: string
  ogDescription: string
  category: string
  tags: string[]
  publishedAt: string
  updatedAt: string
  verifiedAt: string
  caseSourcing?: GuideCaseSourcing
  readingMinutes: number
  heroLead: string
  cover: GuideImage
  inlineImagesByHeading: Record<string, GuideImage>
  relatedLinks: GuideRelatedLink[]
  faq: GuideFaqItem[]
  inlineCtas?: GuideInlineCta[]
  ctaCards?: GuideCta[]
}

export interface Guide extends GuideMeta {
  markdown: string
}

type GetAllGuidesOptions = {
  includeNoindex?: boolean
}

const markdownCache = new Map<string, string>()
let guideMetaCache: GuideMeta[] | null = null

function getGuidesMetaDir(): string {
  return join(process.cwd(), 'content', 'guides', 'meta')
}

function readGuideMarkdown(slug: string): string {
  const cached = markdownCache.get(slug)
  if (cached) return cached

  const markdown = readFileSync(
    join(process.cwd(), 'content', 'guides', `${slug}.md`),
    'utf8',
  )
  markdownCache.set(slug, markdown)
  return markdown
}

function readGuideMetaFiles(): GuideMeta[] {
  if (guideMetaCache) return guideMetaCache

  const metaDir = getGuidesMetaDir()
  if (!existsSync(metaDir)) {
    guideMetaCache = []
    return guideMetaCache
  }

  const metas = readdirSync(metaDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const raw = readFileSync(join(metaDir, file), 'utf8')
      const parsed = JSON.parse(raw) as GuideMeta
      if (!parsed.verifiedAt) {
        parsed.verifiedAt = parsed.updatedAt
      }
      return parsed
    })
    .sort((left, right) => {
      return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime()
    })

  guideMetaCache = metas
  return metas
}

export function getAllGuides(options: GetAllGuidesOptions = {}): Guide[] {
  return readGuideMetaFiles()
    .filter((guideMeta) => options.includeNoindex || !guideMeta.noindex)
    .map((guideMeta) => ({
      ...guideMeta,
      markdown: readGuideMarkdown(guideMeta.slug),
    }))
}

export function getGuideBySlug(slug: string): Guide | null {
  const guideMeta = readGuideMetaFiles().find((item) => item.slug === slug)
  if (!guideMeta) return null

  return {
    ...guideMeta,
    markdown: readGuideMarkdown(guideMeta.slug),
  }
}

export function getGuideAbsoluteUrl(guide: Pick<Guide, 'path'>): string {
  return `${SITE_URL}${guide.path}`
}
