# Malakhov AI Дайджест — Архитектура проекта

> Статус документа: legacy MVP architecture.
> Актуальная рабочая архитектура проекта уже другая: см. `README.md` и `docs/architecture_review_2026-04-16.md`.
> Этот файл сохранён как исторический план исходной версии на `Next.js + Supabase articles + Node pipeline`.

> Единая точка истины. Обновляется перед каждым новым этапом разработки.
> Версия: 1.0 | Апрель 2025

---

## 1. Цель проекта

**Malakhov AI Дайджест** — русскоязычное медиа про искусственный интеллект.

Цели по приоритету:
1. Сайт, на котором интересно читать — не агрегатор карточек, а живое медиа
2. Органический SEO-трафик на русскоязычную аудиторию
3. Telegram-бот как канал доставки топ-новостей и трафика на сайт
4. В перспективе — крупнейшее AI-медиа в России

**Главный критерий качества:** материалы должны быть интересны самому владельцу.

---

## 2. Стек

| Слой | Технология | Почему |
|---|---|---|
| Сайт | Next.js 14 (App Router) | ISR, SEO из коробки, Vercel-деплой |
| Хостинг сайта | Vercel (бесплатно) | Родная среда для Next.js, автодеплой |
| База данных | Supabase PostgreSQL (бесплатно) | Managed DB, REST API, дашборд |
| Парсинг/пайплайн | TypeScript + Node.js | Один стек с сайтом |
| Планировщик | GitHub Actions (бесплатно) | Надёжный cron, логи каждого запуска |
| Перевод EN→RU | DeepL API (500к симв./мес бесплатно) | Лучшее качество среди бесплатных |
| AI-обогащение | Claude API (Haiku — дёшево) | Только для поля why_it_matters |
| Telegram-бот | Telegraf (Node.js) | Один стек, простая интеграция |
| DNS | Рег.ру → Vercel | Домен news.malakhovai.ru уже настроен |

**Рег.ру используется только как DNS.** Хостинг рег.ру не задействован.

---

## 3. Архитектура системы

```
┌─────────────────────────────────────────────────────┐
│                  GitHub Actions                      │
│                                                      │
│  cron: каждые 30 мин                                 │
│  ┌─────────────────────────────────────────────┐    │
│  │  1. RSS Parser                               │    │
│  │     16 фидов → сырые статьи                 │    │
│  │     дедуп по хэшу заголовка                 │    │
│  │     → новые записи в Supabase               │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  cron: каждые 2 часа                                 │
│  ┌─────────────────────────────────────────────┐    │
│  │  2. Enrichment Pipeline                      │    │
│  │     → fetch og:image                        │    │
│  │     → DeepL: ru_title + ru_text             │    │
│  │     → Claude: why_it_matters (топ-10/день)  │    │
│  │     → флаг published = true                 │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  cron: 06:00 UTC (= 09:00 МСК) ежедневно            │
│  ┌─────────────────────────────────────────────┐    │
│  │  3. Telegram Digest                          │    │
│  │     топ-5 за последние 24ч                  │    │
│  │     → отправка в канал                      │    │
│  │     → tg_sent = true                        │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │  Supabase        │
              │  PostgreSQL      │
              │  таблица:        │
              │  articles        │
              └──────────────────┘
                        │
            ┌───────────┴───────────┐
            ▼                       ▼
  ┌──────────────────┐    ┌──────────────────┐
  │   Next.js сайт   │    │  Telegram-канал  │
  │   Vercel         │    │  @malakhovai     │
  │   news.malakhovai│    │                  │
  │   .ru            │    │  топ-5 новостей  │
  │                  │    │  в 9:00 МСК      │
  │   ISR: 5 мин     │    │  со ссылкой      │
  └──────────────────┘    │  на сайт         │
                          └──────────────────┘
```

---

## 4. База данных — схема таблицы articles

```sql
CREATE TABLE articles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Оригинал
  original_url    TEXT UNIQUE NOT NULL,
  original_title  TEXT NOT NULL,
  original_text   TEXT,          -- полный текст статьи
  source_name     TEXT NOT NULL, -- "VentureBeat", "Habr" и т.д.
  source_lang     TEXT NOT NULL, -- 'en' | 'ru'
  topics          TEXT[],        -- ['ai-research', 'ai-russia'] и т.д.
  pub_date        TIMESTAMPTZ,   -- дата из RSS
  
  -- Обогащение
  cover_image_url TEXT,          -- og:image из оригинала
  ru_title        TEXT,          -- переведённый заголовок
  ru_text         TEXT,          -- переведённый текст
  why_it_matters  TEXT,          -- 1 предложение от Claude
  
  -- Флаги и статусы
  dedup_hash      TEXT UNIQUE,   -- хэш нормализованного заголовка
  enriched        BOOLEAN DEFAULT false,
  published       BOOLEAN DEFAULT false,
  tg_sent         BOOLEAN DEFAULT false,
  
  -- Score для ранжирования (простой)
  score           INTEGER DEFAULT 0,
  
  -- Мета
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Индексы
CREATE INDEX idx_articles_published ON articles(published, created_at DESC);
CREATE INDEX idx_articles_topics ON articles USING GIN(topics);
CREATE INDEX idx_articles_tg ON articles(tg_sent, published, score DESC);
```

---

## 5. Источники RSS

### Международные (EN) — 12 фидов

| Источник | RSS URL | Топики | Поток/день |
|---|---|---|---|
| VentureBeat AI | `https://venturebeat.com/category/ai/feed/` | ai-industry | ~10 |
| The Verge AI | `https://www.theverge.com/ai-artificial-intelligence/rss/index.xml` | ai-industry | ~5 |
| The Decoder | `https://the-decoder.com/feed/` | ai-research, ai-industry | ~5 |
| TechCrunch AI | `https://techcrunch.com/category/artificial-intelligence/feed/` | ai-industry | ~8 |
| ZDNet AI | `https://www.zdnet.com/topic/artificial-intelligence/rss.xml` | ai-industry | ~5 |
| Wired AI | `https://www.wired.com/feed/category/artificial-intelligence/rss` | ai-industry | ~3 |
| Ars Technica | `https://feeds.arstechnica.com/arstechnica/index` | ai-research | ~5 |
| MIT Tech Review AI | `https://www.technologyreview.com/topic/artificial-intelligence/feed` | ai-research | ~3 |
| OpenAI | `https://openai.com/news/rss.xml` | ai-labs | ~2/нед |
| Google Research | `https://research.google/blog/rss` | ai-labs | ~2/нед |
| Hugging Face | `https://huggingface.co/blog/feed.xml` | ai-research, coding | ~3/нед |
| 404 Media | `https://www.404media.co/rss` | ai-industry | ~3 |

### Российские (RU) — 4 фида

| Источник | RSS URL | Топики | Фильтр | Поток/день |
|---|---|---|---|---|
| Habr / ИИ-хаб | `https://habr.com/ru/rss/hubs/artificial_intelligence/articles/` | ai-russia, coding | нет | ~5 |
| РБК (все) | `https://rssexport.rbc.ru/rbcnews/news/20/full.rss` | ai-russia | по ключ. словам | ~3 из 50 |
| CNews | `https://www.cnews.ru/inc/rss/news.xml` | ai-russia | по ключ. словам | ~3 из 10 |
| vc.ru | `https://vc.ru/rss/all` | ai-russia | по ключ. словам | ~3 из 30 |

### Ключевые слова для фильтрации RU-источников
```
искусственный интеллект, нейросеть, нейросети, ИИ, AI, GPT, LLM,
машинное обучение, Яндекс GPT, GigaChat, Сбер AI, языковая модель,
генеративный, ChatGPT, Gemini, Claude, Mistral, робот, автоматизация
```

### Парсинг без RSS (Phase 2 — после MVP)
- `reuters.com/technology/artificial-intelligence/` — Playwright scraper
- `anthropic.com/news` — Playwright scraper
- `deepmind.google/discover/blog` — Playwright scraper

---

## 6. Пайплайн обогащения — логика

### Шаг 1: Дедупликация
```
dedup_hash = md5(lowercase(title).replace(/[^\w\s]/g, '').trim())
Если хэш уже есть в БД за последние 48 часов → пропускаем
```

### Шаг 2: Скоринг (простой, без LLM)
```
score += 3   если источник — лаборатория (OpenAI, Anthropic, Google, Meta, Mistral)
score += 2   если ru-источник (ai-russia)
score += 1   если оригинальный текст > 500 слов (глубокий материал)
score += 1   если pub_date < 6 часов (свежесть)
score -= 1   если заголовок < 5 слов (слишком короткий)
```

### Шаг 3: Обогащение (только для score >= 2)
1. `fetch(original_url)` → парсим og:image (Cheerio)
2. Фетчим полный текст статьи через `@mozilla/readability`
3. DeepL API → `ru_title`, `ru_text` (первые 1500 символов)
4. Claude API (`claude-haiku`) → `why_it_matters` только для топ-10 по score за день

### Шаг 4: Публикация
```
enriched = true → published = true → появляется на сайте
```

---

## 7. Структура сайта

### Страницы

| URL | Описание | Данные |
|---|---|---|
| `/` | Главная — топ-20 свежих материалов с картинками | published=true, сортировка по score+date |
| `/articles/[slug]` | Страница материала | ru_title, ru_text, why_it_matters, og:image |
| `/topics/[topic]` | Лента по категории | фильтр по topics[] |
| `/russia` | Раздел: ИИ в России | topics contains 'ai-russia' |
| `/digest` | Архив дайджестов | группировка по дням |

### SEO-логика

- **Slug** = `transliterate(ru_title) + '-' + shortId`
- **Title** = `{ru_title} | Malakhov AI Дайджест`
- **Description** = первое предложение `ru_text`
- **OG Image** = `cover_image_url` если есть, иначе дефолтная заглушка
- **ISR revalidate** = 300 секунд (5 минут) — страницы статические, обновляются автоматически

### Дизайн-принципы сайта
- Тёмная тема (основная) / светлая (переключатель)
- Карточки с картинкой, заголовком, источником, временем и `why_it_matters`
- Раздел «Россия» визуально выделен (другой акцентный цвет)
- Мобайл-фёрст — большинство читают с телефона
- Нет рекламных блоков на старте

---

## 8. Telegram-бот

### Логика ежедневного дайджеста (09:00 МСК)
```
1. Берём articles за последние 24 часа, published=true, tg_sent=false
2. Сортируем по score DESC
3. Берём топ-5
4. Формируем сообщение:
   🤖 AI Дайджест — {дата}

   1. {ru_title}
      {why_it_matters}
      → Читать: {URL на сайт}

   ... (5 новостей)

   Все новости: news.malakhovai.ru
5. Отправляем в канал
6. tg_sent = true для отправленных
```

### Формат сообщения в Telegram
- Без HTML-разметки кроме ссылок
- Emoji умеренно: 🤖 в шапке, числа-пункты
- Длина: ~800-1000 символов (умещается без "читать дальше")

---

## 9. Структура файлов проекта

```
malakhov-ai-digest/
│
├── src/
│   └── app/                    # Next.js App Router
│       ├── page.tsx             # Главная
│       ├── articles/[slug]/
│       │   └── page.tsx
│       ├── topics/[topic]/
│       │   └── page.tsx
│       ├── russia/
│       │   └── page.tsx
│       └── digest/
│           └── page.tsx
│
├── components/
│   ├── ArticleCard.tsx
│   ├── ArticleGrid.tsx
│   ├── TopicBadge.tsx
│   ├── RussiaSection.tsx
│   └── DigestArchive.tsx
│
├── lib/
│   ├── supabase.ts             # Supabase client
│   ├── articles.ts             # Запросы к БД
│   └── utils.ts                # slugify, transliterate
│
├── pipeline/                   # Пайплайн (Node.js скрипты)
│   ├── rss-parser.ts           # Шаг 1: парсинг RSS
│   ├── enricher.ts             # Шаг 2: обогащение
│   ├── scorer.ts               # Скоринг статей
│   ├── deepl.ts                # DeepL клиент
│   ├── claude.ts               # Claude клиент
│   └── feeds.config.ts         # Список RSS-фидов
│
├── bot/
│   └── daily-digest.ts         # Telegram-бот
│
├── .github/
│   └── workflows/
│       ├── rss-parse.yml       # cron: каждые 30 мин
│       ├── enrich.yml          # cron: каждые 2 часа
│       └── tg-digest.yml       # cron: 06:00 UTC
│
├── .env.local                  # локально
├── package.json
└── README.md
```

---

## 10. ENV переменные

```bash
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=           # только для пайплайна (серверный)

# DeepL
DEEPL_API_KEY=                  # бесплатный тир: 500к симв./мес

# Claude
ANTHROPIC_API_KEY=              # Haiku — дёшево, ~$0.25/1M токенов

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHANNEL_ID=

# Site
NEXT_PUBLIC_SITE_URL=https://news.malakhovai.ru
```

---

## 11. Расчёт стоимости (в месяц)

| Сервис | Объём | Стоимость |
|---|---|---|
| Vercel | Хобби-план | **$0** |
| Supabase | Free tier (500 МБ) | **$0** |
| GitHub Actions | ~1500 мин/мес | **$0** |
| DeepL | ~300к симв./мес | **$0** |
| Claude Haiku | ~300 запросов/мес (топ-10/день × 30) | **~$0.50** |
| Домен | Уже оплачен | **$0** |
| **Итого** | | **~$0.50/мес** |

При росте (>500к симв. DeepL): переходим на платный DeepL (~$6/мес) или Google Translate.

---

## 12. Порядок разработки (этапы)

### Этап 1 — Фундамент (Неделя 1)
- [ ] Создать репо `malakhov-ai-digest` на GitHub
- [ ] Инициализировать Next.js 14 проект
- [ ] Настроить Supabase: создать проект, применить схему БД
- [ ] Написать `feeds.config.ts` с 16 источниками
- [ ] Написать `rss-parser.ts` (на базе подхода друга)
- [ ] Протестировать парсер локально — убедиться что фиды работают
- [ ] Настроить GitHub Action `rss-parse.yml`

### Этап 2 — Обогащение (Неделя 1-2)
- [ ] Написать `scorer.ts`
- [ ] Написать `enricher.ts` (og:image + readability)
- [ ] Подключить DeepL API
- [ ] Подключить Claude API (only why_it_matters)
- [ ] GitHub Action `enrich.yml`
- [ ] Проверить данные в Supabase dashboard

### Этап 3 — Сайт MVP (Неделя 2)
- [ ] Главная страница `/` — сетка карточек
- [ ] Страница статьи `/articles/[slug]`
- [ ] Раздел Россия `/russia`
- [ ] Базовый дизайн: тёмная тема, карточки с картинкой
- [ ] SEO: метатеги, OG, sitemap
- [ ] Деплой на Vercel
- [ ] Подключить домен news.malakhovai.ru

### Этап 4 — Telegram (Неделя 3)
- [ ] Написать `daily-digest.ts`
- [ ] GitHub Action `tg-digest.yml`
- [ ] Протестировать на тестовом канале
- [ ] Запустить на основной канал

### Этап 5 — Полировка (Неделя 3-4)
- [ ] Страницы `/topics/[topic]` и `/digest`
- [ ] Переключатель тёмная/светлая тема
- [ ] Health-лог в Telegram (ежедневный отчёт о работе пайплайна)
- [ ] Оптимизация изображений (next/image)

### После MVP (Phase 2)
- [ ] Playwright scraper для Reuters, Anthropic, DeepMind
- [ ] Алгоритм быстрого отслеживания breaking news
- [ ] Еженедельный дайджест в Telegram (по понедельникам)
- [ ] SEO-материалы: еженедельные обзоры, объяснения

---

## 13. Что НЕ делаем на MVP

- ❌ Tier-логика (TIER_1/2/3) — простого score достаточно
- ❌ Events как отдельная сущность — одна таблица articles
- ❌ LLM-классификация топиков — топики берём из конфига фида
- ❌ Кластеризация новостей — дедуп по хэшу достаточно
- ❌ Авторский слой «Альфа» — добавим в Phase 2
- ❌ Микросервисы — всё в одном репо, один стек
- ❌ APScheduler / отдельный cron-сервер — только GitHub Actions
