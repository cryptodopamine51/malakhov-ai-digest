import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import sharp from 'sharp'

type ImageMeta = {
  src: string
  width: number
  height: number
}

type GuideMetadata = {
  cover?: ImageMeta
  inlineImagesByHeading?: Record<string, ImageMeta>
}

type Plan = {
  rawPath: string
  outPath: string
  width: number
  height: number
  fit: 'cover' | 'contain'
  role: 'cover' | 'inline'
  filename: string
}

const root = process.cwd()
const COVER_WIDTH = 1200
const COVER_HEIGHT = 675
const INLINE_WIDTH = 1200
const INLINE_HEIGHT = 800
const SQUARE_SIDE = 1200
const WEBP_QUALITY = 82
const PNG_WARN_SIZE = 5 * 1024 * 1024

function getArgValue(name: string): string | undefined {
  const exactIndex = process.argv.indexOf(name)
  if (exactIndex !== -1) return process.argv[exactIndex + 1]
  const prefix = `${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length) : undefined
}

function readMetadata(slug: string): GuideMetadata {
  const path = join(
    root,
    'content',
    'evergreen',
    'packages',
    slug,
    '08-metadata.json',
  )
  if (!existsSync(path)) {
    throw new Error(`Package metadata not found: ${path}`)
  }
  return JSON.parse(readFileSync(path, 'utf8')) as GuideMetadata
}

function indexMetaByFilename(slug: string, metadata: GuideMetadata): Map<string, { width: number; height: number; role: 'cover' | 'inline' }> {
  const expectedPrefix = `/images/guides/${slug}/`
  const map = new Map<string, { width: number; height: number; role: 'cover' | 'inline' }>()

  if (metadata.cover?.src?.startsWith(expectedPrefix)) {
    const file = metadata.cover.src.slice(expectedPrefix.length)
    map.set(basenameWithoutExt(file), {
      width: metadata.cover.width || COVER_WIDTH,
      height: metadata.cover.height || COVER_HEIGHT,
      role: 'cover',
    })
  }

  for (const image of Object.values(metadata.inlineImagesByHeading ?? {})) {
    if (typeof image?.src !== 'string' || !image.src.startsWith(expectedPrefix)) continue
    const file = image.src.slice(expectedPrefix.length)
    map.set(basenameWithoutExt(file), {
      width: image.width || INLINE_WIDTH,
      height: image.height || INLINE_HEIGHT,
      role: 'inline',
    })
  }
  return map
}

function basenameWithoutExt(file: string): string {
  return file.replace(/\.(webp|png|jpg|jpeg)$/i, '')
}

function buildPlans(slug: string, metadata: GuideMetadata): Plan[] {
  const rawDir = join(root, 'content', 'evergreen', 'packages', slug, 'raw-images')
  if (!existsSync(rawDir)) {
    throw new Error(`raw-images directory not found: ${rawDir}`)
  }

  const outDir = join(root, 'public', 'images', 'guides', slug)
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  const metaIndex = indexMetaByFilename(slug, metadata)
  const rawPngs = readdirSync(rawDir).filter((file) => file.toLowerCase().endsWith('.png'))

  const plans: Plan[] = []
  for (const file of rawPngs) {
    const stem = basenameWithoutExt(file)
    const meta = metaIndex.get(stem)
    const rawPath = join(rawDir, file)
    const outPath = join(outDir, `${stem}.webp`)
    const role: 'cover' | 'inline' = meta?.role ?? (stem === 'cover' ? 'cover' : 'inline')
    const { width, height } = resolveDimensions(role, meta?.width, meta?.height)
    plans.push({ rawPath, outPath, width, height, fit: 'cover', role, filename: file })
  }
  return plans
}

function resolveDimensions(
  role: 'cover' | 'inline',
  metaWidth: number | undefined,
  metaHeight: number | undefined,
): { width: number; height: number } {
  if (role === 'cover') return { width: COVER_WIDTH, height: COVER_HEIGHT }
  if (metaWidth && metaHeight && metaWidth === metaHeight) {
    return { width: SQUARE_SIDE, height: SQUARE_SIDE }
  }
  if (metaWidth && metaHeight) return { width: metaWidth, height: metaHeight }
  return { width: INLINE_WIDTH, height: INLINE_HEIGHT }
}

export async function convertPlan(plan: Plan): Promise<{ inputBytes: number; outputBytes: number }> {
  const inputBytes = statSync(plan.rawPath).size
  await sharp(plan.rawPath)
    .resize(plan.width, plan.height, { fit: plan.fit, position: 'attention' })
    .webp({ quality: WEBP_QUALITY })
    .toFile(plan.outPath)
  const outputBytes = statSync(plan.outPath).size
  return { inputBytes, outputBytes }
}

export async function prepareSlug(slug: string): Promise<void> {
  const metadata = readMetadata(slug)
  const plans = buildPlans(slug, metadata)

  if (plans.length === 0) {
    console.log(`images:prep: no PNG files to convert in raw-images for slug=${slug}`)
    return
  }

  let totalOut = 0
  for (const plan of plans) {
    const { inputBytes, outputBytes } = await convertPlan(plan)
    totalOut += outputBytes
    const inputKb = (inputBytes / 1024).toFixed(0)
    const outputKb = (outputBytes / 1024).toFixed(0)
    console.log(
      `images:prep ${plan.role.padEnd(6)} ${plan.filename} (${inputKb} KB) → ${plan.outPath.replace(`${root}/`, '')} (${outputKb} KB, ${plan.width}×${plan.height})`,
    )
    if (inputBytes > PNG_WARN_SIZE) {
      console.warn(
        `  warn: input PNG ${plan.filename} is ${inputKb} KB (> ${PNG_WARN_SIZE / 1024} KB); likely ChatGPT source without compression`,
      )
    }
  }
  console.log(
    `images:prep ok: slug=${slug} files=${plans.length} totalOutput=${(totalOut / 1024).toFixed(0)} KB`,
  )
}

async function main() {
  const slug = getArgValue('--slug')
  if (!slug) {
    throw new Error('Usage: npm run images:prep -- --slug=<slug>')
  }
  await prepareSlug(slug)
}

const isDirectInvocation = (() => {
  const argv1 = process.argv[1] ?? ''
  return argv1.endsWith('/scripts/images-prep.ts') || argv1.endsWith('\\scripts\\images-prep.ts')
})()

if (isDirectInvocation) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}

export { buildPlans, indexMetaByFilename, resolveDimensions, COVER_WIDTH, COVER_HEIGHT, INLINE_WIDTH, INLINE_HEIGHT, SQUARE_SIDE, WEBP_QUALITY }
export type { Plan, GuideMetadata }
