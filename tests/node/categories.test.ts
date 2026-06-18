import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  splitTopicsToCategories,
  resolveArticleCategories,
  hasRussiaMarketSignal,
  isKnownCategory,
  DEFAULT_CATEGORY,
} from '../../lib/categories'

test('splitTopicsToCategories: первый известный topic становится primary, остальные — secondary', () => {
  const { primary, secondary } = splitTopicsToCategories(['ai-research', 'ai-industry', 'ai-labs'])
  assert.equal(primary, 'ai-research')
  assert.deepEqual(secondary, ['ai-industry', 'ai-labs'])
})

test('splitTopicsToCategories: secondary ограничивается двумя элементами', () => {
  const { secondary } = splitTopicsToCategories(['ai-industry', 'ai-research', 'ai-labs', 'ai-startups'])
  assert.equal(secondary.length, 2)
})

test('splitTopicsToCategories: неизвестные topic-и игнорируются', () => {
  const { primary, secondary } = splitTopicsToCategories(['something-unknown', 'ai-labs', 'another'])
  assert.equal(primary, 'ai-labs')
  assert.deepEqual(secondary, [])
})

test('splitTopicsToCategories: дубликаты схлопываются', () => {
  const { primary, secondary } = splitTopicsToCategories(['ai-industry', 'ai-industry', 'ai-research'])
  assert.equal(primary, 'ai-industry')
  assert.deepEqual(secondary, ['ai-research'])
})

test('splitTopicsToCategories: пустой/null вход даёт DEFAULT_CATEGORY и пустой secondary', () => {
  for (const input of [null, undefined, [], ['unknown-only']]) {
    const { primary, secondary } = splitTopicsToCategories(input as string[] | null | undefined)
    assert.equal(primary, DEFAULT_CATEGORY)
    assert.deepEqual(secondary, [])
  }
})

test('isKnownCategory: распознаёт текущие slug-и и отвергает остальное', () => {
  assert.equal(isKnownCategory('ai-research'), true)
  assert.equal(isKnownCategory('coding'), true)
  assert.equal(isKnownCategory('research'), false)
  assert.equal(isKnownCategory(null), false)
  assert.equal(isKnownCategory(undefined), false)
  assert.equal(isKnownCategory(''), false)
})

test('resolveArticleCategories: CNews foreign story is not classified as Russia', () => {
  const result = resolveArticleCategories({
    topics: ['ai-russia'],
    title: 'Французская разведка отказывается от ИИ Palantir ради сохранения суверенитета',
    snippet: 'Париж инвестирует 655 млн евро в государственный ИИ и заменяет американские сервисы.',
  })

  assert.equal(result.primary, 'ai-industry')
  assert.deepEqual(result.secondary, [])
  assert.deepEqual(result.topics, ['ai-industry'])
})

test('resolveArticleCategories: ai-russia stays only with Russia-market signal', () => {
  const result = resolveArticleCategories({
    topics: ['ai-russia', 'coding'],
    title: 'Сбер представил GigaChat Enterprise для крупного бизнеса',
    snippet: 'Российская компания расширяет линейку корпоративных ИИ-инструментов.',
  })

  assert.equal(result.primary, 'ai-russia')
  assert.deepEqual(result.secondary, ['coding'])
  assert.deepEqual(result.topics, ['ai-russia', 'coding'])
})

test('resolveArticleCategories: Habr AI without local signal falls through to coding', () => {
  const result = resolveArticleCategories({
    topics: ['ai-russia', 'coding'],
    title: 'Как ускорить inference LLM в Python-приложении',
    snippet: 'Практический разбор кэша, батчинга и профилирования запросов.',
  })

  assert.equal(result.primary, 'coding')
  assert.deepEqual(result.secondary, [])
  assert.deepEqual(result.topics, ['coding'])
})

test('resolveArticleCategories: non-local secondary ai-russia is removed, not just demoted', () => {
  const result = resolveArticleCategories({
    topics: ['ai-startups', 'ai-russia', 'ai-industry'],
    title: 'Французский AI-стартап привлек новый раунд инвестиций',
    snippet: 'Компания развивает платформу для аналитики документов в Европе.',
  })

  assert.equal(result.primary, 'ai-startups')
  assert.deepEqual(result.secondary, ['ai-industry'])
  assert.deepEqual(result.topics, ['ai-startups', 'ai-industry'])
})

test('hasRussiaMarketSignal: does not treat Belarus as Russia', () => {
  assert.equal(hasRussiaMarketSignal('В Белоруссии запустили новый ИИ-сервис'), false)
  assert.equal(hasRussiaMarketSignal('В России запустили новый ИИ-сервис'), true)
})

test('hasRussiaMarketSignal: recognizes Russian-market companies and demonyms', () => {
  assert.equal(hasRussiaMarketSignal('ВТБ Мои Инвестиции обновили ИИ-сервис'), true)
  assert.equal(hasRussiaMarketSignal('Каждый четвертый россиянин использует нейросети каждый день'), true)
  assert.equal(hasRussiaMarketSignal('X5 развернула роботов на складе Новая Рига'), true)
})
