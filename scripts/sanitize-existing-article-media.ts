import { config } from 'dotenv'
import { mkdir, appendFile } from 'fs/promises'
import { resolve } from 'path'
import { pathToFileURL } from 'url'
config({ path: resolve(process.cwd(), '.env.local') })

import { getServerClient, type Article } from '../lib/supabase'
import { sanitizeArticleMedia } from '../pipeline/media-sanitizer'

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

interface ChangedArticle {
  id: string
  slug: string | null
  sourceName: string
  previousCover: string | null
  nextCover: string | null
  previousImages: { src: string; alt?: string | null }[] | null
  nextImages: { src: string; alt: string }[] | null
  rejects: { src: string; reason: string; alt?: string | null }[]
}

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

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, canonicalJson(nestedValue)]),
    )
  }
  return value ?? null
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalJson(a)) === JSON.stringify(canonicalJson(b))
}

function increment(map: Map<string, number>, key: string, delta = 1): void {
  map.set(key, (map.get(key) ?? 0) + delta)
}

async function fetchRows(offset: number, pageSize: number, args: Args): Promise<ArticleMediaRow[]> {
  const supabase = getServerClient()
  let query = supabase
    .from('articles')
    .select('id, slug, source_name, original_url, original_title, original_text, ru_title, lead, summary, cover_image_url, article_images, created_at')
    .eq('published', true)
    .eq('quality_ok', true)
    .eq('verified_live', true)
    .eq('publish_status', 'live')
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  if (args.slug) query = query.eq('slug', args.slug)
  if (args.source) query = query.eq('source_name', args.source)

  const { data, error } = await query
  if (error) throw new Error(`article fetch failed: ${error.message}`)
  return (data ?? []) as ArticleMediaRow[]
}

async function applyChange(change: ChangedArticle, auditPath: string): Promise<void> {
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const pageSize = Math.min(args.limit ?? 200, 200)
  const reasonCounts = new Map<string, number>()
  const sourceCounts = new Map<string, number>()
  const examples: string[] = []
  const changes: ChangedArticle[] = []
  let scanned = 0
  let offset = 0
  let coverRemoved = 0
  let inlineRemoved = 0
  const auditPath = resolve(
    process.cwd(),
    'tmp',
    `media-sanitizer-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
  )

  if (args.apply) {
    await mkdir(resolve(process.cwd(), 'tmp'), { recursive: true })
  }

  while (args.limit === null || scanned < args.limit) {
    const remaining = args.limit === null ? pageSize : Math.min(pageSize, args.limit - scanned)
    if (remaining <= 0) break

    const rows = await fetchRows(offset, remaining, args)
    if (rows.length === 0) break

    for (const row of rows) {
      scanned++
      const sanitized = sanitizeArticleMedia({
        coverImageUrl: row.cover_image_url,
        articleImages: row.article_images,
        context: {
          sourceName: row.source_name,
          originalUrl: row.original_url,
          originalTitle: row.original_title,
          ruTitle: row.ru_title,
          lead: row.lead,
          summary: row.summary,
          originalText: row.original_text,
        },
      })

      const nextImages = sanitized.articleImages.length > 0 ? sanitized.articleImages : null
      const changed =
        row.cover_image_url !== sanitized.coverImageUrl ||
        !sameJson(row.article_images, nextImages)

      if (!changed) continue

      const change: ChangedArticle = {
        id: row.id,
        slug: row.slug,
        sourceName: row.source_name,
        previousCover: row.cover_image_url,
        nextCover: sanitized.coverImageUrl,
        previousImages: row.article_images,
        nextImages,
        rejects: sanitized.rejects,
      }
      changes.push(change)
      increment(sourceCounts, row.source_name)

      if (row.cover_image_url && !sanitized.coverImageUrl) coverRemoved++
      inlineRemoved += Math.max(0, (row.article_images?.length ?? 0) - sanitized.articleImages.length)

      for (const reject of sanitized.rejects) {
        increment(reasonCounts, reject.reason)
        if (examples.length < 20) {
          examples.push(`${row.slug ?? row.id} removed ${reject.src} reason=${reject.reason} caption="${reject.alt ?? ''}"`)
        }
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
  console.log(`changed: ${changes.length}`)
  console.log(`cover_removed: ${coverRemoved}`)
  console.log(`inline_removed: ${inlineRemoved}`)
  console.log('by_reason:')
  for (const [reason, count] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`)
  }
  console.log('by_source:')
  for (const [source, count] of [...sourceCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${source}: ${count}`)
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
