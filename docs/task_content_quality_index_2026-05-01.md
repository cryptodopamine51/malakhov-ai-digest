# Индекс задачи: content quality, media hygiene, layout и ranking

Дата: 2026-05-01
Статус: ready-for-implementation
Родительский контекст: `docs/task_content_media_consent_layout_interest_2026-05-01.md`

## Зачем этот пакет документов

Задача затрагивает pipeline, Supabase-данные, рендер статей, разделы, главную, юридические страницы и визуальную проверку. Чтобы закрыть её качественно, работа разбита на отдельные документы: каждый документ отвечает за один тип решений и один тип проверки.

## Документы

| Документ | Для чего нужен |
|---|---|
| `docs/spec_content_quality_requirements_2026-05-01.md` | Финальные пользовательские требования, scope и non-goals |
| `docs/file_map_content_quality_2026-05-01.md` | Точные файлы/модули, которые надо читать и менять |
| `docs/spec_media_sanitizer_2026-05-01.md` | Системное решение по рекламным баннерам, author photos и нерелевантным inline images |
| `docs/spec_interest_ranking_2026-05-01.md` | MVP-алгоритм «Самое интересное» и research по готовым решениям |
| `docs/execution_plan_content_quality_2026-05-01.md` | Порядок реализации по фазам, чтобы не сломать прод |
| `docs/rollout_backfill_content_quality_2026-05-01.md` | Dry-run, backfill, Supabase update, deploy и rollback |
| `docs/acceptance_criteria_content_quality_2026-05-01.md` | Проверки, тесты, visual QA и live smoke |

## Канонические документы, которые обновить после реализации

После кода итоговые правила нужно перенести в:

- `docs/ARTICLE_SYSTEM.md` — media extraction, sanitizer, article render, category sorting, interest ranking;
- `docs/DESIGN.md` — hero contrast, unified cards, section module layout;
- `docs/PROJECT.md` — если меняется роль category pages и блока «Самое интересное»;
- `docs/OPERATIONS.md` — если добавляется backfill script или новый smoke checklist;
- `docs/DECISIONS.md` — если утверждаем правило «основная лента = свежесть, интересное = отдельный ranking».

## Порядок чтения перед реализацией

1. `docs/spec_content_quality_requirements_2026-05-01.md`
2. `docs/file_map_content_quality_2026-05-01.md`
3. `docs/spec_media_sanitizer_2026-05-01.md`
4. `docs/spec_interest_ranking_2026-05-01.md`
5. `docs/execution_plan_content_quality_2026-05-01.md`
6. `docs/rollout_backfill_content_quality_2026-05-01.md`
7. `docs/acceptance_criteria_content_quality_2026-05-01.md`

## Execution guardrails

- Не менять данные Supabase до dry-run backfill и ручного просмотра отчёта.
- Не внедрять ML-персонализацию в первом проходе.
- Не удалять route `/consent` без отдельного SEO/redirect решения; сначала поменять смысл страницы и убрать кнопку.
- Не смешивать сортировку свежей ленты и ranking «Самое интересное».
- Не править unrelated worktree changes.
