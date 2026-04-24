# Spec: план миграции pipeline status-layer

**Дата:** 2026-04-20  
**Статус:** migration plan перед разработкой

## 1. Цель миграции

Ввести новый operational layer без одномоментного разрыва с текущей логикой сайта и Telegram, которые читают legacy-флаги.

## 2. Preconditions

- миграция должна быть additive на первом шаге
- существующая таблица `digest_runs` сохраняется
- существующие публичные чтения не переключаются в той же транзакции, что и schema-add
- старые строки в `articles` должны получить backfill

## 3. Фаза 0. Подготовка

До выкатки schema change нужно зафиксировать:

- точное значение `published` в переходный период
- стратегию atomic claim: SQL update или RPC
- SQL view `public_articles` как часть первой или второй миграции

## 4. Фаза 1. Additive schema migration

Добавить:

- новые status/lease/error поля в `articles`
- `ingest_runs`
- `source_runs`
- `enrich_runs`
- `pipeline_alerts`
- `article_attempts`
- нужные индексы и check constraints

На этом шаге:

- ничего не удалять
- не менять старые workflow
- не менять публичные выборки

## 5. Фаза 2. Dual-write rollout

Обновить `pipeline/ingest.ts` и `pipeline/enricher.ts`, чтобы они писали:

- новые статусы
- новые operational timestamps
- legacy `enriched/published/quality_ok`

Цель:

- новые поля уже наполняются реальными данными
- старые части приложения продолжают работать без переключения чтений

## 6. Фаза 3. Backfill старых данных

### 6.1 Что backfill'ить

- все строки `articles`
- при необходимости часть `digest_runs` расширением схемы, а не заменой таблицы

### 6.2 Базовые правила backfill

- `enriched=false` -> `enrich_status='pending'`
- `published=true AND quality_ok=true` -> `enrich_status='enriched_ok'`, `publish_status='live'`
- `quality_reason in ('low_score', 'quality_reject')` -> `enrich_status='rejected'`
- `quality_reason in ('editorial_parse_failed', 'unhandled_error')` -> `enrich_status='failed'`
- `verified_live` для legacy-published оставить `null`, потом отдельно прогнать verify-backfill

### 6.3 Проверки после backfill

- нет строк с `published=true` и пустым `publish_status`
- нет строк с `enrich_status='processing'` без `processing_started_at`
- нет строк с `retry_wait` и `next_retry_at is null`

## 7. Фаза 4. Включение operational jobs

После того как dual-write и backfill живы:

1. включить `retry-failed.yml`
2. включить `pipeline-health.yml`
3. включить `publish-verify.yml`

Перед этим:

- убедиться, что alert dedupe уже работает
- убедиться, что provider guard не заблокирует весь enrich сразу после старта

## 8. Фаза 5. Переключение чтений

### 8.1 Telegram

Перевести digest-выборку на статьи с `verified_live=true`.

### 8.2 Сайт

Перевести `lib/articles.ts` на `public_articles` или эквивалентный visibility gate.

### 8.3 Дополнительные джобы

Проверить:

- image generation
- sitemap generation
- archive/source/topic pages

Все публичные потребители должны читать одинаковое определение “public article”.

## 9. Фаза 6. Cleanup

Только после стабилизации:

- убрать прямую зависимость от `select enriched=false`
- перестать трактовать legacy-флаги как источник правды для pipeline
- сузить зону использования `published/enriched` до совместимости или убрать их в следующей волне

## 10. Rollback plan

Если новый status-layer ведёт себя нестабильно:

1. Отключить новые workflow `retry-failed.yml`, `pipeline-health.yml`, `publish-verify.yml`.
2. Оставить additive schema как есть.
3. Вернуть чтения сайта и Telegram на legacy-условия.
4. Не удалять уже записанные operational данные, они нужны для диагностики.

Rollback не должен требовать destructive schema reset.

## 11. Признаки безопасного завершения миграции

- сайт и Telegram используют один visibility gate
- `enrich.yml` не читает `enriched=false`
- `retry_wait`, `stuck`, `failed` реально встречаются в данных и понятны операционно
- alert noise находится под контролем
- `scripts/wait-and-reenrich.sh` перестал быть ежедневным recovery path

