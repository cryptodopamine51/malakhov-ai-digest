// Конфигурация RSS-фидов для парсинга AI-новостей

export interface FeedConfig {
  name: string
  url: string
  lang: 'en' | 'ru'
  topics: string[]
  // Для источников без жёсткой AI-тематики (РБК, vc.ru, CNews) —
  // нужна дополнительная фильтрация по ключевым словам
  needsKeywordFilter?: boolean
  // Переопределить список ключевых слов для этого фида (вместо глобального RU_AI_KEYWORDS)
  keywords?: string[]
}

export const FEEDS: FeedConfig[] = [
  // ── Международные источники (en) ───────────────────────────────────────────

  {
    name: 'VentureBeat AI',
    url: 'https://venturebeat.com/category/ai/feed/',
    lang: 'en',
    topics: ['ai-industry'],
  },
  {
    name: 'The Verge AI',
    url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
    lang: 'en',
    topics: ['ai-industry'],
  },
  {
    name: 'The Decoder',
    url: 'https://the-decoder.com/feed/',
    lang: 'en',
    topics: ['ai-research', 'ai-industry'],
  },
  {
    name: 'TechCrunch AI',
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    lang: 'en',
    topics: ['ai-industry'],
  },
  {
    name: 'ZDNet AI',
    url: 'https://www.zdnet.com/topic/artificial-intelligence/rss.xml',
    lang: 'en',
    topics: ['ai-industry'],
  },
  {
    name: 'Wired AI',
    url: 'https://www.wired.com/feed/category/artificial-intelligence/rss',
    lang: 'en',
    topics: ['ai-industry'],
  },
  {
    name: 'Ars Technica',
    url: 'https://feeds.arstechnica.com/arstechnica/index',
    lang: 'en',
    topics: ['ai-research'],
  },
  {
    name: 'MIT Technology Review AI',
    url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed',
    lang: 'en',
    topics: ['ai-research'],
  },
  {
    name: 'OpenAI News',
    url: 'https://openai.com/news/rss.xml',
    lang: 'en',
    topics: ['ai-labs'],
  },
  {
    name: 'Google Research Blog',
    url: 'https://research.google/blog/rss',
    lang: 'en',
    topics: ['ai-labs'],
  },
  {
    name: 'Hugging Face Blog',
    url: 'https://huggingface.co/blog/feed.xml',
    lang: 'en',
    topics: ['ai-research', 'coding'],
  },
  {
    name: '404 Media',
    url: 'https://www.404media.co/rss',
    lang: 'en',
    topics: ['ai-industry'],
  },

  // ── Инвестиции (en) ────────────────────────────────────────────────────────

  {
    name: 'TechCrunch Venture',
    url: 'https://techcrunch.com/category/venture/feed/',
    lang: 'en',
    topics: ['ai-investments'],
    needsKeywordFilter: true,
    keywords: [
      'openai', 'anthropic', 'deepmind', 'mistral', 'cohere', 'stability ai',
      'artificial intelligence', ' ai ', 'machine learning', 'llm', 'generative',
      'series a', 'series b', 'series c', 'seed round',
    ],
  },
  {
    name: 'Axios Pro Rata',
    url: 'https://www.axios.com/feeds/feed/pro-rata',
    lang: 'en',
    topics: ['ai-investments'],
    needsKeywordFilter: true,
    keywords: [
      'openai', 'anthropic', 'deepmind', 'mistral', 'artificial intelligence',
      ' ai ', 'machine learning', 'llm', 'generative', 'raises', 'funding round',
    ],
  },

  // ── Стартапы (en) ─────────────────────────────────────────────────────────

  {
    name: 'YC Blog',
    url: 'https://www.ycombinator.com/blog/rss.xml',
    lang: 'en',
    topics: ['ai-startups'],
  },
  {
    name: 'a16z Blog',
    url: 'https://a16z.com/feed/',
    lang: 'en',
    topics: ['ai-startups'],
    needsKeywordFilter: true,
    keywords: [
      'artificial intelligence', ' ai ', 'machine learning', 'llm', 'generative',
      'language model', 'foundation model', 'openai', 'anthropic',
    ],
  },

  // ── Российские источники (ru) ───────────────────────────────────────────────

  {
    name: 'Habr AI',
    url: 'https://habr.com/ru/rss/hubs/artificial_intelligence/articles/',
    lang: 'ru',
    topics: ['ai-russia', 'coding'],
    // Habr AI hub — все статьи по теме, фильтр не нужен
  },
  // РБК — RSS недоступен (404/401), временно отключён
  // {
  //   name: 'РБК',
  //   url: 'https://rbc.ru/arc/outboundfeeds/rss/technology/?outputType=xml',
  //   lang: 'ru',
  //   topics: ['ai-russia'],
  //   needsKeywordFilter: true,
  // },
  {
    name: 'CNews',
    url: 'https://www.cnews.ru/inc/rss/news.xml',
    lang: 'ru',
    topics: ['ai-russia'],
    needsKeywordFilter: true,
  },
  {
    name: 'vc.ru',
    url: 'https://vc.ru/rss/all',
    lang: 'ru',
    topics: ['ai-russia'],
    needsKeywordFilter: true,
  },
  {
    name: 'vc.ru Финансы',
    url: 'https://vc.ru/finance/rss',
    lang: 'ru',
    topics: ['ai-investments'],
    needsKeywordFilter: true,
    keywords: [
      'искусственный интеллект', 'нейросеть', 'нейросети', 'машинное обучение',
      'языковая модель', 'генеративн', 'ии ', ' ии', 'gpt', 'llm',
      'openai', 'anthropic', 'яндекс', 'сбер', 'раунд', 'инвестиции',
    ],
  },
  {
    name: 'vc.ru Стартапы',
    url: 'https://vc.ru/startups/rss',
    lang: 'ru',
    topics: ['ai-startups'],
    needsKeywordFilter: true,
    keywords: [
      'искусственный интеллект', 'нейросеть', 'нейросети', 'машинное обучение',
      'языковая модель', 'генеративн', 'ии ', ' ии', 'gpt', 'llm',
      'openai', 'anthropic', 'яндекс', 'сбер', 'стартап', 'запустили',
      'mvp', 'traction', 'основали',
    ],
  },
]
