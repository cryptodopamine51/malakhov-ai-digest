import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { findGuideInlineLinks, MAX_GUIDE_INLINE_LINKS } from '../../lib/guide-inline-links'

const GUIDES: Record<string, { path: string; noindex: boolean }> = {
  'ii-agenty-v-prodazhah': { path: '/guides/ii-agenty-v-prodazhah', noindex: false },
  'ii-agenty-dlya-biznesa-chto-eto-i-gde-primenyat': {
    path: '/guides/ii-agenty-dlya-biznesa-chto-eto-i-gde-primenyat',
    noindex: false,
  },
  'skolko-stoit-vnedrenie-ii-v-kompaniyu': {
    path: '/guides/skolko-stoit-vnedrenie-ii-v-kompaniyu',
    noindex: false,
  },
  'kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii': {
    path: '/guides/kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii',
    noindex: false,
  },
  'kak-vnedrit-ii-v-biznes-2026': { path: '/guides/kak-vnedrit-ii-v-biznes-2026', noindex: false },
}

const resolveGuide = (slug: string) => GUIDES[slug] ?? null

test('agent phrase links to the agents hub guide', () => {
  const body = 'Компания выпустила нового ИИ-агента для юристов.\n\nОн работает внутри Word.'
  const links = findGuideInlineLinks(body, { resolveGuide })
  assert.equal(links.length >= 1, true)
  assert.equal(links[0].href, '/guides/ii-agenty-dlya-biznesa-chto-eto-i-gde-primenyat')
  assert.ok(body.includes(links[0].anchor), 'anchor must be a verbatim substring of the body')
})

test('sales-context agent phrase prefers the sales guide', () => {
  const body = 'Стартап делает ИИ-агентов для продаж и квалификации лидов.'
  const links = findGuideInlineLinks(body, { resolveGuide })
  assert.equal(links[0].href, '/guides/ii-agenty-v-prodazhah')
  assert.ok(body.includes(links[0].anchor))
})

test('implementation phrase links to the pillar guide', () => {
  const body = 'Опрос показал, что внедрение ИИ в ритейле ускорилось вдвое.'
  const links = findGuideInlineLinks(body, { resolveGuide })
  assert.equal(links.length, 1)
  assert.equal(links[0].href, '/guides/kak-vnedrit-ii-v-biznes-2026')
})

test('cost phrase wins over generic implementation phrase', () => {
  const body = 'Аналитики оценили затраты на внедрение ИИ в средней компании.'
  const links = findGuideInlineLinks(body, { resolveGuide })
  assert.equal(links[0].href, '/guides/skolko-stoit-vnedrenie-ii-v-kompaniyu')
})

test('caps at MAX_GUIDE_INLINE_LINKS and keeps one link per guide', () => {
  const body = [
    'Новый ИИ-агент вышел на рынок.',
    'Внедрение ИИ ускоряется.',
    'Автоматизация бизнес-процессов растёт.',
    'Ещё один ИИ-агент и ещё одно внедрение ИИ.',
  ].join('\n\n')
  const links = findGuideInlineLinks(body, { resolveGuide })
  assert.equal(links.length, MAX_GUIDE_INLINE_LINKS)
  const hrefs = links.map((l) => l.href)
  assert.equal(new Set(hrefs).size, hrefs.length)
})

test('noindex guides are never linked', () => {
  const noindexResolver = (slug: string) =>
    GUIDES[slug] ? { ...GUIDES[slug], noindex: true } : null
  const body = 'Компания выпустила ИИ-агента, продолжается внедрение ИИ.'
  assert.deepEqual(findGuideInlineLinks(body, { resolveGuide: noindexResolver }), [])
})

test('headings and blockquotes are skipped', () => {
  const body = '## ИИ-агенты наступают\n\n> внедрение ИИ в цитате\n\nОбычный текст без ключевых фраз.'
  assert.deepEqual(findGuideInlineLinks(body, { resolveGuide }), [])
})

test('overlapping anchors are not double-assigned', () => {
  // «ИИ-агентов для продаж» contains «ИИ-агентов»: the generic rule must not
  // re-link a substring of an anchor already used by the sales rule.
  const body = 'Рынок ИИ-агентов для продаж вырос. Про ИИ-агентов пишут все.'
  const links = findGuideInlineLinks(body, { resolveGuide })
  const anchors = links.map((l) => l.anchor)
  for (let i = 0; i < anchors.length; i++) {
    for (let j = 0; j < anchors.length; j++) {
      if (i === j) continue
      assert.equal(anchors[i].includes(anchors[j]), false, `anchor "${anchors[i]}" overlaps "${anchors[j]}"`)
    }
  }
})

test('empty body yields no links', () => {
  assert.deepEqual(findGuideInlineLinks('', { resolveGuide }), [])
})
