import test from 'node:test'
import assert from 'node:assert/strict'

import {
  COVER_HEIGHT,
  COVER_WIDTH,
  INLINE_HEIGHT,
  INLINE_WIDTH,
  SQUARE_SIDE,
  indexMetaByFilename,
  resolveDimensions,
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
