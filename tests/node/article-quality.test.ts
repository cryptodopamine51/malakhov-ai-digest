import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildOwnerFeedbackBatchMessage,
  buildQualityJudgePrompt,
  inferWriterPath,
  parseQualityJudgeJson,
  type QualityJudgeArticle,
} from '../../pipeline/article-quality'

const article: QualityJudgeArticle = {
  id: '11111111-1111-4111-8111-111111111111',
  original_title: 'OpenAI releases new model',
  original_text: 'OpenAI released a new model on June 10, 2026.',
  source_name: 'OpenAI News',
  source_lang: 'en',
  ru_title: 'OpenAI выпустила новую модель',
  lead: 'OpenAI 10 июня 2026 года выпустила новую модель для разработчиков.',
  summary: ['OpenAI описала релиз и API.'],
  card_teaser: 'Новая модель OpenAI стала доступна разработчикам.',
  tg_teaser: 'OpenAI выпустила новую модель и открыла её в API.',
  editorial_body: 'OpenAI выпустила новую модель.\n\nОна доступна через API.\n\nИсточник описывает ограничения.',
  editorial_model: 'deepseek-v4-flash',
  primary_category: 'ai-labs',
  slug: 'openai-new-model',
  cover_image_url: null,
  published_at: '2026-06-10T12:00:00.000Z',
}

test('parseQualityJudgeJson accepts structured judge result', () => {
  const parsed = parseQualityJudgeJson(JSON.stringify({
    score: 4,
    reasons: {
      source_grounding: 'claims match source',
      lead_anchor: 'lead has OpenAI and date',
      banned_phrases: 'clean',
      usefulness: 'has context',
      overall: 'solid short article',
    },
  }))

  assert.equal(parsed?.score, 4)
  assert.equal(parsed?.reasons.overall, 'solid short article')
  assert.equal(parseQualityJudgeJson('{"score":6,"reasons":{}}'), null)
})

test('buildQualityJudgePrompt contains source and candidate article', () => {
  const prompt = buildQualityJudgePrompt(article)

  assert.match(prompt.user, /Source grounding/)
  assert.match(prompt.user, /Write every reasons\.\* value in Russian/)
  assert.match(prompt.user, /OpenAI releases new model/)
  assert.match(prompt.user, /Candidate article:/)
  assert.match(prompt.user, /Return JSON exactly/)
})

test('inferWriterPath maps editorial model to stable buckets', () => {
  assert.equal(inferWriterPath(article), 'deepseek')
  assert.equal(inferWriterPath({ editorial_model: 'claude-sonnet-4-6' }), 'premium')
  assert.equal(inferWriterPath({ editorial_model: 'claude-haiku-4-5' }), 'haiku-fallback')
  assert.equal(inferWriterPath({ editorial_model: null }), 'unknown')
})

test('buildOwnerFeedbackBatchMessage creates one numbered Telegram message', () => {
  const message = buildOwnerFeedbackBatchMessage([
    { article, source: 'channel_post', reason: null, score: 4 },
  ])

  assert.match(message.text, /Оценка статей/)
  assert.match(message.text, /1\. \[канал, 4\/5\] OpenAI News: OpenAI выпустила новую модель/)
  assert.equal(message.replyMarkup.inline_keyboard.length, 1)
  assert.deepEqual(message.replyMarkup.inline_keyboard[0]?.map((button) => button.callback_data), [
    `af:${article.id}:2`,
    `af:${article.id}:1`,
    `af:${article.id}:0`,
  ])
})

test('buildOwnerFeedbackBatchMessage falls back from dangling truncated titles', () => {
  const message = buildOwnerFeedbackBatchMessage([
    {
      article: {
        ...article,
        source_name: 'Habr AI',
        ru_title: 'Claude пишет 80% кода Anthropic, PyPI заблокировали в России, GitHub захлёбывается от',
        card_teaser: 'Claude пишет 80% кода Anthropic, PyPI пропал в России, GitHub тонет в ИИ-PR — главное за неделю',
      },
      source: 'channel_post',
      reason: 'Хорошая статья',
      score: 4,
    },
  ])

  assert.match(message.text, /GitHub тонет в ИИ-PR/)
  assert.doesNotMatch(message.text, /захлёбывается от\n/)
})
