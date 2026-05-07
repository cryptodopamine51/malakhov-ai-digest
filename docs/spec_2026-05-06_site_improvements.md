# Site Improvements — Spec 2026-05-06

> Дата: 2026-05-06
> Источник: задачи владельца на доработку news.malakhovai.ru от 2026-05-06.
> Тип: временная спецификация. После реализации каждой волны — переносить итоги в канонические docs (`ARTICLE_SYSTEM.md`, `DESIGN.md`, `OPERATIONS.md`, `editorial_style_guide.md`) и удалять из этого файла выполненные пункты.
> Связанные документы: `docs/ARTICLE_SYSTEM.md` (media policy, sanitizer, sort policy), `docs/DESIGN.md` (UI), `docs/editorial_style_guide.md` (редакционные правила), `docs/task_vcru_ingestion_debug_2026-05-02.md` (диагностика vc.ru).

---

## Жёсткое правило: бюджет API = 0

**Эта волна не должна тратить ни одного цента Anthropic API.**

- Никаких `npx tsx scripts/reenrich-all.ts`, `enricher.ts`, `enrich-submit-batch.ts`, `enrich-collect-batch.ts`.
- Все backfill'ы по картинкам — только через прямой HTTP-фетч исходника и пересохранение `cover_image_url` / `article_images` в БД. Это `pipeline/fetcher.ts::fetchArticleContent` без вызова Claude.
- Любая логика, требующая повторной генерации текста (например, переписать a16z-crypto статью), — фиксируется как **правило для будущих статей**, а не как backfill через API.

Если разработчик в какой-то задаче считает, что нужен повторный enrichment — поставить задачу на паузу и согласовать с владельцем.

---

# Сводная таблица задач

| # | Задача | Тип | Канонический doc для апдейта |
|---|---|---|---|
| 1 | Cover-картинки не подтягиваются (MIT TR + другие). Фикс fetcher + sanitizer + backfill без API. | Bug + backfill | `docs/ARTICLE_SYSTEM.md` |
| 2 | vc.ru — проверить ingestion, продолжить расследование из `task_vcru_ingestion_debug_2026-05-02.md`. | Bug | `docs/ARTICLE_SYSTEM.md` |
| 3 | Тупые SVG-иконки (стрелки, share/icon) попадают в карточку статьи (CNews и аналоги). Фикс sanitizer + backfill. | Bug + backfill | `docs/ARTICLE_SYSTEM.md` |
| 4 | Редакционный разбор a16z-crypto: статья читается криво. Сформулировать правило структуры. | Editorial | `docs/editorial_style_guide.md` |
| 5 | Альтернативы Anthropic API (дешевле, качество ≥). Только варианты, без выбора. | Research | — |
| 6 | «Все новости» на главной — сортировка по `created_at desc` (а не по score). | UX | `docs/ARTICLE_SYSTEM.md` |
| 7 | «Самое интересное» во вкладках — пересмотр периодически, не залипает. | UX | `docs/ARTICLE_SYSTEM.md` |
| 8 | Лента раздела — сортировка по `created_at desc` (сейчас по `pub_date`). | UX | `docs/ARTICLE_SYSTEM.md` |
| 9 | Убрать sticky-заголовок при скролле на странице статьи. | UI | `docs/DESIGN.md` |
| 10 | Источник в левой колонке статьи — синим (accent), не серо-чёрным. | UI | `docs/DESIGN.md` |

---

# 1. Cover-картинки не подтягиваются — фикс и backfill без API

## 1.1. Симптом

Статья https://news.malakhovai.ru/categories/ai-research/mit-technology-review-mezhdu-khaypom-ii-i-pribylyu-nedostayu — `cover_image_url` пуст или отброшен sanitizer'ом, на странице статьи нет обложки. По наблюдениям владельца — это не единичный случай: у части статей обложек нет вообще.

## 1.2. Где может «теряться» картинка

Проследить путь: `pipeline/fetcher.ts::fetchArticleContent` → `articles.cover_image_url` (из `imageUrl` = og:image) → `lib/media-sanitizer.ts::sanitizeArticleMedia` (на render) → страница статьи `app/categories/[category]/[slug]/page.tsx`.

| Точка | Что может отсечь | Файл / строки |
|---|---|---|
| A | `extractOgImage` возвращает `null` если у источника нет `meta[property="og:image"]` (например, Twitter-only `meta name="twitter:image"`). | `pipeline/fetcher.ts:75-81` |
| B | `extractOgImage` берёт `content` без абсолютизации — если URL относительный (`/static/...`), он сохранится как relative и может отрабатывать только частично. | `pipeline/fetcher.ts:75-81` (нужно `absolutizeUrl(content, url)`) |
| C | `extractInlineImages` отрезает картинки `< 50×50` и URL по regex `pixel\|tracking\|beacon\|logo\|icon\|avatar\|badge` — это ОК. Но *внутри* контейнера статьи у MIT TR изображения часто лежат в `<picture>` или с `data-srcset` без `width/height` — они могут потеряться. | `pipeline/fetcher.ts:159-208` |
| D | `sanitizeArticleMedia` отбрасывает cover при `looksLikeTextCover` (только для Habr AI / vc.ru / CNews) и `banner_ratio` (≥2.8). Для MIT TR не должно срабатывать, но проверить логи `media_sanitize` attempts. | `lib/media-sanitizer.ts:182-228` |
| E | Страница статьи `app/categories/[category]/[slug]/page.tsx:521` показывает cover только если `(!SOURCES_WITH_TEXT_COVERS.has(article.source_name) || isArticleImagesStorageUrl(...))`. Для не-русских источников блокировка не срабатывает. | `app/categories/[category]/[slug]/page.tsx:521-533` |

## 1.3. Что сделать

### Этап 1 — диагностика конкретной статьи (без кода)

1. SQL:
   ```sql
   SELECT id, slug, source_name, original_url,
          cover_image_url,
          jsonb_array_length(coalesce(article_images::jsonb, '[]'::jsonb)) AS img_count,
          enrich_status, publish_status, quality_ok
   FROM articles
   WHERE slug LIKE 'mit-technology-review-mezhdu-khaypom%'
   LIMIT 1;
   ```
2. SQL по `article_attempts.stage='media_sanitize'` для этой статьи — какой `error_code` / payload reject-причин.
3. `curl -sL <original_url> | grep -iE 'og:image|twitter:image'` — посмотреть, что отдаёт сам MIT TR.

**Артефакт этапа:** короткий отчёт «cover отсутствует потому что: <точка A/B/C/D/E>».

### Этап 2 — фикс fetcher

Конкретные правки в `pipeline/fetcher.ts`:

1. **`extractOgImage` (строки 75-81)** — расширить fallback'ы и абсолютизировать:
   ```ts
   function extractOgImage(document: Document, baseUrl: string): string | null {
     const candidates = [
       'meta[property="og:image:secure_url"]',
       'meta[property="og:image:url"]',
       'meta[property="og:image"]',
       'meta[name="og:image"]',
       'meta[name="twitter:image"]',
       'meta[name="twitter:image:src"]',
       'link[rel="image_src"]',
     ]
     for (const sel of candidates) {
       const el = document.querySelector(sel)
       const value = (el?.getAttribute('content') ?? el?.getAttribute('href'))?.trim()
       if (value) {
         const absolute = absolutizeUrl(value, baseUrl)
         if (absolute) return absolute
       }
     }
     return null
   }
   ```
   Не забыть прокинуть `baseUrl` в вызов на 489 строке: `extractOgImage(document, url)`.

2. **JSON-LD fallback** — если og:image нет, искать `<script type="application/ld+json">` с полем `image` (string или array). MIT TR и Ars Technica это держат. Сделать отдельной функцией `extractJsonLdImage(document, baseUrl)`, вызывать после og как secondary fallback.

3. **Inline-картинки как cover, если og отсутствует** — после `extractInlineImages`, если `imageUrl===null && inlineImages.length > 0`, взять первую картинку с площадью ≥ 80×80 (или без размеров, если ratio в норме) как fallback cover. Прокинуть это в `imageUrl` результата. Это снижает риск «сухой» статьи без обложки.

4. **`pickImageSrc` — добавить `<source srcset>` из `<picture>`** — у современных издателей `img` без атрибута src внутри `<picture>` с несколькими `<source>`. Сейчас этот случай теряется.

### Этап 3 — фикс sanitizer (минимально)

В `lib/media-sanitizer.ts`:

- Не менять `looksLikeTextCover`, не расширять `TEXT_COVER_SOURCE_NAMES` без явных доказательств — иначе риск отрезать валидные обложки.
- Добавить тест-кейс с MIT TR-обложкой в `tests/node/media-sanitizer.test.ts` (или эквивалентный), чтобы регресс не вернулся.

### Этап 4 — backfill существующих статей БЕЗ API

Скрипт `scripts/backfill-cover-images.ts` (новый, не вызывает Claude):

1. SELECT всех статей с `publish_status='live' AND cover_image_url IS NULL` за последние 30 дней.
2. Для каждой — `fetchArticleContent(original_url, { includeText: false })` (новый flag, экономит CPU — текст уже есть в БД).
3. Если получили `imageUrl` — `UPDATE articles SET cover_image_url = $1, article_images = $2 WHERE id = $3`.
4. Логировать: `processed`, `updated`, `still_empty`, `fetch_failed` — с разбивкой по `source_name`.
5. Запускать с `--dry-run` сначала, потом `--apply`. Использовать batch размером 20, sleep 1s между батчами, чтобы не упереться в rate-limit источников.

Дополнительно: тот же скрипт может перепроверить `article_images` для статей где `cover_image_url` ЕСТЬ, но `article_images=[]` — потенциально мы пропустили inline-картинки.

**Не вызывать Claude. Не пересоздавать `editorial_body`. Только media-поля.**

## 1.4. Acceptance

- [ ] SQL по `articles WHERE slug = 'mit-technology-review-mezhdu-khaypom-ii-...'` показывает непустой `cover_image_url`.
- [ ] На странице обложка отрисована.
- [ ] Скрипт `scripts/backfill-cover-images.ts --apply` отработал. В отчёте — сколько статей получило обложку, сколько осталось без неё с разбивкой по источнику.
- [ ] Доля live-статей с непустым `cover_image_url` за последние 30 дней — ≥ 85% (исключая Habr AI / CNews / vc.ru, у которых текстовые обложки источника всё равно отрезаются).
- [ ] Тест `media-sanitizer` покрывает: og + twitter:image fallback, JSON-LD fallback, относительные URL.
- [ ] `docs/ARTICLE_SYSTEM.md` раздел «Cover image» обновлён: явно описана последовательность fallback'ов (og:image → twitter:image → JSON-LD `image` → первая inline-картинка).

---

# 2. vc.ru — продолжить расследование

## 2.1. Текущее состояние

Расследование уже спланировано в `docs/task_vcru_ingestion_debug_2026-05-02.md`. На 2026-05-02 за 14 дней — 0 статей с vc.ru в БД.

## 2.2. Что сделать в этой волне

1. Прогнать **Этап 1 (Discovery)** из `task_vcru_ingestion_debug_2026-05-02.md` — без правок кода:
   - `curl -s https://vc.ru/rss/all` — что отдаёт сейчас.
   - SQL по `articles WHERE source_name ILIKE '%vc.ru%'` (всех, не только `quality_ok`) — есть ли вообще записи.
   - `source_runs` за последние 7 дней — что говорит ingest по vc.ru.
2. По результатам выбрать ровно один из вариантов A–D в спеке.
3. Минимально: расширить `RU_AI_CORE_KEYWORDS` лексикой vc.ru: добавить варианты `'нейронк'` (covers «нейронка», «нейронкой»), `'ии-агент'`, `'ии-ассистент'`. Убрать слишком короткое `'ии'` из core (даёт ложноположительные совпадения внутри слов в substring-поиске; оставить как `' ии '` или `'ии-'` где `'-'`/whitespace boundary).
   - Файл: `pipeline/keyword-filters.ts:25-43`.
   - Прогнать существующие тесты `tests/node/` (если есть для keyword-filters).
4. Подтвердить, что keyword-search с `keywordSearchFields: 'title'` смотрит на нормализованный заголовок (lowercase, без `ё→е`). Если нет — поправить в `pipeline/rss-parser.ts`.

## 2.3. Связанная задача — `/sources` mapping

Из `task_vcru_ingestion_debug_2026-05-02.md` раздел «Связанная задача — `/sources` маппинги»:
- В `app/sources/page.tsx::SOURCE_DOMAINS` имя должно быть `'vc.ru AI/стартапы'`.
- Удалить мёртвые ключи `'vc.ru Финансы'`, `'vc.ru Стартапы'`, `'a16z Blog'`, `'Axios Pro Rata'`.
- Добавить отсутствующие `'The Decoder'`, `'Google DeepMind Blog'`, `'TechCrunch Startups'`, `'RB.ru'`, `'Habr Startups'`.

Сделать одним PR с задачей выше.

## 2.4. Acceptance

См. `task_vcru_ingestion_debug_2026-05-02.md`. Минимум — ≥ 5 статей с vc.ru с `quality_ok=true` за 7 дней после фикса.

---

# 3. Тупые иконки в карточке статьи (стрелка, share-svg) — фикс и backfill

## 3.1. Симптом

Статья https://news.malakhovai.ru/categories/ai-russia/develonika-sokratila-podgotovku-hr-analitiki-s-6-do-2-chasov — на странице вместо обложки серая SVG-стрелка (share-icon из шаблона CNews). На скрине в чате видно: после заголовка идёт огромный share-icon вместо реальной картинки. Источник — CNews, у которого в `TEXT_COVER_SOURCE_NAMES` уже есть отсев текстовых обложек, но конкретно эта SVG-иконка прошла через все фильтры.

## 3.2. Корневая причина (гипотезы)

| # | Гипотеза | Проверка |
|---|---|---|
| H1 | og:image у CNews для этой статьи указывает на share-svg (`/static/icons/share.svg` или похоже), и `looksLikeTextCover` (regex `share/social/cover/og-image/share-image`) пропустил его, потому что URL не соответствует шаблону. | `curl -sL <original_url> \| grep -iE 'og:image\|twitter:image'` |
| H2 | Это не cover, а первая `inline_image` — fetcher вытащил share-button SVG из шаблона CNews и не отсеял по icon/avatar regex'у (стрелка-share не подходит ни под `pixel\|tracking\|beacon\|logo\|icon\|avatar\|badge`, потому что в URL может не быть слова `icon`). | SELECT `cover_image_url, article_images` для статьи. |
| H3 | SVG-формат сам по себе как cover в editorial-новости не должен использоваться (обычно SVG = иконка), но sanitizer его не блокирует. | Поиск `.svg` в `cover_image_url` БД. |

## 3.3. Что сделать

### Этап 1 — диагностика

```sql
SELECT id, slug, source_name, cover_image_url, article_images
FROM articles
WHERE slug = 'develonika-sokratila-podgotovku-hr-analitiki-s-6-do-2-chasov'
LIMIT 1;
```

Зафиксировать, какой именно URL рендерится как обложка.

### Этап 2 — фикс sanitizer

В `lib/media-sanitizer.ts`:

1. **Жёсткий blocklist для UI-иконок и share-svg.** Добавить regex:
   ```ts
   const UI_ICON_URL_RE =
     /(?:\/icons?\/|\/sprites?\/|\/share[-_]?icon|\/social[-_]?icon|\/arrow[-_.]|\/btn[-_]|\/button[-_]|share[-_.]svg|social[-_.]svg|arrow[-_.]svg)/i
   ```
   В `rejectReasonForCandidate` для cover и inline — если `UI_ICON_URL_RE.test(urlText)` → `'ui_icon'`.

2. **SVG как cover — отрезать всегда.** Editorial обложки приходят как PNG/JPEG/WebP. SVG = почти всегда иконка/логотип. В cover-mode добавить:
   ```ts
   if (mode === 'cover' && /\.svg(?:[?#]|$)/i.test(src)) return 'svg_cover'
   ```
   Inline SVG разрешить только если у картинки есть длинный `caption` с article-token match — это редкий случай схем/диаграмм.

3. **Расширить `looksLikeTextCover`** — убрать ограничение по `TEXT_COVER_SOURCE_NAMES` (т.к. CNews уже там, но текущий regex не ловит этот URL). Расширить regex словами `default[-_]cover`, `placeholder`, `noimage`, `no[-_]image`.

### Этап 3 — фикс fetcher

В `pipeline/fetcher.ts::extractInlineImages` (159-208):

1. Расширить regex отсева:
   ```ts
   if (/pixel|tracking|beacon|logo|icon|avatar|badge|sprite|share[-_.]|social[-_.]|arrow[-_.]|button[-_.]/i.test(src)) return
   ```
2. Отсекать `<img>` внутри `<button>`, `<a class*="share">`, `[role="button"]` — share-кнопки.
3. Отсекать SVG из inline-images вообще (см. логику sanitizer'а — но лучше двойная защита). Альтернатива: оставить SVG, но требовать от него подходящий контекст (figure + figcaption).

### Этап 4 — backfill БЕЗ API

Тот же `scripts/backfill-cover-images.ts` (или отдельный `scripts/sanitize-existing-article-media.ts --apply` — он уже упомянут в `docs/ARTICLE_SYSTEM.md`):

1. Прогнать sanitizer по всем live-статьям.
2. Если sanitizer отбрасывает текущий `cover_image_url` (новые правила) — попытаться поднять fallback из `article_images` (после sanitize).
3. Если и там пусто — пере-фетч `original_url` с обновлённым fetcher'ом и вытащить новый og:image.
4. Никаких вызовов Claude.

### Этап 5 — публичная защита на render

В `app/categories/[category]/[slug]/page.tsx:521-533` оставить текущую проверку, но дополнительно: **не показывать cover, если URL заканчивается на `.svg`** — даже если он прошёл sanitizer. Это защита на render-уровне, чтобы плохие данные в БД не пробрасывались на страницу.

## 3.4. Acceptance

- [ ] У статьи `develonika-sokratila-podgotovku-hr-analitiki-...` после backfill либо нормальная обложка (если фетч смог вытащить), либо обложка скрыта на странице (но не SVG-стрелка).
- [ ] Поиск по БД: `SELECT count(*) FROM articles WHERE cover_image_url ILIKE '%.svg%' AND publish_status='live'` → 0 (или только статьи, где `article-images/...` storage с editorial-обработкой).
- [ ] Тесты sanitizer покрывают: share-icon SVG, sprite SVG, arrow.svg, default-cover.png.
- [ ] `docs/ARTICLE_SYSTEM.md` раздел «Media sanitizer» дополнен описанием UI-icon blocklist'а.

---

# 4. Редакционная логика — статья a16z-crypto

## 4.1. Что не так

URL: https://news.malakhovai.ru/categories/ai-investments/a16z-crypto-zakryl-fond-na-2-2-mlrd-pyatyy-po-schyotu-i-krup

Жалоба владельца: «было вообще не понятно — закрыли они крипто-фонд и инвестируют в ИИ или наоборот».

Скорее всего проблема:
- Заголовок «a16z crypto закрыл фонд» в русском языке двусмыслен («закрыл» = «прекратил работу» ИЛИ «полностью собрал/закрыл раунд»).
- Лид не разрешает двусмысленность в первом предложении.
- В первом абзаце нет однозначной формулировки «a16z привлёк $2.2B в новый крипто-фонд» (а именно это, скорее всего, произошло — фонд crypto fund 5).

## 4.2. Что сделать сейчас (без API)

1. **Прочитать статью полностью**, найти точное место, где двусмысленность не снята.
2. **Зафиксировать правило в `docs/editorial_style_guide.md`** новым разделом «Однозначность смысла в первом абзаце»:

   > **Правило: первый абзац обязан однозначно отвечать на вопрос «что произошло?».**
   >
   > Запрещены конструкции, где глагол допускает противоположные толкования. В частности:
   > - «закрыл фонд» — двусмысленно (прекратил работу vs собрал раунд). Использовать: «привлёк $X в новый фонд», «полностью собрал фонд на $X», «прекратил работу фонда».
   > - «остановил продукт» — двусмысленно (заморозил vs прекратил полностью). Уточнять.
   > - «вышел из X» — двусмысленно (запустил vs покинул).
   >
   > Если оригинальный заголовок содержит такую двусмысленность — `ru_title` обязан её снять, не сохраняя оригинал дословно.
   >
   > Также: в первом предложении лида должен быть конкретный субъект и действие («Кто что сделал»). «X закрыл фонд» — недостаточно. «X собрал крипто-фонд на $2.2B, пятый по счёту» — достаточно.

3. **Обновить системный промпт в `pipeline/claude.ts`** (только текст промпта, не вызывать Claude):
   - В блоке «КРИТЕРИЙ quality_ok = true» добавить пункт:
     > - В первом предложении лида тема разрешена однозначно: нет двусмысленных глаголов («закрыл», «остановил», «вышел из» без контекста).

   Это сразу подействует для всех будущих статей. **Не делать backfill старой статьи через API.**

4. **Для конкретной статьи a16z-crypto** — допустимо ручное редактирование в БД, если владелец посчитает нужным. Это разовая операция, без API:
   ```sql
   UPDATE articles
   SET ru_title = '...',
       lead = '...',
       editorial_body = '...'
   WHERE slug LIKE 'a16z-crypto-zakryl-fond%';
   ```
   Но решение делать или нет — за владельцем; код-задача только в правиле и промпте.

## 4.3. Acceptance

- [ ] В `docs/editorial_style_guide.md` появился раздел «Однозначность смысла в первом абзаце».
- [ ] В `pipeline/claude.ts` системный промпт включает требование снятия двусмысленности в лиде.
- [ ] (Опционально, по решению владельца) ручное обновление a16z-crypto статьи в БД.

---

# 5. Дешёвые альтернативы Anthropic API — короткий research

## 5.1. Контекст

Сейчас pipeline использует Claude Sonnet 4.6 (`pipeline/claude.ts`) на каждый успешный score≥2 материал. Стоимость = главная статья расходов.

## 5.2. Варианты, которые можно рассмотреть

| Вариант | Цена (~) | Качество | Риски |
|---|---|---|---|
| **A. Anthropic Batch API** (50% off) | в ~2× дешевле текущего | то же качество | задержка до 24 ч; но дайджест и так суточный — норма |
| **B. Claude Haiku 4.5** на не-research категориях, Sonnet 4.6 только на ai-research | ~5–7× дешевле на основной массе | приемлемо для коротких новостей; для research — без потери | нужно A/B по 50 статьям, иначе риск падения качества на ai-industry/ai-startups |
| **C. OpenAI GPT-5 Mini** (если ценник конкурентен) | сравнимо с Haiku | сопоставимо | нужно адаптировать промпт и валидатор под OpenAI JSON-mode; риск рассогласования стиля |
| **D. Gemini 2.5 Flash** (Google AI) | дешевле всех | хуже на русском editorial; но «достаточно» для коротких новостей | стиль другой, может потребоваться постпроцессинг |
| **E. Локальная LLM** (Llama 3.3 70B / Qwen 2.5 72B) на собственном GPU/Modal/Together | переменная себестоимость | хуже Sonnet на русском editorial | инфраструктура, latency, поддержка; для проекта одного человека — overhead |
| **F. Гибрид: Haiku генерирует draft → Sonnet валидирует/правит только если Haiku-output не прошёл quality-gate** | ~3× дешевле | то же качество | сложнее pipeline; quality-gate надо сделать строже |
| **G. Prompt caching ставить агрессивнее** (в текущем коде уже есть `cache_control: ephemeral` на system) | до 90% off на input-токены при cache hit | без потерь | нужно проверить % cache hit в `llm_usage_logs` |

## 5.3. Рекомендация (короткая)

**Не выбирать сейчас.** Сделать дешёвый замер (G) — посмотреть текущий cache hit rate. Если он низкий — дёшево его поднять. Параллельно собрать 50-100 статей и провести **A/B Sonnet vs Haiku** офлайн на сохранённых `original_text` (это не стоит почти ничего). По итогу — переключить ai-industry/ai-startups на Haiku (вариант B), оставив Sonnet на ai-research. Ожидаемая экономия: ~60-70% от текущих расходов на Claude.

Batch API (A) — отдельный простой рычаг, его можно включать независимо от B.

## 5.4. Что положить в задачу разработчику

**Не делать сейчас выбор и не переключать модель.** Сделать только две вещи:
1. Запросить из `llm_usage_logs` за последние 7 дней метрики: total input tokens, cache_read_input_tokens, cache_create_input_tokens — посчитать cache hit rate.
2. Положить в `docs/DECISIONS.md` черновик решения «Cost optimization options 2026-05-06» с таблицей выше и текущим cache hit rate.

Решение — за владельцем после прочтения этого черновика.

---

# 6. «Все новости» на главной — сортировка по `created_at desc`

## 6.1. Текущее поведение

`lib/articles.ts:365-398` — `getArticlesFeed`:

```ts
.order('score', { ascending: false })
.order('created_at', { ascending: false })
```

Статьи с высоким score «прилипают» наверху, даже если они вчерашние, а свежие сегодняшние оказываются ниже.

## 6.2. Что сделать

В `getArticlesFeed`:

```ts
.order('created_at', { ascending: false })
.order('score', { ascending: false })
.order('id', { ascending: false })
```

`id` нужен для детерминированного тай-брейкера.

`pub_date` НЕ использовать в feed на главной — у нас бывают backfill, где `pub_date` от издателя месячной давности, а добавление к нам — сегодня. Владелец явно запросил «по времени **добавления**».

## 6.3. Acceptance

- [ ] Главная (`/`) показывает статьи в строгом порядке `created_at desc`.
- [ ] При двух статьях с одинаковым `created_at` — выше та, у которой больше score; при равном score — больше id.
- [ ] `docs/ARTICLE_SYSTEM.md` раздел про сортировку лент обновлён: явное правило «главная сортируется по `created_at desc`».

---

# 7. «Самое интересное» во вкладках — пересмотр периодически

## 7.1. Текущее поведение

`lib/articles.ts:201-221` — `getInterestingArticlesByCategory`:
- окно: последние 7 дней (primary), 30 дней (fallback).
- `lib/interest-ranking.ts` — формула `score*1 + freshness*3 + sourceWeight + ...`. Freshness считается как `exp(-ageHours/48)*10` — после 48 часов вес затухает.
- Категория-страница: `app/categories/[category]/page.tsx:13` — `revalidate = 300` (5 минут).

Проблема: при revalidate=300 страница пересобирается часто, но если за окно (7 дней) поступает мало статей и они не двигаются по score, выдача застаивается. Вес freshness уже есть, но не побеждает score топ-статьи через 7-10 дней.

## 7.2. Что сделать

### 7.2.1. Сократить primary-окно до 72 часов

В `getInterestingArticlesByCategory` (`lib/articles.ts:201-221`):
- было: `sevenDaysAgo = now - 7d`
- станет: `seventyTwoHoursAgo = now - 72h`
- fallback оставить 30 дней (или сократить до 14).

Это автоматически выдавит из «Самого интересного» статьи старше трёх суток в большинстве категорий.

### 7.2.2. Усилить time-decay в interest-ranking

В `lib/interest-ranking.ts:95`:
- было: `freshnessScore = Math.exp(-ageHours / 48) * 10`
- станет: `freshnessScore = Math.exp(-ageHours / 24) * 10`

Полураспад с 33 часов → 16 часов. Через 48 часов вес freshness падает почти до 1.4 (вместо 3.7), и старые high-score статьи перестают доминировать.

Вес freshness в формуле тоже можно поднять с 3.0 до 4.0 — но менять что-то одно за раз. Сначала окно + полураспад, замерить.

### 7.2.3. Опциональная ротация (deterministic shuffle)

Чтобы у одного и того же ранга был визуальный «обмен» позиций раз в N часов, можно добавить опциональный seed `Math.floor(now.getTime() / (6 * 3600 * 1000))` в тай-брейкер. Только если после фиксов в 7.2.1+7.2.2 выдача всё ещё кажется залипшей — иначе не делать (детерминированность важнее визуала).

### 7.2.4. Не трогать revalidate

`revalidate = 300` уже достаточно для пересборки. Проблема не в кеше, а в формуле.

## 7.3. Acceptance

- [ ] В блоке «Самое интересное» на странице `/categories/<category>` 70%+ карточек — статьи моложе 72 часов (на момент проверки).
- [ ] Тесты `tests/node/` для `interest-ranking` обновлены: при `now = X`, статья с `created_at = X - 72h` имеет freshness < 1 (раньше было ≈ 2.7).
- [ ] `docs/ARTICLE_SYSTEM.md` раздел «Самое интересное» — указано окно 72ч и полураспад 24ч.

---

# 8. Лента раздела — сортировка по `created_at desc`

## 8.1. Текущее поведение

`lib/articles.ts:141-173` — `getArticlesByCategoryPage`:

```ts
.order('pub_date', { ascending: false, nullsFirst: false })
.order('created_at', { ascending: false })
.order('score', { ascending: false })
.order('id', { ascending: false })
```

`pub_date` — это дата публикации в источнике. Если источник опубликовал материал 10 дней назад, а наш ingest подобрал его сегодня — статья в ленте окажется глубоко внизу. Владелец запросил «по дате **добавления**».

## 8.2. Что сделать

```ts
.order('created_at', { ascending: false })
.order('pub_date', { ascending: false, nullsFirst: false })
.order('score', { ascending: false })
.order('id', { ascending: false })
```

Аналогично — для `getArticlesByCategory`, `getArticlesByTopic`, `getRussiaArticles` (если они отдельно сортируют). Сделать grep по `lib/articles.ts` на `.order(`.

`getRecentHeadlines` — уже корректно сортирует по `created_at desc` (`lib/articles.ts:287`).

## 8.3. Acceptance

- [ ] Лента `/categories/<category>` сортируется в строгом порядке `created_at desc`.
- [ ] То же для `/russia`, `/sources/<source>`.
- [ ] В тестах добавить кейс: статья с `pub_date = now - 30d, created_at = now - 1h` стоит выше статьи с `pub_date = now - 1d, created_at = now - 24h`.
- [ ] `docs/ARTICLE_SYSTEM.md` раздел «Связанные поверхности» — фраза «Обычная лента раздела сортируется по свежести (`pub_date desc nulls last`...)» заменена на сортировку по `created_at desc`.

---

# 9. Убрать sticky-заголовок при скролле на странице статьи

## 9.1. Текущее поведение

`app/categories/[category]/[slug]/page.tsx:498` рендерит `<StickyArticleTitle title={title} />`. Компонент `src/components/StickyArticleTitle.tsx` показывает фиксированный заголовок при `scrollY > 320`.

## 9.2. Что сделать

1. Удалить строку `<StickyArticleTitle title={title} />` (строка 498).
2. Удалить импорт `import StickyArticleTitle from '../../../../src/components/StickyArticleTitle'` (строка 15).
3. Удалить файл `src/components/StickyArticleTitle.tsx` целиком.
4. Прогнать `grep -rn "StickyArticleTitle"` по `app/`, `src/`, `lib/` — убедиться, что больше ссылок нет.

ReadingProgress (тонкая полоска прогресса) оставить — отдельный компонент, не sticky-title.

## 9.3. Acceptance

- [ ] При скролле на странице статьи нет верхнего фиксированного блока с заголовком.
- [ ] `npm run build` проходит без ошибок (нет dead-import).
- [ ] `docs/DESIGN.md` — если упоминается sticky title, упоминание удалить.

---

# 10. Источник в левой колонке — синим (accent), не серо-чёрным

## 10.1. Текущее поведение

`app/categories/[category]/[slug]/page.tsx:544-551`:

```tsx
<a
  href={article.original_url}
  target="_blank"
  rel="noopener noreferrer"
  className="text-[13px] font-medium text-ink transition-colors hover:text-accent"
>
  {article.source_name}
</a>
```

Цвет в покое — `text-ink` (≈ чёрный), на hover — `text-accent` (синий `#0055FF`). Пользователь не понимает, что это ссылка.

## 10.2. Что сделать

Заменить на:

```tsx
<a
  href={article.original_url}
  target="_blank"
  rel="noopener noreferrer"
  className="text-[13px] font-medium text-accent transition-colors hover:underline"
>
  {article.source_name}
</a>
```

Аналогично проверить:
- footer'ный «Источник» (строки 687-700) — там уже `text-accent hover:underline`, не трогать.
- мобильную версию (строка 599) — там просто текст без ссылки. Решить, стоит ли её тоже сделать ссылкой на `original_url` — рекомендую: да, для консистентности.

## 10.3. Acceptance

- [ ] В левой колонке статьи название источника — синее (accent), при наведении — подчёркивание.
- [ ] Клик ведёт на `original_url` в новой вкладке.
- [ ] Визуальный smoke-check в светлой и тёмной темах.
- [ ] `docs/DESIGN.md` — если есть раздел про article sidebar / link colors, обновить.

---

# Порядок выполнения и масштаб

Рекомендуемая последовательность по принципу «дешёвые быстрые фиксы → дорогие изменения логики»:

1. **PR 1 (UI, мгновенно):** задачи 9 + 10. Меньше 30 строк кода.
2. **PR 2 (sort fixes):** задачи 6 + 8. Поправить `getArticlesFeed`, `getArticlesByCategoryPage`, обновить `ARTICLE_SYSTEM.md`.
3. **PR 3 (interest ranking):** задача 7.
4. **PR 4 (media fix + backfill, без API):** задачи 1 + 3, скрипт `backfill-cover-images.ts`.
5. **PR 5 (vc.ru):** задача 2 + `/sources` mapping.
6. **PR 6 (editorial style + cost research, без кода):** задачи 4 + 5 — обновление промпта и добавление черновика DECISIONS.

Не объединять PR 4 с PR 5 — у них разный риск-профиль и разные acceptance-проверки.

---

# Связанные файлы (быстрая навигация)

- `app/page.tsx` — главная.
- `app/categories/[category]/page.tsx` — лента раздела.
- `app/categories/[category]/[slug]/page.tsx` — страница статьи.
- `lib/articles.ts` — все выборки. **Тут будут править задачи 6, 7, 8.**
- `lib/interest-ranking.ts` — формула «Самого интересного». **Задача 7.**
- `lib/media-sanitizer.ts` — фильтр картинок. **Задача 1, 3.**
- `pipeline/fetcher.ts` — извлечение og:image и inline. **Задача 1, 3.**
- `pipeline/feeds.config.ts` — vc.ru feed. **Задача 2.**
- `pipeline/keyword-filters.ts` — `RU_AI_CORE_KEYWORDS`. **Задача 2.**
- `pipeline/claude.ts` — системный промпт. **Задача 4 (только текст промпта, без вызовов Claude).**
- `src/components/StickyArticleTitle.tsx` — удалить. **Задача 9.**
- `app/sources/page.tsx` — `SOURCE_DOMAINS` mapping. **Задача 2.**
- `scripts/backfill-cover-images.ts` — новый, БЕЗ API. **Задача 1, 3.**
- `docs/ARTICLE_SYSTEM.md`, `docs/DESIGN.md`, `docs/editorial_style_guide.md`, `docs/DECISIONS.md` — апдейт по результатам.
