import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadDotenv, parse as parseDotenv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

loadDotenv({ path: resolve(process.cwd(), '.env.local') })
loadDotenv({ path: resolve(process.cwd(), '.env') })
loadExtraEnv(resolve(process.cwd(), 'malakhov-ai-keys.env'))

const BUCKET = 'article-images'
const WIDTH = 1400
const HEIGHT = 788

type CoverKind =
  | 'tool-mosaic'
  | 'comparison-radar'
  | 'learning-stack'
  | 'office-grid'
  | 'security-scan'
  | 'orbital-infra'
  | 'token-market'
  | 'neuro-atlas'

type CoverJob = {
  slug: string
  kind: CoverKind
  accent: string
  secondary: string
  bg: string
  ink: string
}

type ArticleRow = {
  slug: string
  ru_title: string
  source_name: string
  cover_image_url: string | null
}

const jobs: CoverJob[] = [
  {
    slug: '5-skillov-iz-ofitsialnogo-marketpleysa-claude-code-chto-rabo',
    kind: 'tool-mosaic',
    accent: '#D56F4D',
    secondary: '#2F7B79',
    bg: '#F3EFE7',
    ink: '#202833',
  },
  {
    slug: 'minimax-kimi-i-gpt-kakie-podpiski-vyderzhivayut-realnuyu-age',
    kind: 'comparison-radar',
    accent: '#D6A13A',
    secondary: '#4C79A8',
    bg: '#ECE8DF',
    ink: '#1F2630',
  },
  {
    slug: 'otus-otkryvaet-63-besplatnykh-uroka-v-mae-go-kubernetes-llm',
    kind: 'learning-stack',
    accent: '#C9644A',
    secondary: '#65884D',
    bg: '#F5F0E6',
    ink: '#26312E',
  },
  {
    slug: 'officeai-open-source-prilozhenie-prevrashchaet-ii-agentov-v',
    kind: 'office-grid',
    accent: '#3B7F86',
    secondary: '#D39A3A',
    bg: '#EFEAE1',
    ink: '#222733',
  },
  {
    slug: 'vaybkod-pod-skanerom-kak-podklyuchit-sast-i-ne-dat-llm-sloma',
    kind: 'security-scan',
    accent: '#CF5E4B',
    secondary: '#5B7FA6',
    bg: '#EDE8DE',
    ink: '#1E2630',
  },
  {
    slug: 'pochemu-data-tsentry-v-kosmose-ne-rabotayut-razbor-ot-inzhen',
    kind: 'orbital-infra',
    accent: '#D5A340',
    secondary: '#356F95',
    bg: '#F1ECE3',
    ink: '#202832',
  },
  {
    slug: 'grok-4-3-tsena-tokenov-v-8-raz-nizhe-gpt-5-5-i-dostup-iz-ros',
    kind: 'token-market',
    accent: '#2E7D76',
    secondary: '#C96B50',
    bg: '#F4EFE7',
    ink: '#202631',
  },
  {
    slug: 'shizofreniya-i-autizm-cherez-printsip-svobodnoy-energii-karl',
    kind: 'neuro-atlas',
    accent: '#B95F7A',
    secondary: '#427F91',
    bg: '#F2ECE4',
    ink: '#242832',
  },
]

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) throw new Error('Missing Supabase env')

  const apply = process.argv.includes('--apply')
  const topRussia = getNumberArg('--top-russia')
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const targetJobs = topRussia > 0 ? await getTopRussiaJobs(supabase, topRussia) : jobs

  const { data: articles, error } = await supabase
    .from('articles')
    .select('id, slug, ru_title, cover_image_url')
    .in('slug', targetJobs.map((job) => job.slug))

  if (error) throw error
  const articleBySlug = new Map((articles ?? []).map((article) => [article.slug, article]))

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', count: targetJobs.length, top_russia: topRussia || null }, null, 2))

  for (const job of targetJobs) {
    const article = articleBySlug.get(job.slug)
    if (!article) {
      console.warn(`missing article: ${job.slug}`)
      continue
    }

    const svg = renderSvg(job)
    const webp = await sharp(Buffer.from(svg))
      .resize(WIDTH, HEIGHT, { fit: 'cover' })
      .webp({ quality: 86, effort: 5 })
      .toBuffer()

    if (!apply) {
      console.log(`DRY ${job.slug} ${job.kind} ${Math.round(webp.length / 1024)}KB`)
      continue
    }

    const path = `template-covers/2026-05-01/${job.slug}-${job.kind}-${Date.now()}.webp`
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, webp, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: false,
    })
    if (uploadError) throw uploadError

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    const { error: updateError } = await supabase
      .from('articles')
      .update({ cover_image_url: data.publicUrl })
      .eq('id', article.id)
    if (updateError) throw updateError

    console.log(JSON.stringify({
      slug: job.slug,
      title: article.ru_title,
      kind: job.kind,
      bytes: webp.length,
      url: data.publicUrl,
    }))
  }
}

async function getTopRussiaJobs(supabase: any, limit: number): Promise<CoverJob[]> {
  const { data, error } = await supabase
    .from('articles')
    .select('slug, ru_title, source_name, cover_image_url')
    .eq('published', true)
    .eq('quality_ok', true)
    .or('primary_category.eq.ai-russia,secondary_categories.cs.{ai-russia}')
    .order('pub_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .order('score', { ascending: false })
    .order('id', { ascending: false })
    .limit(Math.max(limit * 4, 100))

  if (error) throw error

  return ((data ?? []) as ArticleRow[])
    .filter((article) => !isOurGeneratedCover(article.cover_image_url))
    .filter((article) => !article.cover_image_url || ['Habr AI', 'vc.ru', 'CNews'].includes(article.source_name))
    .slice(0, limit)
    .map((article, index) => createJobForArticle(article, index))
}

function isOurGeneratedCover(value: string | null): boolean {
  return Boolean(
    value?.includes('/article-images/template-covers/') ||
    value?.includes('/article-images/ai-covers/')
  )
}

function createJobForArticle(article: ArticleRow, index: number): CoverJob {
  const palettes = [
    ['#D56F4D', '#2F7B79', '#F3EFE7', '#202833'],
    ['#D6A13A', '#4C79A8', '#ECE8DF', '#1F2630'],
    ['#C9644A', '#65884D', '#F5F0E6', '#26312E'],
    ['#3B7F86', '#D39A3A', '#EFEAE1', '#222733'],
    ['#CF5E4B', '#5B7FA6', '#EDE8DE', '#1E2630'],
    ['#B95F7A', '#427F91', '#F2ECE4', '#242832'],
  ] as const
  const [accent, secondary, bg, ink] = palettes[index % palettes.length]

  return {
    slug: article.slug,
    kind: chooseKind(article.ru_title),
    accent,
    secondary,
    bg,
    ink,
  }
}

function chooseKind(title: string): CoverKind {
  const text = title.toLowerCase()
  if (/безопас|sast|уязв|шлюз|контрол|верификац|казнач|фнс|омс|риск/.test(text)) return 'security-scan'
  if (/рынок|цена|токен|подпис|рубл|млрд|долг|оплат|коммунал/.test(text)) return 'token-market'
  if (/курс|урок|обуч|jun|джун|тестов|промпт/.test(text)) return 'learning-stack'
  if (/офис|сотрудник|компан|бизнес|агент|сервис|платформ/.test(text)) return 'office-grid'
  if (/модель|vision|claude|gpt|grok|llm|opus|kimi|minimax|gemma/.test(text)) return 'comparison-radar'
  if (/данн|центр|инфра|контекст|архитектур|космос|локальн/.test(text)) return 'orbital-infra'
  if (/псих|аутизм|шизофрен|язык|галлюцинац|мышлен|мозг/.test(text)) return 'neuro-atlas'
  if (/скилл|маркетплейс|инструмент|настрой|obsidian|spec/.test(text)) return 'tool-mosaic'
  return ['tool-mosaic', 'comparison-radar', 'learning-stack', 'office-grid'][title.length % 4] as CoverKind
}

function getNumberArg(name: string): number {
  const arg = process.argv.find((item) => item.startsWith(`${name}=`))
  if (!arg) return 0
  const value = Number(arg.slice(name.length + 1))
  return Number.isFinite(value) ? value : 0
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
      // keep raw RTF key-value fallback below
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
    const value = match[2].trim().replace(/^["']|["']$/g, '')
    if (value) parsed[match[1]] = value
  }
  return parsed
}

function renderSvg(job: CoverJob): string {
  const base = baseDefs(job)
  const motif = renderMotif(job)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
${base}
<rect width="${WIDTH}" height="${HEIGHT}" fill="${job.bg}"/>
<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#paperGrain)"/>
${motif}
<rect x="64" y="64" width="${WIDTH - 128}" height="${HEIGHT - 128}" fill="none" stroke="${job.ink}" stroke-opacity="0.16" stroke-width="2"/>
<rect x="86" y="86" width="${WIDTH - 172}" height="${HEIGHT - 172}" fill="none" stroke="#fffaf2" stroke-opacity="0.36" stroke-width="1.5"/>
</svg>`
}

function baseDefs(job: CoverJob): string {
  return `<defs>
  <pattern id="paperGrain" width="22" height="22" patternUnits="userSpaceOnUse">
    <path d="M0 11H22M11 0V22" stroke="${job.ink}" stroke-opacity="0.035" stroke-width="1"/>
    <circle cx="5" cy="6" r="0.9" fill="${job.ink}" fill-opacity="0.045"/>
    <circle cx="18" cy="15" r="0.7" fill="${job.ink}" fill-opacity="0.04"/>
  </pattern>
  <radialGradient id="warmGlow" cx="26%" cy="22%" r="62%">
    <stop offset="0" stop-color="${job.accent}" stop-opacity="0.30"/>
    <stop offset="1" stop-color="${job.accent}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="coolGlow" cx="76%" cy="34%" r="54%">
    <stop offset="0" stop-color="${job.secondary}" stop-opacity="0.24"/>
    <stop offset="1" stop-color="${job.secondary}" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#warmGlow)"/>
<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#coolGlow)"/>`
}

function renderMotif(job: CoverJob): string {
  switch (job.kind) {
    case 'tool-mosaic':
      return toolMosaic(job)
    case 'comparison-radar':
      return comparisonRadar(job)
    case 'learning-stack':
      return learningStack(job)
    case 'office-grid':
      return officeGrid(job)
    case 'security-scan':
      return securityScan(job)
    case 'orbital-infra':
      return orbitalInfra(job)
    case 'token-market':
      return tokenMarket(job)
    case 'neuro-atlas':
      return neuroAtlas(job)
  }
}

function toolMosaic({ accent, secondary, ink }: CoverJob): string {
  return `<g>
  <rect x="134" y="126" width="392" height="500" rx="34" fill="#fffaf2" opacity="0.74"/>
  <rect x="610" y="114" width="560" height="188" rx="34" fill="${ink}" opacity="0.88"/>
  <rect x="610" y="344" width="250" height="238" rx="32" fill="${accent}" opacity="0.84"/>
  <rect x="914" y="344" width="256" height="238" rx="32" fill="${secondary}" opacity="0.80"/>
  ${Array.from({ length: 12 }).map((_, i) => `<rect x="${176 + (i % 3) * 105}" y="${178 + Math.floor(i / 3) * 88}" width="64" height="52" rx="12" fill="${i % 2 ? secondary : accent}" opacity="${i % 3 === 0 ? 0.86 : 0.46}"/>`).join('')}
  <path d="M650 230 C760 176 850 254 946 198 S1090 166 1160 224" fill="none" stroke="${accent}" stroke-width="18" stroke-linecap="round" opacity="0.52"/>
  <circle cx="1042" cy="462" r="62" fill="#fffaf2" opacity="0.72"/>
  <circle cx="748" cy="462" r="38" fill="${ink}" opacity="0.24"/>
</g>`
}

function comparisonRadar({ accent, secondary, ink }: CoverJob): string {
  return `<g>
  <rect x="116" y="118" width="430" height="506" rx="36" fill="${ink}" opacity="0.90"/>
  <g transform="translate(914 392)">
    ${[90, 150, 210, 270].map((r) => `<circle cx="0" cy="0" r="${r}" fill="none" stroke="${secondary}" stroke-opacity="0.24" stroke-width="3"/>`).join('')}
    ${Array.from({ length: 8 }).map((_, i) => {
      const a = (Math.PI * 2 * i) / 8
      return `<line x1="0" y1="0" x2="${Math.cos(a) * 290}" y2="${Math.sin(a) * 290}" stroke="${ink}" stroke-opacity="0.13" stroke-width="3"/>`
    }).join('')}
    <polygon points="0,-240 176,-82 120,158 -98,188 -230,40 -132,-152" fill="${accent}" opacity="0.28" stroke="${accent}" stroke-width="7"/>
    <polygon points="0,-164 122,-46 90,100 -72,126 -150,24 -82,-96" fill="${secondary}" opacity="0.30" stroke="${secondary}" stroke-width="5"/>
  </g>
  ${[0, 1, 2, 3].map((i) => `<rect x="172" y="${188 + i * 86}" width="${210 + i * 42}" height="32" rx="16" fill="${i % 2 ? secondary : accent}" opacity="${0.72 - i * 0.08}"/>`).join('')}
  <rect x="648" y="116" width="364" height="116" rx="30" fill="#fffaf2" opacity="0.64"/>
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
  ${Array.from({ length: 11 }).map((_, i) => `<line x1="${306 + i * 70}" y1="${188 + i * 25}" x2="${306 + i * 70}" y2="${410 + i * 20}" stroke="${ink}" stroke-opacity="0.16" stroke-width="3"/>`).join('')}
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
  <path d="M92 360 H1220" stroke="${accent}" stroke-opacity="0.84" stroke-width="5"/>
</g>`
}

function orbitalInfra({ accent, secondary, ink }: CoverJob): string {
  return `<g>
  <circle cx="968" cy="180" r="96" fill="${accent}" opacity="0.82"/>
  <circle cx="968" cy="180" r="168" fill="none" stroke="${secondary}" stroke-opacity="0.30" stroke-width="3"/>
  <circle cx="968" cy="180" r="250" fill="none" stroke="${secondary}" stroke-opacity="0.18" stroke-width="2"/>
  <path d="M0 570 C220 508 388 640 642 570 S1012 466 1400 574 L1400 788 L0 788 Z" fill="${ink}" opacity="0.86"/>
  <path d="M0 604 C236 548 430 670 680 604 S1034 508 1400 616" fill="none" stroke="${secondary}" stroke-opacity="0.46" stroke-width="4"/>
  <g transform="translate(214 394)">
    ${[0, 1, 2, 3, 4].map((i) => `<rect x="${i * 82}" y="${i % 2 ? 18 : 0}" width="56" height="${116 + i * 18}" fill="#fffaf2" opacity="${0.62 - i * 0.05}"/>`).join('')}
    <rect x="-24" y="176" width="500" height="48" fill="${accent}" opacity="0.62"/>
  </g>
  <rect x="110" y="118" width="450" height="230" rx="34" fill="#fffaf2" opacity="0.64"/>
</g>`
}

function tokenMarket({ accent, secondary, ink }: CoverJob): string {
  return `<g>
  <rect x="110" y="106" width="1180" height="530" rx="38" fill="#fffaf2" opacity="0.58"/>
  ${Array.from({ length: 10 }).map((_, i) => `<line x1="150" y1="${160 + i * 44}" x2="1248" y2="${160 + i * 44}" stroke="${ink}" stroke-opacity="0.08" stroke-width="2"/>`).join('')}
  ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${182 + i * 150}" y="${420 - i * 38}" width="88" height="${140 + i * 38}" rx="14" fill="${i % 2 ? secondary : accent}" opacity="${0.74 - i * 0.04}"/>`).join('')}
  <path d="M170 516 C312 420 426 468 558 382 S760 242 914 308 S1080 312 1230 188" fill="none" stroke="${ink}" stroke-opacity="0.62" stroke-width="14" stroke-linecap="round"/>
  <circle cx="914" cy="308" r="38" fill="${accent}"/>
  <circle cx="1230" cy="188" r="48" fill="${secondary}"/>
  <rect x="198" y="154" width="246" height="98" rx="24" fill="${ink}" opacity="0.86"/>
</g>`
}

function neuroAtlas({ accent, secondary, ink }: CoverJob): string {
  const nodes = [
    [250, 236, 70],
    [410, 338, 118],
    [616, 238, 86],
    [792, 376, 132],
    [1010, 250, 96],
    [1034, 512, 74],
    [570, 528, 92],
  ]
  return `<g>
  ${Array.from({ length: 8 }).map((_, i) => `<path d="M0 ${154 + i * 56} C260 ${72 + i * 28} 402 ${328 - i * 14} 642 ${196 + i * 18} S1010 ${120 + i * 20} 1400 ${264 + i * 24}" fill="none" stroke="${i % 2 ? secondary : accent}" stroke-opacity="${0.14 + i * 0.025}" stroke-width="${3 + (i % 3)}"/>`).join('')}
  ${nodes.map(([x, y, r], i) => `<g>
    <circle cx="${x}" cy="${y}" r="${r}" fill="${i % 2 ? secondary : accent}" opacity="${0.22 + (i % 3) * 0.08}"/>
    <circle cx="${x}" cy="${y}" r="${Math.round(r * 0.22)}" fill="${ink}" opacity="0.72"/>
  </g>`).join('')}
  ${nodes.slice(0, -1).map(([x, y], i) => `<line x1="${x}" y1="${y}" x2="${nodes[i + 1][0]}" y2="${nodes[i + 1][1]}" stroke="${ink}" stroke-opacity="0.20" stroke-width="5"/>`).join('')}
  <rect x="116" y="108" width="384" height="138" rx="32" fill="#fffaf2" opacity="0.54"/>
  <rect x="856" y="500" width="316" height="104" rx="28" fill="#fffaf2" opacity="0.42"/>
</g>`
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
