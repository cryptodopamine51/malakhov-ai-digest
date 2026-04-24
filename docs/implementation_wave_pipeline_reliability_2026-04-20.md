# Волна внедрения: надёжность pipeline публикации

**Дата:** 2026-04-20  
**Контекст:** текущий ingest/enrich/digest контур уже работает, но зависит от ручного recovery и legacy-флагов `enriched/published/quality_ok`.  
**Цель волны:** перевести контур на наблюдаемый и устойчивый operational layer без поломки сайта, Telegram и существующих workflow.

## Связанные документы

- [pipeline_reliability_roadmap_2026-04-20.md](/Users/malast/malakhov-ai-digest/docs/pipeline_reliability_roadmap_2026-04-20.md)
- [spec_pipeline_reliability_implementation_2026-04-20.md](/Users/malast/malakhov-ai-digest/docs/spec_pipeline_reliability_implementation_2026-04-20.md)
- [spec_pipeline_reliability_migration_2026-04-20.md](/Users/malast/malakhov-ai-digest/docs/spec_pipeline_reliability_migration_2026-04-20.md)
- [execution_plan_pipeline_reliability_2026-04-20.md](/Users/malast/malakhov-ai-digest/docs/execution_plan_pipeline_reliability_2026-04-20.md)
- [sql_migration_draft_pipeline_reliability_2026-04-20.md](/Users/malast/malakhov-ai-digest/docs/sql_migration_draft_pipeline_reliability_2026-04-20.md)
- [file_map_pipeline_reliability_2026-04-20.md](/Users/malast/malakhov-ai-digest/docs/file_map_pipeline_reliability_2026-04-20.md)
- [task_breakdown_pipeline_reliability_2026-04-20.md](/Users/malast/malakhov-ai-digest/docs/task_breakdown_pipeline_reliability_2026-04-20.md)
- [acceptance_criteria_pipeline_reliability_2026-04-20.md](/Users/malast/malakhov-ai-digest/docs/acceptance_criteria_pipeline_reliability_2026-04-20.md)

## Что входит в эту волну

- status-layer для `articles`
- atomic claim/lease для enrichment
- retry/stuck recovery
- source health + backlog monitoring
- alert dedupe + admin alerting
- post-publish verification + visibility gate
- совместимая миграция с legacy-флагами

## Что не входит

- крупная переработка editorial prompt
- redesign UI сайта
- полный re-architecture Supabase клиента
- отказ от Telegram как канала дистрибуции

## Затрагиваемые части репо

- `pipeline/enricher.ts`
- `pipeline/ingest.ts`
- `pipeline/rss-parser.ts`
- `bot/daily-digest.ts`
- `lib/articles.ts`
- `.github/workflows/enrich.yml`
- `.github/workflows/rss-parse.yml`
- `.github/workflows/tg-digest.yml`
- новая миграция в `supabase/migrations/`
- новые operational-модули в `pipeline/`

## Порядок внедрения

1. Добавить схему БД, новые таблицы и status/lease поля без переключения чтений.
2. Включить dual-write в ingest/enrich.
3. Внедрить atomic claim/lease, retry и stuck recovery.
4. Добавить run logs, source health, backlog monitor, provider guard и alert dedupe.
5. Добавить publish verify.
6. Перевести Telegram и публичные выборки на visibility gate.
7. Только после стабилизации убрать прямую зависимость от legacy-условий.

## Definition Of Done волны

- временный outage LLM/fetch больше не требует `scripts/wait-and-reenrich.sh` как регулярной операции
- два параллельных запуска enrich не берут одну и ту же статью
- по любой статье видно историю попыток, последнюю ошибку и текущее состояние
- по любому дню видно run logs ingest/enrich/digest и source-level health
- Telegram и сайт используют только verified-live статьи
- одинаковые operational alerts не спамят в Telegram при каждом hourly запуске
