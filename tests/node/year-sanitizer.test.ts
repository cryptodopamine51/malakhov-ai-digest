import test from 'node:test'
import assert from 'node:assert/strict'

import { findStaleHallucinatedYears, hasStaleYearHallucination } from '../../lib/year-sanitizer'

const now = new Date('2026-06-17T10:00:00.000Z')

test('year sanitizer rejects stale years that are absent from source', () => {
  assert.equal(hasStaleYearHallucination({
    generatedText: 'Apple покажет Siri на WWDC 2025.',
    sourceText: 'Apple готовит Siri для WWDC 2026.',
    now,
  }), true)
})

test('year sanitizer does not treat count metrics as stale years', () => {
  const stale = findStaleHallucinatedYears({
    generatedText:
      'Grok помог нанести удары по 2000 целям и применить более 2000 единиц боеприпасов за 96 часов.',
    sourceText:
      'Grok helped forces deploy over 2,000 munitions to 2,000 distinct targets within 96 hours.',
    now,
  })

  assert.deepEqual(stale, [])
})

test('year sanitizer still reports real stale years next to count metrics', () => {
  const stale = findStaleHallucinatedYears({
    generatedText:
      'NAACP подала иск в апреле 2025 года; Grok помог нанести удары по 2000 целям.',
    sourceText:
      'The NAACP sued xAI in April. Grok helped deploy over 2,000 munitions to 2,000 distinct targets.',
    now,
  })

  assert.deepEqual(stale, ['2025'])
})
