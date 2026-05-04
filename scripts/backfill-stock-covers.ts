import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { config as loadDotenv, parse as parseDotenv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

loadDotenv({ path: resolve(process.cwd(), '.env.local') })
loadDotenv({ path: resolve(process.cwd(), '.env') })
loadExtraEnv(resolve(process.cwd(), 'malakhov-ai-keys.env'))

const BUCKET = 'article-images'
const OUTPUT_WIDTH = 1400
const OUTPUT_HEIGHT = 788
const WEBP_QUALITY = 84
const MOSCOW_OFFSET = '+03:00'

const TEXT_COVER_SOURCES = new Set(['Habr AI', 'vc.ru', 'CNews'])

type Provider = 'pexels' | 'unsplash' | 'pixabay'

interface ArticleRow {
  id: string
  slug: string
  ru_title: string
  original_title: string
  source_name: string
  topics: string[] | null
  primary_category: string | null
  pub_date: string | null
  created_at: string
  cover_image_url: string | null
  score: number | null
}

interface StockCandidate {
  provider: Provider
  id: string
  imageUrl: string
  pageUrl: string
  photographer: string
  photographerUrl?: string | null
  alt?: string | null
  avgColor?: string | null
}

interface ProcessResult {
  article: ArticleRow
  query: string
  stock: StockCandidate
  publicUrl: string | null
  storagePath: string | null
  applied: boolean
}

const args = new Map<string, string | boolean>()
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--') && arg.includes('=')) {
    const raw = arg.slice(2)
    const separator = raw.indexOf('=')
    const key = raw.slice(0, separator)
    const value = raw.slice(separator + 1)
    args.set(key, value)
  } else if (arg.startsWith('--')) {
    args.set(arg.slice(2), true)
  }
}

const apply = args.has('apply')
const limit = Number(args.get('limit') ?? 20)
const explicitDate = typeof args.get('date') === 'string' ? String(args.get('date')) : null
const latestDay = args.has('latest-day') || !explicitDate

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY')
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const date = explicitDate ?? await getLatestLiveCreatedDateMsk(supabase)
  const { startIso, endIso } = getMoscowDayBounds(date)

  const { data, error } = await supabase
    .from('articles')
    .select('id, slug, ru_title, original_title, source_name, topics, primary_category, pub_date, created_at, cover_image_url, score')
    .eq('published', true)
    .eq('quality_ok', true)
    .not('slug', 'is', null)
    .not('ru_title', 'is', null)
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .order('score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error

  const candidates = ((data ?? []) as ArticleRow[])
    .filter(needsGeneratedCover)
    .slice(0, limit)

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    date_msk: date,
    latest_day_mode: latestDay,
    window_utc: { start: startIso, end: endIso },
    selected_count: candidates.length,
    selected: candidates.map((article) => ({
      slug: article.slug,
      title: article.ru_title,
      source: article.source_name,
      score: article.score,
      category: article.primary_category,
      had_cover: Boolean(article.cover_image_url),
    })),
  }, null, 2))

  if (!candidates.length) return

  const results: ProcessResult[] = []
  for (const article of candidates) {
    const query = buildSearchQuery(article)
    const stock = await pickStockCandidate(query, article)
    console.log(`\n${apply ? 'APPLY' : 'DRY'} ${article.slug}`)
    console.log(`  query: ${query}`)
    console.log(`  stock: ${stock.provider}:${stock.id} ${stock.photographer}`)

    if (!apply) {
      results.push({ article, query, stock, publicUrl: null, storagePath: null, applied: false })
      continue
    }

    const raw = await downloadImage(stock.imageUrl)
    const treated = await renderEditorialTreatment(raw, article, stock)
    const storagePath = `stock-covers/${date}/${article.slug}-${stock.provider}-${stock.id}-${Date.now()}.webp`

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, treated, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: false,
    })
    if (uploadError) throw new Error(`Storage upload failed for ${article.slug}: ${uploadError.message}`)

    const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath)
    const publicUrl = publicData.publicUrl

    const { error: updateError } = await supabase
      .from('articles')
      .update({ cover_image_url: publicUrl })
      .eq('id', article.id)
    if (updateError) throw new Error(`Article update failed for ${article.slug}: ${updateError.message}`)

    console.log(`  stored: ${publicUrl}`)
    results.push({ article, query, stock, publicUrl, storagePath, applied: true })
  }

  console.log('\nRESULTS')
  console.log(JSON.stringify(results.map((result) => ({
    slug: result.article.slug,
    title: result.article.ru_title,
    provider: result.stock.provider,
    stock_id: result.stock.id,
    photographer: result.stock.photographer,
    stock_url: result.stock.pageUrl,
    image_url: result.publicUrl,
    storage_path: result.storagePath,
    applied: result.applied,
  })), null, 2))
}

function loadExtraEnv(path: string) {
  if (!existsSync(path)) return

  const raw = readFileSync(path, 'utf8')
  const parsed = safeParseEnv(raw)
  if (/^\\{\\rtf/.test(raw)) {
    try {
      const plain = execFileSync('textutil', ['-convert', 'txt', '-stdout', path], { encoding: 'utf8' })
      Object.assign(parsed, safeParseEnv(plain))
    } catch {
      // Raw RTF often still contains plain KEY=value runs; use those if textutil is unavailable.
    }
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (!process.env[key]) process.env[key] = value
  }
}

function safeParseEnv(text: string): Record<string, string> {
  const parsed: Record<string, string> = {}
  Object.assign(parsed, parseDotenv(text))

  const keyValueRe = /([A-Z][A-Z0-9_]{2,})=([^\\\r\n{}]+)/g
  for (const match of text.matchAll(keyValueRe)) {
    const key = match[1]
    const value = match[2].trim().replace(/^["']|["']$/g, '')
    if (value) parsed[key] = value
  }
  return parsed
}

async function getLatestLiveCreatedDateMsk(supabase: any): Promise<string> {
  const { data, error } = await supabase
    .from('articles')
    .select('created_at')
    .eq('published', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data?.created_at) throw new Error('No published articles found')

  return toMoscowDate(data.created_at)
}

function getMoscowDayBounds(date: string) {
  const start = new Date(`${date}T00:00:00${MOSCOW_OFFSET}`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

function toMoscowDate(iso: string): string {
  const date = new Date(iso)
  const moscow = new Date(date.getTime() + 3 * 60 * 60 * 1000)
  return moscow.toISOString().slice(0, 10)
}

function needsGeneratedCover(article: ArticleRow): boolean {
  if (!article.cover_image_url) return true
  if (!TEXT_COVER_SOURCES.has(article.source_name)) return false
  return !isArticleImagesStorageUrl(article.cover_image_url)
}

function isArticleImagesStorageUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.pathname.includes('/storage/v1/object/public/article-images/')
  } catch {
    return false
  }
}

function buildSearchQuery(article: ArticleRow): string {
  const text = `${article.ru_title} ${article.original_title} ${(article.topics ?? []).join(' ')} ${article.primary_category ?? ''}`.toLowerCase()

  if (/безопас|уязв|security|sast|сканер|защит/.test(text)) return 'cybersecurity server room abstract technology'
  if (/код|developer|разработ|codex|claude code|kubernetes|go\b|debug|llm|агент/.test(text)) return 'software development code screen technology'
  if (/grok|gpt|kimi|minimax|model|модель|токен|подписк/.test(text)) return 'abstract artificial intelligence data center'
  if (/data|данн|центр|server|космос|space|nasa|google/.test(text)) return 'data center architecture technology'
  if (/шизофрен|аутизм|медиц|био|brain|neuro|фристон/.test(text)) return 'neuroscience research laboratory abstract'
  if (/office|офис|сотрудник|team|команд/.test(text)) return 'modern office architecture work technology'
  if (/курс|урок|образован|otus|classroom|learning/.test(text)) return 'computer classroom learning technology'
  if (/финанс|инвест|цена|рынок|стартап|round|arr/.test(text)) return 'financial data screens abstract business'

  switch (article.primary_category) {
    case 'coding':
    case 'ai-russia':
      return 'software engineering workspace abstract technology'
    case 'ai-research':
    case 'ai-labs':
      return 'research laboratory abstract technology'
    case 'ai-investments':
      return 'financial data screens technology'
    case 'ai-startups':
      return 'startup office technology'
    default:
      return 'abstract technology editorial'
  }
}

async function pickStockCandidate(query: string, article: ArticleRow): Promise<StockCandidate> {
  if (process.env.PEXELS_API_KEY) {
    try {
      const pexels = await searchPexels(query)
      if (pexels.length) return pexels[hashToIndex(article.slug, pexels.length)]
    } catch (error) {
      console.warn(`  pexels failed: ${(error as Error).message}`)
    }
  }

  if (process.env.UNSPLASH_ACCESS_KEY) {
    try {
      const unsplash = await searchUnsplash(query)
      if (unsplash.length) return unsplash[hashToIndex(article.slug, unsplash.length)]
    } catch (error) {
      console.warn(`  unsplash failed: ${(error as Error).message}`)
    }
  }

  if (process.env.PIXABAY_API_KEY) {
    const pixabay = await searchPixabay(query)
    if (pixabay.length) return pixabay[hashToIndex(article.slug, pixabay.length)]
  }

  throw new Error('No stock candidates found or no stock API keys configured')
}

async function searchPexels(query: string): Promise<StockCandidate[]> {
  const url = new URL('https://api.pexels.com/v1/search')
  url.searchParams.set('query', query)
  url.searchParams.set('orientation', 'landscape')
  url.searchParams.set('per_page', '18')

  const response = await fetch(url, {
    headers: { Authorization: process.env.PEXELS_API_KEY! },
  })
  if (!response.ok) throw new Error(`Pexels ${response.status}: ${await response.text()}`)
  const body = await response.json() as {
    photos?: Array<{
      id: number
      url: string
      photographer: string
      photographer_url: string
      alt: string
      avg_color: string
      src: { large2x?: string; large?: string; original?: string }
    }>
  }

  return (body.photos ?? [])
    .filter((photo) => photo.src.large2x || photo.src.large || photo.src.original)
    .map((photo) => ({
      provider: 'pexels',
      id: String(photo.id),
      imageUrl: photo.src.large2x ?? photo.src.large ?? photo.src.original!,
      pageUrl: photo.url,
      photographer: photo.photographer,
      photographerUrl: photo.photographer_url,
      alt: photo.alt,
      avgColor: photo.avg_color,
    }))
}

async function searchUnsplash(query: string): Promise<StockCandidate[]> {
  const url = new URL('https://api.unsplash.com/search/photos')
  url.searchParams.set('query', query)
  url.searchParams.set('orientation', 'landscape')
  url.searchParams.set('per_page', '18')

  const response = await fetch(url, {
    headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY!}` },
  })
  if (!response.ok) throw new Error(`Unsplash ${response.status}: ${await response.text()}`)
  const body = await response.json() as {
    results?: Array<{
      id: string
      links: { html: string }
      alt_description: string | null
      color: string | null
      user: { name: string; links?: { html?: string } }
      urls: { regular?: string; full?: string; raw?: string }
    }>
  }

  return (body.results ?? [])
    .filter((photo) => photo.urls.regular || photo.urls.full || photo.urls.raw)
    .map((photo) => ({
      provider: 'unsplash',
      id: photo.id,
      imageUrl: photo.urls.regular ?? photo.urls.full ?? photo.urls.raw!,
      pageUrl: photo.links.html,
      photographer: photo.user.name,
      photographerUrl: photo.user.links?.html,
      alt: photo.alt_description,
      avgColor: photo.color,
    }))
}

async function searchPixabay(query: string): Promise<StockCandidate[]> {
  const url = new URL('https://pixabay.com/api/')
  url.searchParams.set('key', process.env.PIXABAY_API_KEY!)
  url.searchParams.set('q', query)
  url.searchParams.set('image_type', 'photo')
  url.searchParams.set('orientation', 'horizontal')
  url.searchParams.set('safesearch', 'true')
  url.searchParams.set('per_page', '18')

  const response = await fetch(url)
  if (!response.ok) throw new Error(`Pixabay ${response.status}: ${await response.text()}`)
  const body = await response.json() as {
    hits?: Array<{
      id: number
      pageURL: string
      largeImageURL: string
      webformatURL: string
      user: string
      userImageURL?: string
    }>
  }

  return (body.hits ?? [])
    .filter((photo) => photo.largeImageURL || photo.webformatURL)
    .map((photo) => ({
      provider: 'pixabay',
      id: String(photo.id),
      imageUrl: photo.largeImageURL || photo.webformatURL,
      pageUrl: photo.pageURL,
      photographer: photo.user,
      photographerUrl: null,
      alt: query,
      avgColor: null,
    }))
}

async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Image download failed ${response.status}: ${url}`)
  return Buffer.from(await response.arrayBuffer())
}

async function renderEditorialTreatment(input: Buffer, article: ArticleRow, stock: StockCandidate): Promise<Buffer> {
  const seed = hashInt(`${article.slug}|${stock.provider}|${stock.id}`)
  const palette = palettes[seed % palettes.length]
  const overlay = makeOverlaySvg(seed, palette)

  return sharp(input)
    .rotate()
    .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, { fit: 'cover', position: 'entropy' })
    .modulate({ saturation: 0.55, brightness: 0.92 })
    .linear(0.92, 4)
    .composite([{ input: Buffer.from(overlay), blend: 'over' }])
    .webp({ quality: WEBP_QUALITY, effort: 5 })
    .toBuffer()
}

const palettes = [
  { paper: '#F4EFE8', ink: '#1F2726', warm: '#D96F53', cool: '#2F6F9F', accent: '#D1A338' },
  { paper: '#EFE8DC', ink: '#202631', warm: '#C9654E', cool: '#1D7A78', accent: '#B88B2D' },
  { paper: '#F6F1E9', ink: '#26313A', warm: '#E08361', cool: '#517F9C', accent: '#C8A23A' },
  { paper: '#ECE7DE', ink: '#22262C', warm: '#BE604B', cool: '#3B7772', accent: '#D0A545' },
]

function makeOverlaySvg(seed: number, palette: typeof palettes[number]): string {
  const x = 60 + (seed % 340)
  const y = 48 + ((seed >> 3) % 220)
  const cx = 28 + (seed % 44)
  const cy = 22 + ((seed >> 5) % 46)
  const lineOpacity = 0.16 + ((seed % 8) / 100)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OUTPUT_WIDTH}" height="${OUTPUT_HEIGHT}" viewBox="0 0 ${OUTPUT_WIDTH} ${OUTPUT_HEIGHT}">
  <defs>
    <linearGradient id="wash" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.paper}" stop-opacity="0.52"/>
      <stop offset="0.45" stop-color="${palette.paper}" stop-opacity="0.10"/>
      <stop offset="1" stop-color="${palette.ink}" stop-opacity="0.34"/>
    </linearGradient>
    <radialGradient id="warm" cx="${cx}%" cy="${cy}%" r="46%">
      <stop offset="0" stop-color="${palette.warm}" stop-opacity="0.48"/>
      <stop offset="1" stop-color="${palette.warm}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grain" width="18" height="18" patternUnits="userSpaceOnUse">
      <path d="M0 9H18M9 0V18" stroke="${palette.ink}" stroke-opacity="0.045" stroke-width="1"/>
      <circle cx="3" cy="4" r="0.8" fill="${palette.ink}" fill-opacity="0.045"/>
      <circle cx="14" cy="11" r="0.7" fill="${palette.ink}" fill-opacity="0.04"/>
    </pattern>
  </defs>
  <rect width="1400" height="788" fill="${palette.ink}" opacity="0.18"/>
  <rect width="1400" height="788" fill="url(#wash)"/>
  <rect width="1400" height="788" fill="url(#warm)"/>
  <rect width="1400" height="788" fill="url(#grain)"/>
  <rect x="${x}" y="${y}" width="${180 + (seed % 90)}" height="${90 + ((seed >> 4) % 70)}" fill="${palette.paper}" opacity="0.54"/>
  <rect x="${70 + ((seed >> 2) % 90)}" y="${64 + ((seed >> 6) % 80)}" width="${OUTPUT_WIDTH - 140}" height="${OUTPUT_HEIGHT - 128}" fill="none" stroke="${palette.paper}" stroke-opacity="0.46" stroke-width="2"/>
  <path d="M ${80 + (seed % 60)} ${610 + ((seed >> 3) % 70)} C 370 ${440 + (seed % 110)}, 680 ${720 - (seed % 130)}, 1210 ${430 + ((seed >> 2) % 120)}" fill="none" stroke="${palette.accent}" stroke-opacity="${lineOpacity}" stroke-width="22" stroke-linecap="round"/>
  <path d="M ${1020 - (seed % 100)} 92 L 1310 ${180 + (seed % 90)} L ${1210 - (seed % 60)} ${590 + ((seed >> 5) % 90)}" fill="none" stroke="${palette.cool}" stroke-opacity="0.34" stroke-width="10"/>
</svg>`
}

function hashToIndex(value: string, length: number): number {
  return hashInt(value) % length
}

function hashInt(value: string): number {
  return createHash('sha256').update(value).digest().readUInt32BE(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
