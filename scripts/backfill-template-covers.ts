import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { config as loadDotenv, parse as parseDotenv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { isArticleImagesStorageUrl, sanitizeArticleMedia } from '../lib/media-sanitizer'
import { uploadWebpWithVariants } from '../lib/r2-images'

loadDotenv({ path: resolve(process.cwd(), '.env.local') })
loadDotenv({ path: resolve(process.cwd(), '.env') })
loadExtraEnv(resolve(process.cwd(), 'malakhov-ai-keys.env'))

const WIDTH = 1400
const HEIGHT = 788
const MOSCOW_OFFSET = '+03:00'
const TEXT_COVER_SOURCES = new Set(['Habr AI', 'vc.ru', 'vc.ru AI/стартапы', 'CNews'])

type CoverKind =
  | 'tool-mosaic'
  | 'learning-stack'
  | 'office-grid'
  | 'security-scan'
  | 'infrastructure'
  | 'market'
  | 'research-map'

interface ArticleRow {
  id: string
  slug: string
  ru_title: string
  original_title: string
  original_url: string
  source_name: string
  primary_category: string | null
  created_at: string
  score: number | null
  cover_image_url: string | null
  lead: string | null
  summary: string[] | null
  original_text: string | null
  editorial_body: string | null
}

interface CoverJob {
  article: ArticleRow
  kind: CoverKind
  accent: string
  secondary: string
  bg: string
  ink: string
}

const args = new Map<string, string | boolean>()
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--') && arg.includes('=')) {
    const raw = arg.slice(2)
    const separator = raw.indexOf('=')
    args.set(raw.slice(0, separator), raw.slice(separator + 1))
  } else if (arg.startsWith('--')) {
    args.set(arg.slice(2), true)
  }
}

const apply = args.has('apply')
const limit = positiveIntegerArg('limit', 50)
const days = positiveIntegerArg('days', 30)
const olderThanDays = nonNegativeIntegerArg('older-than-days', 0)
const date = stringArg('date', '')
const outDir = resolve(process.cwd(), stringArg('out-dir', `tmp/template-covers-${Date.now()}`))

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) throw new Error('Missing Supabase env')

  mkdirSync(outDir, { recursive: true })
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const targetDate = date || toMoscowDate(new Date().toISOString())
  const articles = await selectArticles(supabase, targetDate)
  const jobs = articles.map((article, index) => createJob(article, index))

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    selected_count: jobs.length,
    limit,
    days,
    older_than_days: olderThanDays || null,
    target_date: targetDate,
    out_dir: outDir,
    selected: jobs.map((job) => ({
      slug: job.article.slug,
      title: job.article.ru_title,
      source: job.article.source_name,
      kind: job.kind,
      previous_cover: classifyCover(job.article.cover_image_url),
    })),
  }, null, 2))

  const results: Array<{ slug: string; title: string; kind: CoverKind; public_url: string; storage_path: string }> = []

  for (const job of jobs) {
    const svg = renderSvg(job)
    const webp = await sharp(Buffer.from(svg))
      .resize(WIDTH, HEIGHT, { fit: 'cover' })
      .webp({ quality: 86, effort: 5 })
      .toBuffer()
    const localPath = join(outDir, `${job.article.slug}.webp`)
    writeFileSync(localPath, webp)

    if (!apply) {
      console.log(`DRY ${job.article.slug} ${job.kind} ${Math.round(webp.length / 1024)}KB`)
      continue
    }

    const storageDate = toMoscowDate(job.article.created_at)
    const storagePath = `template-covers/${storageDate}/${job.article.slug}-${job.kind}-${Date.now()}.webp`
    const publicUrl = await uploadWebpWithVariants(storagePath, webp, {
      contentType: 'image/webp',
      cacheControl: '31536000',
    })
    const { error: updateError } = await supabase
      .from('articles')
      .update({ cover_image_url: publicUrl })
      .eq('id', job.article.id)
    if (updateError) throw new Error(`Article update failed for ${job.article.slug}: ${updateError.message}`)

    const result = {
      slug: job.article.slug,
      title: job.article.ru_title,
      kind: job.kind,
      public_url: publicUrl,
      storage_path: storagePath,
    }
    results.push(result)
    console.log(JSON.stringify(result))
  }

  const report = {
    generated_at: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    count: jobs.length,
    updated_count: results.length,
    results,
  }
  const reportPath = join(outDir, 'report.json')
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`report: ${reportPath}`)
}

async function selectArticles(supabase: any, targetDate: string): Promise<ArticleRow[]> {
  const { startIso } = getMoscowDayWindowBounds(targetDate, days)
  const cutoffIso = olderThanDays > 0 ? getMoscowDayWindowBounds(targetDate, olderThanDays).startIso : null
  const selected: ArticleRow[] = []
  const pageSize = 1000

  for (let offset = 0; selected.length < limit; offset += pageSize) {
    let query = supabase
      .from('articles')
      .select('id, slug, ru_title, original_title, original_url, source_name, primary_category, created_at, score, cover_image_url, lead, summary, original_text, editorial_body')
      .eq('published', true)
      .eq('quality_ok', true)
      .eq('verified_live', true)
      .eq('publish_status', 'live')
      .not('slug', 'is', null)
      .not('ru_title', 'is', null)
      .gte('created_at', startIso)
      .order('created_at', { ascending: false })
      .order('score', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (cutoffIso) query = query.lt('created_at', cutoffIso)

    const { data, error } = await query
    if (error) throw error

    const rows = (data ?? []) as ArticleRow[]
    selected.push(...rows.filter((article) => !getCardCoverUrl(article)).slice(0, limit - selected.length))
    if (rows.length < pageSize) break
  }

  return selected
}

function getCardCoverUrl(article: ArticleRow): string | null {
  if (TEXT_COVER_SOURCES.has(article.source_name) && !isArticleImagesStorageUrl(article.cover_image_url)) return null
  return sanitizeArticleMedia({
    coverImageUrl: article.cover_image_url,
    articleImages: null,
    context: {
      sourceName: article.source_name,
      originalUrl: article.original_url,
      originalTitle: article.original_title,
      ruTitle: article.ru_title,
      lead: article.lead,
      summary: article.summary,
      originalText: article.original_text ?? article.editorial_body,
    },
  }).coverImageUrl
}

function createJob(article: ArticleRow, index: number): CoverJob {
  const palettes = [
    ['#D56F4D', '#2F7B79', '#F3EFE7', '#202833'],
    ['#D6A13A', '#4C79A8', '#ECE8DF', '#1F2630'],
    ['#C9644A', '#65884D', '#F5F0E6', '#26312E'],
    ['#3B7F86', '#D39A3A', '#EFEAE1', '#222733'],
    ['#CF5E4B', '#5B7FA6', '#EDE8DE', '#1E2630'],
    ['#B95F7A', '#427F91', '#F2ECE4', '#242832'],
    ['#D08D3C', '#426F8F', '#F4F0E8', '#232C35'],
  ] as const
  const [accent, secondary, bg, ink] = palettes[index % palettes.length]
  return {
    article,
    kind: chooseKind(article),
    accent,
    secondary,
    bg,
    ink,
  }
}

function chooseKind(article: ArticleRow): CoverKind {
  const text = `${article.ru_title} ${article.lead ?? ''} ${article.primary_category ?? ''}`.toLowerCase()
  if (/безопас|уязв|sast|контрол|риск|суд|иск|регулир|privacy|данн/.test(text)) return 'security-scan'
  if (/курс|урок|обуч|школ|университет|преподав|тест|jun|джун|prompt|промпт/.test(text)) return 'learning-stack'
  if (/рынок|цена|токен|подпис|рубл|млн|млрд|инвест|раунд|оценк|стартап/.test(text)) return 'market'
  if (/дата-центр|data.?центр|инфра|сервер|чип|gpu|желез|облак|спутник|космос/.test(text)) return 'infrastructure'
  if (/исслед|учен|модель|benchmark|бенчмарк|llm|gpt|claude|gemini|openai|deepmind/.test(text)) return 'research-map'
  if (/бизнес|офис|сотрудник|компан|корпоратив|процесс|платформ|агент/.test(text)) return 'office-grid'
  return 'tool-mosaic'
}

function renderSvg(job: CoverJob): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
${defs(job)}
<rect width="${WIDTH}" height="${HEIGHT}" fill="${job.bg}"/>
<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#grain)"/>
<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#warm)"/>
<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#cool)"/>
${motif(job)}
<rect x="64" y="64" width="${WIDTH - 128}" height="${HEIGHT - 128}" fill="none" stroke="${job.ink}" stroke-opacity="0.15" stroke-width="2"/>
</svg>`
}

function defs(job: CoverJob): string {
  return `<defs>
  <pattern id="grain" width="24" height="24" patternUnits="userSpaceOnUse">
    <path d="M0 12H24M12 0V24" stroke="${job.ink}" stroke-opacity="0.035" stroke-width="1"/>
    <circle cx="7" cy="8" r="0.9" fill="${job.ink}" fill-opacity="0.045"/>
    <circle cx="19" cy="17" r="0.7" fill="${job.ink}" fill-opacity="0.04"/>
  </pattern>
  <radialGradient id="warm" cx="24%" cy="20%" r="60%">
    <stop offset="0" stop-color="${job.accent}" stop-opacity="0.30"/>
    <stop offset="1" stop-color="${job.accent}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="cool" cx="78%" cy="32%" r="56%">
    <stop offset="0" stop-color="${job.secondary}" stop-opacity="0.24"/>
    <stop offset="1" stop-color="${job.secondary}" stop-opacity="0"/>
  </radialGradient>
</defs>`
}

function motif(job: CoverJob): string {
  switch (job.kind) {
    case 'learning-stack':
      return learningStack(job)
    case 'office-grid':
      return officeGrid(job)
    case 'security-scan':
      return securityScan(job)
    case 'infrastructure':
      return infrastructure(job)
    case 'market':
      return market(job)
    case 'research-map':
      return researchMap(job)
    case 'tool-mosaic':
      return toolMosaic(job)
  }
}

function toolMosaic({ accent, secondary, ink }: CoverJob): string {
  return `<g>
  <rect x="132" y="126" width="386" height="508" rx="34" fill="#fffaf2" opacity="0.72"/>
  <rect x="602" y="118" width="574" height="192" rx="34" fill="${ink}" opacity="0.86"/>
  <rect x="608" y="354" width="254" height="234" rx="30" fill="${accent}" opacity="0.82"/>
  <rect x="920" y="354" width="256" height="234" rx="30" fill="${secondary}" opacity="0.78"/>
  ${Array.from({ length: 12 }).map((_, i) => `<rect x="${174 + (i % 3) * 106}" y="${178 + Math.floor(i / 3) * 88}" width="64" height="52" rx="12" fill="${i % 2 ? secondary : accent}" opacity="${i % 3 === 0 ? 0.84 : 0.46}"/>`).join('')}
  <path d="M650 230 C760 176 850 254 946 198 S1090 166 1160 224" fill="none" stroke="${accent}" stroke-width="18" stroke-linecap="round" opacity="0.52"/>
  <circle cx="1044" cy="470" r="62" fill="#fffaf2" opacity="0.72"/>
  <circle cx="746" cy="472" r="38" fill="${ink}" opacity="0.24"/>
</g>`
}

function learningStack({ accent, secondary, ink }: CoverJob): string {
  return `<g>
  <rect x="134" y="112" width="1010" height="544" rx="40" fill="#fffaf2" opacity="0.62"/>
  ${[0, 1, 2, 3, 4].map((i) => `<g transform="translate(${190 + i * 155} ${170 + i * 42}) rotate(${-7 + i * 4})">
    <rect width="250" height="160" rx="22" fill="${i % 2 ? secondary : accent}" opacity="${0.82 - i * 0.07}"/>
    <circle cx="52" cy="52" r="24" fill="#fffaf2" opacity="0.62"/>
    <rect x="92" y="44" width="108" height="18" rx="9" fill="${ink}" opacity="0.28"/>
    <rect x="46" y="102" width="150" height="14" rx="7" fill="#fffaf2" opacity="0.38"/>
  </g>`).join('')}
  <path d="M148 596 C330 496 494 646 682 526 S980 420 1214 552" fill="none" stroke="${ink}" stroke-opacity="0.16" stroke-width="20" stroke-linecap="round"/>
</g>`
}

function officeGrid({ accent, secondary, ink }: CoverJob): string {
  return `<g>
  <polygon points="260,178 688,82 1110,240 672,392" fill="${secondary}" opacity="0.18" stroke="${ink}" stroke-opacity="0.18" stroke-width="3"/>
  <polygon points="260,178 672,392 672,612 260,398" fill="${accent}" opacity="0.22"/>
  <polygon points="672,392 1110,240 1110,452 672,612" fill="${ink}" opacity="0.10"/>
  ${[0, 1, 2, 3, 4, 5].map((i) => `<g transform="translate(${370 + (i % 3) * 190} ${230 + Math.floor(i / 3) * 135})">
    <polygon points="0,34 86,0 172,34 86,70" fill="#fffaf2" opacity="0.72"/>
    <polygon points="0,34 86,70 86,118 0,80" fill="${accent}" opacity="0.46"/>
    <polygon points="86,70 172,34 172,80 86,118" fill="${secondary}" opacity="0.42"/>
  </g>`).join('')}
  <circle cx="208" cy="520" r="92" fill="${accent}" opacity="0.54"/>
</g>`
}

function securityScan({ accent, secondary, ink }: CoverJob): string {
  return `<g>
  <rect x="134" y="128" width="1030" height="492" rx="34" fill="${ink}" opacity="0.88"/>
  ${Array.from({ length: 12 }).map((_, i) => `<line x1="168" y1="${176 + i * 34}" x2="1130" y2="${176 + i * 34}" stroke="#fffaf2" stroke-opacity="${i === 5 ? 0.28 : 0.08}" stroke-width="${i === 5 ? 6 : 2}"/>`).join('')}
  <rect x="206" y="214" width="286" height="284" rx="26" fill="${secondary}" opacity="0.16" stroke="${secondary}" stroke-opacity="0.48" stroke-width="4"/>
  <path d="M342 250 L452 308 L432 450 L342 510 L252 450 L232 308 Z" fill="${accent}" opacity="0.72"/>
  <path d="M610 246 H1050 M610 316 H960 M610 386 H1080 M610 456 H910" stroke="#fffaf2" stroke-opacity="0.48" stroke-width="18" stroke-linecap="round"/>
  <rect x="118" y="332" width="1080" height="54" fill="${accent}" opacity="0.24"/>
</g>`
}

function infrastructure({ accent, secondary, ink }: CoverJob): string {
  return `<g>
  <circle cx="968" cy="180" r="96" fill="${accent}" opacity="0.82"/>
  <circle cx="968" cy="180" r="168" fill="none" stroke="${secondary}" stroke-opacity="0.30" stroke-width="3"/>
  <path d="M0 570 C220 508 388 640 642 570 S1012 466 1400 574 L1400 788 L0 788 Z" fill="${ink}" opacity="0.86"/>
  <g transform="translate(214 394)">
    ${[0, 1, 2, 3, 4].map((i) => `<rect x="${i * 82}" y="${i % 2 ? 18 : 0}" width="56" height="${116 + i * 18}" fill="#fffaf2" opacity="${0.62 - i * 0.05}"/>`).join('')}
    <rect x="-24" y="176" width="500" height="48" fill="${accent}" opacity="0.62"/>
  </g>
  <rect x="110" y="118" width="450" height="230" rx="34" fill="#fffaf2" opacity="0.64"/>
</g>`
}

function market({ accent, secondary, ink }: CoverJob): string {
  return `<g>
  <rect x="110" y="106" width="1180" height="530" rx="38" fill="#fffaf2" opacity="0.58"/>
  ${Array.from({ length: 10 }).map((_, i) => `<line x1="150" y1="${160 + i * 44}" x2="1248" y2="${160 + i * 44}" stroke="${ink}" stroke-opacity="0.08" stroke-width="2"/>`).join('')}
  ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${182 + i * 150}" y="${420 - i * 38}" width="88" height="${140 + i * 38}" rx="14" fill="${i % 2 ? secondary : accent}" opacity="${0.74 - i * 0.04}"/>`).join('')}
  <path d="M170 516 C312 420 426 468 558 382 S760 242 914 308 S1080 312 1230 188" fill="none" stroke="${ink}" stroke-opacity="0.62" stroke-width="14" stroke-linecap="round"/>
  <circle cx="914" cy="308" r="38" fill="${accent}"/>
  <circle cx="1230" cy="188" r="48" fill="${secondary}"/>
</g>`
}

function researchMap({ accent, secondary, ink }: CoverJob): string {
  const nodes = [[250, 236, 70], [410, 338, 118], [616, 238, 86], [792, 376, 132], [1010, 250, 96], [1034, 512, 74], [570, 528, 92]]
  return `<g>
  ${Array.from({ length: 8 }).map((_, i) => `<path d="M0 ${154 + i * 56} C260 ${72 + i * 28} 402 ${328 - i * 14} 642 ${196 + i * 18} S1010 ${120 + i * 20} 1400 ${264 + i * 24}" fill="none" stroke="${i % 2 ? secondary : accent}" stroke-opacity="${0.14 + i * 0.025}" stroke-width="${3 + (i % 3)}"/>`).join('')}
  ${nodes.map(([x, y, r], i) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${i % 2 ? secondary : accent}" opacity="${0.22 + (i % 3) * 0.08}"/>`).join('')}
  ${nodes.slice(0, -1).map(([x, y], i) => `<line x1="${x}" y1="${y}" x2="${nodes[i + 1][0]}" y2="${nodes[i + 1][1]}" stroke="${ink}" stroke-opacity="0.20" stroke-width="5"/>`).join('')}
  <rect x="116" y="108" width="384" height="138" rx="32" fill="#fffaf2" opacity="0.54"/>
</g>`
}

function classifyCover(value: string | null): string {
  if (!value) return 'none'
  if (value.includes('/article-images/ai-covers/')) return 'ai-cover'
  if (value.includes('/article-images/template-covers/')) return 'template-cover'
  if (value.includes('/article-images/stock-covers/')) return 'stock-cover'
  if (isArticleImagesStorageUrl(value)) return 'article-images-storage'
  return 'source-cover'
}

function getMoscowDayWindowBounds(targetDate: string, dayCount: number) {
  const safeDays = Math.max(1, Math.floor(dayCount))
  const end = new Date(`${targetDate}T00:00:00${MOSCOW_OFFSET}`)
  end.setUTCDate(end.getUTCDate() + 1)
  const start = new Date(end.getTime() - safeDays * 24 * 60 * 60 * 1000)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

function toMoscowDate(iso: string): string {
  const dateValue = new Date(iso)
  const moscow = new Date(dateValue.getTime() + 3 * 60 * 60 * 1000)
  return moscow.toISOString().slice(0, 10)
}

function numberArg(name: string, fallback: number): number {
  const raw = args.get(name)
  if (typeof raw !== 'string') return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

function positiveIntegerArg(name: string, fallback: number): number {
  const value = numberArg(name, fallback)
  const sanitizedFallback = Number.isFinite(fallback) && fallback > 0 ? Math.floor(fallback) : 1
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : sanitizedFallback
}

function nonNegativeIntegerArg(name: string, fallback: number): number {
  const value = numberArg(name, fallback)
  const sanitizedFallback = Number.isFinite(fallback) && fallback >= 0 ? Math.floor(fallback) : 0
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : sanitizedFallback
}

function stringArg(name: string, fallback: string): string {
  const raw = args.get(name)
  return typeof raw === 'string' ? raw : fallback
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

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
