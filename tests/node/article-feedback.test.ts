import test from 'node:test'
import assert from 'node:assert/strict'

import {
  feedbackRatingLabel,
  isAuthorizedFeedbackUser,
  normalizeTelegramUsername,
  parseFeedbackCallbackData,
  withFeedbackConfirmation,
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
  assert.equal(isAuthorizedFeedbackUser(42, null, { TELEGRAM_OWNER_USER_ID: '42' } as unknown as NodeJS.ProcessEnv), true)
  assert.equal(isAuthorizedFeedbackUser(42, null, { TELEGRAM_ADMIN_CHAT_ID: '42' } as unknown as NodeJS.ProcessEnv), true)
  assert.equal(isAuthorizedFeedbackUser(43, null, { TELEGRAM_OWNER_USER_ID: '42' } as unknown as NodeJS.ProcessEnv), false)
})

test('isAuthorizedFeedbackUser accepts configured owner username', () => {
  const env = { TELEGRAM_OWNER_USERNAME: '@iddopamine' } as unknown as NodeJS.ProcessEnv
  assert.equal(normalizeTelegramUsername('@IdDopamine'), 'iddopamine')
  assert.equal(isAuthorizedFeedbackUser(777, 'iddopamine', env), true)
  assert.equal(isAuthorizedFeedbackUser(777, 'IdDopamine', env), true)
  assert.equal(isAuthorizedFeedbackUser(777, 'other_user', env), false)
})

test('withFeedbackConfirmation replaces previous confirmation', () => {
  const text = withFeedbackConfirmation('Заголовок\n\n✓ оценено: 👎 слабая', 2)

  assert.equal(feedbackRatingLabel(2), '🔥 сильная')
  assert.equal(text, 'Заголовок\n\n✓ оценено: 🔥 сильная')
})
