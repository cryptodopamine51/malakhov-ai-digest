/**
 * pipeline/claude.ts
 *
 * Генерация однострочного объяснения "Почему это важно" для топовых статей.
 * Используется только для статей с высоким score — экономим токены.
 */

import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 150
const CONTEXT_LENGTH = 500 // символов текста, передаваемых в промпт

// ── Основная функция ──────────────────────────────────────────────────────────

/**
 * Генерирует одно предложение (до 25 слов) объясняющее важность новости
 * для следящих за AI-индустрией.
 *
 * - Если ANTHROPIC_API_KEY не задан — возвращает пустую строку.
 * - При ошибке API — возвращает пустую строку (не критично для публикации).
 */
export async function generateWhyItMatters(
  title: string,
  text: string
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn(`[${ts()}] Claude: ANTHROPIC_API_KEY не задан — why_it_matters пропущен`)
    return ''
  }

  const client = new Anthropic({ apiKey })
  const context = text.slice(0, CONTEXT_LENGTH)

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system:
        'Ты редактор русскоязычного AI-медиа. Отвечай только на русском языке.',
      messages: [
        {
          role: 'user',
          content:
            `Напиши ОДНО предложение (максимум 25 слов) объясняющее ПОЧЕМУ эта новость важна ` +
            `для людей следящих за AI-индустрией. Без вводных слов, сразу суть.\n\n` +
            `Заголовок: ${title}\n` +
            `Текст: ${context}`,
        },
      ],
    })

    const result = message.content[0]
    if (result.type !== 'text') return ''

    const why = result.text.trim()
    console.log(`[${ts()}] Claude: why_it_matters сгенерирован (${why.length} символов)`)
    return why
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.log(`[${ts()}] Claude: ошибка — ${message}`)
    return ''
  }
}

// ── Утилита ───────────────────────────────────────────────────────────────────

function ts(): string {
  return new Date().toTimeString().slice(0, 8)
}
