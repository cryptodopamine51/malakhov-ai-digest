# Decisions Log

Этот файл хранит не backlog и не идеи, а уже принятые решения.

Формат записи:

## ADR-XXX · Короткое название

- Status: accepted / superseded
- Date: YYYY-MM-DD
- Context:
- Decision:
- Consequences:

---

## ADR-001 · Текущий runtime строится вокруг Next.js + Supabase + GitHub Actions

- Status: accepted
- Date: 2026-04-21
- Context: проекту нужен простой production-контур без отдельного backend-сервиса для рендеринга и фоновых задач.
- Decision: публичный web живёт в Next.js на Vercel, данные хранятся в Supabase, а фоновые pipeline-задачи запускаются GitHub Actions cron-ами.
- Consequences: архитектура остаётся простой, но все operational rules по cron и retries должны быть явно задокументированы.

## ADR-002 · `CLAUDE.md` является control plane, а не энциклопедией проекта

- Status: accepted
- Date: 2026-04-21
- Context: один большой мастер-документ быстро устаревает и начинает спорить с тематическими docs.
- Decision: `CLAUDE.md` хранит только текущие инварианты, read order и source-of-truth map; детали живут в канонических docs внутри `docs/`.
- Consequences: при любом существенном изменении нужно править тематический doc, а не раздувать `CLAUDE.md`.

## ADR-003 · Публичные slug статей должны быть чистыми, legacy slug должны редиректить

- Status: accepted
- Date: 2026-04-21
- Context: технические хвосты в public URL ухудшают читаемость и качество ссылок.
- Decision: новые slug делаются чистыми, коллизии решаются числовыми суффиксами, legacy slug остаются только для совместимости через redirect.
- Consequences: sitemap, internal linking, canonical и Telegram должны использовать clean public URL.

## ADR-004 · Batch lifecycle enrich хранится отдельно от coarse article state

- Status: accepted
- Date: 2026-04-21
- Context: перевод enrich на Anthropic Batch API создаёт отдельный lifecycle submit/collect/apply, который плохо ложится в существующий `articles.enrich_status` и конфликтует с article lease recovery.
- Decision: `articles.enrich_status` остаётся coarse pipeline state (`pending`, `processing`, `retry_wait`, terminal states), а batch-specific ownership и item states живут в `anthropic_batches` и `anthropic_batch_items`.
- Consequences: `recover-stuck` отвечает только за pre-submit lease problems, post-submit recovery переносится в batch-oriented scripts и observability; apply к статье должен быть идемпотентным и опираться на batch item identity.

## ADR-005 · Runtime обновлён до Next.js 15.5.15 в рамках Orchestrator fixes

- Status: accepted
- Date: 2026-04-24
- Context: исходный план предлагал pin на Next.js 14.2.35, но текущий `npm audit --omit=dev` помечает `next <15.5.15` как high severity и предлагает только breaking upgrade.
- Decision: оставить Next.js и `eslint-config-next` на точном pin `15.5.15`, выделив это как осознанный runtime upgrade вместо случайного scope creep.
- Consequences: runtime-коммит должен быть отдельным, документация должна явно говорить Next.js 15, а smoke-проверки включают lint, build, pipeline tests, batch tests и tg digest idempotency.

## ADR-006 · Статья принадлежит одной основной категории + до двух смежных вместо плоского `topics[]`

- Status: accepted
- Date: 2026-04-25
- Context: текущая модель `articles.topics text[]` равноправна — нет понятия «куда статья в первую очередь». Это не позволяет построить чистый URL `/categories/<slug>/<article>`, корректный canonical и осмысленные хлебные крошки. Нужен фундамент для волны 2.2 (URL + редиректы) и 2.4 (SEO-разделение).
- Decision: завести справочник `categories` (slug PK, name_ru, description_ru, order_index, is_active) и два поля в `articles`: `primary_category text NOT NULL` (FK на `categories.slug`) и `secondary_categories text[]` с CHECK на длину ≤ 2. На стартовом этапе slug-и категорий совпадают с прежними значениями `topics`. Backfill маппит `topics[1]` → primary, остальные известные topic-и → до двух secondary; статьи без известного topic получают `ai-industry` как дефолт. Legacy `topics[]` остаётся read-only до полного cutover в рамках волны 2 для возможности отката.
- Consequences: новые URL `/categories/<slug>/...` и редиректы со старых `/articles/<slug>` и `/topics/<slug>` становятся реализуемыми (волна 2.2). Canonical статьи однозначен — он всегда строится по primary. Помещение статьи в secondary-ленты не размывает SEO. Пока legacy `topics` жив, любые операции, добавляющие категорию статье, обязаны писать в новые поля; старые reads через `topics` продолжают работать до явного cutover.

## ADR-007 · Публичный URL статьи перенесён на `/categories/<primary>/<slug>`, legacy маршруты редиректят

- Status: accepted
- Date: 2026-04-25
- Context: волна 2.1 ввела `primary_category` как фундамент. Чтобы хлебные крошки были осмысленными, canonical однозначен, а раздел был частью адреса (для SEO и читаемости), нужно перенести страницу статьи и ленту раздела на категорийные URL. Спека 2.2 явно требует редиректов со всех старых URL в том же PR, иначе SEO провалится через ~неделю.
- Decision: настоящие маршруты — `app/categories/[category]/page.tsx` (лента) и `app/categories/[category]/[slug]/page.tsx` (статья). Старые `app/articles/[slug]` и `app/topics/[topic]` стали тонкими server-side редирект-обёртками (`permanentRedirect`, 308). URL builder централизован в `lib/article-slugs.ts::getArticlePath(slug, primaryCategory)`; все потребители (sitemap, RSS, llms.txt, ArticleCard, PulseList, демо-страницы, Telegram digest, publish-verify, generate-images) переключены через него. Лента раздела включает статью, если её `primary_category` совпадает с категорией ИЛИ категория есть в `secondary_categories` — но canonical статьи всегда строится по primary, поэтому SEO-ценность не размывается.
- Consequences: Telegram digest и publish-verify теперь стучатся на канонический URL, а не на legacy. Sitemap и RSS отдают только новые URL. Любая поверхность, которая будет добавлять ссылку на статью, обязана получать `primary_category` (через `Article.primary_category` или явный аргумент) — иначе TS не пропустит вызов `getArticlePath`. Legacy URL остаются индексируемыми только в форме 308-редиректа; через ~30 дней Search Console должен показать переезд. Если потребуется ещё раз поменять схему slug — это уже scope волны 3.4 (рейминг slug-ов категорий) и обязательно с цепочкой редиректов.

## ADR-008 · Основная лента раздела сортируется по свежести, интересность вынесена в отдельный блок

- Status: accepted
- Date: 2026-05-01
- Context: сортировка category pages по `score desc` поднимала старые высокоскоринговые материалы выше новых статей. Это конфликтует с ожиданием читателя от раздела как свежей ленты, но полностью убирать редакционный score нельзя: он нужен для отдельной поверхности «что стоит прочитать».
- Decision: `getArticlesByCategoryPage()` и API load-more сортируют обычную ленту по свежести (`pub_date desc nulls last`, затем `created_at desc`, `score desc`, `id desc`). «Самое интересное» считается отдельно в `lib/interest-ranking.ts`: deterministic formula без ML-персонализации и без пользовательских профилей.
- Consequences: основной список раздела объясняется как fresh feed, а score участвует только как tie-breaker. Interest ranking можно менять и тестировать независимо от пагинации свежей ленты. Если позже появятся anonymous aggregate events, они должны добавляться в отдельную формулу/предвычисление, а не ломать порядок основной ленты.

## ADR-009 · Публикация live выполняется через RPC `publish_article`

- Status: accepted
- Date: 2026-05-02
- Context: прямой client-side update `articles.publish_status='live'` в `publish-verify` мог обойти инварианты текущей строки (`quality_ok`, актуальный `publish_status`, audit verifier) и оставить частично опубликованное состояние.
- Decision: normal path `pipeline/publish-verify.ts` после успешного HEAD-check вызывает `public.publish_article(article_id, 'publish-verify')`. RPC возвращает typed result code, а код пишет `article_attempts.stage='verify'` для неуспешных `publish_rpc_*` исходов. Единственный разрешённый прямой update в `live` остаётся emergency bypass `PUBLISH_RPC_DISABLED=1`, который поднимает warning alert `publish_rpc_bypass_active`.
- Consequences: переход в `live` стал атомарным и аудируемым через `last_publish_verifier`; операторы получают ранний сигнал, если bypass включён. Перед production smoke нужно убедиться, что текущая БД действительно имеет RPC: безопасный вызов с несуществующим UUID должен вернуть `not_eligible`.
