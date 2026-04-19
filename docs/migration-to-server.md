# План миграции: Supabase + Vercel → свой сервер

## Итоговая архитектура

```
GitHub Actions (cron)          Твой сервер (82.22.146.66)
├── rss-parse.yml      ──→     PostgreSQL (данные)
├── enrich.yml         ──→     Next.js + PM2 (сайт)
└── tg-digest.yml      ──→     Caddy (прокси, уже стоит)
```

Supabase и Vercel после миграции — отключить.

---

## Шаг 1 — PostgreSQL на сервере (30 мин)

```bash
# Установить PostgreSQL (если нет)
sudo apt install postgresql postgresql-contrib

# Создать базу и пользователя
sudo -u postgres psql
CREATE DATABASE digest;
CREATE USER digest_user WITH PASSWORD 'придумать_пароль';
GRANT ALL PRIVILEGES ON DATABASE digest TO digest_user;
\q

# Применить схему
psql -U digest_user -d digest -f supabase/schema.sql
```

Проверить что PostgreSQL слушает:
```bash
sudo systemctl status postgresql
```

---

## Шаг 2 — Перенос данных из Supabase (15 мин)

```bash
# Слить данные из Supabase (запустить локально или на сервере)
pg_dump \
  "postgresql://postgres.oziddrpkwzsdtsibauon:[DB_PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" \
  --table=articles \
  --data-only \
  --no-owner \
  -f articles_dump.sql

# Залить в локальный PostgreSQL
psql -U digest_user -d digest -f articles_dump.sql
```

> DB_PASSWORD для Supabase: Dashboard → Settings → Database → Connection string

Проверить:
```bash
psql -U digest_user -d digest -c "SELECT COUNT(*) FROM articles;"
```

---

## Шаг 3 — Замена supabase-js на postgres-клиент (3-5 ч)

### 3.1 Установить пакет

```bash
npm install postgres
npm uninstall @supabase/supabase-js
```

### 3.2 Переписать `lib/supabase.ts` → `lib/db.ts`

```ts
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!)
export default sql
export type { Article }

export interface Article {
  id: string
  original_url: string
  original_title: string
  original_text: string | null
  source_name: string
  source_lang: 'en' | 'ru'
  topics: string[] | null
  pub_date: string | null
  cover_image_url: string | null
  ru_title: string | null
  ru_text: string | null
  why_it_matters: string | null
  dedup_hash: string | null
  enriched: boolean
  published: boolean
  tg_sent: boolean
  score: number
  slug: string | null
  created_at: string
  updated_at: string
}
```

### 3.3 Переписать `lib/articles.ts`

```ts
import sql, { type Article } from './db'

export async function getLatestArticles(limit = 20): Promise<Article[]> {
  return sql<Article[]>`
    SELECT * FROM articles
    WHERE published = true
    ORDER BY score DESC, created_at DESC
    LIMIT ${limit}
  `
}

export async function getArticleBySlug(slug: string): Promise<Article | null> {
  const rows = await sql<Article[]>`
    SELECT * FROM articles
    WHERE slug = ${slug} AND published = true
    LIMIT 1
  `
  return rows[0] ?? null
}

export async function getArticlesByTopic(topic: string, limit = 20): Promise<Article[]> {
  return sql<Article[]>`
    SELECT * FROM articles
    WHERE published = true AND ${topic} = ANY(topics)
    ORDER BY score DESC, created_at DESC
    LIMIT ${limit}
  `
}

export async function getRussiaArticles(limit = 20): Promise<Article[]> {
  return getArticlesByTopic('ai-russia', limit)
}

export async function getAllSlugs(): Promise<string[]> {
  const rows = await sql<{ slug: string }[]>`
    SELECT slug FROM articles
    WHERE published = true AND slug IS NOT NULL
    ORDER BY created_at DESC
  `
  return rows.map(r => r.slug)
}
```

### 3.4 Переписать pipeline-скрипты

В `pipeline/ingest.ts`, `pipeline/enricher.ts`, `bot/daily-digest.ts` заменить все вызовы:
```ts
// Было
const supabase = getServerClient()
supabase.from('articles').select('*').eq('published', true)

// Стало
import sql from '../lib/db'
sql`SELECT * FROM articles WHERE published = true`
```

---

## Шаг 4 — Обновить переменные окружения (10 мин)

### `.env.local` (для локальной разработки)

```env
# Убрать всё Supabase, добавить:
DATABASE_URL=postgresql://digest_user:пароль@localhost:5432/digest

# Остальное без изменений:
DEEPL_API_KEY=...
ANTHROPIC_API_KEY=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHANNEL_ID=...
TELEGRAM_ADMIN_CHAT_ID=...
NEXT_PUBLIC_SITE_URL=https://news.malakhovai.ru
```

### GitHub Actions secrets

Удалить:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`

Добавить:
- `DATABASE_URL=postgresql://digest_user:пароль@82.22.146.66:5432/digest`

> Не забыть открыть порт 5432 только для GitHub Actions IP или использовать SSH-туннель.

**Безопаснее — SSH-туннель в workflow:**
```yaml
- name: Setup SSH tunnel
  run: |
    mkdir -p ~/.ssh
    echo "${{ secrets.SERVER_SSH_KEY }}" > ~/.ssh/id_rsa
    chmod 600 ~/.ssh/id_rsa
    ssh -fN -L 5432:localhost:5432 user@82.22.146.66
  env:
    DATABASE_URL: postgresql://digest_user:пароль@localhost:5432/digest
```

---

## Шаг 5 — Next.js на сервере (1-2 ч)

### 5.1 Установить Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs
node --version  # должно быть v20.x
```

### 5.2 Установить PM2

```bash
sudo npm install -g pm2
```

### 5.3 Задеплоить код на сервер

```bash
# На сервере — склонировать репо (или rsync)
git clone git@github.com:ВАШ_ЮЗЕ/malakhov-ai-digest.git /var/www/digest
cd /var/www/digest

# Создать .env.local с DATABASE_URL
npm install
npm run build

# Запустить через PM2
pm2 start npm --name "digest" -- start
pm2 save
pm2 startup  # автозапуск при перезагрузке сервера
```

### 5.4 Настроить Caddy

В `/etc/caddy/Caddyfile` заменить блок `news.malakhovai.ru`:

```
news.malakhovai.ru {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl reload caddy
```

---

## Шаг 6 — Проверка (15 мин)

```bash
# Сайт открывается
curl -I https://news.malakhovai.ru/

# Статья открывается
curl -I https://news.malakhovai.ru/articles/[любой-slug]

# Pipeline работает
npm run ingest
npm run enrich
```

---

## Шаг 7 — Отключить Supabase и Vercel (5 мин)

- Vercel: Dashboard → Project → Settings → Delete Project
- Supabase: Dashboard → Project → Settings → Delete Project

---

## Итого времени

| Шаг | Время |
|---|---|
| PostgreSQL + перенос данных | 45 мин |
| Замена supabase-js на postgres | 3-5 ч |
| Next.js + PM2 + Caddy | 1-2 ч |
| Тестирование | 30 мин |
| **Итого** | **~1 рабочий день** |
