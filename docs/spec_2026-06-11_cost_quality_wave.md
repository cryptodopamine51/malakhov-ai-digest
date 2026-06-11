# Spec 2026-06-11 — Волна «дешевле без потери качества + контроль качества владельцем»

> Рабочая спецификация на разработку. Идеи и обоснования цифр — в
> `docs/ideas_2026-06-11_digest_cost_quality.md` (разбор 2026-06-11).
> Решения владельца зафиксированы 2026-06-11 (этот чат):
> - п.4 (high_score → balanced) — **через слепой тест** (решение 2026-06-11): сначала
>   5 пар Sonnet vs DeepSeek без подписей → выбор владельца → переключение только по итогам
>   (см. 4.1); запасной вариант — Haiku 4.5 как writer;
> - п.7 (degraded-режим) — **принят**, переключение автоматическое при недоступности
>   Anthropic + Telegram-уведомление о включении/выключении;
> - п.8 (gpt-image-1-mini) — **принят условно**: сначала одно тестовое сравнение,
>   выкатить на прод и дать владельцу ссылку; решение о переключении — после просмотра;
> - п.11 (few-shot в промпт DeepSeek) — **исключён**;
> - новое требование: **оценка статей владельцем из Telegram в один тап** (кнопки в
>   админ-чате + связка с LLM-judge), без необходимости перечитывать сайт;
> - остальные пункты — в работу.

Цель по деньгам: текст ~$3–5/день → ~$0.5–1/день; картинки $1/день → ~$0.5/день;
месячный AI-бюджет ~$120–180 → ~$30–45 при том же объёме выпуска.
Цель по качеству: появляется ежедневная метрика (judge) + ground truth владельца (feedback),
которых сейчас нет.

Implementation status 2026-06-11: W1, W2 и W3 реализованы в этом заходе; W4–W6 не тронуты.
Покрытие acceptance: batch-cost/list-cost тесты, risk false-positive/positive тесты,
premium source cap, stale-year validator, DeepSeek repair prompt, degraded-mode trigger/recovery
helpers, Haiku pricing, article quality judge parsing/prompt, Telegram feedback callback/auth,
ops-report quality block.

Operational closure 2026-06-11 (вечерняя проверка хвостов):
- `quality-feedback.yml` зарегистрирован на `main` (scheduled workflows исполняются только
  с default-ветки; до этого judge ни разу не запускался). Туда же добавлены
  `ANTHROPIC_API_KEY` в provider-guard шаг `pipeline-health.yml` (probe W2) и `DEEPSEEK_*`
  в `enrich-collect-batch.yml` (repair-pass W1.5 тихо скипался без ключа).
- Первый прогон judge выполнен вручную: 6 статей, баллы 4–5,
  `llm_usage_logs.operation='article_quality_judge'` ~$0.004/статья.
- Замер risk-флагов после фикса 1.2 (`npm run risk:audit -- --limit=500`):
  money 33.4%, research 23.2%, legal_regulation 5.2%, medical 4.0%, geopolitics 3.6%,
  high_score 0.2%. Замер «до» не записан (audit-скрипт появился вместе с фиксом);
  негативные кейсы покрыты тестами `tests/node/editorial-routing.test.ts`.
- Owner one-tap feedback проверен live: webhook на `news.malakhovai.ru/api/tg-feedback`,
  5 оценок владельца записаны в `article_feedback` (2026-06-11 13:53–13:54 МСК).

---

## Wave 1 — Quick wins без риска для качества (делается первым)

### 1.1. Batch-скидка в учёте стоимости

- **Проблема:** `estimateTextCostUsd` нигде в production-путях не вызывается с `batch: true`,
  логи и cost-report считают Anthropic Batch по list price (×2 от реального биллинга).
  Бюджет-гард `CLAUDE_DAILY_BUDGET_USD=1` из-за этого блокирует выпуск вдвое раньше
  (алёрты `enrich_submit_blocked_budget` в baseline 2026-06-10).
- **Что сделать:** при импорте batch-результатов (`enrich-collect-batch` / `llm-usage`)
  считать стоимость с `batch: true`. Желательно хранить обе цифры: `estimated_cost_usd`
  (billed) и list-цену в payload для истории. После фикса осознанно перенастроить
  `CLAUDE_DAILY_BUDGET_USD`.
- **Файлы:** `pipeline/llm-usage.ts`, `pipeline/enrich-collect-batch.ts`,
  `pipeline/model-pricing.ts` (без изменений логики тарифов), `pipeline/cost-guard.ts` (env).
- **Acceptance:** cost-report за день с batch-статьями показывает ~×0.5 от прежней цифры;
  ложных `enrich_submit_blocked_budget` нет.

### 1.2. Фикс ложных срабатываний risk-флагов

- **Проблема:** регэкспы в `pipeline/editorial-routing.ts` матчат подстроки:
  `выбор` (GEOPOLITICS_RE) ловит «выбор модели»/«выборка»; `закон` (LEGAL_RE) ловит
  «закономерность»; `персональн` (LEGAL_RE) ловит «персональный ассистент». Каждое ложное
  срабатывание = статья за $0.02–0.06 вместо $0.001.
- **Что сделать:**
  1. Сначала **замер** (read-only скрипт-однодневка): прогнать `detectEditorialRiskFlags`
     по последним ~500 статьям, вывести долю каждого флага и примеры матчей. Это и baseline,
     и проверка гипотезы о 30–60% ложных.
  2. Перевести регэкспы на границы слов через Unicode `\P{L}` (паттерн уже используется в
     `pipeline/scorer.ts`) и заменить слишком широкие стемы точечными:
     `выборы/выборах` вместо `выбор`; `закон(а|ом|у|ы|опроект|одатель)` вместо `закон`;
     `персональн(ых|ые) данн` вместо `персональн`. Проверить частотность `клиник`/`врач`.
  3. Повторить замер, сравнить распределение флагов до/после.
- **Файлы:** `pipeline/editorial-routing.ts`, новый `scripts/audit-risk-flags.ts` (read-only),
  тесты `tests/node/editorial-routing-flags.test.ts` (позитивные и негативные кейсы:
  «выбор модели» — не геополитика, «закон об ИИ» — legal).
- **Acceptance:** негативные кейсы зелёные; доля premium fallback по причинам `risk:*`
  в `enrich_runs`/routing-логах заметно падает без роста жалоб на качество.

### 1.3. Кап входного текста для premium-пути

- **Проблема:** `buildEditorialUserMessage` (`pipeline/claude.ts`) шлёт `originalText`
  целиком; Habr-лонгриды 30–60К символов дают $0.06+/статья. DeepSeek-бриф режет до 5 000
  символов без жалоб на качество.
- **Что сделать:** обрезать исходник для premium-пути до ~12–15К символов с обрезкой по
  границе абзаца (`\n\n`), добавить маркер «[текст сокращён]» в конец, чтобы модель не
  считала обрыв концом материала. Константа с env-override (`EDITORIAL_SOURCE_TEXT_CAP`).
- **Файлы:** `pipeline/claude.ts`, тест на функцию обрезки.
- **Acceptance:** средний input premium-вызова по Habr падает в разы; judge-оценки (Wave 3)
  по Habr не проседают.

### 1.4. Год-санитайзер на тела статей

- **Что сделать:** включить `hasStaleYearHallucination`-чек (сейчас только Telegram-caption)
  в editorial validator для `ru_title` / `lead` / `editorial_body`: прошедший год допустим,
  только если встречается в `original_title`/`original_text`. Провал — как обычная ошибка
  валидации (уйдёт в repair/retry-путь).
- **Файлы:** `pipeline/claude.ts` (validator), переиспользовать логику из
  `bot/channel-post-core.ts` / общего хелпера; тесты.
- **Acceptance:** синтетический кейс «WWDC 2025» при источнике про 2026 отбраковывается.

### 1.5. Repair-pass перед дорогим ретраем валидации

- **Проблема:** `editorial_validation_failed` сейчас = полная перегенерация новым батчем
  (до 3 попыток по полной цене).
- **Что сделать:** перед постановкой в `retry_wait` прогонять дешёвый DeepSeek-вызов
  «вот JSON статьи, вот список ошибок валидатора — исправь только перечисленное, остальное
  не трогай», затем повторный validator. Только при повторном провале — текущий retry-путь.
  Логировать как `operation='deepseek_editorial_repair'`.
- **Файлы:** `pipeline/editorial-repair.ts` (рядом с deterministic repair),
  `pipeline/enrich-collect-batch.ts`, `scripts/run-editorial-routing.ts`.
- **Acceptance:** доля статей, доходящих до полного ретрая, падает; в `llm_usage_logs`
  видны repair-вызовы по копеечной цене.

---

## Wave 2 — Надёжность: degraded-режим без Anthropic (решение владельца: авто + ТГ-алёрт)

- **Триггер-инцидент:** 2026-06-09 кончились кредиты Anthropic → выпуск упал с 60–70 до
  7 статей/день, хотя 90% статей пишет DeepSeek.
- **Поведение:**
  1. **Детект:** ошибка Anthropic класса billing/credits (`credit balance is too low`,
     401/403 billing) или N подряд недоступностей API → флаг
     `anthropic_degraded=true` (строка в БД, например в `pipeline_alerts` open-alert
     `anthropic_unavailable` severity=critical — все cron-воркеры читают одно место).
  2. **Уведомление в Telegram (требование владельца):** немедленный push в админ-чат при
     включении: «Anthropic недоступен (причина: …). Включён degraded-режим: low-risk статьи
     публикуются на DeepSeek без reviewer, high-risk ждут восстановления». Аналогичный push
     при выключении («Anthropic снова доступен, режим вернулся к обычному, в очереди X
     high-risk статей»).
  3. **Degraded-поведение:** low-risk статьи идут по чистому DeepSeek-пути без
     premium fallback и без reviewer, с пометкой в `article_attempts`/`llm_usage_logs`
     (`degraded=true`), чтобы потом можно было догнать review-ом. High-risk
     (research/legal/medical/geopolitics после фикса 1.2) — остаются `pending`/`retry_wait`.
     Никакие batch-сабмиты в Anthropic не создаются.
  4. **Восстановление:** дешёвый probe (повтор первого реального вызова или
     раз-в-launch проверка в существующих cron-ах); при успехе — флаг снимается, alert
     резолвится, очередь high-risk разбирается обычным путём.
- **Файлы:** `pipeline/provider-guard.ts` (похоже, уже есть подходящее место — проверить),
  `pipeline/alerts.ts`, `scripts/run-editorial-routing.ts`, `pipeline/enrich-submit-batch.ts`,
  `pipeline/retry-failed.ts`. Docs impact: `docs/OPERATIONS.md` (новый режим + recovery),
  `docs/ARTICLE_SYSTEM.md` (routing-поведение).
- **Acceptance:** симуляция billing-ошибки (mock/env) включает режим, шлёт ТГ-пуш, выпуск
  low-risk продолжается; восстановление снимает режим и шлёт второй пуш.

---

## Wave 3 — Контроль качества: LLM-judge + оценки владельца из Telegram

Делается ДО модельных переключений Wave 4 — это их страховка и baseline.

### 3.1. Ежедневный LLM-judge

- Раз в день (после утреннего цикла, отдельный workflow или шаг ops-report) брать выборку:
  5 вчерашних channel-постов + 5 случайных опубликованных. Каждую прогонять через
  **Claude Haiku 4.5** (`claude-haiku-4-5`) с рубрикой: опора на источник (нет фактов не из
  исходника), якорь в лиде, запрещённые фразы/канцелярит, полезность контекста, итоговая
  оценка 1–5 + одно предложение «почему». Структурированный JSON-ответ.
- Хранение: таблица `article_quality_scores` (article_id, judge_model, score, reasons jsonb,
  created_at) или payload в `llm_usage_logs` + отдельная таблица — решить при реализации
  (отдельная таблица предпочтительнее: по ней считаем агрегаты).
- Выход в ops-report: средний балл дня, разбивка по writer-пути (deepseek / premium /
  haiku-fallback когда появится), топ-3 худших со ссылками.
- Стоимость: ~10 статей × (~3К input + 300 output токенов) на Haiku — около цента в день.
- **Acceptance:** неделя данных без разрывов; ops-report показывает блок качества.

### 3.2. Оценки владельца в один тап (вариант А + judge-связка)

- **Канал доставки:** личный админ-чат (не публичный канал — кнопки под постами канала
  видели бы все подписчики).
- **Поток:** утром бот присылает владельцу один нумерованный пост до 8 статей:
  вчерашние 5 channel-постов и 2–3 худшие статьи по judge («judge считает слабой:
  …»). У каждой строки — inline-кнопки `🔥 сильная` / `👌 норм` / `👎 слабая`.
- **Приём тапов:** callback_query → новый webhook-route `app/api/tg-feedback/route.ts`
  (Vercel). Защита: Telegram `secret_token` на setWebhook + проверка `from.id` ==
  `TELEGRAM_OWNER_USER_ID` (новый env). Сейчас бот push-only, getUpdates/webhook не
  используется — при реализации проверить, что webhook не конфликтует ни с чем.
- **Хранение:** таблица `article_feedback` (id, article_id FK, rating smallint:
  2=🔥 / 1=👌 / 0=👎, source text: 'owner_tg', created_at, telegram_message_id).
  После тапа бот редактирует сообщение («✓ оценено: 🔥») — повторный тап перезаписывает.
- **Использование:**
  1. ops-report: агрегат оценок недели, расхождения judge ↔ владелец;
  2. калибровка judge: если judge систематически расходится с владельцем — правим рубрику;
  3. статистика по источникам/writer-путям («Habr через DeepSeek — средняя 👌, через
     premium — 🔥» и т.п.) — основа решений Wave 4;
  4. (позже, опционально) мягкий вес в ранжирование «Самое интересное».
- **Acceptance:** владелец получает утреннюю пачку, тап записывается в БД и подтверждается
  редактированием сообщения; чужой user_id отбрасывается.

---

## Wave 4 — Модельные переключения (только после ≥1 недели данных Wave 3)

### 4.1. high_score: слепой тест → решение владельца (изменено 2026-06-11)

> Решение владельца: НЕ переключать high_score на DeepSeek вслепую. Sonnet сейчас пишет
> только верхний срез (high_score / risk) — это самые видимые статьи (hot story, топ
> дайджеста), и reviewer защищает факты, а не «интересность» текста. Сначала слепой тест.

- **Шаг 1 — слепой тест (~$0.2, один вечер):** взять 5 свежих high_score статей. Каждую
  сгенерить двумя путями: (a) текущий Sonnet-рерайт, (b) DeepSeek-черновик + reviewer.
  Прислать владельцу в админ-чат 5 пар «вариант 1 / вариант 2» без подписи, кто есть кто
  (порядок рандомизировать). Владелец выбирает лучший в каждой паре.
- **Шаг 2 — решение по итогам:**
  - DeepSeek не отличим / 50:50 → переключаем high_score на balanced
    (убрать `high_score` из `CHEAP_FALLBACK_FLAGS`, reviewer форсится через `score_high`
    в `shouldReviewWithClaude`; откат — вернуть флаг / env-override). ~$0.004/статья.
  - Sonnet стабильно выигрывает → выбор между: оставить Sonnet как есть (статей с score ≥ 8
    немного, после Wave 1 это копейки) ИЛИ повторить тест с **Haiku 4.5 как writer**
    (та же школа Claude, ~$0.008/статья с batch-скидкой против ~$0.02 у Sonnet) и решить
    по нему.
- **Гейт после любого переключения:** неделя judge + оценок владельца по high_score статьям;
  откат при падении среднего judge-балла > 0.5 или доле reviewer→premium_fallback > ~40%.
- **Acceptance:** слепой тест проведён, выбор владельца зафиксирован в этом доке;
  переключение (если будет) — отдельный коммит после решения.

### 4.2. Haiku 4.5 для reviewer и не-research fallback-writer

- Reviewer (compact QA, маленький output) → `claude-haiku-4-5` ($1/$5 за MTok против
  $3/$15 у Sonnet). Модель reviewer-а — env (`EDITORIAL_REVIEWER_MODEL`), default пока Sonnet,
  переключение после A/B на judge-выборке.
- Fallback-writer для money/legal-новостей (после фикса 1.2 их станет меньше и они будут
  настоящими) — кандидат на Haiku; `ai-research` остаётся на Sonnet (порог глубины 1500
  символов). Тоже через env (`EDITORIAL_PREMIUM_MODEL_DEFAULT` / per-category override).
- Добавить тарифы Haiku в `ANTHROPIC_RATES_USD_PER_MTOK` (`pipeline/model-pricing.ts`):
  input $1, output $5, cacheRead $0.1, cacheCreate $1.25.
- **Гейт:** 1–2 недели сравнение judge-баллов и reject-rate Haiku-результатов против Sonnet.
- **Acceptance:** оставшийся premium-расход падает ~×3 без просадки метрик.

### 4.3. Prompt caching — проверка (попутно)

- По `llm_usage_logs.cache_read_tokens` проверить, есть ли cache-hit у batch-вызовов
  (system prompt уже под `cache_control`). Если стабильно 0 — зафиксировать в OPERATIONS,
  что на кеш в batch-экономике не рассчитываем; для sync reviewer-вызовов убедиться, что
  system побайтово стабилен. Учесть минимальный кешируемый префикс: Sonnet 4.6 — 2048
  токенов, Haiku 4.5 — 4096 (наш system prompt может не дотягивать для Haiku — тогда кеш
  там просто не работает, это не ошибка).

---

## Wave 5 — Картинки: тест gpt-image-1-mini (решение владельца: сравнение на проде → ссылка → его вердикт)

- **Шаг 1 — тестовая генерация:** взять 10–12 недавних статей, у которых сейчас AI-cover
  (разные сцены: product_launch, model_release, people_news, generic). Для каждой сгенерить
  обложку `gpt-image-1-mini` low 1536×1024 тем же scene-промптом. Стоимость теста ~$0.07.
- **Шаг 2 — страница сравнения:** добавить в существующую неиндексируемую лабораторию
  `/demo/image-lab` режим «1.5 vs mini»: пары обложек рядом (текущая прод-обложка ↔ mini),
  подпись со сценой и ценой. Задеплоить на прод, **дать владельцу ссылку**.
- **Шаг 3 — решение:** только после «ок» владельца переключить default `--model` в
  `scripts/generate-ai-covers.ts` / `ai-covers.yml` на mini для рядовых обложек.
  Homepage-priority остаётся `gpt-image-1.5` medium как сейчас. Если «дерьмо» — остаёмся
  на 1.5, тест закрываем, расход на картинки не трогаем.
- **Acceptance:** ссылка на сравнение отправлена владельцу; переключение — отдельный коммит
  после явного решения.

---

## Wave 6 — Отбор новостей

### 6.1. Telegram-views в ранжирование

- Раз в день забирать просмотры вчерашних постов канала и писать в
  `telegram_channel_posts.views` (+ `views_checked_at`). Получение: у Bot API нет прямого
  метода чтения views старых постов — при реализации проверить варианты
  (хранить из ответа sendPhoto нельзя — views растут после; реальные опции: MTProto-клиент
  read-only под отдельной сессией, либо парс публичной страницы t.me/s/<channel> — выбрать
  на этапе реализации, у t.me/s вариант дешевле и без новых секретов).
- Через 2–3 недели данных: агрегат «средние views по storyKey-типу/категории/источнику» →
  мягкий бонус в `rankDigestCandidates` (`bot/digest-selection.ts`) и опционально в
  `lib/interest-ranking.ts`. Вес небольшой, чтобы не самоусиливался (rich-get-richer).
- **Acceptance:** таблица наполняется ежедневно; ranking-бонус за фичефлагом.

### 6.2. Адаптивный порог score для шумных источников

- В `pipeline/feeds.config.ts` добавить опциональный `scoreThresholdBonus` (+1/+2) для
  источников с хронически высоким reject-rate или низким judge-баллом (данные — из Wave 3).
  Применять в pre-submit gate (`pipeline/enrich-submit-batch.ts`), чтобы мусор не доходил
  до enrichment вообще.
- **Acceptance:** rejected_breakdown показывает рост `low_score` у настроенных источников
  при неизменной доле live-публикаций качественных материалов.

---

## Исключено / отложено

- **Few-shot примеры в промпт DeepSeek** — исключено решением владельца 2026-06-11.
- **Сводный материал на мульти-источниковый storyKey** (−66% enrichment на повторных
  сюжетах, анти-каннибализация SEO) — отложено: крупная переделка pipeline-контракта,
  отдельная инициатива после этой волны.
- **Реакции аудитории в канале как сигнал** — возможное продолжение 3.2/6.1, не в этой волне.

## Порядок исполнения

`W1 (1.1→1.2→1.3, параллельно 1.4–1.5)` → `W2` → `W3` → [неделя сбора метрик] →
`W4 (4.1 → 4.2)` → `W5` (можно параллельно W3+) → `W6`.

## Docs impact (при реализации волн)

- W1–W3 в этом заходе: обновлены `docs/ARTICLE_SYSTEM.md` (risk-флаги, validator
  год-санитайзер, repair-pass, degraded routing, judge/feedback), `docs/OPERATIONS.md`
  (degraded-режим + recovery, новые env/команды/workflow, batch-discount cost accounting,
  quality judge/feedback), `docs/ARCHITECTURE.md` (новые operational tables).
- Миграции БД W3: `article_feedback`, `article_quality_scores`.
- Не трогалось в W1–W3: high_score/ranking-бонусы Wave 4+, image-model switch Wave 5,
  `telegram_channel_posts.views` Wave 6.
