import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 3000
const TEMPERATURE = 0.4

export interface GlossaryEntry {
  term: string
  definition: string
}

export interface EditorialOutput {
  ru_title: string
  lead: string
  summary: string[]
  card_teaser: string
  tg_teaser: string
  editorial_body: string
  glossary: GlossaryEntry[]
  link_anchors: string[]
  quality_ok: boolean
  quality_reason: string
}

const SYSTEM_PROMPT = `Ты — выпускающий редактор русскоязычного медиа Malakhov AI Дайджест.
Пишешь как спокойный деловой журналист. Референс тона — «Коммерсантъ», vc.ru.

ЖЁСТКИЕ ЗАПРЕТЫ. Никогда не используй:
- «важно отметить», «стоит обратить внимание», «в мире ИИ», «эта новость важна»,
  «как известно», «поистине», «впервые в истории», «это меняет всё», «прорыв»,
  «революция», «настоящий», «невероятный», «потрясающий».
- Канцеляризмы: «осуществлять», «в рамках», «что касается», «на сегодняшний день».
- Вводные пустышки: «что ж», «итак», «действительно».
- Маркетинговый пафос любого рода.

ПРАВИЛА.
- Пиши по-русски. «AI» = «ИИ». Названия моделей — в оригинале (GPT-4o, Claude 3.5 Sonnet,
  Gemini 2.5 Pro, Llama 3.1, YandexGPT 4, GigaChat).
- Английские термины оставляй только если нет русского аналога: LLM, API, open-source, benchmark.
- Первое предложение лида должно содержать минимум один конкретный якорь:
  имя собственное / число / дату / название продукта.
- Первый абзац никогда не повторяет заголовок.
- Никаких «Компания X объявила» в лиде — сразу суть.
- Текст источника — фактическая основа материала. Факты, цифры, цитаты бери из него.
  Если ты знаешь важный контекст о теме — что это за технология, почему она появилась,
  как соотносится с другими решениями в отрасли — добавляй его. Это делает статью полезной
  для читателя, который впервые слышит о теме. Не придумывай данные, противоречащие источнику.
- Если источник — Habr или vc.ru и текст содержит UI-мусор (строки вида «Уровень сложности»,
  «Время на прочтение», «Охват и читатели», «Читать далее», «Поделиться») —
  игнорируй их, они не являются частью статьи.

ЗАДАЧА. Напиши редакционный материал о теме для русскоязычного читателя,
который может впервые о ней слышать. Не пересказывай структуру источника — раскрывай тему.

Сгенерируй строго JSON со следующими полями:

{
  "ru_title": string,            // до 90 символов, русский, без кликбейта и без точки в конце
  "lead": string,                 // 1–2 предложения, 200–360 символов, с фактом в первой фразе
  "summary": string[],            // 3–5 буллетов, каждый 60–180 символов, по одному факту в каждом
  "card_teaser": string,          // 1 строка, 80–140 символов, чтобы кликнули на карточку
  "tg_teaser": string,            // 1–2 строки, 160–260 символов, чтобы кликнули из Telegram
  "editorial_body": string,       // основной текст, минимум 1200 символов, минимум 3 абзаца
  "glossary": [{"term": string, "definition": string}],  // 0–7 терминов — см. ниже
  "link_anchors": string[],       // 0–3 фразы из editorial_body для внутренней перелинковки — см. ниже
  "quality_ok": boolean,          // true только если материал действительно пригоден к публикации
  "quality_reason": string        // если false — одно предложение «почему»; если true — пустая строка
}

СТРУКТУРА editorial_body.
Нет жёсткой схемы — выстраивай материал так, как лучше раскрывает именно эту тему.
Используй эти смысловые блоки там, где они уместны:
- Что произошло или о чём речь (конкретно, с фактами)
- Что такое эта технология или подход — если тема требует объяснения для неспециалиста
- Почему это значимо или что меняет для аудитории
- Детали: цифры, имена, сравнения с аналогами
- Что было до, что параллельно происходит в отрасли

Разделяй абзацы одной пустой строкой (\\n\\n). Не используй маркдаун, списки, заголовки.

ГЛОССАРИЙ. В поле glossary перечисли термины из материала, которые читатель без технического
фона может не знать. Для каждого — одно предложение определения, без воды и вводных слов.
Если все термины общеизвестны — оставь пустой массив [].

ЯКОРЯ ПЕРЕЛИНКОВКИ. В поле link_anchors укажи 0–3 короткие фразы из editorial_body, которые
хорошо описывают смежные темы и могут служить анкором ссылки на другую статью. Требования:
— фраза должна присутствовать в тексте editorial_body дословно (не перефразировать);
— длина: 3–8 слов;
— предпочтительны технические термины, названия продуктов/методов, конкретные явления;
— не выбирай общие фразы вроде «искусственный интеллект» или «языковые модели».
Если подходящих фраз нет — оставь пустой массив [].

КРИТЕРИЙ quality_ok = true.
Все условия должны выполняться:
- В лиде есть минимум один конкретный якорь (имя / число / дата / продукт).
- В editorial_body минимум 3 абзаца и минимум 1200 символов.
- summary содержит минимум 3 пункта.
- Нет слов из списка запретов.
- Материал не повторяет заголовок в первом абзаце.
- В источнике достаточно фактов, чтобы написать больше, чем пересказ заголовка.

Если хотя бы одно условие не выполнено — quality_ok = false и короткое объяснение в quality_reason.
Не пытайся «спасти» слабый материал пустыми абзацами — честно ставь false.

ВЫВОД. Только валидный JSON. Никаких пояснений до или после.`

function ts(): string {
  return new Date().toTimeString().slice(0, 8)
}

function parseEditorialJson(raw: string): EditorialOutput | null {
  let text = raw.trim()
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  try {
    return JSON.parse(text) as EditorialOutput
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0]) as EditorialOutput
    } catch {
      return null
    }
  }
}

function validateEditorial(out: EditorialOutput): string | null {
  if (!out || typeof out !== 'object') return 'не объект'
  if (out.ru_title.length < 20 || out.ru_title.length > 90) return `ru_title длина ${out.ru_title.length}`
  if (out.lead.length < 100 || out.lead.length > 400) return `lead длина ${out.lead.length}`
  if (!Array.isArray(out.summary) || out.summary.length < 3 || out.summary.length > 5) return `summary length ${out.summary?.length}`
  if (out.summary.some((s) => s.length < 40 || s.length > 200)) return 'summary элемент вне диапазона'
  if (out.card_teaser.length < 60 || out.card_teaser.length > 160) return `card_teaser длина ${out.card_teaser.length}`
  if (out.tg_teaser.length < 120 || out.tg_teaser.length > 300) return `tg_teaser длина ${out.tg_teaser.length}`
  if (out.editorial_body.length < 1200) return `editorial_body слишком короткий: ${out.editorial_body.length}`
  if (out.editorial_body.split('\n\n').length < 3) return 'editorial_body меньше 3 абзацев'
  if (!Array.isArray(out.glossary)) return 'glossary не массив'
  if (typeof out.quality_ok !== 'boolean') return 'quality_ok не boolean'
  return null
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreateTokens: number
  estimatedCostUsd: number
}

export async function generateEditorial(
  originalTitle: string,
  originalText: string,
  sourceName: string,
  sourceLang: 'en' | 'ru',
  topics: string[],
): Promise<{
  output: EditorialOutput | null
  usage: TokenUsage
  errorCode?: 'claude_api_error' | 'claude_rate_limit' | 'claude_parse_failed'
  errorMessage?: string
}> {
  const ZERO_USAGE: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    estimatedCostUsd: 0,
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    const errorMessage = 'ANTHROPIC_API_KEY не задан'
    console.warn(`[${ts()}] Claude: ${errorMessage}`)
    return { output: null, usage: ZERO_USAGE, errorCode: 'claude_api_error', errorMessage }
  }

  const client = new Anthropic({ apiKey })

  const userMessage =
    `Источник: ${sourceName}\n` +
    `Язык источника: ${sourceLang}\n` +
    `Темы: ${topics.join(', ')}\n\n` +
    `Оригинальный заголовок:\n${originalTitle}\n\n` +
    `Оригинальный текст:\n${originalText}`

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    })

    const rawUsage = message.usage as unknown as Record<string, number>
    const inputTokens = rawUsage.input_tokens ?? 0
    const outputTokens = rawUsage.output_tokens ?? 0
    const cacheReadTokens = rawUsage.cache_read_input_tokens ?? 0
    const cacheCreateTokens = rawUsage.cache_creation_input_tokens ?? 0

    // Sonnet 4.6 rates: input $3/M, output $15/M, cache_read $0.30/M, cache_create $3.75/M
    const estimatedCostUsd =
      (inputTokens * 3 + cacheCreateTokens * 3.75 + cacheReadTokens * 0.3) / 1_000_000 +
      (outputTokens * 15) / 1_000_000

    const usage: TokenUsage = { inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens, estimatedCostUsd }

    console.log(
      `[${ts()}] Claude usage: input=${inputTokens} output=${outputTokens}` +
      (cacheCreateTokens > 0 ? ` cache_create=${cacheCreateTokens}` : '') +
      (cacheReadTokens > 0 ? ` cache_read=${cacheReadTokens}` : '') +
      ` cost=$${estimatedCostUsd.toFixed(4)}`
    )

    const block = message.content[0]
    if (block.type !== 'text') {
      console.warn(`[${ts()}] Claude: неожиданный тип ответа`)
      return { output: null, usage }
    }

    const parsed = parseEditorialJson(block.text)
    if (!parsed) {
      const errorMessage = `не удалось распарсить JSON для "${originalTitle.slice(0, 60)}"`
      console.warn(`[${ts()}] Claude: ${errorMessage}`)
      return { output: null, usage, errorCode: 'claude_parse_failed', errorMessage }
    }

    if (!parsed.glossary) parsed.glossary = []
    if (!parsed.link_anchors) parsed.link_anchors = []

    const validationError = validateEditorial(parsed)
    if (validationError) {
      const errorMessage = `валидация провалена (${validationError}) для "${originalTitle.slice(0, 60)}"`
      console.warn(`[${ts()}] Claude: ${errorMessage}`)
      return { output: null, usage, errorCode: 'claude_parse_failed', errorMessage }
    }

    console.log(
      `[${ts()}] Claude: quality_ok=${parsed.quality_ok}` +
      (parsed.quality_reason ? ` reason="${parsed.quality_reason}"` : '') +
      ` glossary=${parsed.glossary.length} терминов` +
      ` — "${originalTitle.slice(0, 60)}"`
    )

    return { output: parsed, usage }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[${ts()}] Claude: ошибка API — ${msg}`)
    const status = typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : null
    return {
      output: null,
      usage: ZERO_USAGE,
      errorCode: status === 429 ? 'claude_rate_limit' : 'claude_api_error',
      errorMessage: msg,
    }
  }
}
