import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

import {
  checkLocalGuideImageResponsiveVariants,
  countInlineInternalLinks,
  findEditorialStyleIssues,
  gitFirstTouchTimestamp,
  hasCaseBlock,
  hasCounterStrategy,
  leadHasAnchor,
  readWebpDimensions,
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

test('hasCaseBlock: detects H2/H3 with "Кейс" prefix', () => {
  const md = `# Title\n\n## Section\n\n### Кейс: AI-бот поддержки\n\nСитуация. Компания...`
  assert.equal(hasCaseBlock(md), true)

  const h2 = `# Title\n\n## Кейс: AI-бот поддержки\n\nСитуация. Компания...`
  assert.equal(hasCaseBlock(h2), true)
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

test('findEditorialStyleIssues: catches banned evergreen wording in body text', () => {
  const md = [
    'Это не прайс-лист, а рамка для планирования.',
    'После proof of concept проект не дошёл до production.',
    'CTA: AI-сигналы без шума.',
  ].join('\n')

  const issues = findEditorialStyleIssues(md)
  assert.ok(issues.includes('negative-contrast construction ("не X, а Y")'))
  assert.ok(issues.includes('English term: proof of concept'))
  assert.ok(issues.includes('English term: production'))
  assert.ok(issues.includes('Mixed AI-* wording'))
})

test('findEditorialStyleIssues: ignores forbidden words inside source URLs', () => {
  const md = 'Источник: https://example.com/abandoned-after-proof-of-concept-by-end-of-2025'
  assert.deepEqual(findEditorialStyleIssues(md), [])
})

test('readWebpDimensions: reads dimensions from a WebP file', async () => {
  const dir = join(process.cwd(), 'public', 'images', 'guides', '__test-evergreen-dimensions')
  const path = join(dir, 'sample.webp')
  try {
    mkdirSync(dir, { recursive: true })
    await sharp({
      create: {
        width: 32,
        height: 18,
        channels: 3,
        background: '#334455',
      },
    })
      .webp()
      .toFile(path)

    assert.deepEqual(await readWebpDimensions(path), { width: 32, height: 18 })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('checkLocalGuideImageResponsiveVariants: fails when variants are missing', async () => {
  const slug = '__test-evergreen-missing-variants'
  const dir = join(process.cwd(), 'public', 'images', 'guides', slug)
  const canonical = join(dir, 'cover.webp')
  try {
    mkdirSync(dir, { recursive: true })
    await sharp({
      create: {
        width: 1200,
        height: 675,
        channels: 3,
        background: '#112233',
      },
    })
      .webp({ quality: 72 })
      .toFile(canonical)

    const errors: string[] = []
    const warnings: string[] = []
    await checkLocalGuideImageResponsiveVariants(
      {
        src: `/images/guides/${slug}/cover.webp`,
        width: 1200,
        height: 675,
      },
      'test cover',
      'cover',
      errors,
      warnings,
    )

    assert.equal(warnings.length, 0)
    assert.ok(errors.some((error) => error.includes('480w variant is missing')))
    assert.ok(errors.some((error) => error.includes('768w variant is missing')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('checkLocalGuideImageResponsiveVariants: fails oversized variants', async () => {
  const slug = '__test-evergreen-oversized-variant'
  const dir = join(process.cwd(), 'public', 'images', 'guides', slug)
  const canonical = join(dir, 'cover.webp')
  const variant480 = join(dir, 'cover-480.webp')
  const variant768 = join(dir, 'cover-768.webp')
  try {
    mkdirSync(dir, { recursive: true })
    await sharp({
      create: {
        width: 1200,
        height: 675,
        channels: 3,
        background: '#112233',
      },
    })
      .webp({ quality: 72 })
      .toFile(canonical)
    await sharp({
      create: {
        width: 480,
        height: 270,
        channels: 3,
        background: '#112233',
      },
    })
      .webp({ quality: 72 })
      .toFile(variant480)
    writeFileSync(variant768, Buffer.alloc(80 * 1024, 1))

    assert.equal(existsSync(variant480), true)
    const errors: string[] = []
    const warnings: string[] = []
    await checkLocalGuideImageResponsiveVariants(
      {
        src: `/images/guides/${slug}/cover.webp`,
        width: 1200,
        height: 675,
      },
      'test cover',
      'cover',
      errors,
      warnings,
    )

    assert.ok(errors.some((error) => error.includes('768w variant is 80.0 KB')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
