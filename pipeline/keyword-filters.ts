// Keyword filters for broad RSS feeds. Keep these lists intentionally strict:
// broad feeds are useful only while they do not flood ingest with generic tech/news items.

export const RU_AI_KEYWORDS: string[] = [
  'искусственный интеллект',
  'нейросеть',
  'нейросети',
  'машинное обучение',
  'языковая модель',
  'генеративный',
  'chatgpt',
  'gpt',
  'llm',
  'ии',
  'яндекс gpt',
  'gigachat',
  'сбер ai',
  'claude',
  'gemini',
  'mistral',
  'нейронная сеть',
  'компьютерное зрение',
]

export const RU_AI_CORE_KEYWORDS: string[] = [
  'искусственный интеллект',
  'нейросеть',
  'нейросети',
  'машинное обучение',
  'языковая модель',
  'генеративн',
  'компьютерное зрение',
  'chatgpt',
  'gpt',
  'llm',
  'ии',
  'openai',
  'anthropic',
  'mistral',
  'claude',
  'gemini',
  'gigachat',
]

export const RU_STARTUP_DEAL_KEYWORDS: string[] = [
  'стартап',
  'раунд',
  'инвестиции',
  'привлек',
  'посевной',
  'seed',
  'series a',
  'series b',
  'оценк',
  'венчур',
]

export const RU_AI_STARTUP_KEYWORDS: string[] = [
  ...RU_AI_CORE_KEYWORDS,
  ...RU_STARTUP_DEAL_KEYWORDS,
]

export const EN_AI_CORE_KEYWORDS: string[] = [
  'artificial intelligence',
  'generative ai',
  'machine learning',
  'language model',
  'foundation model',
  'llm',
  'openai',
  'anthropic',
  'deepmind',
  'mistral',
  'cohere',
  'claude',
  'gemini',
]

export const EN_STARTUP_DEAL_KEYWORDS: string[] = [
  'startup',
  'funding',
  'raises',
  'valuation',
  'seed',
  'seed round',
  'series a',
  'series b',
  'series c',
]

export const EN_AI_STARTUP_KEYWORDS: string[] = [
  'cursor',
  'perplexity',
  ...EN_AI_CORE_KEYWORDS,
  ...EN_STARTUP_DEAL_KEYWORDS,
]
