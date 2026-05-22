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
  /** Logical output stem (without `.webp`). Used in logs to surface SEO renames. */
  outStem: string
  /** True when the raw PNG name did not match any meta slot and was mapped by order. */
  mapped: boolean
}

const root = process.cwd()
const COVER_WIDTH = 1200
const COVER_HEIGHT = 675
const INLINE_WIDTH = 1200
const INLINE_HEIGHT = 800
const SQUARE_SIDE = 1200
// Quality bumped 2026-05-22: previous quality=82 produced ~30 KB WebP for 1200×800
// ChatGPT illustrations and showed visible artifacts. Cover is the OG/social image and
// stays at the higher end; inline diagrams are slightly leaner.
const COVER_WEBP_QUALITY = 90
const INLINE_WEBP_QUALITY = 88
// effort 6 spends more CPU at convert time for better compression at the same quality.
const WEBP_EFFORT = 6
const PNG_WARN_SIZE = 5 * 1024 * 1024

type MetaSlot = {
  /** Filename stem expected by guide metadata (without extension). SEO-friendly name. */
  stem: string
  width: number
  height: number
  role: 'cover' | 'inline'
  /** Stable order: cover first, then inline images in the order they appear in metadata. */
  order: number
}

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

function indexMetaByFilename(
  slug: string,
  metadata: GuideMetadata,
): Map<string, { width: number; height: number; role: 'cover' | 'inline' }> {
  const slots = buildMetaSlots(slug, metadata)
  const map = new Map<string, { width: number; height: number; role: 'cover' | 'inline' }>()
  for (const slot of slots) {
    map.set(slot.stem, { width: slot.width, height: slot.height, role: slot.role })
  }
  return map
}

/**
 * Build the ordered list of meta slots expected by the guide.
 * Cover is always order=0; inline images keep the order in which they appear in
 * `inlineImagesByHeading` (insertion order in metadata JSON).
 */
function buildMetaSlots(slug: string, metadata: GuideMetadata): MetaSlot[] {
  const expectedPrefix = `/images/guides/${slug}/`
  const slots: MetaSlot[] = []
  let order = 0

  if (metadata.cover?.src?.startsWith(expectedPrefix)) {
    const file = metadata.cover.src.slice(expectedPrefix.length)
    slots.push({
      stem: basenameWithoutExt(file),
      width: metadata.cover.width || COVER_WIDTH,
      height: metadata.cover.height || COVER_HEIGHT,
      role: 'cover',
      order: order++,
    })
  }

  for (const image of Object.values(metadata.inlineImagesByHeading ?? {})) {
    if (typeof image?.src !== 'string' || !image.src.startsWith(expectedPrefix)) continue
    const file = image.src.slice(expectedPrefix.length)
    slots.push({
      stem: basenameWithoutExt(file),
      width: image.width || INLINE_WIDTH,
      height: image.height || INLINE_HEIGHT,
      role: 'inline',
      order: order++,
    })
  }
  return slots
}

function basenameWithoutExt(file: string): string {
  return file.replace(/\.(webp|png|jpg|jpeg)$/i, '')
}

/**
 * Map raw PNG filenames to expected meta slots.
 *
 * 1) If a PNG stem exactly matches a meta slot stem — use that meta slot directly.
 * 2) Any remaining unmatched PNG files (random ChatGPT-style names like
 *    `ChatGPT_image_20260522.png`) are mapped against unfilled meta slots **in alphabetical
 *    order of the PNG filenames**, against meta slots in their declared order (cover first,
 *    then inline images in metadata order).
 *
 * This gives owner a predictable workflow: drop N random-named PNGs into raw-images/,
 * the script renames the WebP outputs to the SEO-friendly slot names from metadata.
 */
function planFiles(
  rawDir: string,
  slug: string,
  metadata: GuideMetadata,
  outDir: string,
): Plan[] {
  const slots = buildMetaSlots(slug, metadata)
  const rawPngs = readdirSync(rawDir)
    .filter((file) => file.toLowerCase().endsWith('.png'))
    .sort((a, b) => a.localeCompare(b))

  const plans: Plan[] = []
  const usedStems = new Set<string>()
  const remainingPngs: string[] = []

  // Pass 1: exact stem match.
  for (const file of rawPngs) {
    const stem = basenameWithoutExt(file)
    const slot = slots.find((s) => s.stem === stem && !usedStems.has(s.stem))
    if (slot) {
      usedStems.add(slot.stem)
      const rawPath = join(rawDir, file)
      const outPath = join(outDir, `${slot.stem}.webp`)
      plans.push({
        rawPath,
        outPath,
        width: slot.width,
        height: slot.height,
        fit: 'cover',
        role: slot.role,
        filename: file,
        outStem: slot.stem,
        mapped: false,
      })
    } else {
      remainingPngs.push(file)
    }
  }

  // Pass 2: map remaining PNGs to unfilled slots in declared meta order.
  const remainingSlots = slots.filter((s) => !usedStems.has(s.stem))
  for (let i = 0; i < remainingPngs.length; i++) {
    const file = remainingPngs[i]
    const slot = remainingSlots[i]
    if (!slot) {
      console.warn(
        `  warn: raw PNG ${file} has no matching meta slot (raw count exceeds expected slots). Skipping.`,
      )
      continue
    }
    usedStems.add(slot.stem)
    const rawPath = join(rawDir, file)
    const outPath = join(outDir, `${slot.stem}.webp`)
    plans.push({
      rawPath,
      outPath,
      width: slot.width,
      height: slot.height,
      fit: 'cover',
      role: slot.role,
      filename: file,
      outStem: slot.stem,
      mapped: true,
    })
  }

  // Warn about unfilled slots (less raw files than expected).
  const stillMissing = slots.filter((s) => !usedStems.has(s.stem))
  for (const slot of stillMissing) {
    console.warn(
      `  warn: meta slot "${slot.stem}" (${slot.role}) has no matching PNG in raw-images/. Slot remains empty.`,
    )
  }

  return plans
}

function buildPlans(slug: string, metadata: GuideMetadata): Plan[] {
  const rawDir = join(root, 'content', 'evergreen', 'packages', slug, 'raw-images')
  if (!existsSync(rawDir)) {
    throw new Error(`raw-images directory not found: ${rawDir}`)
  }

  const outDir = join(root, 'public', 'images', 'guides', slug)
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  return planFiles(rawDir, slug, metadata, outDir)
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
  const quality = plan.role === 'cover' ? COVER_WEBP_QUALITY : INLINE_WEBP_QUALITY
  await sharp(plan.rawPath)
    .resize(plan.width, plan.height, { fit: plan.fit, position: 'attention' })
    .webp({
      quality,
      effort: WEBP_EFFORT,
      // 4:4:4 keeps chroma resolution full — important for graphic illustrations with
      // text-like detail and thin lines (typical ChatGPT cover output). Photographic
      // covers also benefit because gradients stay smoother.
      smartSubsample: false,
    })
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
  let renamed = 0
  for (const plan of plans) {
    const { inputBytes, outputBytes } = await convertPlan(plan)
    totalOut += outputBytes
    const inputKb = (inputBytes / 1024).toFixed(0)
    const outputKb = (outputBytes / 1024).toFixed(0)
    const quality = plan.role === 'cover' ? COVER_WEBP_QUALITY : INLINE_WEBP_QUALITY
    const renameNote = plan.mapped ? ` (renamed ← ${plan.filename})` : ''
    if (plan.mapped) renamed += 1
    console.log(
      `images:prep ${plan.role.padEnd(6)} ${plan.outStem}.webp${renameNote} ` +
        `(in ${inputKb} KB → ${outputKb} KB, ${plan.width}×${plan.height}, q=${quality}, effort=${WEBP_EFFORT})`,
    )
    if (inputBytes > PNG_WARN_SIZE) {
      console.warn(
        `  warn: input PNG ${plan.filename} is ${inputKb} KB (> ${PNG_WARN_SIZE / 1024} KB); likely ChatGPT source without compression`,
      )
    }
  }
  console.log(
    `images:prep ok: slug=${slug} files=${plans.length} renamed=${renamed} totalOutput=${(totalOut / 1024).toFixed(0)} KB`,
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

export {
  buildPlans,
  buildMetaSlots,
  indexMetaByFilename,
  planFiles,
  resolveDimensions,
  COVER_WIDTH,
  COVER_HEIGHT,
  INLINE_WIDTH,
  INLINE_HEIGHT,
  SQUARE_SIDE,
  COVER_WEBP_QUALITY,
  INLINE_WEBP_QUALITY,
  WEBP_EFFORT,
}
export type { Plan, GuideMetadata, MetaSlot }
