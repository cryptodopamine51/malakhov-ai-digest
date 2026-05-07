import { config } from 'dotenv'
import { mkdir, appendFile } from 'fs/promises'
import { resolve } from 'path'
import { pathToFileURL } from 'url'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient, type Article } from '../lib/supabase'
import { sanitizeArticleMedia, type ArticleImageCandidate } from '../lib/media-sanitizer'
import { fetchArticleContent, type ExtractedImage } from '../pipeline/fetcher'

type ArticleMediaRow = Pick<
  Article,
  | 'id'
  | 'slug'
  | 'source_name'
  | 'original_url'
  | 'original_title'
  | 'original_text'
  | 'ru_title'
  | 'lead'
  | 'summary'
  | 'cover_image_url'
  | 'article_images'
  | 'created_at'
>

interface Args {
  apply: boolean
  limit: number | null
  slug: string | null
  source: string | null
}

interface BackfillChange {
  id: string
  slug: string | null
  sourceName: string
  previousCover: string | null
  nextCover: string | null
  previousImages: ArticleMediaRow['article_images']
  nextImages: { src: string; alt: string }[] | null
  reason: 'existing_invalid' | 'missing_cover' | 'svg_cover'
  fetched: boolean
  fetchErrorCode?: string | null
  rejects: { src: string; reason: string; alt?: string | null }[]
}

const PAGE_SIZE = 200
const FETCH_BATCH_SIZE = 20
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const TEXT_COVER_SOURCES = new Set(['Habr AI', 'vc.ru', 'vc.ru AI/стартапы', 'CNews'])

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, limit: null, slug: null, source: null }

  for (const arg of argv) {
    if (arg === '--apply') {
      args.apply = true
      continue
    }
    if (arg === '--dry-run') continue

    const [key, ...valueParts] = arg.split('=')
    const value = valueParts.join('=')
    if (key === '--limit') args.limit = Math.max(1, Number.parseInt(value, 10) || 1)
    if (key === '--slug') args.slug = value || null
    if (key === '--source') args.source = value || null
  }

  return args
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function increment(map: Map<string, number>, key: string, delta = 1): void {
  map.set(key, (map.get(key) ?? 0) + delta)
}

function isSvgUrl(value: string | null): boolean {
  if (!value) return false
  try {
    return new URL(value).pathname.toLowerCase().endsWith('.svg')
  } catch {
    return value.split(/[?#]/, 1)[0]?.toLowerCase().endsWith('.svg') ?? false
  }
}

function sameMedia(
  previousCover: string | null,
  previousImages: ArticleMediaRow['article_images'],
  nextCover: string | null,
  nextImages: { src: string; alt: string }[] | null,
): boolean {
  return previousCover === nextCover &&
    JSON.stringify(previousImages ?? null) === JSON.stringify(nextImages ?? null)
}

function contextFor(row: ArticleMediaRow) {
  return {
    sourceName: row.source_name,
    originalUrl: row.original_url,
    originalTitle: row.original_title,
    ruTitle: row.ru_title,
    lead: row.lead,
    summary: row.summary,
    originalText: row.original_text,
  }
}

function toImageCandidates(inlineImages: ExtractedImage[]): ArticleImageCandidate[] {
  return inlineImages.map((image) => ({
    src: image.src,
    alt: image.alt,
    title: image.title,
    caption: image.caption,
    width: image.width,
    height: image.height,
    parentClassName: image.parentClassName,
    parentId: image.parentId,
    parentHref: image.parentHref,
    nearestFigureClassName: image.nearestFigureClassName,
    nearestFigureId: image.nearestFigureId,
    source: 'inline',
  }))
}

async function fetchRows(offset: number, limit: number, args: Args): Promise<ArticleMediaRow[]> {
  const supabase = getServerClient()
  const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString()
  let query = supabase
    .from('articles')
    .select('id, slug, source_name, original_url, original_title, original_text, ru_title, lead, summary, cover_image_url, article_images, created_at')
    .eq('published', true)
    .eq('quality_ok', true)
    .eq('verified_live', true)
    .eq('publish_status', 'live')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (args.slug) query = query.eq('slug', args.slug)
  if (args.source) query = query.eq('source_name', args.source)

  const { data, error } = await query
  if (error) throw new Error(`article fetch failed: ${error.message}`)
  return (data ?? []) as ArticleMediaRow[]
}

async function applyChange(change: BackfillChange, auditPath: string): Promise<void> {
  const supabase = getServerClient()
  await appendFile(auditPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    article_id: change.id,
    slug: change.slug,
    source_name: change.sourceName,
    previous_cover_image_url: change.previousCover,
    previous_article_images: change.previousImages,
    next_cover_image_url: change.nextCover,
    next_article_images: change.nextImages,
    reason: change.reason,
    fetched: change.fetched,
    fetch_error_code: change.fetchErrorCode,
    rejects: change.rejects,
  }) + '\n', 'utf8')

  const { error } = await supabase
    .from('articles')
    .update({
      cover_image_url: change.nextCover,
      article_images: change.nextImages,
    })
    .eq('id', change.id)

  if (error) throw new Error(`update failed for ${change.id}: ${error.message}`)
}

async function buildChange(row: ArticleMediaRow): Promise<BackfillChange | null> {
  const context = contextFor(row)
  const sanitizedExisting = sanitizeArticleMedia({
    coverImageUrl: row.cover_image_url,
    articleImages: row.article_images,
    context,
  })
  const existingImages = sanitizedExisting.articleImages.length > 0 ? sanitizedExisting.articleImages : null
  const existingInvalid = Boolean(row.cover_image_url && !sanitizedExisting.coverImageUrl)
  const missingCover = !sanitizedExisting.coverImageUrl
  const svgCover = isSvgUrl(row.cover_image_url)
  const textCoverSource = TEXT_COVER_SOURCES.has(row.source_name)

  if (textCoverSource && !row.cover_image_url) return null
  if (!missingCover && !existingInvalid && !svgCover) return null

  let nextCover = sanitizedExisting.coverImageUrl
  let nextImages = existingImages
  let fetched = false
  let fetchErrorCode: string | null = null
  let rejects = [...sanitizedExisting.rejects]

  if (textCoverSource) {
    const reason = svgCover ? 'svg_cover'
      : existingInvalid ? 'existing_invalid'
      : 'missing_cover'

    if (sameMedia(row.cover_image_url, row.article_images, nextCover, nextImages)) return null

    return {
      id: row.id,
      slug: row.slug,
      sourceName: row.source_name,
      previousCover: row.cover_image_url,
      nextCover,
      previousImages: row.article_images,
      nextImages,
      reason,
      fetched,
      fetchErrorCode,
      rejects,
    }
  }

  if (!nextCover && sanitizedExisting.articleImages.length > 0) {
    nextCover = sanitizedExisting.articleImages[0]!.src
  }

  if (!nextCover || svgCover) {
    fetched = true
    const fetchedContent = await fetchArticleContent(row.original_url, { includeText: false })
    fetchErrorCode = fetchedContent.errorCode ?? null

    if (!fetchedContent.errorCode) {
      const fetchedSanitized = sanitizeArticleMedia({
        coverImageUrl: fetchedContent.imageUrl,
        articleImages: toImageCandidates(fetchedContent.inlineImages),
        context,
      })
      nextCover = fetchedSanitized.coverImageUrl ?? fetchedSanitized.articleImages[0]?.src ?? nextCover
      nextImages = fetchedSanitized.articleImages.length > 0 ? fetchedSanitized.articleImages : nextImages
      rejects = [...rejects, ...fetchedSanitized.rejects]
    }
  }

  const reason = svgCover ? 'svg_cover'
    : existingInvalid ? 'existing_invalid'
    : 'missing_cover'

  if (!fetched && sameMedia(row.cover_image_url, row.article_images, nextCover, nextImages)) return null

  return {
    id: row.id,
    slug: row.slug,
    sourceName: row.source_name,
    previousCover: row.cover_image_url,
    nextCover,
    previousImages: row.article_images,
    nextImages,
    reason,
    fetched,
    fetchErrorCode,
    rejects,
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const sourceStats = new Map<string, Map<string, number>>()
  const examples: string[] = []
  const changes: BackfillChange[] = []
  let scanned = 0
  let processed = 0
  let updated = 0
  let stillEmpty = 0
  let fetchFailed = 0
  let offset = 0
  let fetchesSinceSleep = 0
  const auditPath = resolve(
    process.cwd(),
    'tmp',
    `cover-backfill-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
  )

  if (args.apply) {
    await mkdir(resolve(process.cwd(), 'tmp'), { recursive: true })
  }

  while (args.limit === null || scanned < args.limit) {
    const remaining = args.limit === null ? PAGE_SIZE : Math.min(PAGE_SIZE, args.limit - scanned)
    if (remaining <= 0) break

    const rows = await fetchRows(offset, remaining, args)
    if (rows.length === 0) break

    for (const row of rows) {
      scanned++
      const change = await buildChange(row)
      if (!change) continue

      processed++
      changes.push(change)

      if (!sourceStats.has(row.source_name)) sourceStats.set(row.source_name, new Map())
      const byStatus = sourceStats.get(row.source_name)!
      increment(byStatus, 'processed')

      if (change.fetched) {
        fetchesSinceSleep++
        if (fetchesSinceSleep >= FETCH_BATCH_SIZE) {
          fetchesSinceSleep = 0
          await sleep(1000)
        }
      }

      if (change.fetchErrorCode) {
        fetchFailed++
        increment(byStatus, 'fetch_failed')
      } else if (change.nextCover) {
        updated++
        increment(byStatus, 'updated')
      } else {
        stillEmpty++
        increment(byStatus, 'still_empty')
      }

      if (examples.length < 30) {
        examples.push([
          row.slug ?? row.id,
          change.reason,
          change.previousCover ? `prev=${change.previousCover}` : 'prev=null',
          change.nextCover ? `next=${change.nextCover}` : 'next=null',
          change.fetchErrorCode ? `fetch=${change.fetchErrorCode}` : null,
        ].filter(Boolean).join(' | '))
      }

      if (args.apply) {
        await applyChange(change, auditPath)
      }
    }

    offset += rows.length
    if (rows.length < remaining) break
  }

  console.log(`mode: ${args.apply ? 'apply' : 'dry-run'}`)
  console.log(`scanned: ${scanned}`)
  console.log(`processed: ${processed}`)
  console.log(`updated: ${updated}`)
  console.log(`still_empty: ${stillEmpty}`)
  console.log(`fetch_failed: ${fetchFailed}`)
  console.log('by_source:')
  for (const [source, stats] of [...sourceStats.entries()].sort((a, b) => {
    return (b[1].get('processed') ?? 0) - (a[1].get('processed') ?? 0)
  })) {
    console.log(`  ${source}: processed=${stats.get('processed') ?? 0} updated=${stats.get('updated') ?? 0} still_empty=${stats.get('still_empty') ?? 0} fetch_failed=${stats.get('fetch_failed') ?? 0}`)
  }
  console.log('examples:')
  for (const example of examples) console.log(`  ${example}`)
  if (args.apply) console.log(`audit_file: ${auditPath}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
