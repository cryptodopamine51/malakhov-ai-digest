import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { config, parse as parseDotenv } from 'dotenv'
import OpenAI from 'openai'
import sharp from 'sharp'
import { getServerClient } from '../lib/supabase'
import { estimateOpenAiImageCostUsd, type ImageQuality, type ImageSize } from '../pipeline/model-pricing'

config({ path: resolve(process.cwd(), '.env.local') })
config({ path: resolve(process.cwd(), '.env') })
loadExtraEnv(resolve(process.cwd(), 'malakhov-ai-keys.env'))

type ImageStyle =
  | 'editorial-photographic'
  | 'tech-still-life'
  | 'abstract-infrastructure'
  | 'documentary-collage'
  | 'minimal-object-metaphor'

interface ArticleRow {
  id: string
  slug: string
  ru_title: string
  lead: string | null
  card_teaser: string | null
  editorial_body: string | null
  source_name: string
  topics: string[] | null
  primary_category: string | null
  secondary_categories: string[] | null
  cover_image_url: string | null
  score: number | null
  created_at: string
}

interface LabVariant {
  slug: string
  title: string
  source: string
  category: string | null
  style: ImageStyle
  scene: string
  model: string
  quality: ImageQuality
  size: ImageSize
  prompt: string
  estimated_cost_usd: number | null
  local_path?: string
  error?: string
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
const limit = numberArg('limit', 5)
const perArticle = numberArg('per-article', 3)
const model = stringArg('model', 'gpt-image-1.5')
const quality = qualityArg('quality', 'low')
const size: ImageSize = sizeArg('size', '1536x1024')
const budgetUsd = numberArg('budget', 0.5)
const category = stringArg('category', 'all')
const slugs = stringArg('slugs', '').split(',').map((slug) => slug.trim()).filter(Boolean)
const styles = parseStyles(stringArg('styles', 'editorial-photographic,tech-still-life,abstract-infrastructure,documentary-collage,minimal-object-metaphor'))
const outDir = resolve(process.cwd(), stringArg('out-dir', `tmp/image-style-lab-${Date.now()}`))

function loadExtraEnv(path: string): void {
  if (!existsSync(path)) return
  const raw = readFileSync(path, 'utf8')
  const parsed = safeParseEnv(raw)
  if (/^\\{\\rtf/.test(raw)) {
    try {
      Object.assign(parsed, safeParseEnv(execFileSync('textutil', ['-convert', 'txt', '-stdout', path], { encoding: 'utf8' })))
    } catch {
      // Keep raw parse fallback.
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
    if (key && value) parsed[key] = value
  }
  return parsed
}

function stringArg(name: string, fallback: string): string {
  const value = args.get(name)
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function numberArg(name: string, fallback: number): number {
  const value = Number(args.get(name))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function qualityArg(name: string, fallback: ImageQuality): ImageQuality {
  const value = stringArg(name, fallback)
  return value === 'low' || value === 'medium' || value === 'high' ? value : fallback
}

function sizeArg(name: string, fallback: ImageSize): ImageSize {
  const value = stringArg(name, fallback)
  return value === '1024x1024' || value === '1536x1024' || value === '1024x1536' ? value : fallback
}

function parseStyles(value: string): ImageStyle[] {
  const allowed = new Set<ImageStyle>([
    'editorial-photographic',
    'tech-still-life',
    'abstract-infrastructure',
    'documentary-collage',
    'minimal-object-metaphor',
  ])
  const parsed = value.split(',').map((style) => style.trim()).filter((style): style is ImageStyle => allowed.has(style as ImageStyle))
  return parsed.length ? parsed : ['editorial-photographic', 'tech-still-life', 'abstract-infrastructure']
}

async function selectArticles(): Promise<ArticleRow[]> {
  const supabase = getServerClient()
  let query = supabase
    .from('articles')
    .select('id, slug, ru_title, lead, card_teaser, editorial_body, source_name, topics, primary_category, secondary_categories, cover_image_url, score, created_at')
    .eq('quality_ok', true)
    .not('slug', 'is', null)
    .order('created_at', { ascending: false })
    .limit(Math.max(limit * 4, 20))

  if (slugs.length) query = query.in('slug', slugs)
  if (category !== 'all') query = query.eq('primary_category', category)

  const { data, error } = await query
  if (error) throw new Error(`article query failed: ${error.message}`)
  const rows = ((data ?? []) as ArticleRow[]).slice(0, limit)
  if (slugs.length) {
    const order = new Map(slugs.map((slug, index) => [slug, index]))
    rows.sort((a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0))
  }
  return rows
}

function chooseScene(article: ArticleRow, style: ImageStyle, index: number): string {
  const text = `${article.ru_title} ${article.lead ?? ''} ${(article.topics ?? []).join(' ')}`.toLowerCase()
  const topic =
    /инвест|млрд|рынок|цена|стартап|оценк/.test(text) ? 'market' :
    /закон|суд|регулир|персональн|авторск/.test(text) ? 'policy' :
    /research|исследован|модель|benchmark|датасет|arxiv/.test(text) ? 'research' :
    /агент|код|разработ|mcp|api|инфра/.test(text) ? 'engineering' :
    /медицин|пациент|клиник/.test(text) ? 'medical' :
    'general'

  const scenes: Record<ImageStyle, Record<string, string[]>> = {
    'editorial-photographic': {
      market: ['a sober financial newsroom still life with model cards, valuation folders, and a single measuring instrument'],
      policy: ['an institutional archive room with policy folders, sealed documents, and abstract technology evidence'],
      research: ['a research institute table with lab notes, optical plates, and a restrained model-evaluation setup'],
      engineering: ['a developer workbench with physical API connectors, code review strips, and clean tool geometry'],
      medical: ['a public healthcare audit desk with anonymized forms, clinical objects, and cautious risk markers'],
      general: ['a serious technology newsroom desk with article evidence, devices, and restrained editorial lighting'],
    },
    'tech-still-life': {
      market: ['a precise still life of scales, model cards, paper ledgers, and abstract cost meters without numbers'],
      policy: ['a still life of legal folders, inspection stamps without readable text, and a small machine-learning artifact'],
      research: ['a still life of benchmark blocks, dataset cards, lenses, and a compact model object'],
      engineering: ['a still life of developer tools, cable paths, paper architecture blocks, and one central interface object'],
      medical: ['a still life of anonymized clinical forms, risk indicators, and a careful diagnostic tool metaphor'],
      general: ['a still life of AI-news objects, editorial paper layers, and one sharp technical focal point'],
    },
    'abstract-infrastructure': {
      market: ['an abstract market infrastructure map with model routes, cost gates, and institutional data channels'],
      policy: ['an abstract compliance infrastructure with checkpoints, rule layers, and technology flows'],
      research: ['an abstract research infrastructure with benchmark tracks, dataset reservoirs, and evaluation gates'],
      engineering: ['an abstract agent infrastructure with tool routes, memory blocks, and execution lanes'],
      medical: ['an abstract healthcare risk infrastructure with privacy-safe patient-free flows and audit gates'],
      general: ['an abstract AI infrastructure map with data paths, editorial checkpoints, and physical depth'],
    },
    'documentary-collage': {
      market: ['a documentary collage of boardroom fragments, valuation paperwork, and product evidence without logos'],
      policy: ['a documentary collage of government corridors, case files, and digital evidence without readable text'],
      research: ['a documentary collage of lab benches, paper diagrams, and evaluation artifacts'],
      engineering: ['a documentary collage of engineering rooms, terminals as physical objects, and agent workflow fragments'],
      medical: ['a documentary collage of hospital architecture fragments, anonymous documents, and risk review objects'],
      general: ['a documentary collage of technology newsroom fragments and source evidence'],
    },
    'minimal-object-metaphor': {
      market: ['one central measuring scale balancing abstract model blocks and a sealed funding folder'],
      policy: ['one central locked folder intersected by a clean circuit path and a small audit lens'],
      research: ['one central glass prism splitting benchmark cards into measured technical layers'],
      engineering: ['one central tool handle connected to memory cards and execution routes'],
      medical: ['one central risk lens over anonymous clinical paperwork and muted signal markers'],
      general: ['one central editorial object that turns article evidence into a precise technology metaphor'],
    },
  }

  const list = scenes[style][topic] ?? scenes[style].general
  return list[index % list.length]
}

function buildPrompt(article: ArticleRow, style: ImageStyle, scene: string): string {
  const excerpt = (article.lead || article.card_teaser || article.editorial_body || '').replace(/\s+/g, ' ').slice(0, 420)
  const styleLine: Record<ImageStyle, string> = {
    'editorial-photographic': 'premium editorial photographic scene, physically plausible objects, restrained newsroom lighting',
    'tech-still-life': 'high-end technical still life, tactile objects, controlled studio lighting, no people as main subject',
    'abstract-infrastructure': 'abstract infrastructure illustration with physical depth, maps, routes, gates, and layered systems',
    'documentary-collage': 'documentary editorial collage, source-evidence fragments, institutional context, paper and photo layers',
    'minimal-object-metaphor': 'minimal strong object metaphor, one central object, lots of clean negative space, precise symbolism',
  }

  return `Create one original 16:9 editorial cover for Malakhov AI Digest.

Article title: ${article.ru_title}
Article context: ${excerpt}
Category: ${article.primary_category ?? 'AI news'}
Style variant: ${style}
Scene: ${scene}

Visual direction:
${styleLine[style]}. Serious technology media, intelligent and specific, not decorative.

Shared publication language:
Matte paper texture, subtle print grain, restrained modernist geometry, strong thumbnail contrast, off-white/graphite base with one accent from muted coral, mustard, teal, dusty blue, or salmon.

Strict avoid list:
No readable text, no pseudo-text, no letters, no numbers, no logos, no trademarks, no watermarks. No smartphones or laptops showing app UI, fake dashboards, charts with numbers, browser windows, login screens, or product comparison screens. No glowing AI brain, no network sphere, no centered business person, no handshake, no robot mascot, no generic corporate stock-photo look, no beige symmetrical template.

Output:
Landscape editorial image, sophisticated, credible, varied from other covers in the same publication series.`
}

async function generateVariant(openai: OpenAI, variant: LabVariant): Promise<LabVariant> {
  const response = await openai.images.generate({
    model: model as any,
    prompt: variant.prompt,
    size: size as any,
    quality,
    output_format: 'webp' as any,
    n: 1,
  } as any)
  const b64 = response.data?.[0]?.b64_json
  if (!b64) throw new Error('OpenAI returned no b64_json')
  const raw = Buffer.from(b64, 'base64')
  const webp = await sharp(raw)
    .resize(1400, 788, { fit: 'cover', position: 'entropy' })
    .webp({ quality: 88, effort: 5 })
    .toBuffer()
  const localPath = join(outDir, `${variant.slug}-${variant.style}-${quality}.webp`)
  writeFileSync(localPath, webp)
  return { ...variant, local_path: localPath }
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const articles = await selectArticles()
  const unitCost = estimateOpenAiImageCostUsd({ model, quality, size })
  const variants: LabVariant[] = []

  for (const [articleIndex, article] of articles.entries()) {
    const articleStyles = styles.slice(0, perArticle)
    for (const [styleIndex, style] of articleStyles.entries()) {
      const scene = chooseScene(article, style, articleIndex + styleIndex)
      variants.push({
        slug: article.slug,
        title: article.ru_title,
        source: article.source_name,
        category: article.primary_category,
        style,
        scene,
        model,
        quality,
        size,
        prompt: buildPrompt(article, style, scene),
        estimated_cost_usd: unitCost,
      })
    }
  }

  const generated: LabVariant[] = []
  let spent = 0
  if (apply) {
    if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY')
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    for (const variant of variants) {
      const nextCost = variant.estimated_cost_usd ?? 0
      if (budgetUsd > 0 && spent + nextCost > budgetUsd) {
        generated.push({ ...variant, error: `budget exceeded: spent=$${spent.toFixed(4)} next=$${nextCost.toFixed(4)} budget=$${budgetUsd.toFixed(2)}` })
        break
      }
      try {
        const result = await generateVariant(openai, variant)
        generated.push(result)
        spent += nextCost
        console.log(`generated ${result.slug} ${result.style} cost=$${nextCost.toFixed(4)}`)
      } catch (error) {
        generated.push({ ...variant, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    model,
    quality,
    size,
    budget_usd: budgetUsd,
    estimated_unit_cost_usd: unitCost,
    selected_articles: articles.map((article) => ({
      slug: article.slug,
      title: article.ru_title,
      source: article.source_name,
      category: article.primary_category,
      score: article.score,
      has_cover: Boolean(article.cover_image_url),
    })),
    variants: apply ? generated : variants,
  }

  const reportPath = join(outDir, 'report.json')
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({
    mode: report.mode,
    selected_articles: articles.length,
    variants: variants.length,
    estimated_total_cost_usd: unitCost ? Number((unitCost * variants.length).toFixed(4)) : null,
    generated: generated.filter((variant) => variant.local_path).length,
    report: reportPath,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
