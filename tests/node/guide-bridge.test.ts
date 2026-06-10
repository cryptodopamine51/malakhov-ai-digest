import test from 'node:test'
import assert from 'node:assert/strict'

import { getGuideBridgeForArticle } from '../../lib/guide-bridge'

test('guide bridge routes agentic sales articles to the sales agents guide', () => {
  const bridge = getGuideBridgeForArticle({
    primary_category: 'ai-industry',
    ru_title: 'ИИ-агент помогает отделу продаж вести лиды и follow-up в CRM',
    original_title: null,
    lead: null,
    card_teaser: null,
  })

  assert.equal(bridge?.path, '/guides/ii-agenty-v-prodazhah')
})

test('guide bridge routes generic agentic articles to the business agents guide', () => {
  const bridge = getGuideBridgeForArticle({
    primary_category: 'ai-labs',
    ru_title: 'Agentic AI становится новым слоем корпоративного ПО',
    original_title: null,
    lead: null,
    card_teaser: null,
  })

  assert.equal(bridge?.path, '/guides/ii-agenty-dlya-biznesa-chto-eto-i-gde-primenyat')
})

test('guide bridge keeps category fallback for non-agent articles', () => {
  const bridge = getGuideBridgeForArticle({
    primary_category: 'ai-startups',
    ru_title: 'Стартап представил сервис для аналитики расходов',
    original_title: null,
    lead: null,
    card_teaser: null,
  })

  assert.equal(bridge?.path, '/guides/kak-vybrat-pervyj-ii-proekt-v-biznese')
})
