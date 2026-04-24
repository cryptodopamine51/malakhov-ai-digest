# Malakhov AI Дайджест

[![RSS](https://github.com/cryptodopamine51/malakhov-ai-digest/actions/workflows/rss-parse.yml/badge.svg)](https://github.com/cryptodopamine51/malakhov-ai-digest/actions/workflows/rss-parse.yml)
[![Enrich](https://github.com/cryptodopamine51/malakhov-ai-digest/actions/workflows/enrich.yml/badge.svg)](https://github.com/cryptodopamine51/malakhov-ai-digest/actions/workflows/enrich.yml)
[![Digest](https://github.com/cryptodopamine51/malakhov-ai-digest/actions/workflows/tg-digest.yml/badge.svg)](https://github.com/cryptodopamine51/malakhov-ai-digest/actions/workflows/tg-digest.yml)
[![Health](https://github.com/cryptodopamine51/malakhov-ai-digest/actions/workflows/pipeline-health.yml/badge.svg)](https://github.com/cryptodopamine51/malakhov-ai-digest/actions/workflows/pipeline-health.yml)

Русскоязычный медиа-дайджест об искусственном интеллекте.  
Сайт: [news.malakhovai.ru](https://news.malakhovai.ru)

## Стек

- **Сайт:** Next.js 15, Tailwind CSS → Vercel
- **БД:** Supabase (PostgreSQL, таблица `articles`)
- **Пайплайн:** GitHub Actions → `pipeline/*.ts` → Supabase
- **Telegram:** GitHub Actions (cron 06:00 UTC) → `bot/daily-digest.ts`
- **Редактор:** Claude Sonnet 4.6 (один вызов = заголовок + лид + тезисы + тело + TG-тизер)

## Структура

```
app/               Next.js pages (App Router)
src/components/    React-компоненты
lib/               Supabase-клиент, запросы, утилиты
pipeline/          RSS-парсер, фетчер, скорер, редактор Claude, enricher
bot/               Telegram-дайджест
scripts/           Одноразовые скрипты (backfill, link-check)
supabase/          Схема БД и миграции
docs/              Документация актуального стека
legacy/            Старый Python/FastAPI слой (не использовать)
```

## Переменные окружения

`.env.local`:

```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ANTHROPIC_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHANNEL_ID=
TELEGRAM_ADMIN_CHAT_ID=   # опционально
NEXT_PUBLIC_SITE_URL=https://news.malakhovai.ru
```

## Команды

```bash
npm run context      # показать управляющий контекст проекта
npm run dev          # локальная разработка
npm run build        # сборка
npm run docs:check   # проверить, что code/doc изменения синхронизированы
npm run enrich       # запустить enricher (обогащение статей)
npm run tg-digest    # отправить дайджест в Telegram

npx tsx scripts/reenrich-all.ts   # backfill за 14 дней
npx tsx scripts/check-links.ts   # проверка всех ссылок
```

## Документация

Вход в проект:

1. `CLAUDE.md` — управляющий файл и инварианты.
2. `docs/INDEX.md` — карта документации и правила обновления.
3. Канонический doc по нужной области:
   - `docs/PROJECT.md`
   - `docs/ARCHITECTURE.md`
   - `docs/ARTICLE_SYSTEM.md`
   - `docs/OPERATIONS.md`
   - `docs/DECISIONS.md`

Временные `spec_*`, `task_*`, `execution_plan_*` и похожие файлы не считаются source of truth.

## GitHub Actions

| Workflow | Расписание | Действие |
|---|---|---|
| `rss-parse.yml` | каждые 30 мин | парсит RSS, пишет в Supabase |
| `enrich.yml` | каждые 2 часа | recover stuck + обогащение статей через Claude |
| `publish-verify.yml` | каждый час | проверяет, что опубликованные статьи реально открываются на сайте |
| `retry-failed.yml` | каждые 4 часа | возвращает retryable статьи в обработку |
| `pipeline-health.yml` | каждые 2 часа | health-check источников и пайплайна |
| `docs-guard.yml` | push / pull request | проверяет синхронность code/doc изменений |
| `tg-digest.yml` | 06:00 UTC ежедневно | отправляет дайджест в TG |

## Применить миграцию БД

Открой `supabase/migrations/001_content_engine.sql` и выполни в Supabase Dashboard → SQL Editor.

## legacy/

Старый Python/FastAPI слой. Код заморожен. Не правь, не запускай.
