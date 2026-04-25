/**
 * lib/category-meta.ts
 *
 * Дисплейные метаданные категорий: лейбл, описание, SEO-заголовки.
 * Используется страницами `/categories/[category]` и хлебными крошками статьи.
 *
 * Source of truth по структуре категорий — таблица `categories` в Supabase
 * (миграция 013). Здесь зеркалируются только редакционные подписи, чтобы
 * избежать лишних запросов при рендере.
 */

import { CATEGORY_SLUGS, type CategorySlug } from './categories'

export interface CategoryMeta {
  slug: CategorySlug
  label: string
  shortLabel: string
  description: string
  seoTitle: string
  seoDescription: string
}

const META: Record<CategorySlug, CategoryMeta> = {
  'ai-industry': {
    slug: 'ai-industry',
    label: 'Индустрия',
    shortLabel: 'Индустрия',
    description:
      'Бизнес-новости об искусственном интеллекте: продукты, партнёрства, рыночные тренды и релизы компаний со всего мира.',
    seoTitle: 'ИИ-Индустрия — бизнес и продукты',
    seoDescription:
      'Свежие новости о бизнесе в области искусственного интеллекта: релизы продуктов, сделки, партнёрства и рыночные тренды.',
  },
  'ai-research': {
    slug: 'ai-research',
    label: 'Исследования',
    shortLabel: 'Исследования',
    description:
      'Академические прорывы, технические разборы и новые работы в области ИИ — от ведущих лабораторий и университетов.',
    seoTitle: 'ИИ-Исследования — наука и технологии',
    seoDescription:
      'Академические статьи, разборы новых архитектур и прорывы в исследованиях искусственного интеллекта.',
  },
  'ai-labs': {
    slug: 'ai-labs',
    label: 'Лаборатории',
    shortLabel: 'Лаборатории',
    description:
      'Официальные анонсы от ведущих AI-компаний: новые модели, API, инструменты и исследовательские публикации.',
    seoTitle: 'ИИ-Лаборатории — анонсы OpenAI, Google, Anthropic',
    seoDescription:
      'Официальные новости от OpenAI, Google DeepMind, Anthropic и других ведущих AI-лабораторий.',
  },
  'ai-investments': {
    slug: 'ai-investments',
    label: 'Инвестиции',
    shortLabel: 'Инвестиции',
    description:
      'Крупные раунды финансирования, M&A-сделки и движение венчурного капитала в AI-индустрии — куда течут деньги.',
    seoTitle: 'Инвестиции в ИИ — раунды и сделки',
    seoDescription:
      'Крупные инвестиционные раунды, поглощения и венчурный капитал в сфере искусственного интеллекта.',
  },
  'ai-startups': {
    slug: 'ai-startups',
    label: 'Стартапы',
    shortLabel: 'Стартапы',
    description:
      'Интересные AI-стартапы — зарубежные и российские. Идеи, продукты и подходы, которые можно взять на вооружение.',
    seoTitle: 'ИИ-Стартапы — лучшие проекты и идеи',
    seoDescription:
      'Обзоры интересных AI-стартапов: зарубежные и российские проекты, новые продукты и подходы.',
  },
  'ai-russia': {
    slug: 'ai-russia',
    label: '🇷🇺 Россия',
    shortLabel: 'Россия',
    description:
      'Российский рынок ИИ: государственная политика, отечественные модели, кейсы компаний и академические достижения.',
    seoTitle: 'ИИ в России — новости и тренды',
    seoDescription:
      'Новости о развитии искусственного интеллекта в России: YandexGPT, GigaChat, господдержка и российские AI-стартапы.',
  },
  'coding': {
    slug: 'coding',
    label: 'Код',
    shortLabel: 'Код',
    description:
      'Практические материалы для разработчиков: туториалы, библиотеки, фреймворки и кейсы применения ИИ в разработке.',
    seoTitle: 'ИИ и разработка — туториалы и инструменты',
    seoDescription:
      'Практические материалы для разработчиков: AI-инструменты, библиотеки и туториалы по применению ИИ в коде.',
  },
}

export function getCategoryMeta(slug: string): CategoryMeta | null {
  return (META as Record<string, CategoryMeta>)[slug] ?? null
}

export function getAllCategoryMeta(): CategoryMeta[] {
  return CATEGORY_SLUGS.map((slug) => META[slug])
}
