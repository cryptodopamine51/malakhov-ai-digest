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
