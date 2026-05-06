import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { readConsent, hasAnalyticsConsent } from '../../lib/consent'

const repoRoot = resolve(__dirname, '..', '..')

test('analytics is enabled by default for the notice model', () => {
  assert.equal(hasAnalyticsConsent(null), true)
  assert.equal(hasAnalyticsConsent({
    version: 1,
    decision: 'notice_ok',
    categories: { necessary: true, analytics: true, marketing: false },
    decidedAt: '2026-05-05T00:00:00.000Z',
  }), true)
})

test('legacy notice_ok consent remains valid', () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => JSON.stringify({
          version: 1,
          decision: 'notice_ok',
          categories: { necessary: true, analytics: true, marketing: false },
          decidedAt: '2026-05-01T00:00:00.000Z',
        }),
      },
    },
  })

  try {
    assert.deepEqual(readConsent(), {
      version: 1,
      decision: 'notice_ok',
      categories: { necessary: true, analytics: true, marketing: false },
      decidedAt: '2026-05-01T00:00:00.000Z',
    })
  } finally {
    Reflect.deleteProperty(globalThis, 'window')
  }
})

test('consent banner uses a notice acknowledgement and does not expose opt-out actions', () => {
  const src = readFileSync(resolve(repoRoot, 'src/components/ConsentManager.tsx'), 'utf8')
  assert.match(src, /OK/)
  assert.match(src, /decision:\s*'notice_ok'/)
  assert.equal(hasAnalyticsConsent({
    version: 1,
    decision: 'notice_ok',
    categories: { necessary: true, analytics: true, marketing: false },
    decidedAt: '2026-05-05T00:00:00.000Z',
  }), true)
  assert.doesNotMatch(src, /Только необходимые/)
  assert.doesNotMatch(src, /Настроить/)
})
