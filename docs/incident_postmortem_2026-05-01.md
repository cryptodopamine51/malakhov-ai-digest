# Incident postmortem — 2026-05-01

Полный отчёт по инциденту 2026-04-29 → 2026-05-01 на `news.malakhovai.ru`: пропуск Telegram-дайджеста, замёрзший pipeline обогащения, перерасход на Claude API.

---

## 1. Что сломалось и почему

### 1.1 Telegram-дайджест: вчера в неурочное время, сегодня вообще не пришёл

**Симптом 1.** За 7 дней дайджест опаздывал каждый день на 1–2 часа от запланированных 09:00 МСК (фактические запуски 09:54–11:00). Пользователь это видел как «вчера в несогласованное время».

**Корневая причина 1.** GitHub Actions cron не имеет SLA на запуск. В часы пик (06:00–08:00 UTC) задержка 30–120 минут — норма. Документация GitHub: scheduled events «may be delayed during periods of high loads».

**Симптом 2.** На 2026-05-01 дайджест зарегистрировал `digest_runs.status='skipped', articles_count=0` и в Telegram ничего не отправил. То же самое 26.04, 27.04, 28.04 в первой попытке (потом ручной dispatch исправлял).

**Корневая причина 2.** `bot/daily-digest.ts` запросом к Supabase требует `quality_ok=true AND verified_live=true AND publish_status='live'` за вчерашний день МСК. На 2026-05-01 за 30 апреля МСК было 44 статьи, **все** в `enrich_status='processing'`, `publish_status='draft'`, без `slug`/`ru_title`/`tg_teaser`. Pipeline обогащения встал ещё 2026-04-29 14:35 МСК (см. 1.2).

### 1.2 Pipeline обогащения: 89 статей застряли в `processing` на 2 суток

**Симптом.** 20 батчей в `anthropic_batches` со `status='submitted', processing_status='in_progress', last_polled_at=NULL`. Параллельно 10 батчей со `status='completed', poll_attempts=27..34`. По проверке через `GET /v1/messages/batches` все 20 «застрявших» давно `processing_status: ended` со `succeeded: 1..12` каждый.

**Корневая причина.** `pipeline/enrich-collect-batch.ts:296` в `pollBatches`:
```ts
.in('status', ['submitted', 'partial', 'completed', 'failed'])
.order('last_polled_at', { ascending: true })
.limit(BATCH_POLL_LIMIT)   // = 10
```

В Postgres `ORDER BY ... ASC` по умолчанию сортирует `NULL` **в конец**. Когда в очереди накопилось ровно 10 уже-опрошенных `completed` батчей с заполненными `last_polled_at`, они стали постоянно возвращаться в выборке `LIMIT 10`. Новые `submitted` батчи с `last_polled_at=NULL` уехали в конец сортировки и **никогда не попадали в выборку**. Каждые 15 минут collector тратил вызовы Anthropic API на повторный poll одних и тех же завершённых батчей.

`pipeline/recover-batch-stuck.ts` для этого сценария **только писал alert** (`batch_poll_stuck`), но recovery-действия не делал. За 2 суток было ~20 алёртов в админский Telegram, но автомата возврата не было.

### 1.3 Расход на Claude API ~$4 за 2 дня вместо ожидаемых $0.5

**Симптом.** Пользователь видел в Anthropic Console счёт $4 за 28–29 апреля. Память ожидала $0.5/день.

**Реальная картина по `llm_usage_logs`:**

| Дата МСК | $ | Доминирующая операция |
|---|---:|---|
| 28 апреля | $2.45 | $1.05 — **разовый ручной recovery** (24 ре-энричмента), $1.35 — нормальный enrich (33 статьи) |
| 29 апреля | $0.74 | нормальный enrich (17 статей) |
| 30 апреля | $0.00 в БД | (но ~$2–3 «теневого» расхода в Anthropic из-за бага collector) |
| 1 мая | $0.00 в БД | то же |

**Корневые причины перерасхода:**

1. **Цели $0.5/день в коде/документации не существовало.** Реальный таргет в `docs/task_batch_api_enrich_cost_optimization_2026-04-21.md` — `$1/день`, `pipeline-health.yml` уже с `CLAUDE_DAILY_BUDGET_USD: 1`. При средней цене $0.04/статья в Batch API и потоке 30–50 статей/день, $1.20–$2.00/день — структурно ожидаемое значение.
2. **Разовые ручные recovery-операции жгут половину дневного бюджета за один заход.** `manual_failed_article_recovery` 28 апреля = $1.05 за один скрипт.
3. **Cost-guard работал только постфактум.** Запускался раз в 2 часа и писал alert уже после того, как деньги потрачены. Не блокировал submit.
4. **«Теневой» расход за 30.04 и 01.05.** 20 завершённых батчей в Anthropic уже оплачены, но не подгружены в нашу БД из-за бага collector — материализуются в логах после фикса.

---

## 2. Что починено

### Wave 1 (P0) — снять блокировку, восстановить контент

Коммит `1d3510e` на main, развёрнут 2026-05-01.

- **Хотфикс collector `pollBatches`** — `nullsFirst: true` в order clause. Один из самых тривиальных, но критических 1-line fix-ов.
- **Ручной прогон collector** (`BATCH_POLL_LIMIT=50`): подобрано 39 статей, 3 rejected, 3 failed.
- **Publish-verify через GH Actions:** 30 статей переведены в `verified_live=true, publish_status='live'`.
- **Force-digest за 30.04:** отправлено в TG (`telegram_message_id: 25`, 4 статьи).
- **Документ инцидента** `docs/incident_report_2026-05-01.md` + правка `docs/OPERATIONS.md`.

### Wave 2 (P1+P2) — починить надёжность так, чтобы не повторялось

Все изменения второй волны в этом коммите.

#### Auto-recover для polling deadlock (`pipeline/recover-batch-stuck.ts`)

Для каждой строки `anthropic_batches` с `last_polled_at IS NULL AND created_at < NOW() - INTERVAL '5 min'` **автоматически выставляем `last_polled_at = '1970-01-01T00:00:00Z'`**. Это форсит её в начало любой сортировки `last_polled_at ASC` — даже если кто-то когда-нибудь снова уберёт `nullsFirst`. Defense-in-depth. Запускается каждые 30 минут (`recover-batch-stuck.yml`).

#### Backup cron-времена для дайджеста (`.github/workflows/tg-digest.yml`)

Вместо одного cron-а `0 6 * * *` теперь 4 запуска подряд (06:00, 07:00, 08:00, 09:00 UTC = 09:00, 10:00, 11:00, 12:00 МСК). Первый успевший в дне claim-ит slot через `digest_runs` UNIQUE constraint, остальные мгновенно выходят с `already_claimed`. Гарантирует, что даже при максимальной задержке GH дайджест уйдёт до 12:00 МСК.

Не выбран Vercel Cron, потому что (а) требует синхронизации `SUPABASE_SERVICE_KEY`/`TELEGRAM_BOT_TOKEN` в Vercel env-ы, (б) дублирует код dispatch-а, (в) `digest_runs` UNIQUE гарантирует идемпотентность даже без внешнего lock-а.

#### Pipeline-stalled алёрт (`bot/daily-digest.ts`)

При `articles.length === 0` дополнительно запрашиваем количество `articles WHERE enrich_status='processing' AND processing_started_at <= NOW() - 6h`. Если > 0 — слать админу `digest_pipeline_stalled` alert + записать в `digest_runs.error_message='pipeline_stalled: N processing>6h'`. Раньше при пустой выборке скрипт молча писал `skipped` без указания причины.

#### Slug-нормализация (`pipeline/slug.ts`, `pipeline/enrich-collect-batch.ts`, `scripts/normalize-slugs.ts`)

В БД были 459 статей со slug-ами вида `asml-единственный-...` (кириллица) и `foo-bar-26969c` (legacy hex-хвост). Сайт их 404-ил, проверка в дайджесте отбрасывала, инбаунд 31 `verification_failed`.

- В `pipeline/slug.ts` добавлены `normalizeSlug(slug)` (deterministic ASCII-нормализатор) и `assertAsciiSlug(slug)` (runtime guard).
- В `pipeline/enrich-collect-batch.ts` после `ensureUniqueSlug` стоит `assertAsciiSlug` — невалидный slug приведёт item в `apply_failed_terminal` вместо записи мусора в `articles.slug`.
- `scripts/normalize-slugs.ts` — одноразовый скрипт. Прогнан с `APPLY=1`: 459 slug-ов нормализованы, конфликты разрешены через `-2/-3/...` суффикс.
- 31 статья с `publish_status='verification_failed'` сброшена, прогон `publish-verify`: **все 30 (одна невосстановимая) переведены в `verified_live=true, publish_status='live'`**.

В БД сейчас 0 не-ASCII slug-ов и 0 hex-хвостов.

#### Cost-guard перед submit-batch (`pipeline/cost-guard.ts`, `pipeline/enrich-submit-batch.ts`, `.github/workflows/enrich.yml`)

В `cost-guard.ts` извлечён публичный helper `getDailyBudgetStatus()`. `enrich-submit-batch.ts` вызывает его в самом начале `runEnrichSubmitBatch()`: если расход за сегодня уже > бюджета, **submit пропускается без claim-а**. Алёрт `enrich_submit_blocked_budget` уходит админу.

В `enrich.yml` добавлен step `Cost guard pre-check` перед `enrich-submit-batch`. С `CLAUDE_DAILY_BUDGET_USD: '1'` (целевой бюджет, согласован).

Hard-stop: даже если сторонняя ручная операция сожгла бюджет, плановый submit его не будет добивать.

#### Видео-extraction для русскоязычных источников (`pipeline/fetcher.ts`)

Расширил список селекторов «тела статьи». Добавлены классы Habr (`.tm-article-body`, `.article-formatted-body`, `.post__text`), vc.ru/DTF/TJ (`.content--full`), RB.ru (`.s-news__text`, `.b-article__text`).

Добавлен fallback: если в article-контейнерах нет iframe-ов, ищем ВСЕ iframe на странице, фильтруем по known video host (`youtube|youtu\.be|vimeo|rutube|vk\.com\/video_ext|vkvideo`) и исключаем sidebar/related/comments. Покрывает источники с нестандартной разметкой без рисков притянуть рекламу.

Backfill пользователь может запустить: `npx tsx scripts/backfill-article-videos.ts`.

---

## 3. Что в продакшене сейчас

| Метрика | Было до инцидента | Во время инцидента | Сейчас |
|---|---:|---:|---:|
| Статей `quality_ok=true, publish_status='live', verified_live=true` | ~430 | 460 (стагнация) | **529** |
| Статей в `publish_status='verification_failed'` | 31 | 31 | **0** |
| Статей в `enrich_status='processing'` | ~10 | 89 (зависшие) | <50 (рабочая очередь) |
| Slug-ов с кириллицей или hex-хвостом | 459 | 459 | **0** |
| Дайджест за 30.04 в TG | — | не отправлен | отправлен (msg 25) |

---

## 4. Почему мы уверены, что это не повторится

### 4.1 Polling deadlock

Защищено двумя независимыми механизмами:

1. `nullsFirst: true` в `pollBatches` — устранена сама первопричина.
2. Auto-rescue в `recover-batch-stuck` — даже если кто-то снова уберёт `nullsFirst`, скрипт каждые 30 минут принудительно выставит `last_polled_at='1970-01-01'` для строк старше 5 минут. Deadlock самоисцеляется максимум за 30 минут.

Оба фикса — независимые слои.

### 4.2 Тихий skip дайджеста

Раньше при пустой выборке скрипт молча завершался. Теперь:
- Проверяется количество застрявших статей (>6h).
- Если > 0 — алёрт `digest_pipeline_stalled` идёт в админский Telegram немедленно.
- В `digest_runs.error_message` пишется `pipeline_stalled: N processing>6h`.

### 4.3 Опоздание cron

4 cron-времени с интервалом по часу. SLA GitHub неважно: первый успешный отработает, остальные мгновенно exit-ят с `already_claimed`. Идемпотентность гарантирована UNIQUE constraint в `digest_runs`.

### 4.4 Перерасход Claude

Hard-stop в submit-pipeline: если `getDailyBudgetStatus().overBudget`, новые батчи не отправляются. Это работает на уровне функции (не зависит от cron-расписания cost-guard).

Дополнительно cost-guard теперь запускается как pre-step в `enrich.yml` каждые 30 минут перед submit. «Пояс + подтяжки»: код блокирует, и cron алёртит.

### 4.5 Кириллические/legacy slug-и

- БД на сегодня очищена (0 невалидных).
- `assertAsciiSlug` в коде collector — slug с не-ASCII больше не попадёт в `articles.slug`.
- `normalizeSlug` доступен как defensive helper.

### 4.6 Тесты и типы

`tests/node/*.test.ts` (38 тестов) проходят полностью. `tsc --noEmit` зелёный.

### 4.7 Документация

- `docs/OPERATIONS.md` — правило `nullsFirst` + ссылка на postmortem.
- `docs/incident_report_2026-05-01.md` — аудит первой итерации.
- `docs/incident_postmortem_2026-05-01.md` — этот документ.

---

## 5. Что НЕ было сделано осознанно

- **Vercel Cron как backup для дайджеста.** Вместо — 4 GH cron-времени. Меньше движущихся частей, идемпотентность уже обеспечена `digest_runs`.
- **Backfill видео для существующих статей.** Скрипт готов, но запускать на 491 статье из бота локально не оптимально — пользователь прогонит руками когда удобно: `npx tsx scripts/backfill-article-videos.ts`.
- **Hard cap `MAX_DAILY_ENRICHED`.** Не понадобился: cost-guard hard-stop по бюджету закрывает ту же угрозу более точно.
- **Замена scorer threshold (2 → 3).** Согласованный бюджет $1/день и текущий поток укладываются.

---

## 6. Команды для оперативной диагностики

```bash
# Проверить, не зависли ли батчи
curl -s -X POST "https://api.supabase.com/v1/projects/oziddrpkwzsdtsibauon/database/query" \
  -H "Authorization: Bearer $SUPABASE_PAT" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"SELECT status, processing_status, COUNT(*) FROM anthropic_batches GROUP BY 1,2\"}"

# Force-collect с локальной машины
BATCH_POLL_LIMIT=50 npx tsx pipeline/enrich-collect-batch.ts

# Force-trigger дайджеста на сегодня
gh workflow run tg-digest.yml -f force=true

# Узнать текущий дневной расход Claude
npx tsx scripts/claude-cost-report.ts

# Запустить нормализацию slug-ов (dry-run / apply)
npx tsx scripts/normalize-slugs.ts
APPLY=1 npx tsx scripts/normalize-slugs.ts
```

Docs updated: docs/OPERATIONS.md, docs/incident_report_2026-05-01.md, docs/incident_postmortem_2026-05-01.md.
