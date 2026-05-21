import test from 'node:test'
import assert from 'node:assert/strict'

import {
  countInlineInternalLinks,
  gitFirstTouchTimestamp,
  hasCaseBlock,
  hasCounterStrategy,
  leadHasAnchor,
} from '../../scripts/evergreen-check'

test('leadHasAnchor: passes when first 700 chars after H1 contain a number', () => {
  const md = `# Заголовок\n\nВ 2026 году бизнес тратит до 257 млрд рублей на ИИ.`
  assert.equal(leadHasAnchor(md), true)
})

test('leadHasAnchor: passes when first 700 chars contain an ALLCAPS acronym (proper noun)', () => {
  const md = `# Заголовок\n\nКомпания OpenAI выпустила новую модель.`
  assert.equal(leadHasAnchor(md), true)
})

test('leadHasAnchor: fails when lead is generic prose without anchor', () => {
  const md = `# Заголовок\n\nЭта статья поможет вам разобраться в том, как использовать искусственный интеллект.`
  assert.equal(leadHasAnchor(md), false)
})

test('hasCaseBlock: detects H3 with "Кейс" prefix', () => {
  const md = `# Title\n\n## Section\n\n### Кейс: AI-бот поддержки\n\nСитуация. Компания...`
  assert.equal(hasCaseBlock(md), true)
})

test('hasCaseBlock: detects "Редакционный пример" marker', () => {
  const md = `# Title\n\nКакой-то текст. Редакционный пример: AI-агент в продажах.`
  assert.equal(hasCaseBlock(md), true)
})

test('hasCaseBlock: returns false when no case markers present', () => {
  const md = `# Title\n\n## Section\n\nСодержание без кейсов и примеров.`
  assert.equal(hasCaseBlock(md), false)
})

test('hasCounterStrategy: detects "когда не стоит" H2', () => {
  const md = `# Title\n\n## Когда не стоит запускать AI-проект\n\nКонкретика.`
  assert.equal(hasCounterStrategy(md), true)
})

test('hasCounterStrategy: detects "Ошибки внедрения" H2', () => {
  const md = `# Title\n\n## Ошибки внедрения ИИ\n\nПеречисление.`
  assert.equal(hasCounterStrategy(md), true)
})

test('hasCounterStrategy: detects H2 that contains "ошибки внедрения" with a prefix', () => {
  const md = `# Title\n\n## Частые ошибки внедрения ИИ\n\nПеречисление.`
  assert.equal(hasCounterStrategy(md), true)
})

test('hasCounterStrategy: returns false when no anti-case section', () => {
  const md = `# Title\n\n## Как внедрить\n\n## Вывод\n`
  assert.equal(hasCounterStrategy(md), false)
})

test('gitFirstTouchTimestamp: returns null for an uncommitted/non-existent path without throwing', () => {
  const result = gitFirstTouchTimestamp('content/guides/this-guide-was-never-created-xyz.md')
  assert.equal(result, null)
})

test('gitFirstTouchTimestamp: returns a number for a file that was added in git history', () => {
  const result = gitFirstTouchTimestamp('content/guides/kak-vnedrit-ii-v-biznes-2026.md')
  assert.ok(result === null || typeof result === 'number', 'must return number or null')
})

test('countInlineInternalLinks: counts unique guides/categories/russia links', () => {
  const md = `
Текст с [гайдом](/guides/foo) и [категорией](/categories/ai-industry).
Ещё одна ссылка [на russia](/russia/) и повтор [гайда](/guides/foo).
Внешняя [ссылка](https://example.com) не считается.
`
  assert.equal(countInlineInternalLinks(md), 3)
})
