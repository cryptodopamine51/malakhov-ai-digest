# Incident report — production-аудит 2026-05-01

Аудит production-состояния `news.malakhovai.ru` по трём вопросам:
1. Telegram-крон (вчера в неурочное время, сегодня вообще не пришёл).
2. Соответствие статей на сайте требованиям из `docs/ARTICLE_SYSTEM.md`.
3. Расход на Claude (~$4 за 2 дня вместо обещанных ~$0.5).

Все выводы получены из БД (`anthropic_batches`, `anthropic_batch_items`, `articles`, `digest_runs`, `enrich_runs`, `pipeline_alerts`, `llm_usage_logs`), GitHub Actions runs и Anthropic Batch API.

---

## 1. Telegram-крон

### Что наблюдается

| Дата (МСК) | Cron должен | Cron фактически | Результат |
|---|---|---|---|
| 2026-04-25 | 09:00 | 09:59 | success, 5 статей |
| 2026-04-26 | 09:00 | 10:13 | **skipped (0 статей)** |
| 2026-04-27 | 09:00 | 11:00 | **skipped (0 статей)** — потом ручной dispatch 11:51 success |
| 2026-04-28 | 09:00 | 11:00 | **skipped (0 статей)** — потом ручной dispatch 11:52 success |
| 2026-04-29 | 09:00 | 10:54 | success, 5 статей |
| 2026-04-30 | 09:00 | 10:58 | success, 5 статей (это «вчера в несогласованное время») |
| 2026-05-01 | 09:00 | 10:56 | **skipped (0 статей)** (это «сегодня вообще не пришло») |

Источник: `gh run list --workflow=tg-digest.yml` + таблица `digest_runs`.

### Корневые причины (две, независимые)

#### 1.1 GitHub Actions cron хронически опаздывает на 1–2 часа

Cron в `.github/workflows/tg-digest.yml` стоит `0 6 * * *` (06:00 UTC = 09:00 МСК), но GitHub Actions при загрузке shared-runner-ов задерживает планировщик. По всей выборке за 7 дней дайджест запускался в 09:54–11:00 МСК. Это поведение GitHub официально описывает как best-effort и в часы пик типичная задержка 30–120 минут. Это и есть «вчера пришло сообщение в несогласованное время».

#### 1.2 Сегодня пайплайн обогащения не отдал ни одной статьи → выборка `quality_ok=true` пуста → дайджест skip

Запрос дайджеста (`bot/daily-digest.ts:341`) требует одновременно:
- `quality_ok=true`
- `verified_live=true`
- `publish_status='live'`
- `tg_sent=false`
- pub_date в диапазоне «вчера МСК»

За 30 апреля МСК в БД 44 статьи — **все в `enrich_status='processing'`, `publish_status='draft'`, без `ru_title`, `slug`, `tg_teaser`**. Поэтому дайджест законно ничего не нашёл и зарегистрировал `digest_runs.status='skipped', articles_count=0`. На 1 мая та же картина — 13 статей в draft.

Корень — pipeline обогащения встал ещё **2026-04-29 14:35 МСК**. См. раздел 1.3.

#### 1.3 Anthropic-collector «запекся» на уже завершённых батчах и больше не доходит до новых

В `pipeline/enrich-collect-batch.ts:296` запрос на пуллинг:

```ts
.in('status', ['submitted', 'partial', 'completed', 'failed'])
.order('last_polled_at', { ascending: true })
.limit(BATCH_POLL_LIMIT)   // = 10
```

В Postgres `ORDER BY ... ASC` по умолчанию ставит `NULL` **в конец**. Сейчас в `anthropic_batches`:
- 10 строк со `status='completed'` имеют `last_polled_at` уже на 2026-05-01 09:13 (poll_attempts 27–34) и крутятся в очереди вечно;
- **20 строк со `status='submitted'` имеют `last_polled_at = NULL` и `poll_attempts = 0`**, а значит сортируются ПОСЛЕ опрошенных и в `LIMIT 10` никогда не попадают.

При этом по факту в Anthropic эти 20 батчей давно `processing_status: "ended"` (проверено через `GET /v1/messages/batches`) и содержат от 1 до 12 успешных результатов каждый. Они просто никогда не подбираются нашим коллектором.

Эффект: 89 статей застряли в `enrich_status='processing'`, начиная с 2026-04-29 14:35 МСК. Алертов `batch_poll_stuck` за период — около 20.

`pipeline/recover-batch-stuck.ts` для этого сценария **только пишет alert** и в Telegram-админку, но не делает recovery (полю `last_polled_at` не присваивает «давно», статус не сбрасывает). То есть авто-восстановления у нас в коде нет.

### Что чинить (по приоритету)

**P0 — снять блокировку, чтобы статьи поехали уже сегодня.**
1. Хотфикс в `pipeline/enrich-collect-batch.ts` функция `pollBatches`: добавить `nullsFirst: true` либо ужесточить фильтр статусов до `['submitted','partial']` (статус `completed` уже отработан, его можно исключить из poll-цикла, либо включать только если есть `anthropic_batch_items` со статусом != `applied`).
2. Поднять `BATCH_POLL_LIMIT` до 50 (батчи дешёвые в опросе) и снять корявый `nullsLast` на ALL-цикле. Это даст разовый pull всех 20 застрявших.
3. Запустить вручную из локали:
   `npx tsx pipeline/enrich-collect-batch.ts`
   и затем `npx tsx pipeline/publish-verify.ts` — чтобы статьи ушли в `live`.
4. После этого FORCE-дайджест: `gh workflow run tg-digest.yml -f force=true` — отправит вчерашний выпуск.

**P1 — починить надёжность.**
1. Добавить в `pipeline/recover-batch-stuck.ts` реальный recover для `batch_poll_stuck`: для строк, где `last_polled_at IS NULL AND created_at < NOW()-INTERVAL '5 min'`, проставить `last_polled_at = '1970-01-01'`, чтобы они получили приоритет в следующем cron-цикле.
2. Дублировать дайджест-cron: оставить GitHub Actions как backup, добавить **Vercel Cron** или Supabase pg_cron на 09:00 МСК — у обоих SLA на запуск в течение 1 минуты, в отличие от GH.
3. В `bot/daily-digest.ts`: если по выборке 0 статей и есть статьи в `enrich_status='processing' > 6h` — слать админу алёрт `digest_no_content_pipeline_stalled` с указанием количества зависших статей. Сейчас в этом случае молча `skipped`.
4. Вынести `BATCH_POLL_LIMIT` и явный `nullsFirst` в env, описать в `docs/OPERATIONS.md`.
5. Тест: добавить интеграционный тест на pollBatches, который вставляет 5 батчей с `last_polled_at=NULL` + 5 со старым timestamp и проверяет, что NULL-ы попадают в выборку при LIMIT=5.

**P2 — улучшения наблюдаемости.**
1. На `pipeline-health.yml` добавить степ «processing > 6h по статьям, NULL-poll по батчам — критический алёрт».
2. Поправить таблицу `digest_runs` так, чтобы `status='skipped'` при пустой выборке всегда писал `error_message='no_articles_in_window: <reason>'`.

---

## 2. Соответствие статей на сайте

### Что проверено

Спецификация из `docs/ARTICLE_SYSTEM.md`: enriched-статья должна иметь `ru_title`, `lead`, `summary[]`, `card_teaser`, `tg_teaser`, `editorial_body` (1500–5000), `cover_image_url`, `quality_ok=true`, `slug` без hex-хвоста, URL `/categories/<primary>/<slug>`, `verified_live=true`, опц. `article_videos`/`article_images`/`article_tables`.

### Что нашлось

#### 2.1 Контент-поля у `quality_ok=true` статей — в норме

Выборка из 15 свежих опубликованных статей: у всех заполнены все ключевые поля (`ru_title`, `lead`, `summary`, `card_teaser`, `tg_teaser`), `editorial_body` 1909–3994 символов, `cover_image_url` есть, `image_count` 1–5. Это полностью соответствует спеке.

#### 2.2 Видео практически отсутствует — расходится со спекой

| Категория | Всего qok | С видео |
|---|---:|---:|
| ai-russia | 173 | 0 |
| ai-industry | 147 | 1 |
| ai-research | 105 | 14 |
| ai-labs | 44 | 5 |
| ai-investments | 21 | 0 |
| ai-startups | 1 | 0 |

В `docs/ARTICLE_SYSTEM.md` явно сказано «Если в исходном материале есть тематически уместное встроенное видео, оно должно попадать в статью». По факту покрытие ~3% (20 из 491). Не критично (это feature, а не invariant), но fetcher не вытаскивает embed-ы, особенно из ru-источников Habr/vc.ru.

#### 2.3 31 статья с `publish_status='verification_failed'`

Запрос `publish-verify.ts` находит на сайте 404. Slug у всех имеет hex-хвост (`-26969c`, `-c71de1`, `-f98234`, `-103c90`, ...), при этом маршрут `/categories/[category]/[slug]/page.tsx` отдаёт 404 на такие. По спеке «новые slug создаются без hex-хвостов; legacy slug допускается только как входной адрес и редиректится на чистый». То есть либо:
- редиректы на чистый slug сейчас работают плохо для legacy-вариантов;
- либо в БД остался хвост, а на сайте уже чистый slug — тогда `verified_live` ложно negative.

Из выборки видно, что 8 из 10 живых проверок дают `HEAD 404` (legacy hex slug), 3 дают `regression: This operation was aborted` (timeout проверки, не проблема URL). Эти статьи де-факто не показываются в Telegram (фильтр `verified_live=true`), и в публичных лентах их нет (фильтр `publish_status='live'`). То есть — потеря 31 материала.

#### 2.4 Категории — перекос в `ai-russia`/`ai-industry`

`ai-startups` всего 1 статья. `ai-investments` — 21. Это говорит о том, что keyword-filters на источниках работают слишком строго (или порог категории `>=4` для startups недостижим). Это не баг, но дайджест по категории `ai-startups` пуст. По CLAUDE.md правилам — это требует обновления `docs/source_catalog_top_tier_2026-04-19.md` или `pipeline/feeds.config.ts`.

### Что чинить

**P1 — починить 31 verification_failed.**
1. Запустить скрипт `npx tsx scripts/check-links.ts` → получить актуальный список 404.
2. Для каждой `verification_failed` статьи определить: реальный 404 или ложный negative из-за HEAD-таймаута. Если url валиден — переключить на GET-проверку. Если slug битый — нормализовать через `lib/article-slugs.ts::canonicalSlug` и обновить.
3. После — запустить `publish-verify` повторно.

**P2 — поднять покрытие видео.**
1. В `pipeline/fetcher.ts` усилить video-extraction для Habr/vc.ru/RB.ru (selectors для `<iframe>` YouTube/Rutube/VK и кодек `data-rutube-video-id`).
2. Сделать backfill для уже опубликованных статей: `npx tsx scripts/backfill-article-videos.ts`.

**P3 — баланс категорий.**
1. Снизить `ai-startups` threshold до `>=3` (пока он `>=4`) или ослабить keyword-filters на vc.ru/rb.ru.

---

## 3. Расход на Claude

### Что наблюдается

`llm_usage_logs` за последние 7 дней:

| Дата МСК | Кол-во вызовов | Цена | Доминирующая операция |
|---|---:|---:|---|
| 2026-04-28 | 58 | **$2.45** | $1.05 — `manual_failed_article_recovery` (24 шт), $1.35 — `editorial_batch_result` (33), $0.05 — probe |
| 2026-04-29 | 17 | $0.74 | `editorial_batch_result` |
| 2026-04-30 | — | $0.00 в БД | (пайплайн встал, но Anthropic уже посчитал по своей стороне) |
| 2026-05-01 | — | $0.00 в БД | то же |

`anthropic_batches` за 7 дней (только успешно собранные):

| Дата | request_count | input | output | cache_read | cache_create | $ |
|---|---:|---:|---:|---:|---:|---:|
| 2026-04-28 | 33 | 53113 | 73116 | 57648 | 21618 | 1.354 |
| 2026-04-29 | 47 | 33156 | 38602 | 26422 | 14412 | 0.740 |

Среднее на одну успешно обработанную статью: **$0.041–0.044**. Это с уже включённой 50% Batch-скидкой (см. `pipeline/llm-usage.ts`).

### Корневые причины перерасхода против ожидаемых $0.5/день

#### 3.1 Цель «$0.5/день» в коде/доках не зафиксирована

В `docs/task_batch_api_enrich_cost_optimization_2026-04-21.md` официальная цель — **$1/день** («удержать реальный дневной расход ближе к безопасному диапазону ниже $1/day»). В `pipeline-health.yml` лимит `CLAUDE_DAILY_BUDGET_USD: 1`. Это не $0.5.

При фактической ставке $0.04/статья и потоке 30–50 статей/день дневной расход $1.20–$2.00 структурный. Чтобы держать $0.5 при текущем потоке нужно либо:
- ужесточить score-фильтр (поднять минимальный порог с 2 до 3) → ~30–40% меньше статей идёт в Claude;
- или ограничить количество статей/день hard cap (например, не более 12 для обычной ставки, 20 в breaking-режиме).

#### 3.2 Разовый перерасход на manual recovery

28 апреля операция `manual_failed_article_recovery` запустила 24 ре-энричмента по $0.044 каждый = $1.05 за раз. Это ручная правка, а не нормальная работа пайплайна. Cost-guard сработал и прислал алёрт ($1.5396 vs $1 budget) с правильным указанием причины. Это надо помнить — реактивные ручные операции «съедают» half-day budget.

#### 3.3 Невидимый расход за 30 апреля и 1 мая

Из-за бага collector (раздел 1.3) 20 завершённых батчей не импортированы в БД. Они **уже выполнены и оплачены на стороне Anthropic**. По нашим оценкам (по архивным успешным батчам ~$0.05/items): 20 батчей * 1–12 items = ~50–80 items * $0.04 = **$2–3 «теневого» расхода**. После того как мы починим collector и подберём результаты, эти расходы материализуются в `llm_usage_logs` и отчёт закроет gap.

#### 3.4 Cost-guard стоит на $1, но запускается раз в 2 часа

`pipeline-health.yml` cron `45 */2 * * *`. Между запусками может проскочить любой дорогой запуск (особенно ручной). Алёрт в Telegram приходит, но трат это не отменяет.

### Что чинить

**P0 — закрыть утечку «теневого» расхода.**
1. После фикса collector (раздел 1) — пересобрать `total_input_tokens`/`total_output_tokens`/`estimated_cost_usd` для всех batches со статусом `submitted` через `refreshAnthropicBatchUsageTotals` (есть в `pipeline/llm-usage.ts`). Это даст реальную картину расхода за 30 апреля и 1 мая.
2. Сравнить нашу оценку с реальным счётом в Anthropic Console (`https://console.anthropic.com/settings/usage`) — если расхождение >10%, проверить формулу cost в `pipeline/anthropic-batch.ts`.

**P1 — привести бюджет в порядок.**
1. Решить: $0.5/день — это реальный таргет или память? Если да, то:
   - Поднять scorer threshold с 2 до 3 в `pipeline/scorer.config.ts` (минус ~30–40% входящих в Claude).
   - Добавить в `pipeline/enrich-submit-batch.ts` hard cap `MAX_DAILY_ENRICHED=12` (через query `articles WHERE enrich_status='enriched_ok' AND updated_at >= today_start_msk()`).
   - Снизить `CLAUDE_DAILY_BUDGET_USD` в `pipeline-health.yml` с 1 до 0.5 — alert будет раньше.
2. Если бюджет $1/день остаётся — текущая ситуация в норме, но нужно зафиксировать в `docs/OPERATIONS.md`, что ручные recovery-операции тоже жгут деньги, и не запускать их без cost-guard pre-check.

**P2 — превентивные меры.**
1. Запретить `manual_failed_article_recovery` запускать партией >5 без подтверждения. Сейчас один запуск может сжечь $1+.
2. Добавить в cost-guard проактивный hard-stop: если `editorial_batch_result` за день уже >$0.7, новый submit-batch не отправляется (алёрт + skip).
3. Перенести cost-guard в `enrich-submit-batch.yml` (запускается каждые 30 мин), чтобы проверка была в момент потенциальной траты, а не раз в 2 часа.

---

## Сводка действий

| Приор. | Действие | Файл/команда | Эффект |
|---|---|---|---|
| **P0** | Хотфикс collector — `nullsFirst:true` в `pollBatches` | `pipeline/enrich-collect-batch.ts:296` | Подберёт 20 застрявших батчей |
| **P0** | Запустить collector + publish-verify + force-digest | CLI команды | Восстановит контент за 30.04 и 01.05 |
| **P0** | Пересчитать usage по подобранным батчам | `refreshAnthropicBatchUsageTotals` | Закроет gap в расходе |
| **P1** | Реальный recover для `batch_poll_stuck` | `pipeline/recover-batch-stuck.ts` | Авто-recovery на будущее |
| **P1** | Vercel Cron / pg_cron как backup для дайджеста | `vercel.json` либо migration | Стабильное время отправки |
| **P1** | Алёрт «pipeline stalled» при пустой выборке | `bot/daily-digest.ts` | Не молчать в ситуации skip |
| **P1** | Чинить 31 verification_failed | `scripts/check-links.ts` + slug fix | Вернуть 31 материал в ленту |
| **P1** | Решить целевой бюджет ($0.5 или $1) и зафиксировать | `pipeline-health.yml`, `docs/OPERATIONS.md` | Понятный SLA по расходу |
| **P2** | Усилить video-extraction в fetcher | `pipeline/fetcher.ts` | Поднять покрытие видео с 3% |
| **P2** | Hard-cap `MAX_DAILY_ENRICHED` | `pipeline/enrich-submit-batch.ts` | Защита от runaway-расхода |
| **P2** | Cost-guard вызывать перед submit-batch | `enrich-submit-batch.yml` | Защита в реальном времени |

Docs impact: после реализации P0–P1 нужно обновить `docs/OPERATIONS.md` (новый recover-flow, Vercel Cron, бюджет) и `docs/ARTICLE_SYSTEM.md` (если уточняется политика recovery / video / verification).
