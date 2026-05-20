import { NextResponse } from 'next/server'
import { getLatestArticles } from '../../lib/articles'
import { getArticlePath } from '../../lib/article-slugs'
import { getAllGuides, getGuideAbsoluteUrl } from '../../lib/guides'
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '../../lib/site'

// LLM full-text dump for crawler/RAG consumption. Per https://llmstxt.org/
// the convention is `/llms-full.txt` providing the bulk of the site in
// Markdown for context windows.
//
// ISR: 1 hour. Stale-while-revalidate 24h.
// Size budget: ≤ 5 MB.
export const revalidate = 3600

const ARTICLE_LIMIT = 100

function truncate(value: string | null | undefined, max = 1200): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max).trimEnd()}…`
}

function escapeMarkdown(text: string | null | undefined): string {
  if (!text) return ''
  return text.replace(/\r\n?/g, '\n').trim()
}

export async function GET() {
  const guides = getAllGuides()
  const articles = await getLatestArticles(ARTICLE_LIMIT)

  const sections: string[] = []

  // Header.
  sections.push(`# ${SITE_NAME}`)
  sections.push('')
  sections.push(SITE_DESCRIPTION)
  sections.push('')
  sections.push(`Canonical URL: ${SITE_URL}`)
  sections.push(`Language: ru`)
  sections.push(`Last updated: ${new Date().toISOString()}`)
  sections.push('')

  // Guides (full markdown).
  if (guides.length > 0) {
    sections.push('---')
    sections.push('')
    sections.push('## Evergreen guides')
    sections.push('')
    for (const guide of guides) {
      sections.push(`### ${guide.title}`)
      sections.push('')
      sections.push(`URL: ${getGuideAbsoluteUrl(guide)}`)
      sections.push(`Description: ${escapeMarkdown(guide.description)}`)
      sections.push('')
      // Inline the full guide markdown — these are the highest-signal docs.
      sections.push(escapeMarkdown(guide.markdown))
      sections.push('')
    }
  }

  // News articles (recent 100).
  if (articles.length > 0) {
    sections.push('---')
    sections.push('')
    sections.push(`## Recent news articles (${articles.length})`)
    sections.push('')
    for (const article of articles) {
      const title = (article.ru_title ?? article.original_title ?? '').trim()
      if (!title || !article.slug) continue
      const url = `${SITE_URL}${getArticlePath(article.slug, article.primary_category)}`
      sections.push(`### ${title}`)
      sections.push('')
      sections.push(`URL: ${url}`)
      if (article.pub_date) sections.push(`Published: ${article.pub_date}`)
      if (article.source_name) sections.push(`Source: ${article.source_name}`)
      sections.push('')
      if (article.lead) {
        sections.push(`**Lead.** ${escapeMarkdown(article.lead)}`)
        sections.push('')
      }
      if (Array.isArray(article.summary) && article.summary.length > 0) {
        sections.push('Summary bullets:')
        for (const bullet of article.summary) {
          sections.push(`- ${escapeMarkdown(bullet)}`)
        }
        sections.push('')
      }
      const body = article.editorial_body ?? article.ru_text ?? ''
      if (body) {
        const paragraphs = body.split(/\n\s*\n/).slice(0, 2).map((p) => escapeMarkdown(p))
        sections.push(truncate(paragraphs.join('\n\n'), 1200))
        sections.push('')
      }
    }
  }

  let body = sections.join('\n') + '\n'

  // Soft 5 MB cap (UTF-8 byte length).
  const MAX_BYTES = 5 * 1024 * 1024
  const encoder = new TextEncoder()
  let bytes = encoder.encode(body)
  if (bytes.byteLength > MAX_BYTES) {
    body = body.slice(0, Math.floor(body.length * (MAX_BYTES / bytes.byteLength)))
    bytes = encoder.encode(body)
  }

  return new NextResponse(body, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
