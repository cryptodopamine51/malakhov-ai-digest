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
- **Telegram:** Supabase `pg_cron` + Vercel Cron fallback → `/api/cron/tg-digest`
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
CRON_SECRET=
HEALTH_TOKEN=
PUBLISH_VERIFY_SECRET=
CLAUDE_DAILY_BUDGET_USD=2
NEXT_PUBLIC_SITE_URL=https://news.malakhovai.ru
```

## Команды

```bash
npm run context      # показать управляющий контекст проекта
npm run dev          # локальная разработка
npm run lint         # ESLint для актуального TS/Next runtime
npm run typecheck    # TypeScript без emit
npm run build        # сборка
npm run docs:check   # проверить, что code/doc изменения синхронизированы
npm run test:node    # все node:test проверки актуального runtime
npm run enrich-submit-batch    # отправить pending-статьи в Anthropic Batch
npm run enrich-collect-batch   # собрать/apply результаты Anthropic Batch
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
| `enrich.yml` | каждые 30 мин | recover stuck + cost guard + submit в Anthropic Batch |
| `enrich-collect-batch.yml` | каждые 15 мин | poll/import/apply результатов Anthropic Batch |
| `recover-batch-stuck.yml` | каждые 30 мин | восстанавливает stuck batch poll/apply |
| `publish-verify.yml` | каждый час, на 20 минуте | проверяет, что опубликованные статьи реально открываются на сайте |
| `retry-failed.yml` | каждые 4 часа | возвращает retryable статьи в обработку |
| `pipeline-health.yml` | каждые 2 часа | health-check источников и пайплайна |
| `docs-guard.yml` | push / pull request | проверяет синхронность code/doc изменений |

Telegram-дайджест не запускается из GitHub Actions: primary scheduler — Supabase `pg_cron`,
fallback — Vercel Cron из `vercel.json`. Оба дергают `/api/cron/tg-digest`, а `digest_runs`
защищает от дублей.

## Применить миграцию БД

Открой `supabase/migrations/001_content_engine.sql` и выполни в Supabase Dashboard → SQL Editor.

## legacy/

Старый Python/FastAPI слой. Код заморожен. Не правь, не запускай.
