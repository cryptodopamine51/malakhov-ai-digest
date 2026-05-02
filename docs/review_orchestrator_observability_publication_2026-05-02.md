# Review: ORCHESTRATOR observability_publication 2026-05-01 — недоработки и правки

**Дата ревью:** 2026-05-02
**Версия:** 1.2 (corrected, self-rechecked 2026-05-02)
**Объект:** `docs/ORCHESTRATOR_observability_publication_2026-05-01.md` и связанные spec / file_map / acceptance / task_breakdown.
**Метод:** сверка документа с фактическим кодом (`pipeline/`, `app/`, `tests/node/`, `supabase/migrations/`) и acceptance-критериями.
**Статус инициативы по orchestrator-у:** все 4 волны помечены ✅, финальный чек-лист закрыт.
**Статус по факту:** есть расхождения между orchestrator-чек-листом и реальным состоянием. Ниже — список правок, отсортированный по приоритету.

Легенда приоритетов: 🔴 блокер (нарушает acceptance / silent-data-loss) · 🟠 важно (риск регрессии или непрозрачность) · 🟡 housekeeping (тех-долг, мёртвый код, документация).
Метка `· verified` рядом с заголовком — источник расхождения сверен с кодом/файлом на дату ревью.

## Executive summary

| # | Заголовок | Приоритет | Acceptance под угрозой | Доказательство (verified) |
|---|---|---|---|---|
| P0 | Prod-deploy не привязан к git SHA | 🔴 | H6, J6 | `git status --short` → 88 entries после prod-smoke (`40 M`, `1 D`, `47 ??`) |
| P0.1 | `malakhov-ai-keys.env` — RTF, а не plain dotenv | 🔴 | H1, I1 | `file malakhov-ai-keys.env` → `Rich Text Format data, version 1, ANSI` |
| P1 | Bypass-update теряет 3 поля (`published`, `published_at`, `last_publish_verifier`) | 🔴 | D5, B-set, E2 | `pipeline/publish-verify.ts:143-156` |
| P2 | Финальный чек-лист закрыт формально, текст признаёт I3/I5/I6/D5 открытыми | 🔴 | I3, I5, I6, D5 | `docs/ORCHESTRATOR_observability_publication_2026-05-01.md:170-176` |
| P3 | Latency-таргеты E6 (300ms) / F6 (1.5s) ничем не проверены | 🟠 | E6, F6 | нет латентности в `tests/node/health-endpoint.test.ts` и `internal-dashboard-auth.test.ts` |
| P4 | Health/Dashboard handler не покрыт 401/200 | 🟠 | E1, F1, F2 | `tests/node/health-endpoint.test.ts` тестирует только pure `getHealthSummary` |
| P5 | Имена ключей `rejected_breakdown` расходятся со спекой | 🟠 | B6 | `pipeline/enrich-submit-batch.ts:319-323` пишет `low_score`; `keyword_filter` нет |
| P6 | CHECK constraint содержит мёртвые stage `'ingest'`/`'digest'` | 🟠 | A4 | `supabase/migrations/014_observability_publication.sql:24` vs `grep stage:`  |
| P7 | `not_eligible`/`rejected_unverified` оставляют статью в `verifying` | 🟠 | C3, D5/D6 | `pipeline/publish-verify.ts:201-242` |
| P8 | 23 open/untriaged alerts на момент применения миграции не задокументированы | 🟠 | I4 | `docs/ORCHESTRATOR_*:153` vs `:165` |
| P9 | `source_runs.fetch_errors_*` объявлены, но никем не пишутся | 🟠 | B3 | `lib/supabase.ts:145-146` есть, в `pipeline/ingest.ts:121-163` write нет |
| P10 | Lint-regex для `publish_status: 'live'` пропускает бэктики | 🟡 | D4 | `tests/node/publish-rpc.test.ts:73` |
| P11 | Миграция 015 не упомянута в spec/file_map/task_breakdown | 🟡 | A1, H4 | grep `015\|digest_runs_status_extension` в spec/file_map/task_breakdown — пусто |
| P12 | Legacy fallback в `source_runs` insert после применения миграции — мёртвый код | 🟡 | — | `pipeline/ingest.ts:149-162` |
| P13 | Таблица рисков ссылается на acceptance D2/C8 как «срабатывание» вместо «провал» | 🟡 | — | `docs/ORCHESTRATOR_*:128-130` vs `acceptance D2`, `C8` |
| P14 | `writeVerifyAttempt` дефолтит `errorCode='fetch_failed'` для verify-стадии | 🟡 | I6 | `pipeline/publish-verify.ts:101` |
| P15 | `scripts/observability-smoke.ts` указан в file_map § 8, но не реализован | 🟡 | I1, I2 | `ls scripts/` — отсутствует |

Итого: **2 операционных блокера** (P0 — git/SHA; P0.1 — env-файл), **1 кодовый блокер** (P1 — bypass-write), **1 статусный блокер** (P2 — чек-лист), **7 «важных»** (P3–P9), **6 housekeeping** (P10–P15). Acceptance-секции D5, E1, F1/F2, B3, B6, I3/I5/I6 не выполнены полностью — остальные 90% инициативы closed по факту.

---

## 🔴 P0. Production deploy не привязан к воспроизводимому commit · verified

**Где:** prod deploy Wave 4 / локальный git state после финального smoke.
**Production deployment:** `dpl_D3YRmZdC6JMTiAHxSDhJ4PeJFK5e` (orchestrator log line 165), aliased на `https://news.malakhovai.ru`.

**Что не так:** W4 задеплоен в production и smoke прошёл, но локальное рабочее дерево осталось незакоммиченным (`git status --short` на 2026-05-02 показывает 88 entries: `40 M`, `1 D`, `47 ??`, среди них новые `app/internal/dashboard/`, `MEMORY.md`, серия `docs/*_observability_*` и `docs/*_content_quality_*` файлов). То есть production-факт сейчас опережает git/source-of-truth.

**Последствия:**
- следующий Vercel deploy из `main` может откатить `/internal/dashboard`, RPC publish path, alert bypass и документацию;
- невозможно точно воспроизвести prod artifact по SHA commit-а;
- code review / rollback / hotfix будут сравниваться не с тем состоянием, которое реально работает в prod.

**Правка:**
1. Разобрать dirty tree: отделить intentional W4-файлы от unrelated изменений.
2. Зафиксировать W4 в git, запушить и убедиться, что production deployment соответствует этому commit SHA.
3. В `docs/ORCHESTRATOR_observability_publication_2026-05-01.md` и `docs/OPERATIONS.md` записать commit SHA + Vercel deployment ID.
4. До этого момента считать инициативу «production-smoked, but not source-controlled», а не полностью закрытой.

---

## 🔴 P0.1. `malakhov-ai-keys.env` не является надёжным dotenv-файлом · verified

**Где:** локальный secret-файл `malakhov-ai-keys.env` (он игнорируется `.gitignore`, но используется для production smoke).

**Что не так:** `file malakhov-ai-keys.env` отдаёт `Rich Text Format data, version 1, ANSI, code page 1252`, а не plain UTF-8 dotenv. При попытке использовать его как обычный env-файл парсер читает значения ненадёжно; `SUPABASE_SERVICE_KEY` из этого файла возвращал `Invalid API key` в smoke-проверке. `HEALTH_TOKEN` удалось использовать только через selective extraction, а не через обычную загрузку dotenv.

**Последствия:**
- будущий smoke может идти с неверным ключом или падать до реальной проверки production;
- runbook становится невоспроизводимым: команда «загрузить env-файл и запустить smoke» не работает как написано;
- форматированный secret-файл повышает риск случайной порчи ключей при редактировании.

**Правка:**
1. Пересоздать файл как plain UTF-8 dotenv без RTF-разметки.
2. Проверить загрузку через тот же механизм, который будет использовать smoke script.
3. Проверить `SUPABASE_SERVICE_KEY` отдельным безопасным read-only запросом; если происхождение ключа неясно — заменить/ротировать.
4. Рассмотреть разделение `HEALTH_TOKEN` и Supabase service credentials в разные локальные env-файлы, чтобы dashboard smoke не зависел от DB-ключей.

---

## 🔴 P1. Bypass-путь не пишет `last_publish_verifier` / `published_at` / `published` · verified

**Где:** `pipeline/publish-verify.ts:143-156` (функция `publishArticleViaRpc`, ветка `isPublishRpcBypassActive()`).

**Что не так:** в bypass-режиме (`PUBLISH_RPC_DISABLED=1`) делается прямой `UPDATE articles SET publish_status='live', verified_live=true, verified_live_at, live_check_error=null, updated_at`. Но не пишутся:
- `last_publish_verifier` — нарушает acceptance D5 «`articles.last_publish_verifier` заполнен для всех статей, ставших live после релиза W4».
- `published_at` — нарушает контракт RPC (`014_observability_publication.sql:79-86` всегда пишет `published_at = coalesce(published_at, now())`) и индекс `idx_articles_published_at_live`; запросы `live_window_6h_count` (`lib/health-summary.ts:122`) и `articles_published_today` (`lib/health-summary.ts:110`) фильтруют по `published_at`, поэтому статья в них не попадёт.
- `published = true` — расхождение с RPC-логикой, статья будет live без флага `published`.

**Последствия:** при использовании emergency bypass статьи становятся «полу-live»: видны на сайте (по `publish_status='live'`), но не попадают в `articles_published_today`, в `live_window_6h_count`, и в dashboard «Recent live publishes» (раздел читает `published_at`). Алёрт `published_low_window` может ложно срабатывать (он считает live-window, который теперь пуст).

**Правка:** в bypass-ветке выровнять состояние со спецификой RPC:

```ts
.update({
  publish_status: 'live',
  verified_live: true,
  verified_live_at: now,
  published: true,
  published_at: now, // или COALESCE через отдельный select
  last_publish_verifier: PUBLISH_VERIFIER,
  live_check_error: null,
  updated_at: now,
})
```

И добавить в `tests/node/publish-rpc.test.ts` regex-проверку, что bypass-update содержит все 5 полей (по аналогии с lint-тестом на отсутствие прямых `live`-апдейтов).

---

## 🔴 P2. Финальный чек-лист помечает закрытым то, что текстом признано открытым · verified

**Где:** `docs/ORCHESTRATOR_observability_publication_2026-05-01.md:167-176` (секция «Финальный чек-лист»).

**Что не так:** все 7 пунктов финального чек-листа имеют `[x]`, но тут же написано:
- I3 — «сейчас 0 published today» (т.е. условие не наблюдалось);
- I5 — «требует реальное alert событие» (не наблюдалось);
- I6 / D5 — «ожидают следующий реальный post-W4 publish cycle» (не наблюдалось).

В acceptance D5 и I3/I5/I6 не описаны никакие альтернативные signals-of-done. Получается, что инициатива закрыта формально, а три критерия — на самом деле «open, awaiting natural traffic».

**Правка:**
1. Заменить `[x]` на `[~]` (или `🟡 partial`) для двух пунктов чек-листа: «Все 4 волны ✅» оставить, а «Smoke I1–I7 выполнены» и «Acceptance A–H закрыты … J operational goals покрыты» переоформить с явным списком открытых кейсов.
2. Создать в orchestrator-е секцию «Pending observational sign-off» с явно зафиксированным условием выхода из неё (например: «после первого естественного post-W4 publish-цикла проверить D5/I6 и пометить здесь»).
3. Назначить триггер: `/loop` или scheduled-агент через 24–48 часов с проверкой `articles WHERE publish_status='live' AND verified_live_at > 2026-05-02T<deploy>`.

---

## 🟠 P3. Latency-таргеты E6 (`/api/health` < 300ms) и F6 (dashboard < 1.5s) ничем не проверены · verified

**Где:** acceptance E6, F6; orchestrator чек-лист «Smoke I1–I7 выполнены».

**Что не так:** в `tests/node/health-endpoint.test.ts` и `tests/node/internal-dashboard-auth.test.ts` нет ни одного измерения времени. В orchestrator-логе записано «authenticated production smoke … 200 + Cache-Control: no-store + полный HealthSummary contract» — статус 200 проверен, время отклика — нет.

**Правка:**
1. Добавить smoke-скрипт `scripts/observability-latency-smoke.ts` (или extend `scripts/observability-smoke.ts` из file_map § 8 — он, кстати, не реализован тоже): 5 параллельных `curl`-измерений, p50 < 300ms для health, p50 < 1500ms для dashboard, печать HDR-распределения.
2. Запустить против prod, зафиксировать результат в orchestrator-логе или в `docs/OPERATIONS.md` секции «Health endpoint v2».
3. Если p50 > target — настроить `Promise.all` в `lib/health-summary.ts` (если ещё не) и/или вынести `cost_today_usd` в memo (риск из таблицы рисков уже это упоминает: «кэшировать `cost_today_usd` через memoize в worker если > 300ms»).

---

## 🟠 P4. `health-endpoint.test.ts` не покрывает 401-путь (E1) · verified

**Где:** `tests/node/health-endpoint.test.ts:1-156` — все 6 тестов работают только с pure `getHealthSummary` через mockSupabase; ни один тест не импортирует `app/api/health/route.ts::GET` и не подаёт `Request` с/без токена. Аналогично `internal-dashboard-auth.test.ts:38-59` проверяет наличие `notFound()`/`headers()`/`isInternalDashboardAuthorized` через regex по исходнику, а не реальный HTTP-ответ.

**Что не так:** acceptance E1 явно требует «Без token — 401, с неверным — 401, с верным — 200». В тесте нет ни одного кейса, который импортировал бы handler из `app/api/health/route.ts` и прогонял через него `Request` с/без токена. Регрессия в auth-логике пройдёт незаметно.

**Правка:** добавить 3 теста на handler:

```ts
import { GET } from '@/app/api/health/route'
test('returns 401 when HEALTH_TOKEN env set but query missing', async () => {
  process.env.HEALTH_TOKEN = 's3cr3t'
  const res = await GET(new Request('http://test/api/health'))
  assert.equal(res.status, 401)
})
// + неверный токен → 401
// + правильный токен → 200, тело содержит ожидаемые ключи (можно мокать createServerClient)
```

То же — для `/internal/dashboard`: текущий `internal-dashboard-auth.test.ts` проверяет structural code (regex по файлу), а не реальный response. Нужен smoke с моком searchParams.

---

## 🟠 P5. Названия ключей в `rejected_breakdown` расходятся со спекой · verified

**Где:** `docs/spec_observability_publication_2026-05-01.md:30,35,115` vs `pipeline/enrich-submit-batch.ts:303-323`.

**Что не так:** spec явно требует `scorer_below_threshold` (`spec § 1` строка 30 и пример contract на строке 115) и `keyword_filter` в submit-агрегате (`spec § 1` строка 35: «pre-submit reject — `rejected_low_visual`, `scorer_below_threshold`, `keyword_filter`»). В коде пишется `low_score` (`pipeline/enrich-submit-batch.ts:319,323` → `bumpRejectedBreakdown(rejectedBreakdown, 'low_score')` через `staged.rejectedReason`). `keyword_filter` в submit-batch вообще не считается (он живёт в `rss-parser.ts`-фильтре, агрегируется только в `source_runs.items_rejected_breakdown`).

**Последствия:**
- Health-endpoint поле `articles_rejected_today_by_reason` в продакшне будет показывать `low_score: N`, а оператор, читая spec / OPERATIONS.md, ожидает `scorer_below_threshold`. Молчаливый mismatch.
- В `acceptance B6` («все причины reject») формально нарушено: `keyword_filter` не агрегирован.

**Правка:**
1. Решить: либо переименовать в коде на `scorer_below_threshold`, либо обновить spec / acceptance / OPERATIONS.md и зафиксировать `low_score` как канон. Рекомендация — второе (меньше touch на data-row), плюс в `lib/health-summary.ts` нормализовать оба ключа в один префикс.
2. `keyword_filter` уже считается в RSS-stage и пишется в `source_runs.items_rejected_breakdown`. Решить: считать ли это «достаточным» для acceptance B6, или дополнительно агрегировать в `enrich_runs.rejected_breakdown` через cross-stage rollup (тяжелее). Лучше — задокументировать в spec, что pre-RSS-rejects живут в `source_runs`, а не в `enrich_runs`.

---

## 🟠 P6. CHECK constraint расширен мёртвыми значениями · verified

**Где:** `supabase/migrations/014_observability_publication.sql:24` — `stage IN ('enrich','verify','verify_sample','fetch','media_sanitize','ingest','digest')`.

**Что не так:** `'ingest'` и `'digest'` добавлены, но ни в одном файле кода нет write-а с этими stages. Проверка: `grep -rn "stage:\s*['\"]" pipeline/` находит только `'fetch'`, `'enrich'`, `'media_sanitize'`, `'verify'`, `'verify_sample'`. Spec § 4 (Задача 4) разрешала только `'fetch'`; acceptance A4 расширил до `'fetch'+'media_sanitize'`. Дополнительные `'ingest'`/`'digest'` — дезинформирующее «обещание» в схеме.

**Правка:** либо
- (а) удалить `'ingest','digest'` из CHECK в новой миграции `016_*` (rollback-safe, потому что данных с этими stage нет), либо
- (б) реализовать запись (например, ingest-attempt при successful RSS, и digest-attempt при включении статьи в digest) — это полезный сигнал для I6 «полная траектория».

Рекомендация — (б), и тогда дополнить B-секцию acceptance двумя пунктами B9/B10.

---

## 🟠 P7. Состояния `not_eligible` / `rejected_unverified` оставляют статью «утопленной» · verified

**Где:** `pipeline/publish-verify.ts:201-242` (`handlePublishTransitionFailure`) и `pipeline/publish-verify.ts:308-316` (где новые candidates переводятся в `verifying`).

**Что не так:** для `rejected_quality` статья переводится в `withdrawn` и поднимается critical (строки 211-232). Для прочих failure-кодов (`rejected_unverified`, `not_eligible`) пишется только `live_check_error` + `updated_at` (строки 235-241). Статья остаётся в `publish_status='verifying'` (после `mark new candidates as verifying`) и больше не подхватывается selector-ом, который ищет `publish_status='publish_ready'` (строка 262). Будет «висеть» неопределённо долго.

**Правка:**
1. Для `not_eligible` (статья не соответствует invariants `publish_ready`/`verifying`) — расследование, но возврат в `publish_ready` с инкрементом `verify_attempts`.
2. Для `rejected_unverified` — то же поведение, что у `rejected_quality` (в `withdrawn`), потому что invariant verified_live не выполнится без ручного fix-а.
3. Добавить acceptance D7 «после `MAX_VERIFY_ATTEMPTS` failed RPC — статья не остаётся в `verifying`».
4. Тест `publish-rpc.test.ts` — кейс «5 raw failures подряд → статья не в `verifying`».

---

## 🟠 P8. Open alerts на момент применения миграции не отслежены до закрытия · verified

**Где:** orchestrator log line 153 — «alerts_open=23 (преимущественно `batch_poll_stuck` + 1 critical `enrich_submit_blocked_budget`)».

**Что не так:** acceptance I4 «В `pipeline_alerts` нет «застрявших» open-алёртов с `last_seen_at < NOW() - 24h` без причины». Финальный smoke (line 165) пишет «stale open alerts older 24h sample=0». Это значит: либо они были resolve-нуты автоматически (если `batch_poll_stuck` resolve-ится в `batch-collect`), либо просто `last_seen_at` обновился. В orchestrator-логе нет операторской отметки, что 23 алёрта были разобраны.

**Правка:** добавить в orchestrator секцию «Post-deploy alert triage» с однократной таблицей (alert_type → action: resolved / kept / acknowledged) и пометить I4 как закрытое только после неё. Иначе I4 — «нет stale» — всё ещё может быть истинно по таймстампу, но скрывает 23 неразобранных алёрта.

---

## 🟠 P9. `source_runs.fetch_errors_count` / `fetch_errors_breakdown` не наполняются · verified

**Где:** spec § 4 (`docs/spec_observability_publication_2026-05-01.md:75`): «Метрика идёт также в `source_runs.fetch_errors_count INT` и `source_runs.fetch_errors_breakdown JSONB`».

**Что не так:** orchestrator entry W3.1 (line 154) описывает только `article_attempts.stage='fetch'` и не упоминает запись агрегата в `source_runs.fetch_errors_*`. Колонки в миграции 014 объявлены и имеют DEFAULT `0`/`'{}'::jsonb`, тип в `lib/supabase.ts:145-146` присутствует, но `pipeline/ingest.ts::writeSourceRun` (строки 121-163) пишет только `items_rejected_count`/`items_rejected_breakdown`; `grep "fetch_errors_count\|fetch_errors_breakdown" pipeline/` возвращает 0 write-вхождений. Acceptance B3 «`source_runs.fetch_errors_count` отражает реальные fetch failures за run» формально нарушено.

**Правка:**
1. Проверить в `pipeline/ingest.ts` (или в любом месте, где финализируется `source_runs`) — пишется ли `fetch_errors_count`. Если нет — добавить агрегат по тем же `fetch_*` кодам, которые пишутся в `article_attempts.stage='fetch'`. Источник — счётчик в-памяти за run, scoped per source.
2. Дополнить тест `tests/node/article-attempts-fetch.test.ts` или создать `tests/node/source-runs-fetch-errors.test.ts`.
3. Если в текущей архитектуре fetch-of-article (для enrichment) не относится к ingest-source-у — задокументировать это в spec и снять B3, либо добавить дополнительный agg-write в момент enrich-submit-finalize.

---

## 🟡 P10. Lint-тест `publish_status: 'live'` пропускает template-литералы и динамические ключи · verified

**Где:** `tests/node/publish-rpc.test.ts:73` — regex `/.update\(\s*\{[\s\S]{0,600}?publish_status\s*:\s*['"]live['"]/m`.

**Что не так:** регекс матчит только `'live'` или `"live"`. Не сработает на:
- `publish_status: \`live\`` (бэктики);
- `publish_status: STATUS_LIVE` (константа);
- `publish_status: status` (через переменную) — в принципе не докажет ничего, но не относится к лину;
- `update({ ...patch, publish_status: 'live' })` — если `[\s\S]{0,600}` не достаёт.

**Правка:** ужесточить regex (добавить бэктики в alternation) и/или вынести список разрешённых файлов и проверять их через AST (overkill для текущего scope, можно отложить). Минимум — добавить кейс с бэктиком в `tests/node/publish-rpc.test.ts` как negative-fixture.

---

## 🟡 P11. Двойная миграция (014 + 015) для смежных DDL · verified

**Где:** `supabase/migrations/014_observability_publication.sql` (rejected_breakdown, RPC, stage check, индексы) и `015_digest_runs_status_extension.sql` (digest_runs.status enum extension). Поиск `015\|digest_runs_status_extension` в `spec_*`, `file_map_*`, `task_breakdown_*` возвращает пусто на момент ревью.

**Что не так:** spec § 6 явно указывал «миграция 014_observability_publication.sql» как единственный DDL. По факту enum `digest_runs.status` оказался отдельной миграцией 015 «надмножеством» предыдущего CHECK (orchestrator log: «обнаружен конфликт с миграцией 009 (`digest_runs_status_check_v2`), поэтому enum расширен надмножеством вместо replace»). Это рабочее решение, но:
- task_breakdown / file_map / spec до сих пор не упоминают 015 → новый разработчик не догадается, что нужно apply две миграции;
- rollback-сценарий в orchestrator (line 303-306) описывает только 014 и не учитывает 015.

**Правка:** обновить spec/file_map/task_breakdown «после факта» (оставить execution-history записи в orchestrator log + добавить ссылку на 015 в spec § 6), либо merge содержимого 015 обратно в 014 (если миграция ещё не накатана нигде кроме prod — можно сделать idempotent-merge через `DROP CONSTRAINT IF EXISTS`).

---

## 🟡 P12. Legacy column fallback в `source_runs.items_rejected_*` — мёртвый код · verified

**Где:** `pipeline/ingest.ts:149-162` (legacy fallback insert после catch на missing `items_rejected_count`/`items_rejected_breakdown`). Зафиксирован в orchestrator log W3.2.

**Что не так:** миграция 014 уже применена в prod (orchestrator log line 153 подтверждает «миграция 014 применена в production через Supabase Management API»). Fallback-ветка теперь никогда не сработает и только мутит код-ридинг. По принципу «no backwards-compatibility shims unless requested» (CLAUDE.md, общие правила) — стоит выпилить.

**Правка:** удалить legacy fallback в `pipeline/ingest.ts` (и в `pipeline/enrich-submit-batch.ts`/`enrich-collect-batch.ts`, если там тоже добавляли) после подтверждения, что prod-миграция 014 действительно гарантирована (CI-step или README-проверка).

---

## 🟡 P13. Risks-таблица ссылается на acceptance ID неправильно · verified

**Где:** `docs/ORCHESTRATOR_observability_publication_2026-05-01.md:128-130` (секция «Rollback-сценарии»).

**Что не так:** «При срабатывании D2 (RPC отказывает легитимные case)» — но D2 в acceptance это «Для `quality_ok=false` RPC возвращает `rejected_quality` и не меняет статус» (`docs/acceptance_criteria_observability_publication_2026-05-01.md:48`), т.е. наоборот: D2 — это **корректный** отказ, а не bug. Аналогично «срабатывание C8 (cooldown не работает)» — C8 = «Все алёрты соблюдают cooldown» (`acceptance:40`), т.е. этот пункт — **успех**, а не «срабатывание».

**Правка:** переписать как «При наблюдаемом регресc-симптоме X — действие Y», без cross-reference на ID, либо обновить ID, чтобы ссылаться на конкретный риск-сценарий, не на acceptance criterion.

---

## 🟡 P14. `writeVerifyAttempt` дефолтит `errorCode='fetch_failed'` для verify-стадии · verified

**Где:** `pipeline/publish-verify.ts:101` — `errorCode = resultStatus !== 'ok' ? 'fetch_failed' : null`.

**Что не так:** пре-existing bug, не вводится этой инициативой. Но при чтении `article_attempts.stage='verify'` оператор увидит `error_code='fetch_failed'` для verify-сбоев, не передавших explicit code. Сбивает диагностику I6 «по `article_attempts` восстановить полную траекторию».

**Правка (optional housekeeping):** заменить дефолт на `'verify_unknown'` или сделать обязательным (без default). За пределами scope этой инициативы — отметить в backlog.

---

## 🟡 P15. `scripts/observability-smoke.ts` из file_map § 8 не реализован · verified

**Где:** `docs/file_map_observability_publication_2026-05-01.md:161` указывает: «`scripts/observability-smoke.ts` | add | Скрипт, проверяющий: (a) RPC `publish_article` существует; (b) `enrich_runs.rejected_breakdown` присутствует; (c) `/api/health` отдаёт расширенный JSON; (d) последний `digest_run` имеет валидный status».

**Что не так:** скрипт не существует (`ls scripts/` показывает 15 файлов, среди них нет `observability-smoke.ts`). На prod-smoke полагается ручная проверка через `curl` + selective extraction секретов из RTF-файла (см. P0.1) — не воспроизводимо.

**Правка:** создать `scripts/observability-smoke.ts` с проверками RPC + health-shape + dashboard-status. Полезен и для P3 (latency).

---

## Итоговый план правок

Группировка по последовательности применения. Для каждого пункта — конкретный exit-criterion (что считать «закрыто»).

**Wave A — без релиза, только housekeeping и documentation (low risk, можно сразу):**

| # | Действие | Exit-criterion |
|---|---|---|
| P0 | Привести production и git к одному source-of-truth | intentional W4 file set закоммичен и запушен; в orchestrator зафиксированы `commit SHA` + `dpl_D3YRmZdC6JMTiAHxSDhJ4PeJFK5e`; `OPERATIONS.md` имеет ссылку на ту же пару; unrelated dirty entries либо вынесены в отдельный follow-up, либо явно исключены из W4 scope |
| P0.1 | Пересоздать `malakhov-ai-keys.env` как plain dotenv | `file malakhov-ai-keys.env` → `ASCII text` или `UTF-8 Unicode text`; smoke-сценарий запускается без selective extraction; `SUPABASE_SERVICE_KEY` подтверждён через `curl …/rest/v1/articles?select=id&limit=1` → 200 |
| P2 | Переоформить финальный чек-лист orchestrator | Чек-лист в `docs/ORCHESTRATOR_*:167-176` имеет `[~]` или явное «pending observational sign-off» для I3/I5/I6/D5; добавлена секция «Pending observational sign-off» с условием выхода |
| P11 | Упомянуть миграцию 015 в spec/file_map/task_breakdown | Поиск `015_digest_runs_status_extension` в spec/file_map/task_breakdown даёт хотя бы по одному совпадению |
| P13 | Поправить cross-references в risk-таблице | В `docs/ORCHESTRATOR_*:128-130` нет ссылок на D2/C8 в значении «срабатывание»; вместо них — описание риск-сценария без acceptance ID |

**Wave B — отдельный PR с миграцией кода (требует ревью):**

| # | Действие | Exit-criterion |
|---|---|---|
| P1 | Допилить bypass-update в `pipeline/publish-verify.ts:143-156` | bypass-update пишет 8 полей: `publish_status`, `verified_live`, `verified_live_at`, `published`, `published_at`, `last_publish_verifier`, `live_check_error`, `updated_at`; новый regex-тест в `publish-rpc.test.ts` падает, если хоть одно поле пропадёт |
| P7 | Корректно обработать `not_eligible`/`rejected_unverified` | Статья после `not_eligible` возвращается в `publish_ready` с инкрементом `verify_attempts`; `rejected_unverified` ведёт к `withdrawn`; новый кейс `tests/node/publish-rpc.test.ts` «5 failed RPC подряд → нет статьи в `verifying`» зелёный; добавлен acceptance D7 |
| P5 | Выровнять имена ключей `low_score`/`scorer_below_threshold`, `keyword_filter` | Решение зафиксировано в spec (один из двух вариантов: переименовать в коде или закрепить `low_score` как канон + нормализовать в health-summary); `keyword_filter` либо агрегируется в `enrich_runs.rejected_breakdown`, либо acceptance B6 переписан на «pre-RSS-rejects живут в `source_runs`» |
| P9 | Реализовать `source_runs.fetch_errors_*` агрегатор | `pipeline/ingest.ts::writeSourceRun` пишет non-zero `fetch_errors_count` при наличии fetch_*-failures за run; `tests/node/source-runs-fetch-errors.test.ts` (новый) зелёный; либо acceptance B3 явно снят с пометкой «pre-existing constraint» |

**Wave C — отдельный PR с тестами + смоук-скриптом:**

| # | Действие | Exit-criterion |
|---|---|---|
| P4 | Добавить 401/200 кейсы для `/api/health` и `/internal/dashboard` | `tests/node/health-endpoint.test.ts` импортирует `GET` из route и проверяет `401/401/200`; аналогично для dashboard-handler-а; оба теста зелёные |
| P3 + P15 | `scripts/observability-smoke.ts` + latency-замер на prod | Скрипт существует, проверяет (a-d) из file_map § 8 + измеряет p50 health < 300ms / dashboard < 1.5s; результат p50 зафиксирован в orchestrator log или `OPERATIONS.md` |

**Wave D — backlog (после prod-наблюдения):**

| # | Действие | Exit-criterion |
|---|---|---|
| P8 | Alert triage чек-лист в orchestrator | Секция «Post-deploy alert triage» с таблицей (alert_type → action) и подтверждением «23 open alerts разобраны или явно оставлены active с причиной»; I4 помечен закрытым только после неё |
| P12 | Удалить legacy fallback в `source_runs` insert | Строки 149-162 в `pipeline/ingest.ts` удалены; CI-гейт «миграция 014 присутствует на target БД» добавлен (или зафиксирован в README как pre-deploy check) |
| P6 | Решить судьбу `'ingest'`/`'digest'` stages | Либо новая миграция 016 убирает их из CHECK; либо `pipeline/ingest.ts` пишет `stage='ingest'` на successful-RSS, `bot/daily-digest.ts` пишет `stage='digest'`, добавлены acceptance B9/B10 |
| P10 | Ужесточить lint-regex | Regex в `tests/node/publish-rpc.test.ts:73` матчит и `'live'`, и `"live"`, и `` `live` ``; добавлен negative-fixture с бэктиком |
| P14 | Починить дефолтный `errorCode` в `writeVerifyAttempt` | Дефолт заменён на `'verify_unknown'` (или становится обязательным параметром); `article_attempts.stage='verify' AND error_code='fetch_failed'` per-run больше не появляется без явного `fetch_*` контекста |

**Trigger для автоматической проверки D5/I3/I5/I6:** scheduled-агент через 24–48ч после следующего успешного prod-deploy. Проверки:
- `articles WHERE publish_status='live' AND verified_live_at > <deploy-time>` — non-empty;
- все эти строки имеют `last_publish_verifier IS NOT NULL` и `published_at IS NOT NULL` (D5);
- `article_attempts` для одной из них показывает полную траекторию `enrich → verify` без silent return (I6);
- `articles_published_today > 0` (I3);
- хотя бы одно alert-событие пришло в Telegram админ-чат с правильным severity (I5).

После закрытия waves A-C и наблюдательного 24-48ч gate инициатива перестаёт быть «production-smoked, but not source-controlled» и помечается полностью закрытой в `docs/ORCHESTRATOR_observability_publication_2026-05-01.md`.

---

## Self-recheck (2026-05-02)

Все 16 пунктов сверены с актуальным кодом и документами:
- `pipeline/publish-verify.ts` (P1, P7, P14), `pipeline/enrich-submit-batch.ts` (P5), `pipeline/ingest.ts` (P9, P12), `lib/health-summary.ts` (P1 backref);
- `tests/node/publish-rpc.test.ts` (P10), `tests/node/health-endpoint.test.ts` + `tests/node/internal-dashboard-auth.test.ts` (P3, P4);
- `supabase/migrations/014_observability_publication.sql` + `015_digest_runs_status_extension.sql` (P6, P11);
- `docs/spec_observability_publication_2026-05-01.md`, `docs/file_map_observability_publication_2026-05-01.md`, `docs/acceptance_criteria_observability_publication_2026-05-01.md` (P5, P11, P13, P15);
- `docs/ORCHESTRATOR_observability_publication_2026-05-01.md` (P0, P2, P8, P13);
- env-файл `malakhov-ai-keys.env` (P0.1) + `git status --short` (P0; на момент проверки: `40 M`, `1 D`, `47 ??`, всего 88 entries).

После корректировок выше расхождений между текстом ревью и проверенными фактами не обнаружено. Документ можно считать рабочей финальной версией для запуска waves A-C; сам review-файл остаётся untracked до отдельного git commit вместе с intentional W4-документацией.
