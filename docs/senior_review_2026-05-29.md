# Senior review — Malakhov AI Digest (2026-05-29)

> Рабочий, **не канонический** документ (audit/recommendation). Source of truth остаётся в `docs/*` канонических файлах.
> Цель: разобрать проект глазами сениора и выписать, что улучшить под три продуктовые цели:
> 1) интересный для чтения продукт, 2) SEO-трафик, 3) Telegram как возвратный канал + надёжный content-engine.

---

## TL;DR

Код в хорошей форме. `tsc --noEmit` проходит чисто под `strict`, `any` = 0, TODO/FIXME = 3,
`@ts-ignore`/`eslint-disable` = 4, service key изолирован в server-only token-gated роутах
(`app/internal/dashboard`, `app/api/health`). Архитектура и документация дисциплинированные.

**Слабые места не в коде, а в процессе и инфраструктуре**: нет CI-гейта качества, тесты не
подключены к раннеру, в working tree висит замороженный Python-стек, и эмердженси-хотфикс
по картинкам (`images.unoptimized=true`) бьёт прямо по цели №2 (Core Web Vitals → ранжирование).

Приоритеты ниже отсортированы по leverage/усилие.

---

## P0 — защита content-engine и SEO (низкое усилие, высокий эффект)

### 1. Нет CI-гейта качества на PR/push
**Что:** единственный workflow на `pull_request`/`push` — `docs-guard.yml` (только `npm run docs:check`).
Нет ни `npm run build`, ни `next lint`, ни `tsc --noEmit`, ни node-тестов в CI.
**Почему важно:** весь продукт — это автоматический cron-pipeline (RSS → enrich → publish → digest).
Регрессия уходит в прод молча. Инцидент 2026-05-22 (пустые ISR-страницы) показал, что прод хрупкий;
сейчас ничто не ловит поломку до деплоя.
**Рекомендация:** добавить `.github/workflows/ci.yml` (триггеры `pull_request` + `push: main`):
`npm ci` → `npx tsc --noEmit` → `npm run lint` → `npm test` → `npm run build`. Сделать его required check.
**Усилие:** ~1 час.

### 2. Тест-сьют не подключён к раннеру
**Что:** 36 файлов `tests/node/*.test.ts`, в `package.json` заскриптовано только 2
(`test:pipeline-reliability`, `test:batch-enrich`). Единого `npm test` нет; остальные 34 файла
запускаются только вручную по одному.
**Проверено:** выборка из 5 файлов (scorer, media-sanitizer, pagination, scene-matcher,
interest-ranking) = 49/49 pass. Сьют живой — просто не вызывается централизованно.
**Рекомендация:** добавить `"test": "tsx --test tests/node/*.test.ts"` и гейтить его в CI (см. P0.1).
Разделить «чистые» unit-тесты от тех, что требуют env/DB, чтобы CI не зависел от секретов.
**Усилие:** ~30 минут.

---

## P1 — производительность и SEO (цели №1 и №2)

### 3. Отключена оптимизация изображений Next.js
**Что:** `next.config.mjs` → `images.unoptimized = true`. Это был эмердженси-хотфикс 2026-05-22
под лимит image-трансформаций Hobby + egress Supabase.
**Почему важно сейчас:** корневая причина уже устранена (переезд обложек на R2 — бесплатный egress —
и апгрейд Supabase до Pro, см. `CLAUDE.md`). Раздача полноразмерных оригиналов без resize/AVIF/WebP
бьёт по LCP/Core Web Vitals → хуже ранжирование (цель №2) и медленнее чтение (цель №1).
**Рекомендация:** вернуть оптимизатор (теперь на Pro) **или** ввести image-CDN поверх R2
(Cloudflare Images / on-upload resize в `lib/r2.ts`). Это полноценный follow-up, не строчка в конфиге —
проверить, что лимиты Pro покрывают трафик. Сейчас в `CLAUDE.md` это записано как «возврат после Pro»,
но как задача нигде не трекается.
**Усилие:** 0.5–1 день + замер CWV до/после.

### 4. `remotePatterns: hostname '**'` — wildcard
**Что:** `images.remotePatterns` разрешает любой `https`-хост.
**Почему важно:** как только вернётся оптимизатор (P1.3), это делает `/_next/image` открытым
image-прокси для произвольных URL (SSRF-поверхность + расход трансформаций на чужой трафик).
**Рекомендация:** при возврате оптимизатора сузить до известных хостов (R2 public base, домены
активных источников из `pipeline/feeds.config.ts`). Сейчас, пока `unoptimized`, — риск низкий, но
закрыть вместе с P1.3.
**Усилие:** ~30 минут (вместе с P1.3).

---

## P1 — гигиена репозитория (важно для агент-driven workflow)

Проект явно TS-only (`legacy/` заморожен, Python-контур не поддерживается — см. `docs/PROJECT.md`).
Но working tree это не отражает, и это путает загрузку контекста (`npm run context`, чтение `tests/`).

### 5. Замороженный Python-стек живёт в дереве
**Что:** 19 трекаемых Python-тестов в `tests/` (`tests/api/*`, `tests/services/*`, `tests/digest/*`,
`tests/pipeline/*`, `tests/scripts/*`) тестируют несуществующие FastAPI-эндпоинты
(`test_internal_ingestion_endpoints`, `test_event_preview_endpoints`, `test_site_leads_endpoint`…).
Плюс `legacy/` (176 файлов), включая `legacy/node-duplicates/` (7 файлов, зеркалят текущий `app/`:
`page.tsx`, `layout.tsx`, `sitemap.ts`).
**Почему важно:** смешанное дерево `tests/` делает команду «прогони тесты» неоднозначной; дубликаты
`app/` в `legacy/node-duplicates/` создают риск, что правка уедет не в тот файл; контекст-доки и
агент тратят бюджет на мёртвый код.
**Рекомендация:** вынести `legacy/` из working tree (git tag `legacy-python-freeze` + удалить из ветки,
история сохранится) либо хотя бы удалить `legacy/node-duplicates/`. Стале Python-тесты — удалить или
явно карантинить (`tests/_legacy_python/` + README «не запускать»). После — `tests/` = только `tests/node`.
**Усилие:** ~1–2 часа.

### 6. Мусор в корне
**Что:** `local_dev.db` (4 МБ, SQLite от Python-стека) на диске; трекаются `design new/` (14 файлов)
и `articles ever green/` (8 файлов) в корне; несколько env-файлов рядом (`.env`, `keys.env`,
`malakhov-ai-keys.env` — корректно в `.gitignore`, не трекаются ✅, но лежат в корне).
**Рекомендация:** удалить `local_dev.db`; рабочие материалы (`design new/`, `articles ever green/`)
убрать в `docs/` или отдельный non-tracked каталог; держать секреты вне корня проекта.
**Усилие:** ~30 минут. (Секреты не утекли — это только про порядок.)

---

## P2 — поддерживаемость и резилентность

### 7. God-модули
**Что:** `lib/ops-summary.ts` (1000 строк), `lib/articles.ts` (909), `app/guides/[slug]/page.tsx` (910),
`app/categories/[category]/[slug]/page.tsx` (760).
**Рекомендация:** не срочно (код чистый), но при следующем касании — расщепить `ops-summary.ts` на
compute (`getOpsSummary`/`evaluateOpsStatus`) и format (`format*ForTelegram`); вынести секции
article-страниц в компоненты. Держать порог ~400–500 строк на модуль.
**Усилие:** инкрементально.

### 8. Demo-роуты в проде
**Что:** `app/demo/vector-covers/page.tsx` (1348 строк), `app/demo/image-lab/page.tsx` (741) ездят в
прод-бандле. Они корректно `noindex` + `disallow /demo/` в `robots.ts` ✅, но раздувают build и
остаются поверхностью поддержки.
**Рекомендация:** гейтить за env (`ENABLE_DEMO`) или вынести в отдельный sandbox/preview; не тащить
~2k строк лабораторных страниц в прод-сборку.
**Усилие:** ~1 час.

### 9. Дрейф документации про модель
**Что:** quick-таблица в `docs/PROJECT.md`/`docs/ARCHITECTURE.md` говорит «Claude Sonnet 4.6», но
живой enrich-путь (`.github/workflows/enrich.yml`) — DeepSeek-first fallback routing
(`editorial:routing --mode=cheap`, `deepseek-v4-flash`, Anthropic Batch как fallback).
**Рекомендация:** сверить канонический референс модели в `docs/ARTICLE_SYSTEM.md`/`ARCHITECTURE.md`
с реальным routing'ом, чтобы doc-impact-правило не врало о текущем стеке.
**Усилие:** ~20 минут.

### 10. Инцидент-learning не заэнфорсен
**Что:** урок 2026-05-26 («прод-редеплой при egress-заблокированном Supabase стирает stale ISR-кеш →
пустые страницы») зафиксирован прозой в `CLAUDE.md`, но ничем не защищён технически.
**Рекомендация:** post-deploy synthetic check — после промоушена дёргать `/api/feed` и алертить в
Telegram, если `total:0` (переиспользовать `pipeline/alerts.ts`). Опционально — pre-deploy guard,
который фейлит деплой при заблокированном Supabase.
**Усилие:** ~2–3 часа.

---

## Что уже хорошо (не трогать)

- `tsc --noEmit` зелёный под `strict`; `any` = 0; почти нет `ts-ignore`.
- ESLint-правило `no-restricted-imports` запрещает `app/**` импортировать `pipeline/*` — чистая граница.
- RLS-контракт и изоляция service key (только server-only token-gated) — корректные.
- Дисциплина «один топик = один канонический doc» + `docs-guard` на PR.
- Observability: `enrich_runs`/`llm_usage_logs`/`anthropic_batches` + health endpoint + ops-report.
- Cover-storage на R2 (бесплатный egress) убрал целый класс отказов.

---

## Предлагаемый порядок работ

Каждый блок разнесён в отдельный рабочий task-файл (untracked, для доработки):

1. **P0.1 + P0.2** (CI-гейт + `npm test`) — `docs/task_ci_gate_2026-05-29.md` — ~1.5 часа, максимальный leverage.
2. **P1.5 + P1.6** (вычистить legacy/Python + мусор) — `docs/task_repo_hygiene_2026-05-29.md` — разгружает контекст для будущих сессий.
3. **P1.3 + P1.4** (вернуть image-оптимизацию + сузить remotePatterns) — `docs/task_image_optimization_2026-05-29.md` — прямой эффект на SEO/CWV.
4. **P2.10** (synthetic check после деплоя) — `docs/task_deploy_resilience_2026-05-29.md` — закрывает известный инцидент-класс.
5. **P2.7–9** (god-модули, demo-роуты, дрейф докуменации) — `docs/task_maintainability_2026-05-29.md` — инкрементально.

Docs impact: no (этот файл — аудит, канонические доки не менялись).
