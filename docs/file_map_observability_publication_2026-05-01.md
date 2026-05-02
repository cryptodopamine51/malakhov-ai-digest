# File Map: Observability и публикация

**Дата:** 2026-05-01
**Связанная спецификация:** `docs/spec_observability_publication_2026-05-01.md`

Карта файлов для реализации. Колонка «Действие»: `add` — новый файл, `edit` — точечная правка, `extend` — крупное расширение существующего, `delete` — удаление.

## 1. Миграции БД

| Файл | Действие | Что внутри |
|---|---|---|
| `supabase/migrations/014_observability_publication.sql` | add | См. ниже DDL |

**DDL (полный текст):**

```sql
-- 014_observability_publication.sql

-- 1. enrich_runs.rejected_breakdown
ALTER TABLE enrich_runs
  ADD COLUMN IF NOT EXISTS rejected_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. source_runs.fetch_errors_count + fetch_errors_breakdown
ALTER TABLE source_runs
  ADD COLUMN IF NOT EXISTS fetch_errors_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fetch_errors_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS items_rejected_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS items_rejected_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 3. article_attempts.stage — расширить enum check
ALTER TABLE article_attempts DROP CONSTRAINT IF EXISTS article_attempts_stage_check;
ALTER TABLE article_attempts
  ADD CONSTRAINT article_attempts_stage_check
  CHECK (stage IN ('ingest','fetch','enrich','media_sanitize','verify','verify_sample','digest'));

-- 4. RPC publish_article (атомарный переход)
CREATE OR REPLACE FUNCTION public.publish_article(
  p_article_id uuid,
  p_verifier text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quality_ok boolean;
  v_publish_status text;
  v_verified_live boolean;
BEGIN
  SELECT quality_ok, publish_status, verified_live
    INTO v_quality_ok, v_publish_status, v_verified_live
    FROM articles
    WHERE id = p_article_id
    FOR UPDATE;

  IF NOT FOUND THEN RETURN 'not_eligible'; END IF;
  IF v_publish_status = 'live' THEN RETURN 'already_live'; END IF;
  IF v_quality_ok IS NOT TRUE THEN RETURN 'rejected_quality'; END IF;
  IF v_publish_status NOT IN ('publish_ready','verifying') THEN RETURN 'not_eligible'; END IF;

  UPDATE articles
    SET publish_status = 'live',
        verified_live = true,
        verified_live_at = NOW(),
        published = true,
        published_at = COALESCE(published_at, NOW()),
        last_publish_verifier = p_verifier
    WHERE id = p_article_id;

  RETURN 'published_live';
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_article(uuid, text) TO service_role;

-- 5. articles.last_publish_verifier (опционально, для аудита)
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS last_publish_verifier text;

-- 6. digest_runs status enum extension
ALTER TABLE digest_runs DROP CONSTRAINT IF EXISTS digest_runs_status_check;
ALTER TABLE digest_runs
  ADD CONSTRAINT digest_runs_status_check
  CHECK (status IN (
    'success',
    'skipped_already_claimed',
    'skipped_no_articles',
    'skipped_outside_window',
    'failed_send',
    'failed_pipeline_stalled'
  ));

-- 7. Индекс для published_low_window и dashboard
CREATE INDEX IF NOT EXISTS idx_articles_published_at
  ON articles (published_at DESC) WHERE publish_status = 'live';
```

## 2. Pipeline (новые)

| Файл | Действие | Назначение |
|---|---|---|
| `pipeline/published-window-monitor.ts` | add | Реализация `runPublishedWindowMonitor()` для wave 2.1 |

## 3. Pipeline (правки)

| Файл | Действие | Что меняем |
|---|---|---|
| `pipeline/alerts.ts` | edit | В `COOLDOWN_HOURS` добавить: `published_low_window: 2`, `publish_verify_failed_warn: 1`, `claude_parse_failed: 4`, `lease_expired_spike: 2`, `llm_usage_log_write_failed: 4`. Удалить или оставить `enrich_failed_spike`/`backlog_high` по факту реализации |
| `pipeline/enricher.ts` | edit | Не требует прямых правок (legacy, не активный path) — пропустить |
| `pipeline/enrich-submit-batch.ts` | edit | Считать pre-submit `rejected_breakdown` (по `rejected_low_visual`, `scorer_below_threshold`, `keyword_filter`); записать в `enrich_runs.rejected_breakdown` в финализаторе |
| `pipeline/enrich-collect-batch.ts` | edit | (a) считать post-collect rejects → `rejected_breakdown`; (b) при `error_code='claude_parse_failed'` в строке 305–320 — `fireAlert('claude_parse_failed', warning, cooldown 4h)` |
| `pipeline/fetcher.ts` | extend | Все ошибочные ветки → возвращают нормализованный `error_code`; вызывающий (`enrich-submit-batch.ts`) пишет `article_attempts` со `stage='fetch'`. Также возвращает per-source агрегацию для `source_runs.fetch_errors_*` |
| `pipeline/ingest.ts` | edit | При финализации `source_runs` записать `items_rejected_count` и `items_rejected_breakdown` (источник — `pipeline/rss-parser.ts`) и `fetch_errors_count/breakdown` |
| `pipeline/rss-parser.ts` | edit | Возвращать в результат массив отклонённых items с причиной (`keyword_filter`, `requireDateInUrl`, `dedup`); ingest агрегирует |
| `pipeline/publish-verify.ts` | edit | (a) на 1-й failure поднимать `publish_verify_failed_warn` (warning); на `MAX_VERIFY_ATTEMPTS` — оставить current critical; (b) при success вызывать `resolveAlert('publish_verify_failed_warn', entityKey)` и `resolveAlert('publish_verify_failed', entityKey)`; (c) при transition в `live` использовать RPC `publish_article(article_id, 'publish-verify')`; (d) при `PUBLISH_RPC_DISABLED=1` — fallback на прямой `UPDATE` + `fireAlert('publish_rpc_bypass_active', warning)` |
| `pipeline/recover-stuck.ts` | edit | Считать сколько lease было восстановлено за run; если > 3 — `fireAlert('lease_expired_spike', warning)` |
| `pipeline/llm-usage.ts` | edit | `writeLlmUsageLog` оборачиваем в try/catch + `fireAlert('llm_usage_log_write_failed', warning)`; не throw наружу |
| `pipeline/backlog-monitor.ts` | edit | Реализовать `fireAlert('backlog_high', warning)` при превышении `BACKLOG_HIGH_THRESHOLD` (default 80); `resolveAlert` при возврате |
| `pipeline/media-sanitizer.ts` | edit | Возвращать структурированные `rejects` из `sanitizeArticleMedia`; вызывающие (`enrich-submit-batch.ts`, `enrich-collect-batch.ts`) пишут `article_attempts` со `stage='media_sanitize'` (только при не-пустом массиве rejects) |

## 4. Bot

| Файл | Действие | Что меняем |
|---|---|---|
| `bot/daily-digest.ts` | edit | Каждая выходящая ветка обязана вызвать `writeDigestRun` с конкретным `status` из enum (см. spec). Удалить silent return (~line 181–186). При обнаружении `pipeline_stalled` — переход на `status='failed_pipeline_stalled'` |

## 5. App / API

| Файл | Действие | Что меняем |
|---|---|---|
| `app/api/health/route.ts` | extend | Добавить поля `oldest_pending_age_minutes`, `articles_published_today`, `articles_rejected_today_by_reason`, `cost_today_usd`, `live_window_6h_count`, `top_open_alerts` (см. контракт) |
| `app/internal/dashboard/page.tsx` | add | Server component, рендерит блоки health + alerts + stuck batches + recent live + last digests |
| `app/internal/dashboard/sections/HealthCards.tsx` | add | UI-блок (читать) |
| `app/internal/dashboard/sections/AlertsTable.tsx` | add | UI-блок |
| `app/internal/dashboard/sections/StuckBatchesTable.tsx` | add | UI-блок |
| `app/internal/dashboard/sections/RecentLiveTable.tsx` | add | UI-блок |
| `app/internal/dashboard/sections/DigestsTable.tsx` | add | UI-блок |
| `app/internal/middleware.ts` или общий `middleware.ts` | edit | Гард на `/internal/dashboard` через `HEALTH_TOKEN` (?token=... или header). Без токена — 404 |

> Уточнение: middleware в Next.js App Router — корневой `middleware.ts`. Если уже существует — extend; если нет — add.

## 6. Lib

| Файл | Действие | Что меняем |
|---|---|---|
| `lib/supabase.ts` | edit | Тип `Article` — добавить `last_publish_verifier?: string \| null`. Тип `EnrichRun` — `rejected_breakdown?: Record<string, number>`. Тип `SourceRun` — поля fetch/items rejected |
| `lib/articles.ts` | none | Не трогаем (visibility gate `quality_ok=true` уже есть) |
| `lib/health-summary.ts` | add | Чистая функция, собирающая блок данных для `/api/health` и `/internal/dashboard` (DRY) |

## 7. GitHub Actions

| Файл | Действие | Что меняем |
|---|---|---|
| `.github/workflows/pipeline-health.yml` | edit | Добавить step `run published-window-monitor`. Если уже агрегирует backlog/source-health — просто extend |
| `.github/workflows/publish-verify.yml` | none | Не меняем cron, но новый код алёрта warning поднимется автоматически |

## 8. Scripts

| Файл | Действие | Что меняем |
|---|---|---|
| `scripts/observability-smoke.ts` | add | Скрипт, проверяющий: (a) RPC `publish_article` существует; (b) `enrich_runs.rejected_breakdown` присутствует; (c) `/api/health` отдаёт расширенный JSON; (d) последний `digest_run` имеет валидный status |

## 9. Tests (обязательны)

| Файл | Действие | Покрытие |
|---|---|---|
| `tests/node/observability-rejected-breakdown.test.ts` | add | Агрегатор причин в submit/collect-batch финализаторах |
| `tests/node/published-window-monitor.test.ts` | add | (a) 0 live за окно → fire; (b) 0 live + ingest_failed за окно → не fire; (c) ночное окно МСК → не fire; (d) после live — resolve |
| `tests/node/publish-verify-warn.test.ts` | add | 1-й failure → warn fire; 3-й failure → critical fire; success → resolve обоих |
| `tests/node/digest-runs-completeness.test.ts` | add | Каждая ветка `daily-digest.main()` пишет `digest_runs` row с легитимным status |
| `tests/node/article-attempts-fetch.test.ts` | add | На 404/timeout/empty fetcher вызывает писатель `article_attempts` со `stage='fetch'` и нормализованным `error_code` |
| `tests/node/publish-rpc.test.ts` | add | (a) `quality_ok=false` → `rejected_quality`; (b) `publish_status='live'` → `already_live`; (c) валидный путь → `published_live`; (d) lint: вне `publish-verify.ts` нет `publish_status: 'live'` записей |
| `tests/node/health-endpoint.test.ts` | add | Контракт ответа /api/health — все поля присутствуют, типы корректны |
| `tests/node/internal-dashboard-auth.test.ts` | add | Без токена — 404; с токеном — 200 + содержимое |
| `tests/node/alert-cleanup.test.ts` | add | `COOLDOWN_HOURS` не содержит «мертвых» ключей, для каждого ключа есть `fireAlert(...)` в коде (grep-test) |

## 10. Документация (после реализации каждой волны)

| Файл | Действие | Что обновляется |
|---|---|---|
| `docs/OPERATIONS.md` | edit | Новые алёрт-типы; расширенный health; admin dashboard; cleanup мёртвых алёртов |
| `docs/ARTICLE_SYSTEM.md` | edit | Описание RPC `publish_article`; rejected_breakdown; новый stage `fetch`/`media_sanitize` в `article_attempts` |
| `docs/DECISIONS.md` | edit | Запись о принятии RPC-only пути для transition в `live`; решение по `enrich_failed_spike`/`backlog_high` |
| `docs/INDEX.md` | edit | Регистрация новых временных файлов |
| `CLAUDE.md` | edit | Update last-modified date после wave 4 |

## 11. ENV (новые/опциональные)

| Переменная | Назначение | Default |
|---|---|---|
| `BACKLOG_HIGH_THRESHOLD` | порог для `backlog_high` | 80 |
| `PUBLISHED_LOW_WINDOW_HOURS` | окно для проверки публикаций | 6 |
| `PUBLISHED_LOW_WINDOW_QUIET_START_MSK` | начало «тихого окна» | 0 (00:00 МСК) |
| `PUBLISHED_LOW_WINDOW_QUIET_END_MSK` | конец «тихого окна» | 6 (06:00 МСК) |
| `PUBLISH_RPC_DISABLED` | emergency bypass для RPC `publish_article` (см. spec § 5) | unset |

`HEALTH_TOKEN` уже используется (`app/api/health/route.ts:7`). Используем тот же для `/internal/dashboard` — отдельный секрет не вводим.
