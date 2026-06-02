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
  'ии-',
  'ии-агент',
  'ии-ассистент',
  'openai',
  'anthropic',
  'mistral',
  'claude',
  'gemini',
  'gigachat',
  'нейронк',
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

// Off-topic blocklist applied to all feeds BEFORE per-feed keyword filtering.
// Goal: prevent gadget/consumer-tech filler (Android Auto, AirPods, dishwashers, etc.)
// from broad tech feeds (ZDNet AI, Wired AI, CNet) reaching enrichment.
// Extend list as new off-topic clusters are observed in `article_attempts` /
// `source_runs.items_rejected_breakdown.off_topic_filter` examples.
//
// Match policy: case-insensitive substring in the same normalised text used for
// `needsKeywordFilter` (title + optional snippet). Single token is enough to
// reject the item — there is no co-occurrence requirement.
export const OFF_TOPIC_KEYWORDS: string[] = [
  // Automotive / in-car gadgets
  'android auto',
  'apple carplay',
  'car infotainment',
  // Wearables / personal audio
  'airpods',
  'smartwatch',
  'fitness tracker',
  'headphones review',
  'earbuds review',
  // Home appliances
  'dishwasher',
  'vacuum cleaner',
  'robot vacuum',
  'air fryer',
  'coffee maker',
  // Consumer-grade hardware reviews
  'tv review',
  'gaming chair',
  'gaming mouse',
  'gaming keyboard',
  'streaming stick',
  // Misc lifestyle
  'streaming deals',
  'black friday deal',
  'cyber monday deal',
  'amazon prime day',
  // VPN products (keep tokens specific — bare "vpn" would reject legitimate
  // "доступ к Gemini через VPN" AI-access explainers).
  'nordvpn',
  'nordwhisper',
  'meshnet',
  // Serial / legacy AV connectors (TV RS-232 control questions).
  'rs-232',
  'rs 232',
  'rs232',
  // Fitness wearables (Whoop / Fitbit bands, not AI).
  'whoop',
  'fitbit',
  'фитнес-браслет',
  'фитнес-трекер',
  // Consumer headphones (Sony WH-1000XM, Bose QuietComfort comparisons).
  'wh-1000xm',
  'quietcomfort',
  'quiet comfort',
  // Network attached storage buyer guides (keep tokens specific — bare "nas"
  // is a substring of unrelated words; Cyrillic "нас" is a separate codepoint set).
  'network attached storage',
  'nas для дома',
  'nas устройств',
  'nas-накопител',
  // Generic file-manager app reviews (Android "Material Files", etc.).
  'material files',
  'file manager',
]
