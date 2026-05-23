import test from 'node:test'
import assert from 'node:assert/strict'

import { classifyScene } from '../../scripts/generate-ai-covers'

// Wave 4 (spec_2026-05-22_digest_editorial_priority.md): когда AI-cover всё-таки нужен,
// сцена должна соответствовать сущности материала. См. typical fail case — Flipper One
// получивший «Russian enterprise operations room» сцену вместо product-launch.

test('product launch with hardware noun + announcement verb → product_launch', () => {
  assert.equal(
    classifyScene('Flipper Devices выпустила карманный Linux-компьютер Flipper One с ИИ-ускорителем', null, ''),
    'product_launch',
  )
  assert.equal(
    classifyScene('Apple unveils new Vision Pro headset', null, ''),
    'product_launch',
  )
})

test('model release with AI lab token + announcement → model_release', () => {
  assert.equal(
    classifyScene('OpenAI announces GPT-5 with new reasoning model', null, ''),
    'model_release',
  )
  assert.equal(
    classifyScene('Anthropic выпустила Claude 4.7 Sonnet', null, ''),
    'model_release',
  )
  assert.equal(
    classifyScene('Google представил Gemini 3.5 Flash на I/O', null, ''),
    'model_release',
  )
})

test('protest / people-focused news → people_news', () => {
  assert.equal(
    classifyScene('Бунт выпускников против ИИ-проповеди CEO: что стоит за протестами', null, ''),
    'people_news',
  )
})

test('hardware mention without announcement verb does NOT trigger product_launch', () => {
  assert.equal(
    classifyScene('Как локальная 8B vision-модель закрыла 70% разрыва до Claude Opus', null, ''),
    null,
  )
})

test('AI lab token without announcement verb does NOT trigger model_release', () => {
  assert.equal(
    classifyScene('Сравнение Claude и GPT для агентского кодинга', null, ''),
    null,
  )
})

test('product_launch takes precedence over model_release when both could fire', () => {
  // Hardware launch + AI mention: hardware wins because it's the editorial subject.
  assert.equal(
    classifyScene('NVIDIA выпустила Blackwell-ускоритель для дата-центров', null, ''),
    'product_launch',
  )
})

test('returns null for generic editorial / dev-story headlines', () => {
  assert.equal(
    classifyScene('Шесть слоёв между клиентом и галлюцинацией: архитектура голосового бота в финтехе', null, ''),
    null,
  )
  assert.equal(
    classifyScene('CUDA out of memory при обучении с GRPO: как считать память', null, ''),
    null,
  )
})
