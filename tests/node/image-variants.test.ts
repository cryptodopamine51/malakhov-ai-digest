import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  COVER_BASE_WIDTH,
  COVER_VARIANT_WIDTHS,
  isR2ImageUrl,
  r2VariantSrcSet,
  variantKeyFor,
  variantUrlFor,
} from '../../lib/image-variants'

const R2 = 'https://pub-abc123.r2.dev/article-images/ai-covers/2026-05-29/slug-123.webp'

test('constants are consistent', () => {
  assert.equal(COVER_BASE_WIDTH, 1200)
  assert.ok(COVER_VARIANT_WIDTHS.length > 0)
  assert.ok(COVER_VARIANT_WIDTHS.every((w) => w < COVER_BASE_WIDTH))
})

test('variantUrlFor / variantKeyFor insert width before .webp', () => {
  assert.equal(
    variantUrlFor(R2, 400),
    'https://pub-abc123.r2.dev/article-images/ai-covers/2026-05-29/slug-123-400.webp',
  )
  assert.equal(variantKeyFor('article-images/x/slug-123.webp', 800), 'article-images/x/slug-123-800.webp')
})

test('variantUrlFor only touches the .webp extension', () => {
  // ".webp" appears once; the date segment with hyphens must be untouched.
  assert.equal(variantUrlFor(R2, 800).split('.webp').length, 2)
  assert.ok(variantUrlFor(R2, 800).endsWith('-800.webp'))
})

test('isR2ImageUrl accepts our R2 webp covers', () => {
  assert.equal(isR2ImageUrl(R2), true)
})

test('isR2ImageUrl rejects non-R2 / non-webp / malformed', () => {
  assert.equal(isR2ImageUrl(null), false)
  assert.equal(isR2ImageUrl(undefined), false)
  assert.equal(isR2ImageUrl('not a url'), false)
  // external source CDN
  assert.equal(isR2ImageUrl('https://habrastorage.org/article-images/x.webp'), false)
  // R2 host but not an article-images path
  assert.equal(isR2ImageUrl('https://pub-abc.r2.dev/other/x.webp'), false)
  // R2 article-images but not webp
  assert.equal(isR2ImageUrl('https://pub-abc.r2.dev/article-images/x.png'), false)
  // http (not https)
  assert.equal(isR2ImageUrl('http://pub-abc.r2.dev/article-images/x.webp'), false)
})

test('isR2ImageUrl honors NEXT_PUBLIC_R2_PUBLIC_BASE_URL custom domain', () => {
  const prev = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL
  process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL = 'https://img.malakhovai.ru'
  try {
    assert.equal(isR2ImageUrl('https://img.malakhovai.ru/article-images/slug.webp'), true)
    assert.equal(isR2ImageUrl('https://evil.example/article-images/slug.webp'), false)
  } finally {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL
    else process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL = prev
  }
})

test('r2VariantSrcSet builds widths + base, or null for non-R2', () => {
  const srcSet = r2VariantSrcSet(R2)
  assert.ok(srcSet)
  for (const w of COVER_VARIANT_WIDTHS) {
    assert.ok(srcSet!.includes(`${variantUrlFor(R2, w)} ${w}w`))
  }
  assert.ok(srcSet!.includes(`${R2} ${COVER_BASE_WIDTH}w`))
  assert.equal(r2VariantSrcSet('https://habrastorage.org/x.webp'), null)
  assert.equal(r2VariantSrcSet(null), null)
})
