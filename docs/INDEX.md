# Documentation Index

Этот файл показывает, где в проекте находится текущая правда, а где лежат временные рабочие материалы.

## Read Order

1. `CLAUDE.md`
2. Этот файл
3. Канонический документ по области задачи

Быстрый вход в контекст:

```bash
npm run context
```

## Канонические документы

| Файл | Область |
|---|---|
| `docs/PROJECT.md` | Продукт, цели, основные пользовательские поверхности |
| `docs/ARCHITECTURE.md` | Архитектура, границы модулей, runtime и данные |
| `docs/ARTICLE_SYSTEM.md` | Полный цикл статьи: ingest, enrich, media, slug, render, publish |
| `docs/OPERATIONS.md` | Деплой, GitHub Actions, env, smoke checks, runtime recovery |
| `docs/DECISIONS.md` | Принятые решения и их мотивация |
| `docs/DESIGN.md` | Дизайн-система и визуальные паттерны |
| `docs/editorial_style_guide.md` | Редакционные правила текста |

## Рабочие, а не канонические документы

Эти документы нужны для исследования, миграций, исполнения задач и аудитов, но не являются source of truth:

- `docs/spec_*`
- `docs/task_*`
- `docs/execution_plan_*`
- `docs/implementation_wave_*`
- `docs/roadmap_*`
- `docs/acceptance_criteria_*`
- `docs/file_map_*`
- `docs/*_audit_*`
- `docs/*_report_*`
- `docs/sql_migration_draft_*`
- `docs/content_engine_backlog_*`

`docs/ORCHESTRATOR.md` тоже не считается канонической архитектурной документацией. Это planning/backlog файл.

## Правила обновления

Если изменение затрагивает:

| Что меняется | Что обновлять |
|---|---|
| Product surface, разделы, пользовательские сценарии | `docs/PROJECT.md` |
| Data model, Supabase contracts, модульные границы | `docs/ARCHITECTURE.md` |
| Логику статей, slug, media, render, публикацию, digest | `docs/ARTICLE_SYSTEM.md` |
| Workflow, cron, env, deploy, alerting, recovery | `docs/OPERATIONS.md` |
| Новое принципиальное решение или смену правила | `docs/DECISIONS.md` |
| Визуальную систему | `docs/DESIGN.md` |
| Тон и редакционный стандарт | `docs/editorial_style_guide.md` |

## Doc Impact Matrix

Эта матрица нужна и для людей, и для автоматической проверки `npm run docs:check`.

| Кодовая зона | Канонический doc |
|---|---|
| `pipeline/ingest.ts`, `pipeline/rss-parser.ts`, `pipeline/feeds.config.ts`, `pipeline/enricher.ts`, `pipeline/fetcher.ts`, `pipeline/scorer.ts`, `pipeline/slug.ts`, `pipeline/claude.ts`, `pipeline/deepl.ts`, `pipeline/generate-images.ts`, `pipeline/image-*` | `docs/ARTICLE_SYSTEM.md` |
| `app/articles/**`, `app/archive/**`, `app/topics/**`, `app/sources/**`, `bot/daily-digest.ts`, `lib/articles.ts`, `lib/article-slugs.ts`, `app/sitemap.ts`, `src/components/ArticleCard.tsx` | `docs/ARTICLE_SYSTEM.md` |
| `lib/supabase.ts`, `supabase/**`, `app/internal/**` | `docs/ARCHITECTURE.md` |
| `.github/workflows/**`, `vercel.json`, `package.json`, runtime scripts в `scripts/`, recovery/health/publish verification в `pipeline/` | `docs/OPERATIONS.md` |
| `app/page.tsx`, `app/layout.tsx`, `src/components/Header.tsx` | `docs/PROJECT.md` |
| `app/globals.css`, общие UI-компоненты в `src/components/**`, кроме компонентов с отдельной доменной ответственностью | `docs/DESIGN.md` |

Если файл не попал в матрицу, решение принимается вручную. Матрицу нужно расширять вместе с проектом.

## Рабочий цикл для изменений

1. Перед началом задачи определить `docs impact`.
2. Сделать код.
3. Обновить канонический doc, если поведение или правила реально изменились.
4. Прогнать:

```bash
npm run docs:check
```

5. В финале задачи явно написать:
   - `Docs updated: ...`
   - или `Docs impact: no`

## Принцип консолидации

При появлении новой большой задачи разрешено создать временный документ.
После реализации итог обязательно переносится в канонический файл.
Если канонический doc и временный spec конфликтуют, прав канонический doc.
