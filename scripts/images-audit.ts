import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { GUIDE_IMAGE_VARIANT_WIDTHS, localImageVariantPathFor } from '../lib/local-image-variants'

type GuideImage = {
  src?: string
  width?: number
  height?: number
}

type GuideMetadata = {
  slug?: string
  cover?: GuideImage
  inlineImagesByHeading?: Record<string, GuideImage>
}

type ImageRecord = {
  slug: string
  role: 'cover' | 'inline'
  src: string
  path: string
  bytes: number
}

const root = process.cwd()
const metaDir = join(root, 'content', 'guides', 'meta')

function getArgValue(name: string): string | undefined {
  const exactIndex = process.argv.indexOf(name)
  if (exactIndex !== -1) return process.argv[exactIndex + 1]
  const prefix = `${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length) : undefined
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`
}

function isLocalGuideWebp(src: string | undefined): src is string {
  return typeof src === 'string' && src.startsWith('/images/guides/') && /\.webp$/i.test(src)
}

function readPublishedGuideImages(): ImageRecord[] {
  const records: ImageRecord[] = []
  for (const file of readdirSync(metaDir).filter((item) => item.endsWith('.json')).sort()) {
    const metadata = JSON.parse(readFileSync(join(metaDir, file), 'utf8')) as GuideMetadata
    const slug = metadata.slug ?? file.replace(/\.json$/, '')
    const candidates: Array<{ role: 'cover' | 'inline'; image: GuideImage | undefined }> = [
      { role: 'cover', image: metadata.cover },
      ...Object.values(metadata.inlineImagesByHeading ?? {}).map((image) => ({ role: 'inline' as const, image })),
    ]

    for (const { role, image } of candidates) {
      if (!isLocalGuideWebp(image?.src)) continue
      const path = join(root, 'public', image.src)
      if (!existsSync(path)) continue
      records.push({
        slug,
        role,
        src: image.src,
        path,
        bytes: statSync(path).size,
      })
    }
  }
  return records
}

function variantPath(src: string, width: number): string {
  return join(root, 'public', localImageVariantPathFor(src, width))
}

function variantBytesOrNull(src: string, width: number): number | null {
  const path = variantPath(src, width)
  return existsSync(path) ? statSync(path).size : null
}

async function spotCheckHeaders(records: ImageRecord[]) {
  if (process.argv.includes('--no-live')) return
  const baseUrl = (getArgValue('--base-url') ?? 'https://news.malakhovai.ru').replace(/\/$/, '')
  const limit = Number.parseInt(getArgValue('--live-limit') ?? '5', 10)
  const sample = records.slice(0, Number.isFinite(limit) ? limit : 5)

  console.log('\nLive cache-control spot checks')
  for (const record of sample) {
    const url = `${baseUrl}${record.src}`
    try {
      const res = await fetch(url, { method: 'HEAD' })
      console.log(
        `- ${res.status} ${record.src} cache-control=${res.headers.get('cache-control') ?? '(missing)'}`,
      )
    } catch (error) {
      console.log(`- ERROR ${record.src}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

async function main() {
  const records = readPublishedGuideImages()
  const byGuide = new Map<string, ImageRecord[]>()
  for (const record of records) {
    const guideRecords = byGuide.get(record.slug) ?? []
    guideRecords.push(record)
    byGuide.set(record.slug, guideRecords)
  }

  console.log('Top 30 heaviest local guide canonical images')
  for (const record of records.slice().sort((a, b) => b.bytes - a.bytes).slice(0, 30)) {
    console.log(`- ${kb(record.bytes).padStart(9)} ${record.slug} ${record.role} ${record.src}`)
  }

  console.log('\nPer-guide image weight')
  for (const [slug, guideRecords] of Array.from(byGuide.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const canonicalBytes = guideRecords.reduce((sum, record) => sum + record.bytes, 0)
    const mobileBytes = guideRecords.reduce((sum, record) => {
      return sum + (variantBytesOrNull(record.src, 768) ?? record.bytes)
    }, 0)
    console.log(
      `- ${slug}: images=${guideRecords.length} canonical=${kb(canonicalBytes)} mobile-768=${kb(mobileBytes)}`,
    )
  }

  const missing: string[] = []
  for (const record of records) {
    for (const width of GUIDE_IMAGE_VARIANT_WIDTHS) {
      const path = variantPath(record.src, width)
      if (!existsSync(path)) missing.push(`${record.src} -> ${width}w`)
    }
  }

  console.log('\nMissing responsive variants')
  if (missing.length === 0) {
    console.log('- none')
  } else {
    for (const item of missing) console.log(`- ${item}`)
  }

  await spotCheckHeaders(records)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
