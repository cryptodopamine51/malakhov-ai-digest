# Execution Plan — Site Improvements 2026-05-06

> Дата: 2026-05-06
> Связанная спека: `docs/spec_2026-05-06_site_improvements.md`
> Цель: реализовать все 10 задач из спеки и **выкатить в прод** через серию PR с проверками на каждом шаге.
> Бюджет API: **0 USD**. Никаких вызовов Claude — все backfill'ы только через прямой HTTP-фетч исходников.

---

## Базовая последовательность для каждого PR

Каждый из 6 PR проходит один и тот же конвейер. Не пропускать шаги:

1. `git checkout main && git pull origin main` — стартуем с актуального main.
2. `git checkout -b <branch-name>` — отдельная ветка под PR.
3. Сделать правки кода + обновить канонический doc + добавить/обновить тесты.
4. Локально: `npm run build` — должен пройти без ошибок. Если меняли pipeline — `npx tsx --test tests/node/...`.
5. `git add <конкретные файлы> && git commit -m "..."`. **Не** делать `git add -A`.
6. `git push -u origin <branch-name>` — Vercel автоматически создаст **preview deployment**.
7. Открыть preview-URL из Vercel checks в PR. Прогнать **smoke-check для этого PR** (см. ниже).
8. Если smoke-check ОК — merge в `main` (squash-merge, чтобы история была чистая).
9. Vercel автоматически деплоит `main` в **production** (`https://news.malakhovai.ru`).
10. Прогнать **production smoke-check** (стандартный из `docs/OPERATIONS.md` + специфичный для PR).
11. Если проблема в проде — откат через Vercel UI (Promote to Production предыдущего deployment).
12. Закрыть PR в `docs/spec_2026-05-06_site_improvements.md` — отметить раздел выполненным или удалить (по правилу из CLAUDE.md).

**Никогда не пушить напрямую в `main`.** Все изменения идут через PR ради preview-deployment'а Vercel.

---

## Pre-flight перед началом всей волны

Один раз, до первого PR:

- [ ] `npm run context` — обновить локальный контекст.
- [ ] `git status` — рабочее дерево чистое.
- [ ] `git pull origin main` — последний main.
- [ ] Проверить, что Vercel project linked: `vercel link` (если нужен Vercel CLI) или просто убедиться, что `https://vercel.com/.../malakhov-ai-digest` показывает зелёный последний deploy main'а.
- [ ] Снять baseline-метрики (нужны для acceptance в задачах 1, 3, 7):
  ```sql
  -- доля live-статей с непустым cover за 30 дней
  SELECT source_name,
         COUNT(*) FILTER (WHERE cover_image_url IS NOT NULL) AS with_cover,
         COUNT(*) AS total
  FROM articles
  WHERE publish_status='live' AND created_at >= NOW() - INTERVAL '30 days'
  GROUP BY source_name ORDER BY total DESC;
  ```
  Сохранить в `docs/baseline_2026-05-06.md` или в комментарий PR 4. Это нужно, чтобы после backfill сравнить «до/после».

---

# PR 1 — UI: убрать sticky-заголовок и сделать источник синим

> Соответствует задачам 9 и 10 в спеке.
> Risk: минимальный. Только UI.
> Estimate: 30 минут.

**Branch:** `ui/sticky-title-and-source-color`

## Что делаем

1. `app/categories/[category]/[slug]/page.tsx`:
   - Удалить строку 15: `import StickyArticleTitle from '../../../../src/components/StickyArticleTitle'`.
   - Удалить строку 498: `<StickyArticleTitle title={title} />`.
   - В строках 544-551 заменить `text-ink transition-colors hover:text-accent` → `text-accent transition-colors hover:underline`.
   - Опционально: в мобильной версии (строка 599) обернуть `{article.source_name}` в `<a href={article.original_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">`.
2. Удалить файл `src/components/StickyArticleTitle.tsx`.
3. `grep -rn "StickyArticleTitle" app/ src/ lib/ pipeline/ bot/ scripts/` — должен ничего не вернуть.
4. Обновить `docs/DESIGN.md`: если упоминается sticky title — убрать; в разделе про article sidebar явно указать «название источника — accent, hover: underline».

## Local checks

- [ ] `npm run build` — passes.
- [ ] Открыть статью локально (`npm run dev`), убедиться: при скролле нет sticky-блока с заголовком, в левой колонке источник — синий и кликабельный.

## PR smoke-check (Vercel preview)

- [ ] На preview-URL открыть любую статью.
- [ ] Скролл вниз → нет фиксированного заголовка вверху.
- [ ] Левая колонка: «Источник: <name>» — синий, при наведении — подчёркивание, клик ведёт на `original_url`.
- [ ] Светлая и тёмная темы — оба смотрятся ок.

## Production smoke-check

- [ ] Те же проверки на `https://news.malakhovai.ru/categories/<любая>/<любой-slug>`.

---

# PR 2 — Сортировка лент по `created_at desc`

> Соответствует задачам 6 и 8.
> Risk: средний — меняется визуальный порядок лент, кеш Vercel надо прогреть.
> Estimate: 1-2 часа.

**Branch:** `feed/sort-by-created-at`

## Что делаем

1. `lib/articles.ts:365-398` — `getArticlesFeed`:
   ```ts
   .order('created_at', { ascending: false })
   .order('score', { ascending: false })
   .order('id', { ascending: false })
   ```
2. `lib/articles.ts:141-173` — `getArticlesByCategoryPage`:
   ```ts
   .order('created_at', { ascending: false })
   .order('pub_date', { ascending: false, nullsFirst: false })
   .order('score', { ascending: false })
   .order('id', { ascending: false })
   ```
3. Проверить grep'ом `lib/articles.ts` остальные `.order(` на предмет похожих несоответствий: `getArticlesByTopic`, `getRussiaArticles`, `getArticlesBySource`. Где есть «по свежести» — обновить.
4. Обновить `docs/ARTICLE_SYSTEM.md` раздел «Связанные поверхности» — заменить упоминание `pub_date desc nulls last` на `created_at desc nulls last`.
5. Добавить unit-тест в `tests/node/`: при двух статьях, где `pub_date(A) > pub_date(B)`, но `created_at(A) < created_at(B)` — B стоит выше A.

## Local checks

- [ ] `npm run build`.
- [ ] `npx tsx --test tests/node/articles-sort.test.ts` (новый или обновлённый).

## PR smoke-check (Vercel preview)

- [ ] Главная: первая статья в «Все новости» — самая свежая по `created_at` (можно сверить с SQL `SELECT slug, created_at FROM articles WHERE publish_status='live' ORDER BY created_at DESC LIMIT 5`).
- [ ] `/categories/ai-industry`: тот же тест.
- [ ] «Главное сегодня» (hot story) — не сломано.

## Production smoke-check

- [ ] То же на проде. Проверить, что revalidate (300s) уже сработал — если нет, подождать 5 минут или принудительно запросить `?revalidate=...`.

---

# PR 3 — «Самое интересное» не залипает

> Соответствует задаче 7.
> Risk: средний — меняется выбор статей в блоке.
> Estimate: 1-2 часа.

**Branch:** `interest-ranking/freshness-tighten`

## Что делаем

1. `lib/articles.ts:201-221` — `getInterestingArticlesByCategory`:
   - `sevenDaysAgo` → `seventyTwoHoursAgo` (3 дня).
   - `thirtyDaysAgo` → оставить как fallback (или сократить до 14 — на усмотрение).
2. `lib/interest-ranking.ts:95`:
   - `Math.exp(-ageHours / 48) * 10` → `Math.exp(-ageHours / 24) * 10`.
3. Обновить тесты `lib/interest-ranking` (если есть в `tests/node/`): проверить, что при `now - 72h` freshness < 1, при `now - 12h` freshness ~ 6.
4. `docs/ARTICLE_SYSTEM.md` раздел про «Самое интересное» — указать окно 72ч и полураспад 24ч.

**Не делаем (отложено до проверки результата):** ротация по 6-часовому seed; рост веса freshness с 3 до 4. Сначала смотрим, как изменилась выдача.

## Local checks

- [ ] `npm run build`.
- [ ] Тесты interest-ranking — проходят с новыми ожиданиями.

## PR smoke-check (Vercel preview)

- [ ] `/categories/ai-industry`: блок «Самое интересное» — все 4 статьи моложе 72ч (cверить created_at).
- [ ] Если в категории < 3 свежих статей — блок скрыт (это ожидаемое поведение).
- [ ] `/russia` — то же.

## Production smoke-check

- [ ] То же на проде. Через сутки повторить — убедиться, что блок обновился (не залипает).

---

# PR 4 — Cover-картинки: фикс fetcher + sanitizer + backfill (без API)

> Соответствует задачам 1 и 3.
> Risk: высокий — меняется ingestion media-логика и пишет в `articles` массово.
> Estimate: 1 рабочий день.

**Branch:** `media/cover-fix-and-backfill`

## Шаги внутри PR (несколько коммитов)

### Коммит 1 — fetcher

- `pipeline/fetcher.ts`:
  - `extractOgImage` принимает `baseUrl`, проверяет cascade `og:image:secure_url → og:image:url → og:image → twitter:image → twitter:image:src → link[rel=image_src]`, абсолютизирует через `absolutizeUrl`.
  - Новая `extractJsonLdImage(document, baseUrl)` — secondary fallback на `<script type="application/ld+json">` поле `image`.
  - `pickImageSrc` — добавить чтение `<picture><source srcset>` если у `<img>` нет `src`.
  - `extractInlineImages` — расширить regex отсева: добавить `sprite|share[-_.]|social[-_.]|arrow[-_.]|button[-_.]`, отсекать `<img>` внутри `<a class*="share">`, `<button>`, `[role="button"]`.
  - `fetchArticleContent`: если `imageUrl===null && inlineImages.length > 0` — взять первую inline ≥80×80 как fallback cover.
  - Поддержать `options.includeText = false` — в backfill это сэкономит CPU.

### Коммит 2 — sanitizer

- `lib/media-sanitizer.ts`:
  - `UI_ICON_URL_RE` для cover и inline → reject `'ui_icon'`.
  - В cover-mode: `if (/\.svg(?:[?#]|$)/i.test(src)) return 'svg_cover'`.
  - Расширить `looksLikeTextCover` regex (`default[-_]cover|placeholder|noimage|no[-_]image`).

### Коммит 3 — render-defence

- `app/categories/[category]/[slug]/page.tsx:521`: дополнительная проверка перед рендером cover — `!sanitizedMedia.coverImageUrl?.toLowerCase().endsWith('.svg')`.

### Коммит 4 — тесты

- `tests/node/media-sanitizer.test.ts`: кейсы share-icon SVG, sprite SVG, arrow.svg, default-cover.png, twitter:image fallback, JSON-LD fallback, относительные URL.

### Коммит 5 — backfill script (без API)

- `scripts/backfill-cover-images.ts`:
  - SELECT live-статей за 30 дней с `cover_image_url IS NULL OR cover_image_url ILIKE '%.svg%'`.
  - Для каждой `fetchArticleContent(original_url, { includeText: false })`.
  - Прогнать через `sanitizeArticleMedia` — взять только то, что прошло.
  - `UPDATE articles SET cover_image_url = $1, article_images = $2`.
  - Логи: `processed`, `updated`, `still_empty`, `fetch_failed` с разбивкой по `source_name`.
  - Флаги `--dry-run` (default) и `--apply`.
  - Batch 20, sleep 1s.
  - **Никаких вызовов Claude.**

### Коммит 6 — docs

- `docs/ARTICLE_SYSTEM.md` раздел «Cover image»: явная цепочка fallback (og:image → twitter:image → JSON-LD `image` → первая inline-картинка).
- Раздел «Media sanitizer» дополнен описанием UI-icon blocklist'а и `svg_cover` reject-причины.

## Local checks

- [ ] `npm run build`.
- [ ] Все media-тесты проходят.
- [ ] `npx tsx scripts/backfill-cover-images.ts --dry-run` — отчёт реалистичный, не валится.
- [ ] Точечно проверить через скрипт MIT TR-статью и Develonika: после dry-run видно, какой URL ставится.

## PR smoke-check (Vercel preview)

- [ ] Открыть страницу MIT TR-статьи на preview — обложка либо есть, либо честно отсутствует (но не SVG).
- [ ] Открыть Develonika — нет SVG-стрелки.
- [ ] Несколько случайных свежих статей — обложки ок.

## Apply backfill

После merge PR в main и production deploy:

1. `npx tsx scripts/backfill-cover-images.ts --dry-run > /tmp/backfill-dry.log` — посмотреть отчёт.
2. Если отчёт реалистичен (нет лавины fetch_failed — не более 10%) — `npx tsx scripts/backfill-cover-images.ts --apply > /tmp/backfill-apply.log`.
3. Замерить тот же SQL, что был в pre-flight baseline. Доля live-статей с непустым `cover_image_url` за 30 дней — ≥ 85% (исключая Habr AI / CNews / vc.ru).

## Production smoke-check

- [ ] MIT TR-статья — обложка есть.
- [ ] Develonika-статья — нет SVG-стрелки (возможно, обложки нет совсем — это норма).
- [ ] Случайная статья из CNews/vc.ru/Habr — текст-cover остаётся скрыт (как и было).
- [ ] Случайная статья из MIT TR / Verge / Wired — обложка корректная.

---

# PR 5 — vc.ru ingestion + `/sources` mapping

> Соответствует задаче 2.
> Risk: средний — keyword filter может зашумить ingest.
> Estimate: 1 рабочий день (включая discovery).

**Branch:** `ingest/vcru-debug-and-keywords`

## Шаги

### Этап 1 — Discovery (без коммитов)

Запустить из `docs/task_vcru_ingestion_debug_2026-05-02.md` Этап 1:
- `curl -s https://vc.ru/rss/all -o /tmp/vcru.xml && wc -l /tmp/vcru.xml`.
- Глазами оценить долю AI-заголовков среди последних 50 items.
- SQL: какие записи vc.ru уже есть в `articles` (без фильтра `quality_ok`).
- Прогнать ingest-скрипт локально: `npx tsx pipeline/ingest.ts --source 'vc.ru AI/стартапы' --verbose` (или эквивалент).

Зафиксировать в комментарии PR таблицу «items в RSS / прошло keyword / прошло scorer / попало в Claude / quality_ok».

### Этап 2 — Точечный фикс

В зависимости от диагноза — один из вариантов A–D из спеки `task_vcru_ingestion_debug_2026-05-02.md`. Скорее всего вариант A (расширить `RU_AI_CORE_KEYWORDS`):

- `pipeline/keyword-filters.ts:25-43`:
  - Добавить `'нейронк'`, `'ии-агент'`, `'ии-ассистент'`, `'ии-' (с дефисом)`.
  - Заменить голое `'ии'` на `' ии '` или регексп с word boundary, чтобы не ловить substring внутри слов вроде «институт», «инициатива».
  - Если в `pipeline/rss-parser.ts` keyword-match идёт по `includes(...)` — переделать на нормализацию + `\b` regex для двухбуквенных ключей.

### Этап 3 — `/sources` mapping

`app/sources/page.tsx`:
- В `SOURCE_DOMAINS` ключ `'vc.ru'` → `'vc.ru AI/стартапы'`.
- Удалить мёртвые ключи: `'vc.ru Финансы'`, `'vc.ru Стартапы'`, `'a16z Blog'`, `'Axios Pro Rata'`.
- Добавить отсутствующие: `'The Decoder'`, `'Google DeepMind Blog'`, `'TechCrunch Startups'`, `'RB.ru'`, `'Habr Startups'`.

### Этап 4 — Docs

- Обновить `docs/ARTICLE_SYSTEM.md`, если меняли keyword-фильтры или search-fields.
- Закрыть `docs/task_vcru_ingestion_debug_2026-05-02.md` — поставить `status: closed` и summary в шапке.

## Local checks

- [ ] `npm run build`.
- [ ] Если есть тесты на keyword-filter — обновить и прогнать.
- [ ] Прогнать локально один цикл ingest и убедиться, что vc.ru-items проходят.

## PR smoke-check (Vercel preview)

- [ ] `/sources` показывает блок vc.ru с правильным favicon (раз mapping исправили).
- [ ] Если за этап preview успели появиться vc.ru-статьи в БД — они отображаются.

## Production smoke-check

- [ ] После merge — наблюдать 7 дней. Acceptance: ≥ 5 статей с `source_name ILIKE '%vc.ru%' AND quality_ok=true`.
- [ ] Не ухудшен yield других ru-фидов: сверить недельный счётчик Habr AI и CNews до/после.

---

# PR 6 — Editorial style + cost research (no code)

> Соответствует задачам 4 и 5.
> Risk: минимальный — только тексты в docs и системный промпт.
> Estimate: 1-2 часа.

**Branch:** `docs/editorial-clarity-and-cost`

## Что делаем

1. `docs/editorial_style_guide.md` — добавить раздел «Однозначность смысла в первом абзаце» (текст из спеки, раздел 4.2).
2. `pipeline/claude.ts` — в системный промпт в блок «КРИТЕРИЙ quality_ok = true» добавить строку:
   > - В первом предложении лида тема разрешена однозначно: нет двусмысленных глаголов («закрыл», «остановил», «вышел из» без контекста).
3. `docs/DECISIONS.md` — новый раздел «Cost optimization options 2026-05-06»:
   - Таблица из 7 вариантов (см. спеку, раздел 5.2).
   - Текущий cache hit rate из `llm_usage_logs` за 7 дней.
     ```sql
     SELECT
       SUM(input_tokens) AS input,
       SUM(cache_read_input_tokens) AS cache_read,
       SUM(cache_creation_input_tokens) AS cache_create,
       ROUND(100.0 * SUM(cache_read_input_tokens) / NULLIF(SUM(input_tokens), 0), 1) AS cache_hit_pct
     FROM llm_usage_logs
     WHERE created_at >= NOW() - INTERVAL '7 days';
     ```
   - Рекомендация: «не выбирать сейчас. Сначала Batch API + замер cache hit rate. Через 2 недели вернуться к выбору модели».
4. (Опционально, по решению владельца) ручное обновление a16z-crypto статьи в БД через прямой `UPDATE articles SET ru_title=..., lead=..., editorial_body=... WHERE slug LIKE 'a16z-crypto-zakryl-fond%'`. **Не через API.** Если владелец не считает нужным — пропустить.

## Local checks

- [ ] `npm run build` — да, промпт меняется как строка.
- [ ] Тесты `pipeline/claude` (если они проверяют структуру промпта) — обновить.
- [ ] Грep по `pipeline/claude.ts` тестам в `tests/node/` на наличие фикстуры с системным промптом.

## PR smoke-check (Vercel preview)

- [ ] Открыть статью — рендер не сломан (промпт меняется только при следующих enrichment'ах, старые статьи остаются как были).
- [ ] `/categories/ai-investments/a16z-crypto-...` — если делали ручной апдейт, статья читается однозначно.

## Production smoke-check

- [ ] Через сутки после deploy — на новых статьях проверить лиды: формулировки конкретные, без двусмысленности.

---

# Финальный rollout-чеклист

После того как все 6 PR смержены и прошли production smoke-check:

- [ ] `git checkout main && git pull origin main`.
- [ ] `git log --oneline -20` — все 6 squash-коммитов в main.
- [ ] Vercel dashboard: последний production deploy = последний commit main, статус Ready.
- [ ] Прогнать **полный production smoke-check** из `docs/OPERATIONS.md` раздел «Post-deploy smoke check» (14 пунктов).
- [ ] Прогнать **дополнительный smoke-check** этой волны:
  - [ ] (PR 1) Sticky-заголовка нет; источник в левой колонке синий.
  - [ ] (PR 2) Главная и любая категория сортируются по `created_at desc`.
  - [ ] (PR 3) «Самое интересное» — статьи моложе 72ч.
  - [ ] (PR 4) MIT TR и Develonika выглядят корректно. Доля статей с обложками ≥ 85% (см. SQL pre-flight).
  - [ ] (PR 5) `/sources` показывает корректные favicons. Через 7 дней — ≥ 5 vc.ru статей с `quality_ok=true`.
  - [ ] (PR 6) Промпт обновлён в проде; новые enrichment'ы используют его.
- [ ] Закрытие волны:
  - [ ] Удалить из `docs/spec_2026-05-06_site_improvements.md` выполненные разделы или пометить `[done]`.
  - [ ] Перенести key facts в канонические doc'и: `ARTICLE_SYSTEM.md`, `DESIGN.md`, `editorial_style_guide.md`, `DECISIONS.md` — по правилу из CLAUDE.md.
  - [ ] Финальный коммит в main: `docs: close 2026-05-06 site improvements wave` с обновлением `docs/INDEX.md` (добавить ссылку на этот execution plan и spec в раздел истории).
  - [ ] В CLAUDE.md обновить «Последняя закрытая инициатива» на `Site improvements 2026-05-06`.
  - [ ] (опционально) Записать post-mortem-абзац в новый `docs/wave_close_2026-05-06.md`: что сделано, что отложено, какой next-step (например, выбор модели после 2 недель замеров).

---

# Откат / rollback policy

Каждый PR делается отдельно ради изоляции отката:

- **UI-PR (1):** откат через Vercel «Promote to Production» предыдущего deployment'а.
- **Sort-PR (2):** то же. Кеш категорий обновится в течение 5 минут (revalidate=300).
- **Interest-ranking (3):** то же. Никаких миграций БД, можно ревертить мгновенно.
- **Media (4):** откат **кода** — через Vercel rollback. Откат **backfill'а** в БД невозможен напрямую (мы перезаписали `cover_image_url`); поэтому перед `--apply` сделать снапшот:
  ```bash
  curl -X POST 'https://api.supabase.com/v1/projects/oziddrpkwzsdtsibauon/database/query' \
    -H "Authorization: Bearer sbp_..." \
    -H "Content-Type: application/json" \
    -d '{"query": "CREATE TABLE articles_cover_snapshot_20260506 AS SELECT id, cover_image_url, article_images FROM articles WHERE publish_status='\''live'\'';"}'
  ```
  Если backfill сломал данные — восстановить через `UPDATE articles a SET cover_image_url = s.cover_image_url, article_images = s.article_images FROM articles_cover_snapshot_20260506 s WHERE a.id = s.id`.
- **Ingest (5):** откат через revert-PR. Уже забранные статьи остаются в БД — это нормально.
- **Docs/prompt (6):** revert-PR.

---

# Что НЕ делать в этой волне

- Не трогать enrichment / Claude API. Никаких re-enrich существующих статей.
- Не трогать модель данных `articles` / `categories` / миграции SQL.
- Не менять deploy/cron-инфраструктуру.
- Не выбирать новую LLM (только research-черновик в DECISIONS).
- Не объединять PR в один мега-PR.

---

# Связанные документы

- Спецификация: `docs/spec_2026-05-06_site_improvements.md`.
- Канонические доки для апдейта: `docs/ARTICLE_SYSTEM.md`, `docs/DESIGN.md`, `docs/editorial_style_guide.md`, `docs/DECISIONS.md`.
- Operations / smoke-check: `docs/OPERATIONS.md` раздел «Deploy» и «Post-deploy smoke check».
- vc.ru предыстория: `docs/task_vcru_ingestion_debug_2026-05-02.md`.
- CLAUDE.md — общие правила работы с проектом.
