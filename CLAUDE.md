# Malakhov AI Digest — Control Plane

> Главный управляющий файл проекта.
> Он не подгружается автоматически “из памяти” между сессиями: в начале каждой новой работы его нужно открыть явно или запустить `npm run context`.
> Последнее обновление: 2026-05-21

Последняя закрытая инициатива: **SEO improvements wave (2026-05-20→05-21)** — см. `docs/spec_2026-05-20_seo_improvements_wave.md` (план + лог сессий) и `docs/spec_2026-05-20_seo_improvements_wave_progress.md` (подробный per-iteration журнал). Включает (API spend = 0):
- ISR-кеш для главной, `/russia`, `/categories/[category]` через убирание `searchParams` со страниц + Load-more клиент (`HomeFeedList` + `/api/feed`);
- off-topic blocklist (`OFF_TOPIC_KEYWORDS`) перед per-feed keyword filter; `ZDNet AI` / `Wired AI` получили `needsKeywordFilter: true`;
- runtime cover fallback в `sanitizeArticleMedia` (промоут первой sanitized inline в cover) + `SITE_LOGO_URL` brand-fallback для `og:image` / `NewsArticle.image` / `publisher.logo`; article cover теперь 1200×630;
- article-level `BreadcrumbList` JSON-LD + `NewsArticle.abstract` / `wordCount` / `articleSection`;
- `/news-sitemap.xml` (Google News, 48h окно, ISR 10м); SEO-title главной + Organization `sameAs` (Telegram); `WebSite.potentialAction: SearchAction` + страница `/search`;
- `robots.txt` с явными allow для 13 LLM-ботов; `/llms.txt` дополнен кластерами и гайдами; `/llms-full.txt` (топ 100 статей + все гайды); `/about` (`AboutPage`); `/sources` (`CollectionPage` / `ItemList`); `/archive/<date>` теперь `noindex, follow`;
- system prompt Claude: `link_anchors 3–5` (soft warning gate); slug cap 75 с word-boundary cut (`pipeline/slug.ts::capSlugAtWordBoundary`);
- `scripts/indexnow-batch.ts` для post-deploy ping (готов к запуску владельцем);
- Person-author swap: `NewsArticle.author`, `Organization.founder` и `/about` mainEntity ссылаются на одного Person (Иван Малахов) с jobTitle, описанием и портретом (`public/about/editor.jpg`).

Предыдущая инициатива: **Site improvements wave (2026-05-06)** — `docs/spec_2026-05-06_site_improvements.md`.

Отложено до подтверждения владельца (см. §6 spec): evergreen guide generation (🟡 API), card_teaser regen Опция B (🟡 API), alt-text generation Опция B (🟡 API), cover-image generation для остатка (🟡 API).

## Как читать проект

Порядок входа в контекст:
1. `CLAUDE.md`
2. `docs/INDEX.md`
3. Канонический документ по нужной области

Если задача затрагивает статьи и pipeline, смотреть `docs/ARTICLE_SYSTEM.md`.
Если затрагивает данные и границы системы, смотреть `docs/ARCHITECTURE.md`.
Если затрагивает деплой, cron, env или recovery, смотреть `docs/OPERATIONS.md`.

## Что это за проект

Русскоязычное AI-медиа с тремя главными задачами:
1. Делать интересные и читабельные материалы, а не бездушный агрегатор.
2. Расти через SEO и постоянный поток evergreen/news контента.
3. Использовать Telegram как основной канал доставки и возврата аудитории.

Критерий качества: материал должен быть достаточно сильным, чтобы его было интересно читать владельцу проекта без скидки на “это просто агрегатор”.

## Текущее production-ядро

| Слой | Текущее решение |
|---|---|
| Сайт | Next.js 15, App Router, Tailwind CSS, Vercel |
| Данные | Supabase PostgreSQL |
| Ingest | RSS → `pipeline/ingest.ts` |
| Enrichment | `pipeline/enricher.ts` + Claude Sonnet 4.6 |
| Delivery | сайт + Telegram дайджест |
| Проверки | GitHub Actions cron + health/verify/retry workflows |

`legacy/` заморожен. Это не текущий стек и не источник истины.

## Source Of Truth

| Область | Канонический файл |
|---|---|
| Назначение продукта и поверхности | `docs/PROJECT.md` |
| Архитектура и границы системы | `docs/ARCHITECTURE.md` |
| Цикл статьи, media, slug, публикация | `docs/ARTICLE_SYSTEM.md` |
| Runtime, деплой, cron, env, recovery | `docs/OPERATIONS.md` |
| Архитектурные решения | `docs/DECISIONS.md` |
| Дизайн-система | `docs/DESIGN.md` |
| Редакционные правила | `docs/editorial_style_guide.md` |
| SEO-стандарт статей и evergreen-гайдов | `docs/editorial/seo-article-publication-standard.md` |
| Планирование и backlog | `docs/ORCHESTRATOR.md` |

Правило: одна тема = один канонический файл. Временные `spec_*`, `task_*`, `execution_plan_*`, `roadmap_*` не заменяют канонические документы.

## Необсуждаемые правила работы

1. Перед любыми изменениями сначала определить `docs impact`.
2. Если изменение меняет поведение, архитектуру, pipeline, deploy, data flow, публичные URL, editorial rules или product surfaces, соответствующий канонический doc обновляется в том же заходе.
3. Завершённая задача всегда заканчивается одной строкой:
   - `Docs updated: ...`
   - или `Docs impact: no`
4. Изменение поведения без обновления документации считается незавершённой задачей.
5. Перед новой сессией или сложной задачей запускать `npm run context`.

## Документационный цикл

1. Временная спецификация создаётся в `docs/` с датой в имени, если задача большая или исследовательская.
2. После реализации итог переносится в канонический документ.
3. Временный файл остаётся как история работы, но не как текущая правда.
4. Если временный файл начал противоречить каноническому, прав канонический файл.

## Критические инварианты

- Публичный сайт читает из Supabase и не использует service key на клиенте.
- Источником статьи является строка в `articles`; сайт не генерирует контент “на лету”.
- Публичные article URLs должны быть чистыми; legacy-slug адреса только редиректят.
- Новые статьи должны получать релевантные media из исходника, включая видео, если оно тематически подходит.
- Для новых или существенно редактируемых evergreen/manual материалов обязательно применять `docs/editorial/seo-article-publication-standard.md`: SEO-бриф, intent, anti-cannibalization, metadata, image alt, source/fact-checking, internal links и publication checklist.
- Для автоматических RSS-news статей SEO-стандарт применяется только в рамках текущего pipeline contract (`original_url`, categories, `ru_title`, `card_teaser`, `lead`, `slug`, `cover_image_url`, `quality_ok`, `publish_status`). Не требовать ручной SERP/competitor brief перед каждой cron-публикацией.
- Canonical для news-сайта всегда `https://news.malakhovai.ru`; не использовать `malakhovai.ru` или env-derived URL в canonical, sitemap, RSS, `llms.txt`, `og:url` и article links.
- FAQPage schema разрешена только там, где FAQ видим на странице. Для news articles FAQ не добавлять без отдельного изменения render/schema.
- `legacy/` не использовать для нового функционала.
- Продакшен-деплой идёт через Vercel и GitHub/Vercel flow, не ручным копированием файлов.

## Быстрые команды

```bash
npm run context
npm run docs:check
npm run build
npx tsx --test tests/node/pipeline-reliability.test.ts
```

## Что не делать

- Не хранить актуальную архитектуру только в чате.
- Не держать несколько “истин” по одной и той же теме.
- Не менять pipeline или URL-логику без обновления `docs/ARTICLE_SYSTEM.md`.
- Не менять env/deploy/runtime-процессы без обновления `docs/OPERATIONS.md`.
- Не использовать `legacy/` как ориентир для нового кода.
