import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { config as loadDotenv, parse as parseDotenv } from 'dotenv'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

loadDotenv({ path: resolve(process.cwd(), '.env.local') })
loadDotenv({ path: resolve(process.cwd(), '.env') })
loadExtraEnv(resolve(process.cwd(), 'malakhov-ai-keys.env'))

const BUCKET = 'article-images'
const OUTPUT_WIDTH = 1400
const OUTPUT_HEIGHT = 788
const WEBP_QUALITY = 88
const MOSCOW_OFFSET = '+03:00'

type Quality = 'low' | 'medium' | 'high'

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
  created_at: string
  cover_image_url: string | null
  score: number | null
}

interface GenerationResult {
  slug: string
  title: string
  source: string
  scene: string
  model: string
  quality: Quality
  size: string
  usage: ImageUsage | null
  estimated_cost_usd: number | null
  storage_path: string
  public_url: string
  local_path: string
}

interface ImageUsage {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  input_tokens_details?: {
    text_tokens?: number
    image_tokens?: number
  }
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
const limit = numberArg('limit', 8)
const category = stringArg('category', 'ai-russia')
const model = stringArg('model', 'gpt-image-1.5')
const quality = qualityArg('quality', 'medium')
const date = stringArg('date', '')
const latestDay = args.has('latest-day') || Boolean(date)
const onlyGenerated = !args.has('include-source-covers')
const slugs = stringArg('slugs', '')
  .split(',')
  .map((slug) => slug.trim())
  .filter(Boolean)
const outDir = resolve(process.cwd(), stringArg('out-dir', `tmp/ai-covers-${Date.now()}`))

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  const openaiApiKey = process.env.OPENAI_API_KEY

  if (!supabaseUrl || !serviceKey) throw new Error('Missing Supabase env')
  if (!openaiApiKey) throw new Error('Missing OPENAI_API_KEY')

  mkdirSync(outDir, { recursive: true })

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const openai = new OpenAI({ apiKey: openaiApiKey })
  const articles = await selectArticles(supabase)

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    model,
    quality,
    size: '1536x1024',
    limit,
    category,
    latest_day: latestDay,
    selected_count: articles.length,
    out_dir: outDir,
    selected: articles.map((article) => ({
      slug: article.slug,
      title: article.ru_title,
      source: article.source_name,
      score: article.score,
      cover: classifyCover(article.cover_image_url),
    })),
  }, null, 2))

  if (!apply || !articles.length) return

  const results: GenerationResult[] = []
  const failures: Array<{ slug: string; title: string; error: string }> = []
  for (const [index, article] of articles.entries()) {
    const scene = chooseScene(article, index)
    const prompt = buildPrompt(article, scene, index)

    console.log(`\nGENERATE ${index + 1}/${articles.length} ${article.slug}`)
    console.log(`  scene: ${scene}`)

    try {
      const response = await generateWithRetry(openai, prompt)
      const b64 = response.data?.[0]?.b64_json
      if (!b64) throw new Error(`OpenAI returned no b64_json for ${article.slug}`)

      const raw = Buffer.from(b64, 'base64')
      const webp = await sharp(raw)
        .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, { fit: 'cover', position: 'entropy' })
        .webp({ quality: WEBP_QUALITY, effort: 5 })
        .toBuffer()

      const safeModel = model.replace(/[^a-zA-Z0-9._-]/g, '-')
      const storageDate = toMoscowDate(article.created_at)
      const storagePath = `ai-covers/${storageDate}/${article.slug}-${safeModel}-${quality}-${Date.now()}.webp`
      const localPath = join(outDir, `${article.slug}.webp`)
      writeFileSync(localPath, webp)

      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, webp, {
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

      const usage = normalizeUsage(response.usage)
      const cost = estimateCostUsd(model, quality, usage)
      const result: GenerationResult = {
        slug: article.slug,
        title: article.ru_title,
        source: article.source_name,
        scene,
        model,
        quality,
        size: '1536x1024',
        usage,
        estimated_cost_usd: cost,
        storage_path: storagePath,
        public_url: publicUrl,
        local_path: localPath,
      }
      results.push(result)
      console.log(JSON.stringify(result))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failure = { slug: article.slug, title: article.ru_title, error: message }
      failures.push(failure)
      console.warn(JSON.stringify({ failed: failure }))
    }
  }

  const total = results.reduce((sum, result) => sum + (result.estimated_cost_usd ?? 0), 0)
  const report = {
    generated_at: new Date().toISOString(),
    model,
    quality,
    size: '1536x1024',
    count: results.length,
    failed_count: failures.length,
    estimated_total_cost_usd: Number(total.toFixed(6)),
    pricing_note: pricingNote(model),
    results,
    failures,
  }
  const reportPath = join(outDir, 'report.json')
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log('\nRESULTS')
  console.log(JSON.stringify(report, null, 2))
  console.log(`report: ${reportPath}`)
}

async function selectArticles(supabase: any): Promise<ArticleRow[]> {
  let query = supabase
    .from('articles')
    .select('id, slug, ru_title, lead, card_teaser, editorial_body, source_name, topics, primary_category, secondary_categories, created_at, cover_image_url, score')
    .eq('published', true)
    .eq('quality_ok', true)
    .not('slug', 'is', null)
    .not('ru_title', 'is', null)
    .order('score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(Math.max(limit * 8, 120))

  if (slugs.length) {
    query = query.in('slug', slugs)
  } else {
    query = query.or(`primary_category.eq.${category},secondary_categories.cs.{${category}}`)
  }

  if (latestDay) {
    const targetDate = date || await getLatestLiveCreatedDateMsk(supabase)
    const { startIso, endIso } = getMoscowDayBounds(targetDate)
    query = query.gte('created_at', startIso).lt('created_at', endIso)
  }

  const { data, error } = await query
  if (error) throw error

  const selected = ((data ?? []) as ArticleRow[])
    .filter((article) => !onlyGenerated || needsAiCover(article))
    .slice(0, limit)

  if (slugs.length) {
    const position = new Map(slugs.map((slug, index) => [slug, index]))
    selected.sort((a, b) => (position.get(a.slug) ?? 0) - (position.get(b.slug) ?? 0))
  }

  return selected
}

function needsAiCover(article: ArticleRow): boolean {
  if (!article.cover_image_url) return true
  if (article.cover_image_url.includes('/article-images/ai-covers/')) return false
  if (article.cover_image_url.includes('/article-images/template-covers/')) return true
  if (article.cover_image_url.includes('/article-images/stock-covers/')) return true
  return ['Habr AI', 'vc.ru', 'CNews'].includes(article.source_name)
}

function classifyCover(value: string | null): string {
  if (!value) return 'none'
  if (value.includes('/article-images/ai-covers/')) return 'ai-cover'
  if (value.includes('/article-images/template-covers/')) return 'template-cover'
  if (value.includes('/article-images/stock-covers/')) return 'stock-cover'
  return 'source-cover'
}

function buildPrompt(article: ArticleRow, scene: string, index: number): string {
  const excerpt = (article.lead || article.card_teaser || article.editorial_body || '')
    .replace(/\s+/g, ' ')
    .slice(0, 420)
  const composition = [
    'large cropped central object on the left, dense secondary detail on the lower right, open off-white negative space',
    'diagonal editorial composition with one oversized symbolic object crossing the frame, small human-scale fragments',
    'architectural cross-section with paper cutout depth, foreground document fragments, restrained abstract data marks',
    'top-down editorial desk composition with tactile objects, torn-paper layers, and one sharp focal element',
    'cinematic side-lit institutional scene, no literal UI, one strong silhouette and a symbolic technical layer',
    'modular collage with three unequal visual masses, strong asymmetry, and a clear visual hierarchy',
  ][index % 6]

  return `Create one original premium editorial image for Malakhov AI Digest, a serious AI news publication.

Article title: ${article.ru_title}
Article context: ${excerpt}
Topics: ${(article.topics ?? []).join(', ') || 'AI, technology, Russia'}

Scene concept: ${scene}
Composition: ${composition}.

Required publication style:
Editorial conceptual photomontage, intelligent magazine-cover aesthetic, layered paper collage logic, cutout spatial relationships, tactile matte paper texture, subtle print grain, restrained modernist geometry, premium media-grade finish.

Visual language:
Use one clear focal point and 1 to 3 dominant visual masses. Prefer symbolic editorial objects, public/institutional architecture, documents, maps, cameras, equipment, silhouettes, physical tools, and abstract technical layers. The image must feel specific to this article, not a generic AI stock image.

Palette:
Off-white paper, graphite, warm gray, muted coral, salmon, mustard, ochre, teal, dusty blue. Keep contrast strong enough for a news-card thumbnail.

Strict avoid list:
No readable text, no letters, no numbers, no words, no Russian text, no logos, no trademarks, no watermarks. No generic code screen as the main subject. No glowing AI brain, no glowing network sphere, no centered business person, no handshake, no browser-window stack, no crypto coin, no robot mascot, no corporate stock-photo look, no beige symmetrical template.

Output:
16:9 landscape editorial cover, sophisticated, memorable, varied from other covers in the same publication series.`
}

function chooseScene(article: ArticleRow, index: number): string {
  const text = `${article.ru_title} ${article.lead ?? ''} ${article.card_teaser ?? ''} ${(article.topics ?? []).join(' ')}`.toLowerCase()
  const explicit = explicitScene(article.slug)
  if (explicit) return explicit

  const variants = {
    context: [
      'an architect desk where layered context cards, memory fragments, and agent instructions form a precise machine blueprint',
      'a cutaway control room for AI agents, with document layers and route markers showing how context is engineered',
    ],
    security: [
      'an industrial quality gate scanning AI-generated code fragments as physical paper strips, with red audit seals and shield-like geometry',
      'a security checkpoint for autonomous coding agents, where fragile paper code passes through inspection beams and institutional barriers',
    ],
    medical: [
      'a public healthcare risk office with insurance forms, hospital floor-plan fragments, and abstract risk signals under a careful audit lens',
      'an institutional medical archive where AI risk assessment is represented by layered charts, stamps, and patient-free clinical objects',
    ],
    vision: [
      'a local workstation with a compact vision model represented by stacked photographic plates, lens optics, and benchmark ladders',
      'a small edge-computing lab where image tiles, optical glass, and a compact machine block close the gap to a larger remote model',
    ],
    encyclopedia: [
      'an encyclopedia archive where verification chains connect scientists, reference cards, and AI agent annotations without any readable text',
      'a knowledge institution scene with library shelves, researcher silhouettes, stamped source cards, and a verification circuit',
    ],
    tools: [
      'a precise toolkit of AI coding skills laid out like editorial objects on a desk, each tool distinct but part of one workflow',
      'a marketplace wall of physical plugin cards and developer instruments, arranged as a premium magazine still life',
    ],
    subscriptions: [
      'a subscription stress-test bench where different AI model plans are represented by meters, pressure gauges, and workload weights',
      'a comparative endurance lab for agentic coding subscriptions, with token counters abstracted as mechanical dials and paper receipts',
    ],
    office: [
      'an isometric office control room where several AI agents occupy workstations as abstract silhouettes under one operator view',
      'a workplace operations board transformed into a physical office map, showing autonomous agents as coordinated cutout figures',
    ],
    infrastructure: [
      'an orbital infrastructure diagram made of paper satellites, ground data-center silhouettes, and fragile communication paths',
      'a data-center architecture scene where terrestrial infrastructure dominates over distant orbital fragments',
    ],
    learning: [
      'a premium technical classroom collage with course cards, workshop benches, Kubernetes-like infrastructure blocks, and AI assistant tools',
      'an editorial learning stack where lesson modules, command-line tools, notebooks, and small agent diagrams form a structured curriculum',
    ],
    business: [
      'a Russian enterprise operations room where AI adoption is shown through office workflows, paper process maps, and cautious managers',
      'a sober corporate transformation scene with documents, process lanes, and AI assistant objects entering existing business routines',
    ],
    market: [
      'a sober AI token-pricing market scene with measuring instruments, paper ledgers, and abstract model comparison bars',
      'a financial editorial still life about AI model costs, using scales, meters, and data fragments without numbers',
    ],
    research: [
      'a neuroscience research atlas made of paper anatomy fragments, abstract free-energy geometry, and lab archive textures',
      'a cognitive science editorial collage with split portrait fragments, diagrams, and institutional research objects',
    ],
  }

  const key =
    /безопас|sast|уязв|шлюз|сканер|контрол|quality|ошиб/.test(text) ? 'security' :
    /омс|медиц|пациент|риск|страх/.test(text) ? 'medical' :
    /курс|урок|обуч|edtech|джун|jun|тестовое|teacher|куратор/.test(text) ? 'learning' :
    /скилл|skill|маркетплейс|инструмент|claude code|spec-driven|obsidian|mcp|браузер/.test(text) ? 'tools' :
    /vision|зрен|8b|локальн/.test(text) ? 'vision' :
    /рувики|викип|верификац|учён|знан/.test(text) ? 'encyclopedia' :
    /подпис|minimax|kimi|gpt|нагруз|лимит/.test(text) ? 'subscriptions' :
    /office|офис|сотрудник/.test(text) ? 'office' :
    /космос|спутник|data.?центр|дата-центр|инфра/.test(text) ? 'infrastructure' :
    /компан|бизнес|руководител|корпоратив|платформ|vk tech|битрикс|rambler|рамблер/.test(text) ? 'business' :
    /цена|токен|рынок|рубл|млрд|инвест/.test(text) ? 'market' :
    /шизофрен|аутизм|мозг|нейро|фристон|язык/.test(text) ? 'research' :
    /контекст|context|структур/.test(text) ? 'context' :
    'tools'

  const list = variants[key as keyof typeof variants]
  return list[index % list.length]
}

function explicitScene(slug: string): string | null {
  const scenes: Record<string, string> = {
    'context-engineering-dlya-ai-agentov': 'an architect desk where layered context cards, memory fragments, and agent instructions form a precise machine blueprint',
    '5-skillov-iz-ofitsialnogo-marketpleysa-claude-code-chto-rabo': 'a precise toolkit of AI coding skills laid out like editorial objects on a desk, each tool distinct but part of one workflow',
    'minimax-kimi-i-gpt-kakie-podpiski-vyderzhivayut-realnuyu-age': 'a subscription stress-test bench where different AI model plans are represented by meters, pressure gauges, and workload weights',
    'otus-otkryvaet-63-besplatnykh-uroka-v-mae-go-kubernetes-llm': 'a premium technical classroom collage with course cards, workshop benches, Kubernetes-like infrastructure blocks, and AI assistant tools',
    'officeai-open-source-prilozhenie-prevrashchaet-ii-agentov-v': 'an isometric office control room where several AI agents occupy workstations as abstract silhouettes under one operator view',
    'vaybkod-pod-skanerom-kak-podklyuchit-sast-i-ne-dat-llm-sloma': 'an industrial quality gate scanning AI-generated code fragments as physical paper strips, with red audit seals and shield-like geometry',
    'pochemu-data-tsentry-v-kosmose-ne-rabotayut-razbor-ot-inzhen': 'an orbital infrastructure diagram made of paper satellites, ground data-center silhouettes, and fragile communication paths',
    'grok-4-3-tsena-tokenov-v-8-raz-nizhe-gpt-5-5-i-dostup-iz-ros': 'a sober AI token-pricing market scene with measuring instruments, paper ledgers, and abstract model comparison bars',
    'shizofreniya-i-autizm-cherez-printsip-svobodnoy-energii-karl': 'a cognitive science editorial collage with split portrait fragments, diagrams, and institutional research objects',
    'obsidian-claude-kak-baza-znaniy-dlya-razrabotki-prakticheska': 'a developer knowledge-base archive where notes, graph links, and AI assistant tools are arranged like a tactile research desk',
    'fond-oms-potratit-1-9-mlrd-rubley-na-ii-raschyot-riskov-pats': 'a public healthcare risk office with insurance forms, hospital floor-plan fragments, and abstract risk signals under a careful audit lens',
    'ruviki-stroit-verifikatsiyu-na-svyazke-ii-agentov-i-uchyonyk': 'an encyclopedia archive where verification chains connect scientists, reference cards, and AI agent annotations without any readable text',
    'senar-kak-shlyuzy-kachestva-zashchishchayut-ot-oshibok-pri-r': 'a security checkpoint for autonomous coding agents, where fragile paper code passes through inspection beams and institutional barriers',
    'kak-lokalnaya-8b-vision-model-zakryla-70-razryva-do-claude-o': 'a small edge-computing lab where image tiles, optical glass, and a compact machine block close the gap to a larger remote model',
    'ot-40-kb-do-300-gb-kak-razrabotchiki-razuchilis-ekonomit-i-c': 'a software efficiency still life with a tiny memory chip balanced against oversized storage blocks, compression tools, and clean engineering diagrams',
    'kak-sber-pereshyol-ot-forka-langchain-k-sobstvennomu-paketu': 'a corporate software architecture collage where a forked framework path becomes a clean internal integration package',
    'rynok-ii-spetsialistov-v-rossii-hh-indeks-18-zarplaty-do-650': 'a labor-market editorial scene with abstract job cards, salary ladders without numbers, and AI specialist tools on a restrained desk',
    'neyroset-permskogo-politekha-predskazyvaet-podzemnoe-davleni': 'a geotechnical research collage with underground pressure layers, lab instruments, and a neural-network diagram as physical paper strata',
    'pochemu-ii-agenty-usilivayut-khaos-v-komandakh-bez-struktury': 'a team-operations map where AI agent routes create tangled paths until a structured knowledge system organizes the flow',
    'rekomendatelnaya-sistema-dlya-filmov-cold-start-vektor-vkusa': 'a film recommendation lab with abstract taste vectors, cinema frames without logos, and a final AI ranking layer',
    'kak-open-source-agent-n0x-nauchilsya-otkryvat-brauzer-cherez': 'an open-source browser automation workbench with MCP connection nodes, tool handles, and a clean agent control path',
  }
  return scenes[slug] ?? null
}

async function generateWithRetry(openai: OpenAI, prompt: string): Promise<any> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await openai.images.generate({
        model: model as any,
        prompt,
        size: '1536x1024' as any,
        quality,
        output_format: 'webp' as any,
        output_compression: WEBP_QUALITY,
        n: 1,
      } as any)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (attempt === 3 || !/rate|429|timeout|temporarily|overloaded/i.test(message)) throw error
      const delayMs = attempt * 20_000
      console.warn(`  retry after ${delayMs}ms: ${message}`)
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs))
    }
  }
  throw new Error('unreachable')
}

function normalizeUsage(value: unknown): ImageUsage | null {
  if (!value || typeof value !== 'object') return null
  const usage = value as ImageUsage
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
    input_tokens_details: usage.input_tokens_details,
  }
}

function estimateCostUsd(currentModel: string, currentQuality: Quality, usage: ImageUsage | null): number | null {
  if (currentModel === 'gpt-image-2') {
    if (!usage) return null
    const textInput = usage.input_tokens_details?.text_tokens ?? usage.input_tokens ?? 0
    const imageInput = usage.input_tokens_details?.image_tokens ?? 0
    const imageOutput = usage.output_tokens ?? 0
    return roundUsd((textInput * 5 + imageInput * 8 + imageOutput * 30) / 1_000_000)
  }

  const perImage: Record<string, Record<Quality, number>> = {
    'gpt-image-1.5': { low: 0.013, medium: 0.05, high: 0.20 },
    'chatgpt-image-latest': { low: 0.013, medium: 0.05, high: 0.20 },
    'gpt-image-1': { low: 0.016, medium: 0.063, high: 0.25 },
  }
  if (perImage[currentModel]) return perImage[currentModel][currentQuality]
  return null
}

function pricingNote(currentModel: string): string {
  if (currentModel === 'gpt-image-2') {
    return 'Estimated from OpenAI GPT-image-2 pricing: text input $5/1M tokens, image input $8/1M tokens, image output $30/1M tokens, using response usage.'
  }
  return 'Estimated from OpenAI model-page per-image price for 1536x1024.'
}

function roundUsd(value: number): number {
  return Number(value.toFixed(6))
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

function getMoscowDayBounds(targetDate: string) {
  const start = new Date(`${targetDate}T00:00:00${MOSCOW_OFFSET}`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
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

function stringArg(name: string, fallback: string): string {
  const raw = args.get(name)
  return typeof raw === 'string' ? raw : fallback
}

function qualityArg(name: string, fallback: Quality): Quality {
  const raw = stringArg(name, fallback)
  return raw === 'low' || raw === 'medium' || raw === 'high' ? raw : fallback
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
