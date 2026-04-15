/**
 * pipeline/deepl.ts
 *
 * Перевод текста на русский язык через DeepL API (Free).
 * При ошибке или отсутствии ключа — возвращает оригинал без выброса исключения.
 */

const DEEPL_API_URL = 'https://api-free.deepl.com/v2/translate'
const TRANSLATE_TIMEOUT_MS = 20_000

// ── Утилита ───────────────────────────────────────────────────────────────────

function ts(): string {
  return new Date().toTimeString().slice(0, 8)
}

// ── Типы DeepL-ответа ─────────────────────────────────────────────────────────

interface DeepLResponse {
  translations: Array<{ text: string; detected_source_language: string }>
}

// ── Базовая функция перевода ──────────────────────────────────────────────────

/**
 * Переводит произвольный текст на русский через DeepL.
 *
 * - Если sourceLang === 'ru' — возвращает текст без изменений.
 * - Если DEEPL_API_KEY не задан — возвращает оригинал с предупреждением.
 * - При сетевой ошибке или плохом ответе — возвращает оригинал.
 */
export async function translateToRussian(
  text: string,
  sourceLang: 'en' | 'ru'
): Promise<string> {
  // Русский текст переводить не нужно
  if (sourceLang === 'ru') return text

  // Пустой текст — нечего переводить
  if (!text.trim()) return text

  const apiKey = process.env.DEEPL_API_KEY
  if (!apiKey) {
    console.warn(`[${ts()}] DeepL: DEEPL_API_KEY не задан — перевод пропущен`)
    return text
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS)

  try {
    const response = await fetch(DEEPL_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: [text],
        target_lang: 'RU',
        source_lang: 'EN',
      }),
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      console.log(`[${ts()}] DeepL: HTTP ${response.status} — ${body.slice(0, 100)}`)
      return text
    }

    const data = (await response.json()) as DeepLResponse
    const translated = data.translations?.[0]?.text

    if (!translated) {
      console.log(`[${ts()}] DeepL: пустой ответ`)
      return text
    }

    return translated
  } catch (error) {
    clearTimeout(timeoutId)
    const message = error instanceof Error ? error.message : String(error)
    console.log(`[${ts()}] DeepL: ошибка — ${message}`)
    return text
  }
}

// ── Удобные обёртки ───────────────────────────────────────────────────────────

/**
 * Переводит заголовок статьи на русский.
 */
export async function translateTitle(
  title: string,
  sourceLang: 'en' | 'ru'
): Promise<string> {
  return translateToRussian(title, sourceLang)
}

/**
 * Переводит основной текст статьи на русский.
 */
export async function translateText(
  text: string,
  sourceLang: 'en' | 'ru'
): Promise<string> {
  return translateToRussian(text, sourceLang)
}
