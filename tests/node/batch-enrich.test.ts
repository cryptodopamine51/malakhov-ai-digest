import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildEditorialMessageParams,
  buildEditorialSystemPrompt,
  buildEditorialUserMessage,
  extractEditorialText,
  MAX_TOKENS,
  parseEditorialJson,
  validateEditorial,
} from '../../pipeline/claude'
import {
  buildBatchCustomId,
  chunkBatchRequests,
  normalizeBatchResult,
  parseBatchCustomId,
} from '../../pipeline/anthropic-batch'

const VALID_EDITORIAL_JSON = JSON.stringify({
  ru_title: 'OpenAI добавила batch-обработку для редакционного контура',
  lead: 'OpenAI 21 апреля представила batch-режим обработки, который позволяет отправлять набор редакционных задач одной пачкой и снижать удельную стоимость на статью.',
  summary: [
    'Новый режим даёт отдельный lifecycle для submit и collect, поэтому pipeline проще восстанавливать после падений.',
    'Batch API полезен там, где latency в пределах часов приемлема ради более низкой стоимости одной генерации.',
    'Ключевой риск при внедрении связан не с промптом, а с идемпотентным apply и корректным retry accounting.',
  ],
  card_teaser: 'Batch-режим снижает стоимость enrich, но требует отдельного контроля за submit, collect и apply.',
  tg_teaser: 'Batch-обработка помогает экономить на enrich, но только если source of truth вынесен в batch tables, а apply сделан идемпотентным.',
  editorial_body: 'OpenAI 21 апреля представила новый batch-режим для редакционных задач, который позволяет отправлять несколько запросов за один submit и позже забирать результаты отдельным collector-процессом. Такой режим особенно полезен для новостного pipeline, где десятки похожих задач появляются пакетно и не требуют ответа за секунды.\n\nДля контентного pipeline это важно не только из-за цены, но и из-за смены operational ownership. Пока sync worker держит lease на статье, риск смешения статусов ниже, но стоимость одной генерации выше. В batch-flow статья быстро отдаётся под ownership batch item, а значит recovery должен смотреть уже не на lease статьи, а на state конкретного item. Это меняет и observability: оператору нужно видеть не просто количество processing-статей, а сколько item уже submitted, сколько дошли до result import и сколько застряли перед final apply.\n\nПрактический эффект зависит от того, насколько аккуратно реализован apply. Если duplicate collect может второй раз записать article_attempts или переопределить slug, экономия на модели быстро теряется на эксплуатационных сбоях. Поэтому batch API стоит внедрять только вместе с идемпотентным apply, отдельным retry accounting, явным cutover-планом и batch-oriented recovery script. Иначе более дешёвый inference быстро оборачивается дорогой эксплуатацией.\n\nОтдельный вопрос — continuity метрик. Если baseline до миграции считался через enrich_runs, после перехода на batch нужно сохранить сопоставимость cost per claimed article, cost per enriched_ok и latency до publish_ready. Без этого команда увидит снижение счёта за модель, но не поймёт, действительно ли система стала эффективнее в терминах опубликованных материалов.',
  glossary: [{ term: 'batch item', definition: 'Отдельный запрос внутри общего batch job, который имеет собственный lifecycle и результат.' }],
  link_anchors: ['идемпотентным apply', 'batch item', 'операционных сбоев'],
  quality_ok: true,
  quality_reason: '',
})

test('editorial message params reuse the same system and user builders', () => {
  const request = {
    originalTitle: 'Original title',
    originalText: 'Original body',
    sourceName: 'Source',
    sourceLang: 'en' as const,
    topics: ['ai', 'media'],
  }

  const params = buildEditorialMessageParams(request)
  assert.equal(Array.isArray(params.system), true)
  assert.equal((params.system as Array<{ text: string }>)[0]?.text, buildEditorialSystemPrompt())
  assert.equal(params.messages[0]?.content, buildEditorialUserMessage(request))
  assert.equal(params.max_tokens, MAX_TOKENS)
  assert.equal(MAX_TOKENS, 4000)
})

test('batch custom id is deterministic and parseable', () => {
  const customId = buildBatchCustomId({
    articleId: 'article-123',
    attemptNo: 2,
    batchItemId: 'item-456',
  })

  assert.equal(customId, 'article:article-123:attempt:2:item:item-456')
  assert.deepEqual(parseBatchCustomId(customId), {
    articleId: 'article-123',
    attemptNo: 2,
    batchItemId: 'item-456',
  })
})

test('chunkBatchRequests respects max request count', () => {
  const chunks = chunkBatchRequests([1, 2, 3, 4, 5], 2)
  assert.deepEqual(chunks, [[1, 2], [3, 4], [5]])
})

test('parseEditorialJson and validateEditorial accept valid output contract', () => {
  const parsed = parseEditorialJson(VALID_EDITORIAL_JSON)
  assert.ok(parsed)
  assert.equal(validateEditorial(parsed!), null)
})

test('normalizeBatchResult extracts text and usage for succeeded item', () => {
  const normalized = normalizeBatchResult({
    custom_id: 'article:article-1:attempt:1:item:item-1',
    result: {
      type: 'succeeded',
      message: {
        usage: {
          input_tokens: 100,
          output_tokens: 200,
          cache_read_input_tokens: 50,
          cache_creation_input_tokens: 25,
        },
        content: [{ type: 'text', text: VALID_EDITORIAL_JSON }],
      },
    },
  } as never)

  assert.equal(normalized.resultType, 'succeeded')
  assert.equal(normalized.outputText, VALID_EDITORIAL_JSON)
  assert.equal(normalized.inputTokens, 100)
  assert.equal(normalized.outputTokens, 200)
  assert.ok(normalized.estimatedCostUsd > 0)
})

test('normalizeBatchResult maps errored item to internal error shape', () => {
  const normalized = normalizeBatchResult({
    custom_id: 'article:article-1:attempt:1:item:item-2',
    result: {
      type: 'errored',
      error: {
        type: 'error',
        request_id: 'req_123',
        error: {
          type: 'rate_limit_error',
          message: 'rate limited',
        },
      },
    },
  } as never)

  assert.equal(normalized.resultType, 'errored')
  assert.equal(normalized.outputText, null)
  assert.equal(normalized.errorCode, 'rate_limit_error')
  assert.equal(normalized.errorMessage, 'rate limited')
})

test('extractEditorialText joins multiple text response blocks', () => {
  const text = extractEditorialText({
    content: [
      { type: 'text', text: '{"ru_title":' },
      { type: 'text', text: '"ok"}' },
    ],
  } as never)

  assert.equal(text, '{"ru_title":\n"ok"}')
})
