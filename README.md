# Malakhov AI Дайджест

Русскоязычное AI-медиа. Автоматически собирает новости из 16 источников,
переводит через DeepL, публикует на сайт и отправляет топ-5 в Telegram каждое утро.

## Стек

- **Next.js 14** (App Router) + TypeScript + Tailwind
- **Supabase** (PostgreSQL)
- **GitHub Actions** (cron-планировщик)
- **DeepL API** (перевод EN→RU)
- **Claude API Haiku** (why_it_matters)
- **Telegraf** (Telegram-бот)

## Быстрый старт

1. `git clone` + `npm install`
2. `cp .env.example .env.local` и заполнить переменные
3. Применить `supabase/schema.sql` в Supabase Dashboard → SQL Editor
4. `npm run dev`

## Переменные окружения

| Переменная | Описание | Где взять |
|---|---|---|
| `SUPABASE_URL` | URL проекта Supabase | Supabase Dashboard → Settings → API |
| `SUPABASE_ANON_KEY` | Публичный anon-ключ | Supabase Dashboard → Settings → API |
| `SUPABASE_SERVICE_KEY` | Серверный service role ключ | Supabase Dashboard → Settings → API |
| `DEEPL_API_KEY` | Ключ DeepL для перевода | deepl.com/pro-api |
| `ANTHROPIC_API_KEY` | Ключ Claude API | console.anthropic.com |
| `TELEGRAM_BOT_TOKEN` | Токен бота | @BotFather в Telegram |
| `TELEGRAM_CHANNEL_ID` | ID канала для дайджеста | Числовой ID вида `-100xxxxxxxxxx` |
| `TELEGRAM_ADMIN_CHAT_ID` | Личный chat_id для health-отчётов (опционально) | @userinfobot в Telegram |
| `NEXT_PUBLIC_SITE_URL` | Публичный URL сайта | Домен Vercel или свой |

## GitHub Actions — расписание

| Workflow | Расписание | Что делает |
|---|---|---|
| `rss-parse.yml` | Каждые 30 минут | Парсит RSS-фиды, добавляет новые статьи в Supabase |
| `enrich.yml` | Каждые 2 часа | Переводит и обогащает статьи через DeepL + Claude |
| `tg-digest.yml` | Каждый день 09:00 МСК | Отправляет топ-5 статей в Telegram-канал |

## Деплой

### 1. Push в GitHub

```bash
git init && git add . && git commit -m "init"
git remote add origin https://github.com/YOUR_USER/malakhov-ai-digest.git
git push -u origin main
```

### 2. Vercel

1. Открыть [vercel.com](https://vercel.com) → Add New Project → импортировать репо
2. Framework Preset: **Next.js**
3. Добавить переменные окружения (только для сайта — см. таблицу ниже)
4. Deploy

### 3. GitHub Secrets

Settings → Secrets and variables → Actions → New repository secret

Добавить секреты для GitHub Actions (см. таблицу ниже).

## Скрипты

```bash
npm run dev          # локальная разработка
npm run build        # production-сборка
npm run ingest       # разовый запуск RSS-парсера
npm run enrich       # разовый запуск обогащения
npm run tg-digest    # разовый запуск Telegram-дайджеста
npm run bot          # Telegram-бот в режиме long-polling (локально)
```
