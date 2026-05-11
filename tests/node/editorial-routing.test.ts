import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildDeterministicEditorialBrief,
  detectEditorialRiskFlags,
  getEditorialRoutingConfig,
  parseClaudeReviewerResult,
  shouldReviewWithClaude,
} from '../../pipeline/editorial-routing'

const context = {
  sourceName: 'Habr AI',
  originalTitle: 'Стартап привлёк $50 млн на ИИ-платформу для банков',
  originalText:
    'Компания привлекла $50 млн инвестиций и теперь оценивается в $500 млн. ' +
    'Продукт помогает банкам проверять документы, но источник не раскрывает выручку.',
  topics: ['ai-startups'],
  primaryCategory: 'ai-startups',
  secondaryCategories: [],
  score: 8.2,
}

test('getEditorialRoutingConfig keeps current Claude path as default', () => {
  assert.deepEqual(getEditorialRoutingConfig({}), {
    mode: 'premium',
    writerProvider: 'anthropic',
    reviewPolicy: 'none',
  })
})

test('getEditorialRoutingConfig selects DeepSeek without reviewer for cheap mode', () => {
  assert.deepEqual(getEditorialRoutingConfig({ EDITORIAL_ROUTING_MODE: 'cheap' }), {
    mode: 'cheap',
    writerProvider: 'deepseek',
    reviewPolicy: 'none',
  })
})

test('getEditorialRoutingConfig enables selective reviewer for balanced mode', () => {
  assert.deepEqual(getEditorialRoutingConfig({ EDITORIAL_ROUTING_MODE: 'balanced' }), {
    mode: 'balanced',
    writerProvider: 'deepseek',
    reviewPolicy: 'selective',
  })
})

test('detectEditorialRiskFlags marks money and high score stories', () => {
  assert.deepEqual(detectEditorialRiskFlags(context), ['money', 'high_score'])
})

test('buildDeterministicEditorialBrief includes risk flags and source excerpt', () => {
  const brief = buildDeterministicEditorialBrief(context)
  assert.match(brief, /Risk flags: money, high_score/)
  assert.match(brief, /Source excerpt:/)
  assert.match(brief, /Use only source-supported facts/)
})

test('shouldReviewWithClaude triggers selective review on validator failure and risk', () => {
  const decision = shouldReviewWithClaude({
    config: getEditorialRoutingConfig({ EDITORIAL_ROUTING_MODE: 'balanced' }),
    context,
    validation: {
      ok: false,
      errors: ['link_anchor отсутствует в editorial_body'],
      warnings: [],
      riskFlags: ['money'],
    },
  })

  assert.equal(decision.shouldReview, true)
  assert.ok(decision.reasons.includes('validator_failed'))
  assert.ok(decision.reasons.includes('article_money'))
})

test('parseClaudeReviewerResult accepts compact reviewer JSON', () => {
  const parsed = parseClaudeReviewerResult(JSON.stringify({
    pass: false,
    blocking_issues: ['Не хватает источника для оценки'],
    non_blocking_notes: [],
    patch_suggestions: ['Убрать вывод про рынок'],
    publish_recommendation: 'fix',
  }))

  assert.equal(parsed?.pass, false)
  assert.equal(parsed?.publish_recommendation, 'fix')
})
