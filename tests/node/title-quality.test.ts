import test from 'node:test'
import assert from 'node:assert/strict'

import {
  finalTitleToken,
  findDanglingTitleEnding,
  hasDanglingTitleEnding,
  validateArticleTitle,
} from '../../pipeline/title-quality'
import { validateEditorialDetailed, type EditorialOutput } from '../../pipeline/claude'

function editorial(overrides: Partial<EditorialOutput> = {}): EditorialOutput {
  return {
    ru_title: 'Anthropic обогнала OpenAI в корпоративных расходах на ИИ',
    lead: 'Anthropic в мае 2026 года заняла 41% корпоративных расходов на ИИ и обогнала OpenAI, которая получила 39,5%.',
    summary: [
      'Anthropic вышла на первое место по доле корпоративных расходов на ИИ в мае 2026 года.',
      'OpenAI сохранила близкую долю, но уступила конкуренту в корпоративном сегменте.',
      'Сдвиг произошёл на фоне конфликта Anthropic с американскими властями.',
    ],
    card_teaser: 'Anthropic обогнала OpenAI по доле корпоративных расходов на ИИ в мае',
    tg_teaser: 'Anthropic в мае обогнала OpenAI по корпоративным расходам на ИИ, несмотря на конфликт с властями США и рост конкуренции за крупных клиентов.',
    editorial_body: [
      'Anthropic в мае 2026 года заняла 41% корпоративных расходов на ИИ и обогнала OpenAI, которая получила 39,5%. Это делает компанию лидером в сегменте корпоративных закупок моделей. Для клиентов такой сдвиг означает, что выбор поставщика всё чаще определяется не только известностью бренда, но и стабильностью, условиями доступа, качеством корпоративной поддержки и готовностью модели работать внутри существующих процессов.',
      'Контекст важен из-за конфликта с американскими властями. По источнику, спор вокруг доступа к моделям не остановил рост корпоративного спроса на продукты Anthropic. Компании продолжают тестировать несколько платформ одновременно, потому что бюджеты на генеративный ИИ стали операционной статьёй расходов, а не экспериментальной строкой в инновационном подразделении.',
      'Для рынка это сигнал, что крупные клиенты всё чаще распределяют бюджеты между несколькими поставщиками. OpenAI остаётся рядом, но преимущество Anthropic показывает, что корпоративный рынок не закреплён за одним игроком. Если тенденция сохранится, конкуренция сместится от разовых запусков моделей к качеству внедрения, предсказуемости цен и способности поставщиков закрывать требования безопасности для больших организаций.',
    ].join('\n\n'),
    glossary: [],
    link_anchors: ['корпоративных расходов на ИИ', 'конфликта с американскими властями'],
    article_tables: [],
    quality_ok: true,
    quality_reason: '',
    ...overrides,
  }
}

test('title quality detects dangling Russian service words', () => {
  assert.equal(findDanglingTitleEnding('Доля Anthropic обогнала OpenAI на фоне конфликта с'), 'с')
  assert.equal(findDanglingTitleEnding('ИИ-инструмент для'), 'для')
  assert.equal(findDanglingTitleEnding('операции с использованием ИИ для мошенничества и…'), 'и')
  assert.equal(hasDanglingTitleEnding('Google DeepMind запускает акселератор для'), true)
})

test('title quality ignores uppercase acronyms and valid complete titles', () => {
  assert.equal(findDanglingTitleEnding('Атаки через публичные чаты ChatGPT распространяют вредоносное ПО'), null)
  assert.equal(findDanglingTitleEnding('OpenAI обновила API'), null)
  assert.equal(findDanglingTitleEnding('Anthropic обогнала OpenAI в расходах на ИИ'), null)
  assert.equal(finalTitleToken('Заголовок с точкой.'), 'точкой')
})

test('validateArticleTitle rejects invalid replacements', () => {
  assert.deepEqual(validateArticleTitle('Коротко'), { ok: false, error: 'ru_title длина 7' })
  assert.deepEqual(
    validateArticleTitle('Доля Anthropic обогнала OpenAI на фоне конфликта с'),
    { ok: false, error: 'ru_title оборван на служебном слове: "с"' },
  )
  assert.deepEqual(
    validateArticleTitle('Модель Mythos от Anthropic в наступательных киберопераций АНБ'),
    { ok: false, error: 'ru_title грамматически некорректен: "в ... киберопераций"' },
  )
  assert.equal(validateArticleTitle('Anthropic обогнала OpenAI в корпоративных расходах на ИИ').ok, true)
})

test('validateEditorialDetailed rejects dangling ru_title endings', () => {
  const detailed = validateEditorialDetailed(editorial({
    ru_title: 'Доля Anthropic в корпоративных расходах на ИИ обогнала OpenAI на фоне конфликта с',
  }))

  assert.equal(detailed.ok, false)
  assert.ok(detailed.errors.includes('ru_title оборван на служебном слове: "с"'))
})

test('validateEditorialDetailed does not reject uppercase acronym ending', () => {
  const detailed = validateEditorialDetailed(editorial({
    ru_title: 'Атаки через публичные чаты ChatGPT распространяют вредоносное ПО',
  }))

  assert.equal(detailed.ok, true)
})
