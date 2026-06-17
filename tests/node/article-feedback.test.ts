import test from 'node:test'
import assert from 'node:assert/strict'

import {
  feedbackRatingLabel,
  isAuthorizedFeedbackUser,
  normalizeTelegramUsername,
  parseFeedbackCallbackData,
  withFeedbackConfirmation,
  withFeedbackConfirmationForArticle,
} from '../../lib/article-feedback'

test('parseFeedbackCallbackData accepts compact Telegram callback payload', () => {
  assert.deepEqual(parseFeedbackCallbackData('af:11111111-1111-4111-8111-111111111111:2'), {
    articleId: '11111111-1111-4111-8111-111111111111',
    rating: 2,
  })
  assert.equal(parseFeedbackCallbackData('af:not-uuid:2'), null)
  assert.equal(parseFeedbackCallbackData('other'), null)
})

test('isAuthorizedFeedbackUser falls back to TELEGRAM_ADMIN_CHAT_ID', () => {
  assert.equal(isAuthorizedFeedbackUser(42, null, null, { TELEGRAM_OWNER_USER_ID: '42' } as unknown as NodeJS.ProcessEnv), true)
  assert.equal(isAuthorizedFeedbackUser(43, null, 42, { TELEGRAM_ADMIN_CHAT_ID: '42' } as unknown as NodeJS.ProcessEnv), true)
  assert.equal(isAuthorizedFeedbackUser(43, null, null, { TELEGRAM_ADMIN_CHAT_ID: '42' } as unknown as NodeJS.ProcessEnv), false)
  assert.equal(isAuthorizedFeedbackUser(43, null, null, { TELEGRAM_OWNER_USER_ID: '42' } as unknown as NodeJS.ProcessEnv), false)
})

test('isAuthorizedFeedbackUser accepts configured owner username', () => {
  const env = { TELEGRAM_OWNER_USERNAME: '@iddopamine' } as unknown as NodeJS.ProcessEnv
  assert.equal(normalizeTelegramUsername('@IdDopamine'), 'iddopamine')
  assert.equal(isAuthorizedFeedbackUser(777, 'iddopamine', null, env), true)
  assert.equal(isAuthorizedFeedbackUser(777, 'IdDopamine', null, env), true)
  assert.equal(isAuthorizedFeedbackUser(777, 'other_user', null, env), false)
})

test('withFeedbackConfirmation replaces previous confirmation', () => {
  const text = withFeedbackConfirmation('Заголовок\n\n✓ оценено: 👎 слабая', 2)

  assert.equal(feedbackRatingLabel(2), '🔥 сильная')
  assert.equal(text, 'Заголовок\n\n✓ оценено: 🔥 сильная')
})

test('withFeedbackConfirmationForArticle marks the matching batch row', () => {
  const firstId = '11111111-1111-4111-8111-111111111111'
  const secondId = '22222222-2222-4222-8222-222222222222'
  const replyMarkup = {
    inline_keyboard: [
      [{ text: '1 🔥', callback_data: `af:${firstId}:2` }],
      [{ text: '2 👌', callback_data: `af:${secondId}:1` }],
    ],
  }

  const text = withFeedbackConfirmationForArticle([
    'Оценка статей',
    '',
    '1. Первая статья',
    '2. Вторая статья — ✓ 👎 слабая',
  ].join('\n'), secondId, 2, replyMarkup)

  assert.equal(text, [
    'Оценка статей',
    '',
    '1. Первая статья',
    '2. Вторая статья — ✓ 🔥 сильная',
  ].join('\n'))
})
