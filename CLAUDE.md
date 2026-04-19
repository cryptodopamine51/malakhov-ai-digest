# Malakhov AI Дайджест — Мастер-документ проекта

> Этот файл — единая точка истины. Читается при каждом старте работы над проектом.
> При изменении архитектуры, разделов или стека — обновлять здесь.
> Последнее обновление: 2026-04-19

> **Правило документирования:** любая большая или важная задача (новый раздел, редизайн, смена архитектуры, значимый UX-паттерн) должна быть описана в файле в папке `docs/` и получить ссылку в этом файле. Не держать важные решения только в голове или чате.

---

## Что за проект

Русскоязычное AI-медиа. Цели по приоритету:
1. Сайт, на котором интересно читать — не агрегатор, а живое медиа
2. SEO-трафик на русскоязычную аудиторию (органика)
3. Telegram-канал как основной канал доставки и роста аудитории
4. Долгосрочно — крупнейшее AI-медиа в России

**Критерий качества:** материалы должны быть интересны самому владельцу.

---

## Стек (актуальный, production)

| Слой | Технология |
|---|---|
| Сайт | Next.js 14, App Router, Tailwind CSS → Vercel |
| БД | Supabase PostgreSQL (таблица `articles`, `digest_runs`) |
| Пайплайн | TypeScript + tsx, GitHub Actions |
| AI-редактор | Claude Sonnet 4.6 + prompt caching |
| Telegram | bot/daily-digest.ts → cron 06:00 UTC |
| DNS | Рег.ру → Vercel, домен news.malakhovai.ru |

**Важно:** Python/FastAPI-стек в `legacy/` — заморожен, не использовать.

---

## Структура разделов сайта

### Главная `/`
**Что показывает:** ТОП дня (5–7 статей с максимальным score за последние 24ч) + лента всех статей по убыванию score.  
**Аудитория:** все пользователи, первое касание.  
**Логика ранжирования:** score × коэффициент свежести (статьи старше 48ч теряют приоритет в ленте).

### Индустрия `/topics/ai-industry`
**Что показывает:** бизнес-новости AI — продукты, партнёрства, рынок, релизы компаний.  
**Источники:** VentureBeat AI, The Verge AI, TechCrunch AI, Wired AI, ZDNet AI, 404 Media.  
**Топик:** `ai-industry`

### Исследования `/topics/ai-research`
**Что показывает:** академические работы, прорывы в науке, технические разборы.  
**Источники:** MIT Technology Review AI, Ars Technica, The Decoder, Hugging Face Blog.  
**Топик:** `ai-research`

### Лаборатории `/topics/ai-labs`
**Что показывает:** официальные анонсы от AI-компаний — модели, API, исследования.  
**Источники:** OpenAI News, Google Research Blog, Hugging Face Blog.  
**Топик:** `ai-labs`

### Инвестиции `/topics/ai-investments` *(в разработке)*
**Что показывает:** крупные раунды финансирования, M&A, куда течёт капитал в AI.  
**Источники:** TechCrunch Venture, Axios Pro Rata, Crunchbase News, vc.ru/finance (keyword-фильтр).  
**Топик:** `ai-investments`

### Стартапы `/topics/ai-startups` *(в разработке)*
**Что показывает:** интересные AI-стартапы — зарубежные и российские, идеи которые можно брать в работу.  
**Источники:** YC Blog, a16z Blog, Sequoia Capital Blog, vc.ru (стартап-фильтр), Сколково.  
**Топик:** `ai-startups`

### Россия `/topics/ai-russia`
**Что показывает:** российский AI-рынок — госполитика, отечественные модели, кейсы компаний.  
**Источники:** Habr AI Hub, CNews (keyword-фильтр), vc.ru (keyword-фильтр).  
**Топик:** `ai-russia`

### Код `/topics/coding`
**Что показывает:** практические материалы для разработчиков — туториалы, библиотеки, кейсы.  
**Источники:** Habr AI Hub, Hugging Face Blog.  
**Топик:** `coding`

### Источники `/sources` *(в разработке)*
**Что показывает:** все источники как красивые карточки с описанием, количеством статей, последними материалами.  
**Цель:** SEO + доверие аудитории + навигация по любимым источникам.

---

## Пайплайн (как работает)

```
GitHub Actions cron каждые 30 мин
  → pipeline/ingest.ts        RSS → Supabase (raw articles, enriched=false)

GitHub Actions cron каждые 2 часа
  → pipeline/enricher.ts      score → fetchHTML → Claude Sonnet → Supabase (published=true)

GitHub Actions cron 06:00 UTC (09:00 МСК)
  → bot/daily-digest.ts       топ-5 за вчера → Telegram канал
```

**Батч enricher:** 15 статей за запуск (цель — поднять до 25–30).  
**Порог публикации:** score ≥ 2 + quality_ok=true от Claude.

---

## Документация по задачам

| Файл | Тема |
|---|---|
| `docs/DESIGN.md` | Дизайн-система: цвета, типографика, компоненты, темы |
| `docs/ORCHESTRATOR.md` | Дорожная карта разработки |

---

## Ключевые файлы

| Файл | Назначение |
|---|---|
| `pipeline/feeds.config.ts` | Все RSS-источники и их топики |
| `pipeline/claude.ts` | Промпт Claude, модель, кэширование |
| `pipeline/enricher.ts` | Оркестрация обогащения статей |
| `pipeline/fetcher.ts` | HTML → текст + таблицы + картинки |
| `pipeline/scorer.ts` | Алгоритм score для статей |
| `bot/daily-digest.ts` | Telegram-дайджест |
| `lib/supabase.ts` | Тип Article, Supabase-клиенты |
| `lib/articles.ts` | Запросы к БД (getLatestArticles и др.) |
| `app/page.tsx` | Главная страница |
| `app/articles/[slug]/page.tsx` | Страница статьи |
| `src/components/Header.tsx` | Навигация |
| `supabase/migrations/` | История миграций БД |
| `docs/ORCHESTRATOR.md` | Дорожная карта разработки |

---

## Переменные окружения (.env.local)

```
SUPABASE_URL
SUPABASE_SERVICE_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
ANTHROPIC_API_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_CHANNEL_ID
TELEGRAM_ADMIN_CHAT_ID
NEXT_PUBLIC_SITE_URL=https://news.malakhovai.ru
NEXT_PUBLIC_METRIKA_ID   (Яндекс Метрика, опционально)
```

---

## Telegram-канал

Ссылка: задаётся через `TELEGRAM_CHANNEL_ID` и `TELEGRAM_ADMIN_CHAT_ID`.  
CTA на сайте: "Получать анонсы в Telegram" → ссылка на канал.  
Дайджест: ежедневно в 09:00 МСК, топ-5 статей за вчера, HTML parse_mode.

---

## Что НЕ делать

- Не трогать `legacy/` — Python/FastAPI, заморожен
- Не использовать `SUPABASE_SERVICE_KEY` на клиентской стороне
- Не деплоить вручную — только через Vercel (автодеплой от push в main)
- Не менять модель с claude-sonnet-4-6 без обновления этого файла
