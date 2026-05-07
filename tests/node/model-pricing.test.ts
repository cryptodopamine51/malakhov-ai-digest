import test from 'node:test'
import assert from 'node:assert/strict'

import {
  estimateOpenAiImageCostUsd,
  estimateTextCostUsd,
} from '../../pipeline/model-pricing'

test('estimateTextCostUsd applies Anthropic Sonnet rates', () => {
  const cost = estimateTextCostUsd({
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    usage: {
      inputTokens: 1000,
      outputTokens: 1000,
      cacheReadTokens: 1000,
      cacheCreateTokens: 1000,
    },
  })

  assert.equal(cost, 0.02205)
})

test('estimateTextCostUsd can apply Anthropic batch discount', () => {
  const cost = estimateTextCostUsd({
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    batch: true,
    usage: {
      inputTokens: 1000,
      outputTokens: 1000,
    },
  })

  assert.equal(cost, 0.009)
})

test('estimateTextCostUsd uses DeepSeek cache split when present', () => {
  const cost = estimateTextCostUsd({
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    usage: {
      inputTokens: 3000,
      outputTokens: 1000,
      cacheHitInputTokens: 2000,
      cacheMissInputTokens: 1000,
    },
  })

  assert.equal(cost, 0.000426)
})

test('estimateOpenAiImageCostUsd returns low 1536x1024 cover price', () => {
  assert.equal(estimateOpenAiImageCostUsd({
    model: 'gpt-image-1.5',
    quality: 'low',
    size: '1536x1024',
  }), 0.013)
})
