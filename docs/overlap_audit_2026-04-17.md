# Аудит наложения функционала — 2026-04-17

**Задача:** разобраться, какой из двух параллельных сценариев реально работает, оставить только его, второй пометить как legacy и спрятать. Плюс проверить, правильно ли составлен маркетинговый аудит.

**Вывод одной строкой.** В репо официально считается «каноническим» Python/FastAPI-стек, но на проде работает Node/Next.js/Supabase. Документация лжёт. Половина файлов — мёртвый груз. Два GitHub Action’а, добавленных 1–2 дня назад, стреляют в 404. Маркетинговый аудит случайно написан под правильную систему — она и нужна.

---

## 1. Факты с боевого сайта `news.malakhovai.ru`

Проверено прямыми HTTP-запросами к проду **17 апреля 2026**.

| Запрос | Код | Что это значит |
|---|---|---|
| `GET /` | 200, `server: Vercel`, `x-powered-by: Next.js`, `x-vercel-cache: HIT` | Сайт отдаётся **Vercel + Next.js** |
| `GET /sitemap.xml` | 200 | Генерируется `app/sitemap.ts` (Next.js) |
| `GET /russia` | 200 | Рендерится `app/russia/page.tsx` (Next.js) |
| `GET /articles/<slug>` | 200, `<title>... | Malakhov AI Дайджест</title>` | Рендерится `app/articles/[slug]/page.tsx` (Next.js) |
| `GET /health` | **404** | Python FastAPI-эндпоинт — **не отвечает** |
| `GET /health/db` | **404** | то же |
| `GET /events` | **404** | Python-маршрут из `architecture_current.md` — **нет** |
| `GET /issues` | **404** | то же |
| `GET /alpha` | **404** | то же |
| `POST /internal/jobs/ingest` | **404** | Эндпоинт, который дёргают новые workflow `daily_digest.yml` / `weekly_digest.yml` — **не существует** |

HTML-заголовки страниц приходят из `app/layout.tsx` (Next.js), OG-description на статье `claude-opus-4-7...` буквально начинается с habr-мусора `«Уровень сложностиСреднийВремя на прочтение8 минОхват и читатели4.8K»` — это 100% ответ от `pipeline/fetcher.ts` Node-стека (я ссылался на эту проблему в маркет-аудите, она реальна).

**Вывод раздела.** Production обслуживается **только Node/Next.js на Vercel**. Python-код в бою не участвует.

---

## 2. Кто на самом деле пушит в Telegram-канал

**Факт — работает только одна цепочка:**

```
.github/workflows/tg-digest.yml
    ↓  (cron 0 6 * * *)
npm run tg-digest
    ↓
bot/daily-digest.ts
    ↓
Supabase (чтение articles) → Telegram Bot API (@malakhovAIdigest)
```

Подтверждение из `scripts/setup-secrets.sh`: устанавливаемые секреты — `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY`, `DEEPL_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID=-1001003966448216`, `NEXT_PUBLIC_SITE_URL=https://news.malakhovai.ru`. Это секреты **только Node-пайплайна**. Для Python ничего не ставится.

### Что НЕ пушит в канал

1. **Vercel.** В репозитории нет `vercel.json`, нет `app/api/**/route.ts`. Vercel в TG никогда ничего не шлёт, только рендерит сайт.
2. **Python-ветка (`app/api/`, `app/bot/`, `app/services/`).** Даже если на каком-то VPS запущен `deploy/compose.production.yml` — он был бы отдельным доменом. Production-домен обслуживает Vercel. API-роуты Python-слоя на `news.malakhovai.ru` возвращают 404.
3. **`bot/bot.ts`** (Telegraf long-polling для личек). Есть скрипт `npm run bot`, но нигде не запускается автоматически: нет GH Action, нет `Dockerfile` в Node-части, нет systemd/PM2. В production этот бот либо не работает, либо крутится где-то у тебя на локалке/ноуте — неконтролируемо.
4. **Workflow `daily_digest.yml` и `weekly_digest.yml`** (добавлены PR #1 и двумя ночными коммитами `6d2a163`, `2255eb6`). Они дёргают `https://news.malakhovai.ru/internal/jobs/ingest`, `/build-daily`, `/send-daily` — все эти эндпоинты возвращают 404, значит workflow падает каждый запуск на шаге «Run ingestion». Ты, по git status, уже удалил оба файла локально, но они ещё есть на `origin/main` и крутятся по cron, заливая GH Actions красными ошибками.

**Вывод раздела.** В TG шлёт **только** `tg-digest.yml` → `bot/daily-digest.ts`. Всё остальное — либо не запускается, либо падает.

---

## 3. Откуда взялось «наложение»

В репозитории параллельно живут две независимые реализации одного продукта.

### 3.1 Legacy (по README.md) — на самом деле production

| Слой | Файлы |
|---|---|
| Сайт | `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `app/sitemap.ts`, `app/articles/[slug]/page.tsx`, `app/russia/page.tsx`, `app/topics/[topic]/page.tsx`, `src/app/*` (дубль в `src/`), `src/components/*`, `public/` |
| Пайплайн | `pipeline/rss-parser.ts`, `ingest.ts`, `enricher.ts`, `fetcher.ts`, `scorer.ts`, `claude.ts`, `deepl.ts`, `slug.ts`, `feeds.config.ts` |
| Боты | `bot/daily-digest.ts`, `bot/bot.ts` |
| Хранилище | Supabase (`supabase/schema.sql`, `lib/supabase.ts`, `lib/articles.ts`) |
| CI | `.github/workflows/rss-parse.yml`, `enrich.yml`, `tg-digest.yml` |
| Конфиг | `package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `.eslintrc.json` |
| Деплой | Vercel (из `.vercel/project.json` → `projectId prj_f2t8J7...`) |

### 3.2 «Канонический» по README.md — на самом деле мёртвый

| Слой | Файлы |
|---|---|
| API | `app/api/main.py`, `app/api/routes/` |
| Сервисы | `app/services/{ingestion, normalization, clustering, classification, scoring, digest, deliveries, rendering, quality, issues, alpha, russia, editorial, shortlist, sources, events, site, about_service.py, bot_interaction_service.py, delivery_service.py, user_service.py}` |
| Боты | `app/bot/{dispatcher.py, runner.py, handlers/, renderers/, keyboards/, texts.py}` |
| БД/модели | `app/db/models/` (включая `deliveries.py`, `users.py`), `alembic/`, `alembic.ini` |
| Runtime | `app/jobs/`, `app/core/`, `app/templates/`, `app/__init__.py` |
| Web (заглушка сайта) | `app/web/site.py`, `app/web/preview.py` |
| Деплой | `Dockerfile`, `docker-compose.yml`, `deploy/compose.production.yml`, `deploy/Caddyfile`, `render.yaml`, `scripts/run_*.sh`, `scripts/ops/*.sh` |
| CI (сломанные) | `.github/workflows/daily_digest.yml`, `weekly_digest.yml` (уже удалены локально, но есть на `origin/main`) |
| Тесты | `tests/` (pytest) |
| Конфиг | `pyproject.toml`, `.python-version`, виртуалки `.venv`, `.venv311`, `.venv312` |
| Прочее | `AGENTS.md`, `editorial_rules.md`, `seed_sources.csv`, `local_dev.db`, `malakhov-ai-keys.env`, `keys.env.txt`, `scripts/seed_sources.py`, `scripts/seed_demo_newsroom_content.py` |

### 3.3 Документация, которая вводит в заблуждение

- `README.md` — объявляет «FastAPI + PostgreSQL + event-layer + Telegram delivery + HTML site shell» каноническим. Не соответствует проду.
- `docs/architecture_current.md` — то же самое.
- `docs/architecture_review_2026-04-16.md`, `docs/remediation_tz_2026-04-16.md`, `docs/operational_checklist_2026-04-16.md`, `docs/newsroom_product_plan.md`, `docs/newsroom_execution_backlog.md`, `docs/newsroom_quality_matrix.md`, `docs/document_sync_registry.md`, `docs/migration-to-server.md` — написаны все под Python-слой.
- Только `docs/digest-fix-spec.md` и мой новый `docs/marketing_audit_2026-04-17.md` — про реально работающий Node-стек.
- `malakhov-ai-digest-architecture.md` — в шапке помечен как legacy, но по факту описывает именно то, что сейчас работает (Next.js + Supabase articles + Node pipeline).

### 3.4 Ключевой источник путаницы

Папка **`app/`** содержит ОДНОВРЕМЕННО Next.js-файлы (`layout.tsx`, `page.tsx`, `articles/`, `russia/`, `topics/`, `sitemap.ts`, `globals.css`) и Python-пакет (`__init__.py`, `api/`, `bot/`, `services/`, `db/`, `core/`, `jobs/`, `web/`, `templates/`). Next.js видит `.tsx` и не трогает `.py`. Python видит `.py` и не трогает `.tsx`. Два мира живут в одной директории, не мешая друг другу — и именно это мешает человеку понять, что реально работает.

Плюс дубль: `app/*.tsx` и `src/app/*.tsx` — одни и те же страницы в двух местах. Next.js 14 всегда предпочитает `app/` перед `src/app/`, значит `src/app/*` тоже мёртвая копия.

---

## 4. Конфликты и риски

1. **Сломанный cron на origin/main.** `daily_digest.yml` стреляет 5:55 UTC ежедневно в 404-эндпоинт. `weekly_digest.yml` — по понедельникам в 6:15 UTC. Оба падают, GH Actions копит красные запуски, уведомления приходят как от настоящей поломки.
2. **Двусмысленность токена Telegram.** В теории Python-бот в `deploy/compose.production.yml` может быть поднят на каком-то старом VPS и писать в тот же канал с тем же токеном. Признаков не видно (Python-домен недоступен снаружи, признаков дублей в канале не подтвердить отсюда), но сам факт, что `BOT_TOKEN` и `TELEGRAM_BOT_TOKEN` — **разные переменные** в `app/core/config.py` и `.env.example`, значит возможны две одинаковые-но-разные настройки.
3. **Будущая деградация.** Любой человек (или LLM-ассистент), открыв `README.md`, начнёт править Python. Изменения уйдут в мёртвую ветку, прод останется без правок.
4. **Дубль страниц.** `app/articles/[slug]/page.tsx` и `src/app/articles/[slug]/page.tsx` — одинаковые. Если правят не тот — правка не долетает.
5. **Тесты `tests/`** — pytest под Python, на `origin/main` крутятся через `pytest -q` (по README). К реально работающему Node-коду не имеют отношения; при этом падение теста выглядит как падение продукта.
6. **`local_dev.db` (4 МБ SQLite в корне)** — Python-разработческая БД, лежит в репо. Node-стек её не использует, и, возможно, там лежат персональные данные.
7. **Два `.env.local`, `.env`, `.env.example` + зоопарк `.venv311`, `.venv312`, `.venv`** — захламление рабочей папки.

---

## 5. Решение

Фиксируем **Node/Next.js/Supabase на Vercel** как единственный канонический стек. Python-ветку убираем из видимости, но сохраняем историю (не удаляем в никуда — перемещаем в `legacy/` и фиксируем отдельным коммитом).

### 5.1 Что остаётся активным (не трогать)

- **Сайт (Vercel, Next.js 14):** `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `app/sitemap.ts`, `app/articles/[slug]/page.tsx`, `app/russia/page.tsx`, `app/topics/[topic]/page.tsx`, `src/components/*`.
- **Пайплайн:** `pipeline/{ingest.ts, rss-parser.ts, enricher.ts, fetcher.ts, scorer.ts, claude.ts, deepl.ts, slug.ts, feeds.config.ts}`.
- **Бот отправки дайджеста:** `bot/daily-digest.ts` (вызывается из GH Action).
- **Бот личек:** `bot/bot.ts` — **решить отдельно** (см. 5.3).
- **Хранилище:** Supabase (`supabase/schema.sql`, `lib/supabase.ts`, `lib/articles.ts`).
- **CI:** `.github/workflows/rss-parse.yml`, `enrich.yml`, `tg-digest.yml`.
- **Конфиг:** `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `.eslintrc.json`, `next-env.d.ts`, `public/`, `.vercel/`.
- **Deployment target:** Vercel.

### 5.2 Что переезжает в `legacy/` (один коммит)

Создать папку `legacy/` в корне и перенести туда:

```
legacy/
├── README.md              # «Этот слой не используется. Код заморожен. Не править.»
├── python/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── api/
│   │   ├── bot/
│   │   ├── core/
│   │   ├── db/
│   │   ├── jobs/
│   │   ├── services/
│   │   ├── templates/
│   │   └── web/
│   ├── alembic/
│   ├── alembic.ini
│   ├── pyproject.toml
│   ├── .python-version
│   ├── tests/
│   ├── scripts/run_api.sh
│   ├── scripts/run_api_prod.sh
│   ├── scripts/run_bot.sh
│   ├── scripts/run_scheduler.sh
│   ├── scripts/seed_sources.py
│   ├── scripts/seed_demo_newsroom_content.py
│   ├── scripts/data/
│   ├── scripts/ops/
│   ├── docs/architecture_current.md
│   ├── docs/architecture_review_2026-04-16.md
│   ├── docs/remediation_tz_2026-04-16.md
│   ├── docs/operational_checklist_2026-04-16.md
│   ├── docs/newsroom_*.md
│   ├── docs/document_sync_registry.md
│   ├── docs/migration-to-server.md
│   ├── deploy/compose.production.yml
│   ├── deploy/Caddyfile
│   ├── deploy/news-placeholder/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── render.yaml
│   ├── AGENTS.md
│   ├── editorial_rules.md
│   ├── seed_sources.csv
│   └── local_dev.db          # если решим сохранить, иначе удалить
└── node-duplicates/
    └── src/app/              # дубль Next.js-страниц (src/app/*.tsx)
```

Ключевые действия внутри переноса:
1. Папка `app/` внутри репо — **только Next.js**. Удалить из неё все `.py`, `__pycache__/`, `templates/`, `web/`, `services/`, `bot/`, `api/`, `db/`, `core/`, `jobs/`, `__init__.py`.
2. `src/app/*` — удалить (дубль страниц).
3. Удалить `.venv/`, `.venv311/`, `.venv312/`, `.pytest_cache/` (добавить в `.gitignore`, если не добавлены).
4. Удалить с `origin/main` workflow `daily_digest.yml` и `weekly_digest.yml` (у тебя они уже помечены к удалению в working tree — коммитить).
5. Переписать `README.md` (см. 5.4).
6. Файлы-дубли `malakhov-ai-digest-architecture.md` и `docs/digest-fix-spec.md` — оставить в `docs/`, они описывают актуальный Node-стек.

Почему **перенести**, а не **удалить**: там месяцы работы и живые идеи (event-layer, кластеризация, alpha, digest_issues). Потом можно из этого таскать полезное. Удаление обнулит исследовательскую работу.

### 5.3 Что делать с `bot/bot.ts`

Варианты:
- **(A)** Оставить как есть, добавить GH Action `bot-welcome.yml`, который держит long-polling на runner’е. **Плохо:** GH Actions не дают долгоживущих процессов, ограничение 6 часов на job.
- **(B)** Развернуть `bot.ts` отдельным сервисом на **Vercel Cron + webhook**: бот на webhook-режиме, URL смотрит на `app/api/telegram/route.ts`. **Хорошо:** вписывается в текущий Vercel-деплой, не нужен отдельный сервер.
- **(C)** Удалить `bot/bot.ts`. Если бот никому не нужен (а в канале люди всё равно пишут в комменты или ЛС напрямую) — вопрос закрывается. Рекомендую этот путь для MVP, вернуться позже.

Голос аудита: **(C) удалить для MVP**, через 4–8 недель, если лиды из ЛС пойдут, переделать в webhook (B). Не держать призрак-процесс.

### 5.4 Новый `README.md` — короткий и правдивый

Должен в первых 10 строках сообщать:
- Что за продукт.
- Стек: Next.js 14 + Supabase + GitHub Actions + Vercel + Telegram Bot API.
- Где живёт сайт: `news.malakhovai.ru` (Vercel).
- Как пушится в TG: cron `.github/workflows/tg-digest.yml` → `bot/daily-digest.ts`.
- Ссылка на `legacy/` с меткой «не использовать».

Не упоминать FastAPI, event-layer, Alembic, `APScheduler`, aiogram. Это не про текущий проект.

### 5.5 Порядок исполнения (1 рабочий день)

1. **Создать ветку `cleanup/remove-python-legacy`** из `main`.
2. **Подтвердить по git log, что `daily_digest.yml` / `weekly_digest.yml` нигде не подтянуты в другие процессы.** (Они не подтянуты — это отдельные workflow.)
3. **Переместить файлы в `legacy/`** (см. 5.2). Использовать `git mv`, чтобы сохранить историю.
4. **Удалить `daily_digest.yml`, `weekly_digest.yml`** — у тебя уже сделано в working tree, просто закоммитить.
5. **Очистить `app/` от `.py` и прочих Python-артефактов.**
6. **Удалить `src/app/`** (дубль).
7. **Переписать `README.md`** (5.4).
8. **Проверить `pnpm/npm run build`** — собирается ли Next.js после перемещений.
9. **Деплой на Vercel preview**, проверить: главная, `/russia`, 2–3 статьи, `/sitemap.xml`, корректный OG.
10. **Merge в `main`.** Не через force-push, обычным PR.
11. **Проверить, что GH Actions `tg-digest.yml` отработает в ближайший утренний cron** — не сломал ли перенос путей к `bot/daily-digest.ts` (он остаётся в `bot/`, ничего не меняется).
12. **Обновить memory-файлы**, убрать упоминания Python-canonical.

Ни один из 12 шагов не трогает Supabase, Vercel-проект или GH Secrets. Риска деградации нет.

### 5.6 Что **не делать** в рамках уборки

- Не трогать секреты GitHub, Vercel, Supabase.
- Не переразворачивать DNS.
- Не менять схему Supabase (`supabase/schema.sql`).
- Не трогать сами `pipeline/*.ts` (их меняет маркет-аудит, отдельной задачей).
- Не запускать никакие `alembic upgrade head` / `docker compose up` — это команды мёртвой ветки.
- Не ломать `.vercel/project.json` (Vercel привязан к этому projectId).

---

## 6. Ревизия маркетингового аудита

**Файл:** `docs/marketing_audit_2026-04-17.md`.

**Вердикт: аудит написан под правильный стек.** Он анализирует ровно то, что реально работает в проде — Node-пайплайн (`pipeline/claude.ts`, `pipeline/enricher.ts`, `pipeline/fetcher.ts`), Telegram-бот (`bot/daily-digest.ts`), Next.js-страницы (`app/articles/[slug]/page.tsx`, `src/components/ArticleCard.tsx`), Supabase-запросы (`lib/articles.ts`).

Производственные симптомы, про которые я писал, **подтверждены на живом сайте**:
- На проде в `<meta property="og:description">` статьи `/articles/claude-opus-4-7-treyd-offy-extra-high-i-novyy-kharakter-200549` стоит буквально: `Уровень сложностиСреднийВремя на прочтение8 минОхват и читатели4.8K...` — это утечка habr-UI. Пункт 3.1 P0-1 маркет-аудита.
- Слуги вида `...4fedc9`, `...6e90b8` — шестисимвольный UUID-суффикс, как описано в пункте 3.4 P1-11 маркет-аудита.
- Заголовок главной `<title>Malakhov AI Дайджест</title>` без даты и обещания выпуска — пункт 3.3 P1-1.

**Что в маркет-аудите нужно поправить с учётом этой уборки.**

1. Добавить в раздел 5 блок **5.0 Предусловие** — «до начала работ выполнить уборку по `docs/overlap_audit_2026-04-17.md`, иначе правки будут размазаны по двум реализациям».
2. Убрать из раздела 5.7 «Breaking-режим» предположения про Python-scheduler — использовать только GH Action + Vercel.
3. В раздел 5.11 «Ручной редакторский контур» явно указать путь **`app/admin/*`** (Next.js), а не Python-админку (её и так нет, но кто-то может увидеть в `app/api/` что-то похожее и спутать).
4. Уточнить в разделе 5.6 «Кластеризация»: pgvector на Supabase — проверить, что расширение доступно на free-tier (доступно; проверено в документации Supabase). Если нет — fallback на `ivfflat` через self-managed или на внешний Pinecone.

В остальном план остаётся в силе. Предлагаемые изменения (убить `why_it_matters`, ввести `lead`/`summary`/`card_teaser`/`tg_teaser`/`editorial_body`, редакторский порог, JSON-LD, герой-блок главной, воронка, UTM, админка) — все делаются **в Node/Next.js/Supabase**, и это та самая система, которая в проде.

---

## 7. Итоговый чек-лист

Коротко, по пунктам, что надо сделать человеку/команде:

- [ ] **Сегодня:** прочитать этот файл + `docs/marketing_audit_2026-04-17.md`, принять решение по 5.3 (судьба `bot/bot.ts`).
- [ ] **Завтра:** ветка `cleanup/remove-python-legacy`, перенос Python в `legacy/`, удаление `daily_digest.yml` / `weekly_digest.yml`, чистка `app/` от `.py`, удаление `src/app/` (дубль). Переписать `README.md`. Проверить build, preview-deploy, merge.
- [ ] **В течение недели:** начать работы по маркет-аудиту, блок 5.1 + 5.2 (новый промпт Claude + новый формат TG). Там главный прирост качества.
- [ ] **В течение месяца:** пройти фазы 1–3 маркет-аудита (концепт, сайт, SEO). Смотреть метрики из раздела 7.1 маркет-аудита.
- [ ] **Через 4 недели:** повторно свести — что работает, что нет. Если надо — планировать Python-идеи (event-layer, clustering) как upgrade уже для Node-стека, а не возвращаться к мёртвой ветке.

---

## 8. Источники (чтобы проверить моё расследование)

Проверяемые факты (все получены сейчас, 2026-04-17):

- `curl -I https://news.malakhovai.ru/` → `server: Vercel`, `x-powered-by: Next.js`.
- `curl https://news.malakhovai.ru/health` → **404** (Python якобы-канон не отвечает).
- `curl -X POST https://news.malakhovai.ru/internal/jobs/ingest` → **404** (новые workflow бьются о стену).
- `curl https://news.malakhovai.ru/russia` → **200** (Next.js-роут `app/russia/page.tsx`).
- `git log -30` на `main`: последние коммиты за 2 суток — `daily_digest.yml`, `weekly_digest.yml`, Python (`app/api/main.py`, `app/services/digest/service.py`).
- `git status`: локально уже удалены `daily_digest.yml`, `weekly_digest.yml`.
- `.github/workflows/` на HEAD содержит **пять** workflow: 3 рабочих (Node) + 2 сломанных (Python-intent, hits 404).
- `.vercel/project.json`: `projectId=prj_f2t8J7aRgMd6vR7QWWEGvtfQqDfu`, `orgId=team_lexxheo2zV7rTFtPomMwVSBW`, `projectName=malakhov-ai-digest`.
- `scripts/setup-secrets.sh`: устанавливает только Node-секреты (Supabase, Anthropic, DeepL, Telegram, `NEXT_PUBLIC_SITE_URL`).
- `README.md` lines 1–28: объявляет Python каноническим; lines 179–184: признаёт два поколения workflow и просит «проверить, какой используется в проде».

Если что-то из перечисленного изменится, часть выводов пересматривается. По состоянию на сейчас — всё сходится.

---

**Путь к файлу:** `/Users/malast/malakhov-ai-digest/docs/overlap_audit_2026-04-17.md`
**Связанные:** `docs/marketing_audit_2026-04-17.md` (план качества контента), `malakhov-ai-digest-architecture.md` (исторический, но по содержанию = сегодняшний прод).
