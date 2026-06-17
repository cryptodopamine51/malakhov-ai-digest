import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GUIDE_IMAGE_BASE_WIDTH,
  GUIDE_IMAGE_VARIANT_WIDTHS,
  isLocalGuideImageSrc,
  localGuideImageSrcSet,
  localImageVariantPathFor,
  variantHeightFor,
} from '../../lib/local-image-variants'

test('local guide image constants are stable', () => {
  assert.equal(GUIDE_IMAGE_BASE_WIDTH, 1200)
  assert.deepEqual(Array.from(GUIDE_IMAGE_VARIANT_WIDTHS), [480, 768])
})

test('localImageVariantPathFor inserts width before .webp', () => {
  assert.equal(
    localImageVariantPathFor('/images/guides/demo/demo-cover.webp', 480),
    '/images/guides/demo/demo-cover-480.webp',
  )
})

test('isLocalGuideImageSrc only accepts local guide WebP files', () => {
  assert.equal(isLocalGuideImageSrc('/images/guides/demo/demo-cover.webp'), true)
  assert.equal(isLocalGuideImageSrc('/images/guides/demo/demo-cover.png'), false)
  assert.equal(isLocalGuideImageSrc('https://example.com/images/guides/demo.webp'), false)
  assert.equal(isLocalGuideImageSrc(null), false)
})

test('localGuideImageSrcSet builds responsive candidates plus canonical fallback', () => {
  const src = '/images/guides/demo/demo-cover.webp'
  const srcSet = localGuideImageSrcSet(src)
  assert.equal(
    srcSet,
    '/images/guides/demo/demo-cover-480.webp 480w, /images/guides/demo/demo-cover-768.webp 768w, /images/guides/demo/demo-cover.webp 1200w',
  )
  assert.equal(localGuideImageSrcSet('/images/guides/demo/demo-cover.png'), null)
})

test('variantHeightFor preserves aspect ratio', () => {
  assert.equal(variantHeightFor(480, 1200, 675), 270)
  assert.equal(variantHeightFor(768, 1200, 800), 512)
})
