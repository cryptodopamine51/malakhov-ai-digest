# Malakhov AI Дайджест

Русскоязычный медиа-дайджест об искусственном интеллекте.  
Сайт: [news.malakhovai.ru](https://news.malakhovai.ru)

## Стек

- **Сайт:** Next.js 14, Tailwind CSS → Vercel
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
npm run dev          # локальная разработка
npm run build        # сборка
npm run enrich       # запустить enricher (обогащение статей)
npm run tg-digest    # отправить дайджест в Telegram

npx tsx scripts/reenrich-all.ts   # backfill за 14 дней
npx tsx scripts/check-links.ts   # проверка всех ссылок
```

## GitHub Actions

| Workflow | Расписание | Действие |
|---|---|---|
| `rss-parse.yml` | каждые 30 мин | парсит RSS, пишет в Supabase |
| `enrich.yml` | каждые 45 мин | обогащает статьи через Claude |
| `tg-digest.yml` | 06:00 UTC ежедневно | отправляет дайджест в TG |

## Применить миграцию БД

Открой `supabase/migrations/001_content_engine.sql` и выполни в Supabase Dashboard → SQL Editor.

## legacy/

Старый Python/FastAPI слой. Код заморожен. Не правь, не запускай.
