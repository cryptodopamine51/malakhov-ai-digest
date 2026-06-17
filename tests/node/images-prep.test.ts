import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

import {
  COVER_HEIGHT,
  COVER_WIDTH,
  COVER_WEBP_QUALITY,
  GUIDE_IMAGE_VARIANT_WIDTHS,
  INLINE_HEIGHT,
  INLINE_WIDTH,
  INLINE_WEBP_QUALITY,
  SQUARE_SIDE,
  WEBP_EFFORT,
  buildMetaSlots,
  convertPlan,
  indexMetaByFilename,
  planFiles,
  resolveDimensions,
  writeResponsiveVariants,
} from '../../scripts/images-prep'

test('resolveDimensions: cover always returns the canonical 1200x675', () => {
  const dims = resolveDimensions('cover', 9999, 9999)
  assert.equal(dims.width, COVER_WIDTH)
  assert.equal(dims.height, COVER_HEIGHT)
})

test('resolveDimensions: inline square returns 1200x1200', () => {
  const dims = resolveDimensions('inline', 1024, 1024)
  assert.equal(dims.width, SQUARE_SIDE)
  assert.equal(dims.height, SQUARE_SIDE)
})

test('resolveDimensions: inline rectangular defaults to 1200x800 when meta is missing', () => {
  const dims = resolveDimensions('inline', undefined, undefined)
  assert.equal(dims.width, INLINE_WIDTH)
  assert.equal(dims.height, INLINE_HEIGHT)
})

test('resolveDimensions: inline keeps meta-provided dimensions when both are present', () => {
  const dims = resolveDimensions('inline', 1200, 800)
  assert.equal(dims.width, 1200)
  assert.equal(dims.height, 800)
})

test('indexMetaByFilename: maps cover and inline images by filename stem', () => {
  const map = indexMetaByFilename('demo-slug', {
    cover: {
      src: '/images/guides/demo-slug/cover.webp',
      width: 1200,
      height: 675,
    },
    inlineImagesByHeading: {
      'section-one': {
        src: '/images/guides/demo-slug/diagram-one.webp',
        width: 1200,
        height: 800,
      },
      'section-two': {
        src: '/images/guides/demo-slug/square-two.webp',
        width: 1200,
        height: 1200,
      },
    },
  })

  assert.deepEqual(map.get('cover'), { width: 1200, height: 675, role: 'cover' })
  assert.deepEqual(map.get('diagram-one'), { width: 1200, height: 800, role: 'inline' })
  assert.deepEqual(map.get('square-two'), { width: 1200, height: 1200, role: 'inline' })
})

test('buildMetaSlots: preserves cover-first then declared inline order', () => {
  const slots = buildMetaSlots('demo-slug', {
    cover: {
      src: '/images/guides/demo-slug/demo-cover.webp',
      width: 1200,
      height: 675,
    },
    inlineImagesByHeading: {
      'first-h2-slug': {
        src: '/images/guides/demo-slug/first-diagram.webp',
        width: 1200,
        height: 800,
      },
      'second-h2-slug': {
        src: '/images/guides/demo-slug/second-diagram.webp',
        width: 1200,
        height: 1200,
      },
    },
  })

  assert.deepEqual(
    slots.map((s) => ({ stem: s.stem, role: s.role, order: s.order })),
    [
      { stem: 'demo-cover', role: 'cover', order: 0 },
      { stem: 'first-diagram', role: 'inline', order: 1 },
      { stem: 'second-diagram', role: 'inline', order: 2 },
    ],
  )
})

test('WebP quality constants reflect the 2026-05-22 quality bump', () => {
  assert.ok(COVER_WEBP_QUALITY >= 88, `cover quality should be ≥ 88, got ${COVER_WEBP_QUALITY}`)
  assert.ok(INLINE_WEBP_QUALITY >= 85, `inline quality should be ≥ 85, got ${INLINE_WEBP_QUALITY}`)
  assert.ok(WEBP_EFFORT >= 4, `effort should be ≥ 4, got ${WEBP_EFFORT}`)
})

test('writeResponsiveVariants: writes -480 and -768 siblings with expected dimensions', async () => {
  const { tmp, rawDir, outDir } = makeTempDirs()
  try {
    const rawPath = join(rawDir, 'source.png')
    const outPath = join(outDir, 'demo-cover.webp')
    await sharp({
      create: {
        width: 1600,
        height: 900,
        channels: 3,
        background: '#2266aa',
      },
    })
      .png()
      .toFile(rawPath)

    const plan = {
      rawPath,
      outPath,
      width: 1200,
      height: 675,
      fit: 'cover' as const,
      role: 'cover' as const,
      filename: 'source.png',
      outStem: 'demo-cover',
      mapped: false,
    }
    await convertPlan(plan)
    const variants = await writeResponsiveVariants(outPath, plan)

    assert.deepEqual(
      variants.map((variant) => variant.width),
      Array.from(GUIDE_IMAGE_VARIANT_WIDTHS),
    )
    for (const variant of variants) {
      assert.equal(existsSync(variant.outputPath), true)
      const metadata = await sharp(variant.outputPath).metadata()
      assert.equal(metadata.width, variant.width)
      assert.equal(metadata.height, Math.round((675 / 1200) * variant.width))
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

// --- planFiles smart matching ---

function makeTempDirs() {
  const tmp = mkdtempSync(join(tmpdir(), 'images-prep-test-'))
  const rawDir = join(tmp, 'raw-images')
  const outDir = join(tmp, 'out')
  mkdirSync(rawDir, { recursive: true })
  mkdirSync(outDir, { recursive: true })
  return { tmp, rawDir, outDir }
}

function writePng(rawDir: string, name: string) {
  // Minimal placeholder content; planFiles doesn't read PNG bytes, only walks the directory.
  writeFileSync(join(rawDir, name), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
}

test('planFiles: exact-stem PNGs are mapped to their meta slot without rename', () => {
  const { tmp, rawDir, outDir } = makeTempDirs()
  try {
    writePng(rawDir, 'demo-cover.png')
    writePng(rawDir, 'first-diagram.png')

    const plans = planFiles(rawDir, 'demo-slug', {
      cover: {
        src: '/images/guides/demo-slug/demo-cover.webp',
        width: 1200,
        height: 675,
      },
      inlineImagesByHeading: {
        section: {
          src: '/images/guides/demo-slug/first-diagram.webp',
          width: 1200,
          height: 800,
        },
      },
    }, outDir)

    assert.equal(plans.length, 2)
    const cover = plans.find((p) => p.role === 'cover')
    const inline = plans.find((p) => p.role === 'inline')
    assert.ok(cover)
    assert.ok(inline)
    assert.equal(cover!.mapped, false)
    assert.equal(cover!.outStem, 'demo-cover')
    assert.equal(inline!.mapped, false)
    assert.equal(inline!.outStem, 'first-diagram')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('planFiles: random-named PNGs are mapped by alphabetical order to unfilled meta slots', () => {
  const { tmp, rawDir, outDir } = makeTempDirs()
  try {
    // Random ChatGPT-style filenames.
    writePng(rawDir, 'ChatGPT_image_2026-05-22_a.png')
    writePng(rawDir, 'ChatGPT_image_2026-05-22_b.png')
    writePng(rawDir, 'ChatGPT_image_2026-05-22_c.png')

    const plans = planFiles(rawDir, 'demo-slug', {
      cover: {
        src: '/images/guides/demo-slug/demo-cover.webp',
        width: 1200,
        height: 675,
      },
      inlineImagesByHeading: {
        'first-h2': {
          src: '/images/guides/demo-slug/first-diagram.webp',
          width: 1200,
          height: 800,
        },
        'second-h2': {
          src: '/images/guides/demo-slug/second-diagram.webp',
          width: 1200,
          height: 800,
        },
      },
    }, outDir)

    assert.equal(plans.length, 3)
    // Alphabetical PNG order maps onto cover → first-diagram → second-diagram.
    const [first, second, third] = plans
    assert.equal(first.filename, 'ChatGPT_image_2026-05-22_a.png')
    assert.equal(first.outStem, 'demo-cover')
    assert.equal(first.role, 'cover')
    assert.equal(first.mapped, true)

    assert.equal(second.filename, 'ChatGPT_image_2026-05-22_b.png')
    assert.equal(second.outStem, 'first-diagram')
    assert.equal(second.role, 'inline')
    assert.equal(second.mapped, true)

    assert.equal(third.filename, 'ChatGPT_image_2026-05-22_c.png')
    assert.equal(third.outStem, 'second-diagram')
    assert.equal(third.role, 'inline')
    assert.equal(third.mapped, true)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('planFiles: mixes exact-stem matches with random-named fillers for remaining slots', () => {
  const { tmp, rawDir, outDir } = makeTempDirs()
  try {
    writePng(rawDir, 'demo-cover.png') // exact match
    writePng(rawDir, 'random-photo.png') // fill first-diagram (alphabetical first random)
    writePng(rawDir, 'zzz-other.png') // fill second-diagram

    const plans = planFiles(rawDir, 'demo-slug', {
      cover: {
        src: '/images/guides/demo-slug/demo-cover.webp',
        width: 1200,
        height: 675,
      },
      inlineImagesByHeading: {
        first: {
          src: '/images/guides/demo-slug/first-diagram.webp',
          width: 1200,
          height: 800,
        },
        second: {
          src: '/images/guides/demo-slug/second-diagram.webp',
          width: 1200,
          height: 800,
        },
      },
    }, outDir)

    assert.equal(plans.length, 3)
    const byStem = Object.fromEntries(plans.map((p) => [p.outStem, p]))
    assert.equal(byStem['demo-cover'].mapped, false)
    assert.equal(byStem['demo-cover'].role, 'cover')
    assert.equal(byStem['first-diagram'].mapped, true)
    assert.equal(byStem['first-diagram'].filename, 'random-photo.png')
    assert.equal(byStem['second-diagram'].mapped, true)
    assert.equal(byStem['second-diagram'].filename, 'zzz-other.png')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
