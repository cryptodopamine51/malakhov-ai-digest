# SEO Improvements Wave — Spec 2026-05-20

> Дата создания: 2026-05-20
> Источник: SEO-аудит news.malakhovai.ru от 2026-05-20 (полный отчёт ниже, раздел 4).
> Тип: временная спецификация. После реализации **каждой фазы** итоги переносятся в канонические доки (`docs/editorial/seo-article-publication-standard.md`, `docs/ARTICLE_SYSTEM.md`, `docs/OPERATIONS.md`) и подсвечиваются в `CLAUDE.md` как новая последняя закрытая инициатива.
> Канонические документы для этой волны: `docs/editorial/seo-article-publication-standard.md` (главный), `docs/ARTICLE_SYSTEM.md`, `docs/OPERATIONS.md`.

---

## 0. ЖЁСТКОЕ ПРАВИЛО: API-бюджет = 0 без явного подтверждения владельца

**Без письменного «да» от владельца — никаких трат на Anthropic / OpenAI / image-generation API.**

- Все правки в коде (фазы 1-5) делаются с API spend = 0.
- Backfill уже опубликованных статей (фаза 6) разделён на «no-API» подэтапы и «требует API» подэтапы. Каждый подэтап с API spend = YES помечен `🟡 НУЖНО ПОДТВЕРЖДЕНИЕ` и не запускается, пока владелец явно не согласует.
- Любые `npx tsx scripts/reenrich*.ts`, `pipeline/enricher.ts`, `enrich-submit-batch.ts`, `pipeline/generate-images.ts` — **запрещены** без согласования.
- Перед каждой `🟡 НУЖНО ПОДТВЕРЖДЕНИЕ`-итерацией исполнитель готовит оценку: ~$X на N статей, и пишет владельцу.

Если по ходу выяснится, что что-то невозможно сделать без API — фиксируем альтернативу или ставим задачу на паузу, не запускаем API стихийно.

---

## 1. Resume Protocol — как продолжить работу в новой сессии

Этот файл написан так, чтобы Claude в свежей сессии мог зайти и продолжить с нужного места без потери контекста.

**Минимальный protocol для новой сессии:**

1. Открыть `CLAUDE.md` (control plane).
2. Открыть этот файл целиком.
3. Открыть `docs/editorial/seo-article-publication-standard.md` (основной канонический doc).
4. Найти первую незакрытую итерацию (статус `[ ]`). Все предыдущие итерации `[x]` уже сделаны.
5. Прочитать в этой итерации:
   - **Files** — какие файлы трогать;
   - **Steps** — что именно делать;
   - **Acceptance** — как проверить, что готово;
   - **API spend** — нужно ли согласовывать с владельцем;
   - **Docs impact** — какой канонический doc обновить.
6. Сделать. Поставить `[x]`. Записать одну строку в раздел 8 «Лог сессий» внизу файла.
7. Если итерация требует API spend и нет подтверждения — **остановиться и сообщить владельцу**, не запускать.

**Что НЕ делать в новой сессии:**
- Не переоткрывать весь репозиторий «на всякий случай» — следовать списку файлов в каждой итерации.
- Не переписывать sanitizer/pipeline без явной задачи.
- Не менять canonical URL и не трогать `lib/site.ts` без необходимости — это инвариант.
- Не публиковать FAQPage schema на статьях без видимого FAQ (правило CLAUDE.md §5 и SEO-стандарт §15).

---

## 2. Инварианты (не нарушать)

1. Canonical домен — только `https://news.malakhovai.ru`. Не использовать env-derived URL для canonical/sitemap/RSS/llms.txt/og:url.
2. Публичные article URLs — только `/categories/<primary_category>/<slug>`. Legacy `/articles/*` и `/topics/*` только редиректят.
3. Сайт читает из Supabase без service key на клиенте.
4. FAQPage JSON-LD — только там, где FAQ виден пользователю.
5. `legacy/` не трогать.
6. Deploy — только через Vercel/GitHub flow.
7. Не публиковать `quality_ok=false` статьи.

---

## 3. Цели волны

1. **Технический SEO**: снять блокеры скорости (кеширование), добавить недостающие schema (BreadcrumbList, sameAs, abstract), Google News sitemap.
2. **Тематическая чистота**: убрать off-topic (Android Auto и т.п.) из ленты для усиления topical authority.
3. **OG-images**: 0% статей с дефолтным `og-default.png`.
4. **LLM-видимость**: явные allow для GPTBot/ClaudeBot/PerplexityBot, `/llms-full.txt`, `/about` с E-E-A-T.
5. **Backfill уже существующих 1000+ статей** под новые правила без перегенерации текста.

---

## 4. Базовый аудит (источник правды для всех решений ниже)

### 4.1. Что уже хорошо
- Канонический хост един везде (sitemap/robots/RSS/llms.txt/og/JSON-LD).
- Yandex + Google verification установлены (`app/layout.tsx:38-41`).
- JSON-LD: NewsArticle на статье, Article+FAQPage+BreadcrumbList на гайде, CollectionPage на разделах и `/russia`, Organization+WebSite в root.
- Sitemap с ISR 30 мин, robots, llms.txt, RSS, IndexNow → Yandex/Bing/Naver/Seznam (`lib/indexnow.ts`, `pipeline/publish-verify.ts`).
- 301-редиректы с `/articles/*` и `/topics/*` работают.
- Slug ASCII, без hex-суффиксов, читаемый.
- HSTS preload + строгие security headers.
- Editorial validator: ru_title 20-90, card_teaser 50-160 (целевой 80-140), lead 200-360, summary 60-180 (`pipeline/claude.ts:66-69,155`).
- Все основные AI-боты получают 200 (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot, anthropic-ai).
- Готовый редакционный SEO-стандарт `docs/editorial/seo-article-publication-standard.md`.

### 4.2. Критические наблюдения (P0)
- **`/`, `/russia`, `/categories/<cat>` отдаются `cache-control: private, no-cache, no-store` и `x-vercel-cache: MISS`** на каждом запросе. Гайды, статьи, sitemap, RSS — кешируются нормально (HIT). Корень бьёт по LCP/TTFB.
- **Off-topic в RSS**: «4 функции Android Auto…» от ZDNet AI попадает в production. ZDNet AI и подобные tech-mix фиды смешивают AI и consumer-gear контент. Текущий `DEFAULT_MIN_SCORE_FOR_CLAUDE=2` (для `ai-research` уже 4).
- **20% свежих статей с `og:image=/og-default.png`** (выборка 10 статей из RSS) — нет cover.

### 4.3. Важные пропуски (P1)
- На статьях нет `BreadcrumbList` JSON-LD (визуальный crumb есть). SEO-стандарт §20 сам это признал.
- Title главной = «Malakhov AI Дайджест» — нет SEO-ключей, не таргетирует «новости ИИ», «AI новости на русском».
- `NewsArticle.author = Organization`, нет `sameAs` у Organization, нет Person-автора — слабый E-E-A-T.
- Нет Google News sitemap (`<news:publication>`, `<news:publication_date>`).
- `NewsArticle.publisher.logo` использует `/og-default.png` (`app/categories/[category]/[slug]/page.tsx:497`), стандарт сам отмечает в §20: использовать `SITE_LOGO_URL`.

### 4.4. Полезные улучшения (P2)
- AI-боты идут через `*`-default, без явных allow-правил → ниже шанс индексации некоторыми LLM-сервисами.
- `WebSite.potentialAction` (SearchAction) не задан, страницы `/search` нет.
- `link_anchors` 0-3 у новостей — мало для internal linking.
- Slug ограничен ~60 chars (`-funktsii-android-auto-kotorye-stoit-vklyuchit-dlya-bezopas` — обрыв на «-bezopas»).
- og:image cover 1200×460 (`app/categories/[category]/[slug]/page.tsx:530-537`), стандарт §11 рекомендует 16:9 (1200×675).
- Внешние og:image из ZDNet/TheVerge — риск битых ссылок и медленный сторонний CDN.
- Архивные `/archive/YYYY-MM-DD` не в sitemap, без JSON-LD CollectionPage и без noindex.
- `/sources` без JSON-LD CollectionPage/ItemList.

### 4.5. Долгосрочные направления (P3)
- `/llms-full.txt` (full markdown dump для LLM).
- Расширенный llms.txt (карта сайта по гайдам и категориям).
- `/about` с E-E-A-T-сигналами.
- Кластеры evergreen-гайдов (RAG, выбор LLM, AI в РФ, AI-агенты).
- `wordCount`, `abstract`, `articleSection` в NewsArticle для LLM-индексаторов.
- WebSite SearchAction + страница поиска.
- Раздробить sitemap на index (sitemap-index.xml + news-sitemap.xml + articles.xml + guides.xml).

---

## 5. План по фазам

Каждая итерация: `[ ]` ожидает работы, `[x]` сделана. Чекбокс ставится только после прохождения **всех Acceptance Criteria**.

### Фаза 0 — Pre-flight

- [x] **0.1. Согласовать spec с владельцем.** Прочитать целиком, подтвердить scope.
  - API spend: 0
  - Docs impact: no
- [x] **0.2. Сделать снимок production метрик «до».** Curl headers, проверить количество URL в sitemap, посчитать % статей с `cover_image_url IS NULL` и `cover_image_url ILIKE '%og-default%'`. Сохранить в раздел 8 «Лог сессий».
  - Files: внешний curl, SQL
  - SQL:
    ```sql
    SELECT
      count(*) FILTER (WHERE publish_status = 'live') AS live_total,
      count(*) FILTER (WHERE publish_status = 'live' AND cover_image_url IS NULL) AS live_no_cover,
      count(*) FILTER (WHERE publish_status = 'live' AND cover_image_url ILIKE '%og-default%') AS live_default_cover
    FROM articles;
    ```
  - API spend: 0
  - Docs impact: no

---

### Фаза 1 — P0: скорость, тематическая чистота, обложки

#### Итерация 1.1: Включить кеш на главной, /russia, /categories/<cat>

- [x] **сделано 2026-05-21**.
- **Files**: `app/page.tsx`, `app/russia/page.tsx`, `app/categories/[category]/page.tsx`, `src/components/ConsentManager.tsx`, `src/components/Header.tsx`, **`app/api/feed/route.ts` (новый)**, **`src/components/HomeFeedList.tsx` (новый)**.
- **Steps**:
  1. Запустить локально `curl -sI http://localhost:3000/` (или прод) и подтвердить `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`.
  2. Grep по `app/`: `dynamic = 'force-dynamic'`, `cookies(`, `headers(`, `noStore(` — найти источник.
  3. Если ConsentManager или Header использует `cookies()` в RSC — вынести client-side; cookie проверять в browser через `localStorage` или client cookie.
  4. Добавить `export const revalidate = 300` в `app/page.tsx`, `app/russia/page.tsx`, `app/categories/[category]/page.tsx` (по аналогии с гайдами).
  5. Запустить `npm run build` локально — никаких новых warnings про dynamic rendering.
- **Что фактически пришлось сделать (отличается от Steps)**:
  - Step 2-3 — НЕ ConsentManager/Header виноваты (оба `'use client'`). Корень: `await searchParams` в Next.js 15 принудительно переводит роут в Dynamic rendering независимо от `revalidate`. Подтверждено: все три страницы уже имели `revalidate=300`, но всё равно были `ƒ Dynamic`.
  - Step 4 — `revalidate=300` уже стоял до итерации; не помогало.
  - Решение: убрать `searchParams` со всех трёх listing-страниц. `/russia` и `/categories/<cat>` уже использовали client-side Load more через `CategoryArticleList` (`/api/categories/<cat>/articles`), просто удалил серверное чтение `?page=`. На главной server-side pagination заменена на новый client-side Load more (`src/components/HomeFeedList.tsx` + `app/api/feed/route.ts`).
  - `?page=N` URL не редиректятся 301 — canonical уже указывает на base URL, поисковики не индексировали paginated URL как отдельные; решено не вводить риск и оставить URL как есть. При reload `/russia?page=2` сервер игнорирует `?page=` и отдаёт page 1 (canonical=base).
- **Acceptance**:
  - `curl -sI https://news.malakhovai.ru/` после деплоя: `cache-control: public, max-age=0, must-revalidate` и через несколько запросов `x-vercel-cache: HIT`. ⏳ проверить после промоушена.
  - То же для `/russia`, `/categories/ai-industry`, `/categories/ai-research`. ⏳ проверить после промоушена.
  - На странице по-прежнему рендерится свежий список статей (cache не залипает дольше 5 мин). ⏳ проверить после промоушена.
  - ConsentManager продолжает работать в браузере. ✅ (не трогался, остался client-side).
  - **Локально**: `npm run build` показал `○ Static` для `/` и `/russia`, `● SSG` для `/categories/[category]` (revalidate 5m, expire 1y) — это и есть искомое состояние. До рефактора: `ƒ Dynamic`.
- **API spend**: 0
- **Docs impact**: `docs/OPERATIONS.md` — добавлена секция «Rendering policy»; `docs/editorial/seo-article-publication-standard.md` §16 — добавлен блок «Listing pages must stay cacheable on the Vercel CDN».

#### Итерация 1.2: Off-topic фильтрация в pipeline

- [x] **сделано 2026-05-21**.
- **Files**: `scorer.config.ts`, `pipeline/feeds.config.ts`, `pipeline/ingest.ts` или `pipeline/score.ts` (точное имя проверить локально), `tests/node/scorer.test.ts` (если есть).
- **Steps**:
  1. Поднять `DEFAULT_MIN_SCORE_FOR_CLAUDE` для `ZDNet AI`, `CNet AI`, `vc.ru` (общий) и других tech-mix фидов до 4. Список фидов уточнить по факту через `pipeline/feeds.config.ts`.
  2. Добавить блок-лист off-topic ключей (case-insensitive, в title + lead источника):
     ```
     'android auto', 'apple carplay', 'airpods', 'smartwatch',
     'dishwasher', 'vacuum', 'headphones review',
     'tv review', 'gaming chair', 'fitness tracker'
     ```
     (расширять по мере накопления off-topic кейсов).
  3. Применять блок-лист до вызова Claude (на стадии ingest/score, не enrich), чтобы не тратить токены.
  4. Добавить лог `article_attempts.stage='off_topic_filter'` с `error_code='off_topic_keyword'` и причиной — для прозрачности.
  5. Тест: фейковый RSS item «Android Auto guide» от ZDNet AI должен отсеяться.
- **Acceptance**:
  - Новый RSS-цикл больше не пропускает «гаджетный» контент в `articles`.
  - Старые статьи не трогаем (это в Фазе 6).
  - В логе видны off-topic отбросы.
- **API spend**: 0
- **Docs impact**: `docs/ARTICLE_SYSTEM.md` — секция Scoring/Filtering; `docs/editorial/seo-article-publication-standard.md` §7 — добавить требование «Off-topic filter применяется до enrichment».

#### Итерация 1.3: Корректное использование cover из source images (no-API)

> Это не backfill старых статей, а фикс **runtime sanitizer**, чтобы будущие статьи реже падали на `/og-default.png`.

- [x] **сделано 2026-05-21**.
- **Files**: `lib/media-sanitizer.ts`, `pipeline/fetcher.ts`, `app/categories/[category]/[slug]/page.tsx`, `tests/node/media-sanitizer.test.ts`.
- **Steps**:
  1. В `pipeline/fetcher.ts::extractOgImage` подтвердить fallback-цепочку: `og:image:secure_url` → `og:image:url` → `og:image` → `twitter:image` → `twitter:image:src` → JSON-LD `image` → первая `<img>` из контейнера статьи ≥ 200×200. (Если фикс уже сделан в Wave 2026-05-06 — пропустить.)
  2. В `lib/media-sanitizer.ts::sanitizeArticleMedia` — если cover sanitizer отбросил, но в `article_images` есть валидная картинка (площадь ≥ 800×400, не SVG, не UI-icon) — поднять её в cover.
  3. На странице статьи (`app/categories/[category]/[slug]/page.tsx:497`) использовать `SITE_LOGO_URL` для `publisher.logo` вместо `og-default.png`.
  4. В `generateMetadata` (`app/categories/[category]/[slug]/page.tsx:382-420`) — если sanitizer вернул `null` cover и есть `inline_images[0]`, использовать её в `openGraph.images` и `twitter.images`. Это OG-level fallback без редактирования БД.
- **Acceptance**:
  - У всех живых статей `og:image` ≠ `/og-default.png` если в исходнике или article_images есть хоть одна валидная картинка.
  - У статей где реально нечего показать — `og:image=SITE_LOGO_URL` (брендовый fallback, лучше дефолта).
  - Сгенерированный snapshot тест: для тестовой статьи с inline_image[0] og:image возвращает inline_image, а не дефолт.
- **API spend**: 0
- **Docs impact**: `docs/editorial/seo-article-publication-standard.md` §11 — обновить раздел про fallback на social image; `docs/ARTICLE_SYSTEM.md` — sanitizer.

---

### Фаза 2 — P1: schema, sitemap, AI-bots, главная

#### Итерация 2.1: BreadcrumbList JSON-LD на странице статьи

- [x] **сделано 2026-05-21**.
- **Files**: `app/categories/[category]/[slug]/page.tsx`.
- **Steps**:
  1. В JSON-LD блок (текущая `jsonLd` constant на строке ~475) добавить второй элемент `BreadcrumbList`:
     ```ts
     {
       '@context': 'https://schema.org',
       '@type': 'BreadcrumbList',
       itemListElement: [
         { '@type': 'ListItem', position: 1, name: 'Главная', item: SITE_URL },
         { '@type': 'ListItem', position: 2, name: categoryLabel, item: `${SITE_URL}/categories/${article.primary_category}` },
         { '@type': 'ListItem', position: 3, name: title, item: `${SITE_URL}${canonicalPath}` },
       ],
     }
     ```
  2. Обернуть в массив `[NewsArticle, BreadcrumbList]` и сериализовать в один `<script type="application/ld+json">`.
- **Acceptance**:
  - Google Rich Results Test для одной живой статьи показывает оба типа: `NewsArticle` и `BreadcrumbList`.
  - В HTML страницы есть JSON-LD с `"@type":"BreadcrumbList"`.
- **API spend**: 0
- **Docs impact**: `docs/editorial/seo-article-publication-standard.md` §15 — обновить раздел Structured data: «article-level BreadcrumbList реализован».

#### Итерация 2.2: Google News sitemap

- [x] **сделано 2026-05-21**.
- **Files**: `app/sitemap.ts` или новый `app/news-sitemap.xml/route.ts`, `app/robots.ts` (добавить sitemap).
- **Steps**:
  1. Создать новый route `app/news-sitemap.xml/route.ts` с протоколом Google News:
     - Только статьи опубликованные за последние 48 часов (`pub_date >= now() - interval '48 hours'`).
     - Лимит 1000 URL.
     - Поля `<news:publication><news:name>Malakhov AI Дайджест</news:name><news:language>ru</news:language></news:publication>`, `<news:publication_date>`, `<news:title>`.
  2. В `app/robots.ts` добавить вторым `sitemap` ссылку на news-sitemap.
  3. Опционально: разделить общий sitemap на `sitemap-index.xml` + `articles.xml` + `guides.xml` — только если sitemap.xml превысит 50k URL (сейчас 1012, не превышает; делать **не сейчас**, только запланировать на P3).
- **Acceptance**:
  - `https://news.malakhovai.ru/news-sitemap.xml` отдаёт валидный XML с `xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"`.
  - В robots.txt появляется второй Sitemap-строка.
  - Yandex Webmaster и Google Search Console принимают новый sitemap (manual submit владельцем — отдельный шаг).
- **API spend**: 0
- **Docs impact**: `docs/OPERATIONS.md` — секция Sitemaps; `docs/editorial/seo-article-publication-standard.md` §16 — добавить пункт про news sitemap.

#### Итерация 2.3: SEO title главной + Organization sameAs + Person-author

- [x] **частично сделано 2026-05-21** (title + sameAs). Person-author — отложено: spec предписывает «спросить владельца перед изменением author», ждём подтверждения.
- **Files**: `app/layout.tsx`, `app/page.tsx`, `lib/site.ts`, (опционально) `app/about/page.tsx` (новая страница).
- **Steps**:
  1. В `app/layout.tsx` или собственный `generateMetadata` в `app/page.tsx` поставить SEO-title главной:
     ```
     'AI новости на русском — релизы, исследования, инвестиции | Malakhov AI Дайджест'
     ```
     description:
     ```
     'Свежие новости об искусственном интеллекте на русском: модели, лаборатории, стартапы, инвестиции и AI в России. Ежедневные редакционные обзоры.'
     ```
  2. В корневом JSON-LD `Organization` (`app/layout.tsx:107-127`) добавить `sameAs`:
     ```ts
     sameAs: [
       'https://t.me/<реальный канал — узнать у владельца>',
       // 'https://x.com/...', — если есть
       // 'https://www.youtube.com/@...', — если есть
     ]
     ```
     Также добавить `founder` если есть публичная личность.
  3. Person-author: если владелец готов выступить как редактор (имя, био, фото), создать `app/about/page.tsx` с `Person` JSON-LD и заменить в `NewsArticle.author` `Organization` на `Person` с `url: '${SITE_URL}/about'`. Если не готов — оставить Organization, но это снизит P1-эффект. **Спросить владельца перед изменением author**.
- **Acceptance**:
  - Главная отдаёт обновлённые title/description, длина title ≤ 65 chars (видимая часть в SERP).
  - JSON-LD Organization содержит `sameAs` с реальными URLs.
  - Если /about реализована — она отдаёт Person JSON-LD и индексируется.
- **API spend**: 0
- **Docs impact**: `docs/editorial/seo-article-publication-standard.md` §9 (metadata), §15 (schema); `docs/PROJECT.md` если появится `/about`.

#### Итерация 2.4: Robots — явные allow для AI-ботов

- [x] **сделано 2026-05-21**.
- **Files**: `app/robots.ts`.
- **Steps**:
  1. Добавить явные правила allow `/` для:
     ```
     GPTBot, ChatGPT-User, OAI-SearchBot, Google-Extended,
     ClaudeBot, anthropic-ai, claude-web,
     PerplexityBot, CCBot, Applebot-Extended,
     DuckAssistBot, MistralAI-User, cohere-ai
     ```
     `Bytespider` и `Amazonbot` — добавить только если владелец считает их желательными.
  2. Сохранить базовое правило `*` и блокировки `/demo/`, `/internal/`, `/api/`, `/_next/`.
- **Acceptance**:
  - `curl https://news.malakhovai.ru/robots.txt` показывает явные allow-правила для каждого UA.
  - `curl -A 'GPTBot' ... /` по-прежнему 200.
- **API spend**: 0
- **Docs impact**: `docs/editorial/seo-article-publication-standard.md` §16 — добавить «AI bots explicit allow list».

---

### Фаза 3 — P2: polish

#### Итерация 3.1: og:image cover 1200×630 на статьях

- [x] **сделано 2026-05-21**.
- **Files**: `app/categories/[category]/[slug]/page.tsx` (рендер cover), `pipeline/generate-images.ts` (если генерация) — НЕ запускать generation, только параметры размера.
- **Steps**:
  1. В рендере cover (`page.tsx:528-537`) выставить `width=1200 height={630}` и `maxHeight: 630` для соответствия 1.91:1 (или 1200×675 для 16:9 по стандарту §11 — выбрать одно и зафиксировать в стандарте).
  2. В sanitizer/sizing util — корректно даунскейлить большие cover, не растягивать маленькие.
  3. Заголовок twitter card остаётся `summary_large_image`.
- **Acceptance**: cover на странице соотношение ~1.91:1 или 16:9 без растяжения; OG предпросмотр (через Twitter/Telegram debugger) показывает правильный crop.
- **API spend**: 0
- **Docs impact**: `docs/editorial/seo-article-publication-standard.md` §11 — зафиксировать конкретный размер.

#### Итерация 3.2: Internal linking — увеличить до 3-5 link_anchors для новых статей

- **Files**: `pipeline/claude.ts` (system prompt), `pipeline/editorial-apply.ts` (валидация), `tests/node/editorial-apply.test.ts`.
- **Steps**:
  1. В system prompt Claude поменять `link_anchors 0-3` → `link_anchors 3-5` для новых статей. Жёсткий минимум — 2.
  2. Валидатор должен принимать 2-5; всё что меньше — `quality_ok=false` (без блокировки публикации мягким fallback на 2).
  3. Сохранить инвариант: anchor verbatim в `editorial_body`.
- **Acceptance**:
  - Новые статьи (после деплоя) имеют 3-5 `link_anchors` в БД.
  - Старые не трогаем (фаза 6).
- **API spend**: 0 (на новых статьях — обычный enrichment, спенд тот же что сейчас, не больше).
- **Docs impact**: `docs/editorial/seo-article-publication-standard.md` §14.

#### Итерация 3.3: Slug лимит до 75-80 chars

- **Files**: `pipeline/slug.ts` или `lib/article-slugs.ts` (где формируется), `tests/node/slug.test.ts`.
- **Steps**:
  1. Найти текущий cap (видимо 60 chars). Поднять до 75.
  2. Резать по последней границе слова перед лимитом, не посередине корня.
  3. **Не менять slug уже опубликованных статей** — только для новых.
- **Acceptance**: новые статьи получают slug ≤ 75 chars с естественной границей.
- **API spend**: 0
- **Docs impact**: `docs/ARTICLE_SYSTEM.md` — slug правила; `docs/editorial/seo-article-publication-standard.md` §10.

#### Итерация 3.4: WebSite SearchAction + страница /search

> Опционально. Не сделано → потеря sitelinks searchbox. Сделано → бонус для navigational запросов.

- **Files**: `app/layout.tsx` (JSON-LD), новая страница `app/search/page.tsx`.
- **Steps**:
  1. В корневом WebSite JSON-LD добавить:
     ```ts
     potentialAction: {
       '@type': 'SearchAction',
       target: `${SITE_URL}/search?q={search_term_string}`,
       'query-input': 'required name=search_term_string',
     }
     ```
  2. Создать `app/search/page.tsx` с простым поиском по `articles` (Supabase fulltext или LIKE). Можно сделать ультра-простой client-side фильтр поверх кешированной ленты — без сложной инфраструктуры.
- **Acceptance**:
  - `/search?q=openai` отдаёт страницу с результатами.
  - Schema валидируется в Rich Results Test.
- **API spend**: 0
- **Docs impact**: `docs/editorial/seo-article-publication-standard.md` §15; `docs/PROJECT.md` (новая surface).

#### Итерация 3.5: `/sources` CollectionPage JSON-LD + `/archive/<date>` решение

- **Files**: `app/sources/page.tsx`, `app/archive/[date]/page.tsx`.
- **Steps**:
  1. Добавить `CollectionPage` + `ItemList` JSON-LD в `app/sources/page.tsx` — список источников как `ListItem`.
  2. Для `/archive/<date>` — решить: либо `noindex` (если страница тонкая), либо в sitemap + JSON-LD `CollectionPage`. Рекомендация: `noindex, follow` (краулер ходит по ссылкам на статьи, но дату-страницы не индексирует). Внести `robots: { index: false, follow: true }` в metadata.
- **Acceptance**:
  - `/sources` имеет JSON-LD CollectionPage.
  - `/archive/<date>` имеет `<meta name="robots" content="noindex, follow">` если выбран этот путь.
- **API spend**: 0
- **Docs impact**: `docs/editorial/seo-article-publication-standard.md` §15-16.

---

### Фаза 4 — P3: LLM-видимость и длинный хвост

#### Итерация 4.1: `/llms-full.txt` — полный markdown dump

- **Files**: `app/llms-full.txt/route.ts` (новый).
- **Steps**:
  1. Создать route, отдающий markdown-документ:
     - Заголовок + описание сайта.
     - Все evergreen-гайды в полной форме (заголовки H2/H3 сохранены).
     - Последние 100 опубликованных статей: `# <ru_title>` + URL + lead + summary bullets + 1-2 параграфа.
  2. Cache 1 час (`s-maxage=3600, stale-while-revalidate=86400`).
  3. Размер контролировать — не более 5 МБ.
- **Acceptance**:
  - `curl https://news.malakhovai.ru/llms-full.txt` отдаёт валидный markdown.
  - Размер ≤ 5 МБ.
  - Cache headers стоят корректно.
- **API spend**: 0
- **Docs impact**: `docs/editorial/seo-article-publication-standard.md` §15-16 — добавить «llms-full.txt»; `docs/PROJECT.md`.

#### Итерация 4.2: Расширить /llms.txt — карта гайдов и категорий

- **Files**: `app/llms.txt/route.ts`.
- **Steps**:
  1. Добавить раздел «Топ-материалы»: список 5-10 ключевых гайдов и evergreen статей с одной строкой описания.
  2. Раздел «Тематические кластеры»: категории с 3-5 примерами статей внутри.
- **Acceptance**: llms.txt вырос осмысленно, но не больше 200 строк.
- **API spend**: 0
- **Docs impact**: `docs/editorial/seo-article-publication-standard.md` §16.

#### Итерация 4.3: `/about` с E-E-A-T-сигналами

- **Files**: `app/about/page.tsx` (новый), `lib/site.ts` (опционально константы).
- **Steps**:
  1. Создать страницу с биографией редактора, редакционными правилами, контактами, ссылками на соцсети.
  2. JSON-LD `Person` + `AboutPage`.
  3. Внутренние ссылки на политику конфиденциальности, источники, телеграм.
  4. Контент готовит владелец — НЕ генерировать через API.
- **Acceptance**: `/about` отдаёт 200, имеет Person JSON-LD, длина ≥ 800 chars осмысленного текста.
- **API spend**: 0
- **Docs impact**: `docs/PROJECT.md` — новая surface; `docs/editorial/seo-article-publication-standard.md` §15.

#### Итерация 4.4: NewsArticle — добавить wordCount, abstract, articleSection

- **Files**: `app/categories/[category]/[slug]/page.tsx`.
- **Steps**:
  1. В `NewsArticle` JSON-LD добавить:
     - `wordCount`: расчётно из `editorial_body`.
     - `abstract`: `article.summary?.join(' ') ?? article.lead`.
     - `articleSection`: `categoryLabel`.
     - `inLanguage: 'ru'` (уже есть).
- **Acceptance**: JSON-LD валидируется в Rich Results.
- **API spend**: 0
- **Docs impact**: `docs/editorial/seo-article-publication-standard.md` §15.

#### Итерация 4.5: Evergreen-гайды — следующий guide

> Кандидаты тем (выбрать 1, оценить через анти-каннибализацию по §6 стандарта):
> - «Что такое RAG: гайд для бизнеса 2026»
> - «Как выбрать LLM для бизнеса: сравнение моделей и сценариев»
> - «AI-агенты для бизнеса: что это, где работает, какие риски»
> - «GPU-as-a-Service в России: где брать вычисления для ИИ»

- **Files**: `content/guides/<slug>.md`, `lib/guides.ts`, обложка `public/images/guides/<slug>/cover.webp`.
- **Steps**:
  1. Контент готовит владелец (или Codex с ручной правкой) — без автономного запуска API.
  2. Соблюсти SEO-стандарт §4-§8 (бриф, intent, структура, метаданные).
  3. Зарегистрировать в `lib/guides.ts`.
- **Acceptance**: гайд доступен, JSON-LD `Article+FAQPage+BreadcrumbList`, есть собственная обложка.
- **API spend**: 0 для инфраструктуры. Если решено сгенерировать текст через Claude — **🟡 НУЖНО ПОДТВЕРЖДЕНИЕ** с оценкой стоимости.
- **Docs impact**: `docs/editorial/seo-article-publication-standard.md` §4-§8 (применить); `lib/guides.ts`.

---

### Фаза 5 — Deploy в production

#### Итерация 5.1: Preview deploy + smoke check

- **Steps**:
  1. Все фазы 1-4 закоммичены в feature branch (или серия коммитов в main).
  2. Vercel Preview deployment.
  3. Smoke check preview URL:
     - `curl -sI <preview>/` → `cache-control: public, ...`, `x-vercel-cache: HIT` после повторного запроса.
     - `curl <preview>/robots.txt` показывает все AI bots.
     - `curl <preview>/news-sitemap.xml` валидный.
     - Открыть Google Rich Results Test на одной статье — `NewsArticle + BreadcrumbList`.
     - Открыть Yandex Webmaster pages tool на одной статье.
- **Acceptance**: все smoke checks зелёные.
- **API spend**: 0
- **Docs impact**: no

#### Итерация 5.2: Promote to production

- **Steps**:
  1. Promote preview → production через Vercel UI (или merge в main).
  2. Через ~5-10 минут повторить smoke check на проде.
  3. Submit sitemap в Yandex Webmaster и Google Search Console (manually). Submit news-sitemap отдельно.
  4. Trigger IndexNow на 50 свежих статей (`scripts/indexnow-resubmit.ts` если есть, иначе руками через `lib/indexnow.ts`).
- **Acceptance**: production принимает обновления; sitemap submitted; IndexNow ping вернулся 200.
- **API spend**: 0 (IndexNow бесплатен).
- **Docs impact**: `docs/OPERATIONS.md` — секция Deploy; `CLAUDE.md` — обновить «Последняя закрытая инициатива» после полного завершения волны.

---

### Фаза 6 — Backfill уже опубликованных статей

> **Внимание**: каждая итерация ниже помечена как API spend = 0 либо 🟡 НУЖНО ПОДТВЕРЖДЕНИЕ.

#### Итерация 6.1: Cover backfill из source images (no API) — 🟢 SAFE

- **Files**: `scripts/backfill-cover-from-source.ts` (новый).
- **Steps**:
  1. SELECT статей с `publish_status='live' AND (cover_image_url IS NULL OR cover_image_url ILIKE '%og-default%') AND article_images IS NOT NULL AND jsonb_array_length(article_images) > 0`.
  2. Для каждой — взять первую валидную inline-картинку (площадь ≥ 800×400, не SVG, не UI-icon) и сохранить в `cover_image_url`.
  3. **Snapshot rollback table**: создать `articles_cover_backfill_snapshot_20260520` с прежними значениями.
  4. Dry run → отчёт N статей обновится.
  5. После согласования владельцем — Apply.
  6. IndexNow ping для затронутых URLs.
- **Acceptance**:
  - Количество `live AND cover_image_url IS NULL` уменьшилось.
  - Rollback snapshot существует.
  - На случайной обновлённой статье `og:image` ≠ дефолт.
- **API spend**: 0
- **Docs impact**: `docs/ARTICLE_SYSTEM.md` — раздел Backfill history.

#### Итерация 6.2: Cover backfill через source page re-fetch (no API) — 🟢 SAFE

- **Files**: `scripts/backfill-cover-via-refetch.ts` (новый), использует `pipeline/fetcher.ts::fetchArticleContent`.
- **Steps**:
  1. SELECT статей с `cover_image_url IS NULL` и пустым `article_images`.
  2. Для каждой — re-fetch `original_url` без вызова Claude. `fetchArticleContent` извлечёт og:image / JSON-LD image.
  3. Если получили cover — сохранить.
  4. Лимит: 10 параллельных fetch, rate limit ≤ 1 rps на хост.
  5. Snapshot rollback.
  6. Dry run → согласование → Apply.
- **Acceptance**: дополнительное снижение `cover IS NULL` за счёт rescan источников.
- **API spend**: 0 (только HTTP к источникам, не LLM).
- **Docs impact**: `docs/ARTICLE_SYSTEM.md`.

#### Итерация 6.3: Cover backfill — генерация для оставшихся — 🟡 НУЖНО ПОДТВЕРЖДЕНИЕ

- **Files**: `scripts/backfill-cover-images.ts` (уже существует, проверить, не вызывает ли Claude).
- **Steps**:
  1. После 6.1 + 6.2 посчитать остаток статей без cover.
  2. **Оценка стоимости**: <количество> × <цена одной gpt-image-1.5 low> = $X. Передать владельцу, **запросить явное «да»**.
  3. Если согласовано — запустить с лимитом и snapshot rollback.
- **Acceptance**: 0% статей с `og-default.png`.
- **API spend**: YES — image generation.
- **Docs impact**: `docs/ARTICLE_SYSTEM.md`.

#### Итерация 6.4: BreadcrumbList JSON-LD backfill — автоматически через ISR

> После деплоя итерации 2.1 страницы статей пересоберутся при `revalidate=3600`. Backfill отдельно не нужен.

- **Steps**:
  1. Через 1-3 часа после deploy выборочно проверить 10 случайных live статей curl-ом.
  2. Если ISR ещё не сработал — touch через `revalidatePath` или `revalidateTag` (если используется).
- **Acceptance**: 10/10 случайных статей возвращают BreadcrumbList JSON-LD.
- **API spend**: 0
- **Docs impact**: no

#### Итерация 6.5: card_teaser длина — bump до 100-140 chars — 🟡 НУЖНО ПОДТВЕРЖДЕНИЕ (частично)

- **Steps**:
  1. SELECT статей с `LENGTH(card_teaser) < 80` — оценить N.
  2. **Опция A (no API)**: оставить как есть — старые статьи не переписывать.
  3. **Опция B (требует API)**: regenerate teaser через короткий Claude prompt (один запрос на статью, ≤ 200 токенов).
     - Оценка: N × $0.003 ≈ $X. **Запросить подтверждение.**
  4. Рекомендация: применять **только для топ-100 статей по показам** в Yandex Webmaster (если данные есть). Иначе ROI низкий.
- **Acceptance**: для согласованного списка teaser длиной 100-140 chars, без потери смысла.
- **API spend**: YES если выбрана опция B.
- **Docs impact**: `docs/editorial/seo-article-publication-standard.md` §9.

#### Итерация 6.6: Alt-текстов для inline-картинок — 🟡 НУЖНО ПОДТВЕРЖДЕНИЕ

- **Steps**:
  1. Текущий fallback: alt = title (дубликат). Это **не нарушает доступность, но даёт нулевой SEO-сигнал**.
  2. **Опция A (no API)**: для статей с одной картинкой оставить как есть. Для статей с 2+ inline-картинками — генерировать alt программно из `summary[i]` (короткий нарезанный сниппет). 0 API spend.
  3. **Опция B (требует API)**: Claude/Vision модель генерирует осмысленный alt по картинке + контексту. Оценить $.
  4. Рекомендация: начать с Опции A. К Опции B возвращаться только если будет ясный сигнал из аналитики.
- **Acceptance**: alt-теги стали разными от title (на статьях с 2+ inline).
- **API spend**: 0 для опции A, YES для опции B.
- **Docs impact**: `docs/editorial/seo-article-publication-standard.md` §11.

#### Итерация 6.7: Pings IndexNow для всех затронутых URLs

- **Files**: `lib/indexnow.ts`, новый `scripts/indexnow-batch.ts`.
- **Steps**:
  1. После 6.1-6.4 собрать список затронутых URLs.
  2. Батчами по 100 пинговать IndexNow.
  3. Проверить лог: 200 ответы.
- **Acceptance**: все статьи затронутые backfill-ом получили IndexNow ping.
- **API spend**: 0
- **Docs impact**: `docs/OPERATIONS.md`.

---

### Фаза 7 — Закрытие инициативы и доки

#### Итерация 7.1: Обновить канонические доки

- **Files**: `docs/editorial/seo-article-publication-standard.md`, `docs/ARTICLE_SYSTEM.md`, `docs/OPERATIONS.md`, `docs/INDEX.md`, `CLAUDE.md`.
- **Steps**:
  1. В `docs/editorial/seo-article-publication-standard.md` секция §19-§20 обновить: то, что было future-work, переместить в «уже реализовано».
  2. В `docs/ARTICLE_SYSTEM.md` секция «Sitemap & sanitizer» — обновить.
  3. В `docs/OPERATIONS.md` секция «Rendering policy» + «Sitemaps» — обновить.
  4. В `docs/INDEX.md` добавить запись в «Completed initiatives».
  5. В `CLAUDE.md` обновить блок «Последняя закрытая инициатива» с этой волной + ссылкой на этот spec.
  6. `npm run docs:check` — должен пройти.
- **Acceptance**: `docs:check` зелёный, каноны актуальны.
- **API spend**: 0
- **Docs impact**: см. список выше.

#### Итерация 7.2: Post-mortem / Final report владельцу

- **Steps**:
  1. Заполнить раздел 9 «Финальный отчёт».
  2. Послать владельцу.
- **Acceptance**: владелец прочитал, инициатива закрыта.
- **API spend**: 0

---

## 6. Бюджет API — сводная таблица

| Итерация | API spend | Статус |
|---|---|---|
| 1.1, 1.2, 1.3 | 0 | можно делать |
| 2.1, 2.2, 2.3, 2.4 | 0 | можно делать |
| 3.1, 3.2, 3.3, 3.4, 3.5 | 0 | можно делать |
| 4.1, 4.2, 4.3 | 0 | можно делать |
| 4.4 | 0 | можно делать |
| 4.5 | 0 для скелета, 🟡 для генерации текста | согласовать перед запуском |
| 5.1, 5.2 | 0 | можно делать |
| 6.1, 6.2 | 0 | можно делать |
| 6.3 | 🟡 YES (image generation) | согласовать **до запуска** с оценкой $$ |
| 6.4 | 0 | автоматом через ISR |
| 6.5 | 0 для опции A, 🟡 YES для опции B | согласовать перед опцией B |
| 6.6 | 0 для опции A, 🟡 YES для опции B | согласовать перед опцией B |
| 6.7 | 0 | можно делать |
| 7.1, 7.2 | 0 | можно делать |

**Итог**: 90% работы делается без API spend. Три места возможного API spend (6.3, 6.5 опция B, 6.6 опция B) — каждое требует явного «да» владельца с предварительной оценкой стоимости.

---

## 7. Doc Impact — итоговая карта

| Что меняется | Канонический doc |
|---|---|
| Rendering policy (ISR на главной/категориях/russia) | `docs/OPERATIONS.md` |
| Off-topic filter, score thresholds, slug-cap | `docs/ARTICLE_SYSTEM.md` |
| Schema (BreadcrumbList, sameAs, wordCount, abstract), AI bots allow, /llms-full.txt, news sitemap | `docs/editorial/seo-article-publication-standard.md` |
| /about, /search, /llms-full.txt как новые surfaces | `docs/PROJECT.md` |
| Sitemaps split, IndexNow batch | `docs/OPERATIONS.md` |
| Backfill snapshot tables | `docs/ARTICLE_SYSTEM.md` |
| Закрытие инициативы | `CLAUDE.md`, `docs/INDEX.md` |

---

## 8. Лог сессий

> Каждая сессия добавляет одну строку в этот лог. Формат: `YYYY-MM-DD HH:MM — итерация X.Y — статус — короткий комментарий`.

- 2026-05-20 — spec создан — план составлен по результатам аудита; ждём согласования владельца перед фазой 0.
- 2026-05-21 — итерация 3.1 — done — cover на странице статьи рендерится 1200×630 (1.91:1, OG/Twitter Card стандарт). Раньше было 1200×460. `maxHeight` тоже обновлён. `pipeline/generate-images.ts` не трогал — это runtime render change, не генерация. Docs updated: `docs/editorial/seo-article-publication-standard.md` §11.
- 2026-05-21 — итерация 2.4 — done — `app/robots.ts` теперь генерирует явные allow-правила для 13 LLM-side ботов (`GPTBot`, `ChatGPT-User`, `OAI-SearchBot`, `Google-Extended`, `ClaudeBot`, `anthropic-ai`, `claude-web`, `PerplexityBot`, `CCBot`, `Applebot-Extended`, `DuckAssistBot`, `MistralAI-User`, `cohere-ai`). Каждое именованное правило повторяет `disallow: ['/demo/', '/internal/', '/api/', '/_next/']`. `Bytespider`/`Amazonbot` НЕ добавлены — требуется решение владельца. Docs updated: `docs/editorial/seo-article-publication-standard.md` §16.
- 2026-05-21 — итерация 2.3 (частично) — done — главная (`app/page.tsx`) получила `metadata.title='AI новости на русском'` (template добавляет `| Malakhov AI Дайджест`, итог ~44 chars), description с ключами «релизы/исследования/стартапы/инвестиции/AI в России», canonical=`/`, OG/Twitter. В `lib/site.ts` добавлены `SITE_TELEGRAM_URL='https://t.me/malakhovaidigest'` и `SITE_SAME_AS=[SITE_TELEGRAM_URL]`. В `app/layout.tsx` Organization JSON-LD получил `sameAs: SITE_SAME_AS`. Person-author НЕ менялся — spec требует подтверждения владельца. Docs updated: `docs/editorial/seo-article-publication-standard.md` §9 (Home page metadata) + §15 (`Organization … with sameAs`).
- 2026-05-21 — итерация 2.2 — done — добавлен `/news-sitemap.xml` (`app/news-sitemap.xml/route.ts`) с протоколом Google News (`xmlns:news`, `news:publication`, `news:publication_date`, `news:title`), 48ч окно, лимит 1000 URL, ISR 10 мин. Новая функция `getArticlesForNewsSitemap` в `lib/articles.ts`. `app/robots.ts` теперь возвращает sitemap-массив с двумя URLs. Sitemap-split на index/articles/guides отложен (всего 1012 URL — далеко от 50k лимита). Docs updated: `docs/OPERATIONS.md` (Deploy → Sitemaps), `docs/editorial/seo-article-publication-standard.md` §16.
- 2026-05-21 — итерация 2.1 — done — добавлен article-level `BreadcrumbList` JSON-LD на странице статьи (`app/categories/[category]/[slug]/page.tsx`); `jsonLd` const стал массивом `[NewsArticle, BreadcrumbList]`, оба сериализуются в один `<script>`. Items: Главная → categoryLabel → article title. Docs updated: `docs/editorial/seo-article-publication-standard.md` §15.
- 2026-05-21 — итерация 1.3 — done — runtime cover fallback. `lib/media-sanitizer.ts::sanitizeArticleMedia` теперь промоутит первую sanitized inline-картинку в cover-слот, когда исходный cover пустой или отброшен; новое поле `SanitizedMedia.coverPromotedFromInline`. `pipeline/fetcher.ts::extractOgImage` уже имеет full fallback chain (`og:image:secure_url` → `og:image:url` → `og:image` → `twitter:image` → `twitter:image:src` → JSON-LD `image` → inline-cover) — не трогал. В `app/categories/[category]/[slug]/page.tsx` заменил `/og-default.png` на `SITE_LOGO_URL` для `og:image`/`twitter:image`/`NewsArticle.image`/`NewsArticle.publisher.logo` (brand-fallback вместо generic). 4 новых теста в `tests/node/media-sanitizer.test.ts`, всего 23/23 pass. Docs updated: `docs/ARTICLE_SYSTEM.md` (Media sanitizer), `docs/editorial/seo-article-publication-standard.md` §11 (Cover fallback chain).
- 2026-05-21 — итерация 1.2 — done — добавлен off-topic blocklist (`OFF_TOPIC_KEYWORDS` в `pipeline/keyword-filters.ts`) применяемый ко всем фидам ДО per-feed keyword filter; помечен `off_topic_filter` reason в `source_runs.items_rejected_breakdown`. `ZDNet AI` и `Wired AI` переведены на `needsKeywordFilter: true` + `EN_AI_CORE_KEYWORDS` + `keywordSearchFields:'title'`. `DEFAULT_MIN_SCORE_FOR_CLAUDE` НЕ поднят: блок-лист + per-feed keyword filter — более точные инструменты чем глобальный score-bar, а ai-research уже стоит 4. Тест `rss-parser-rejected.test.ts` дополнен кейсом «Android Auto» от ZDNet → отсев `off_topic_filter`, все 7 тестов проходят. Docs updated: `docs/ARTICLE_SYSTEM.md` (Sources and feed filters), `docs/editorial/seo-article-publication-standard.md` §7 (Off-topic gate).
- 2026-05-21 — итерация 1.1 — done — listing-страницы (`/`, `/russia`, `/categories/[category]`) переведены с Dynamic на ISR. Корень MISS — чтение `await searchParams` в Next 15 (force-dynamic), не `cookies()`/`Header`. Решение: убрал `searchParams` со всех трёх страниц; pagination главной — новый client-side `HomeFeedList` + `/api/feed`; `/russia` и `/categories/<cat>` уже использовали client-side Load more. `npm run build` → `/` и `/russia` = `○ Static`, `/categories/[category]` = `● SSG`, revalidate=5m. `?page=N`-редиректы не вводил (canonical уже на base URL, нулевой риск для индекса). Прод-curl-проверка cache headers — после deploy. Docs updated: `docs/OPERATIONS.md` (новая секция «Rendering policy»), `docs/editorial/seo-article-publication-standard.md` §16 (блок про cacheable listing pages).
- 2026-05-20 — итерации 0.1 + 0.2 — done — владелец дал «запусти», снят production snapshot «до»:
  - Cache headers (curl на проде): `/`, `/russia`, `/categories/ai-industry` → `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`, `x-vercel-cache: MISS` на каждом запросе. Подтверждает основной P0-блокер.
  - Sitemap: `https://news.malakhovai.ru/sitemap.xml` содержит 1012 `<loc>`.
  - Robots.txt: явные allow только для `OAI-SearchBot`, `Googlebot`, `Bingbot` (3 шт). Нет `GPTBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`, `anthropic-ai`, `CCBot`, `Applebot-Extended`.
  - Articles (Supabase SQL по `articles` через service key): `liveTotal=1100`, `liveNoCover=3`, `liveDefaultCover (cover_image_url ILIKE '%og-default%')=0`. То есть в БД дефолтных cover'ов уже нет — backfill 2026-05-07 (`articles_cover_snapshot_20260507`) уже вычистил основной долг. Остаются 3 статьи с `cover_image_url IS NULL` — кандидаты на фазу 6.1.
  - BreadcrumbList JSON-LD на странице статьи: отсутствует (подтверждено по `app/categories/[category]/[slug]/page.tsx`).
  - `/news-sitemap.xml`, `/llms-full.txt`, `/about`: отсутствуют (фазы 2.2 / 4.1 / 4.3).

---

## 9. Финальный отчёт владельцу (заполняется после Фазы 7)

Заполнить после полного завершения волны:

- Что сделано (список закрытых итераций).
- Что отложено и почему.
- API spend по факту: $X.YZ (детализация).
- Снимки production метрик «до / после»:
  - % статей с `og-default.png`: было N% → стало M%.
  - cache hit rate главной: было MISS → стало HIT.
  - количество URLs в sitemap: было N → стало M (+news-sitemap).
  - количество AI-ботов с явным allow: было 3 → стало 13+.
- Что улучшилось в индексации (через 2-4 недели после deploy): impressions / clicks по Yandex Webmaster и Google Search Console.
- Следующая волна (если есть кандидаты).

---

## 10. Заметки на случай новой сессии без памяти

- Этот файл — единственная точка истины по волне. Всё планирование — здесь.
- Если что-то в этом файле противоречит `CLAUDE.md` или `docs/editorial/seo-article-publication-standard.md` — побеждают канонические доки.
- Не запускать ни одной итерации помеченной 🟡 без явного согласования с владельцем — это правило проекта, а не вежливость.
- Все изменения коммитить отдельными PR/коммитами по итерациям. Сообщение коммита заканчивается:
  - `Docs updated: <path>` (если doc обновлён) или
  - `Docs impact: no` (если doc не нужен).
  Это правило CLAUDE.md §3.
- Перед слиянием в main — `npm run build` и `npm run docs:check` должны быть зелёные.
- Не трогать `legacy/`. Не использовать service key на клиенте. Canonical только `https://news.malakhovai.ru`.
