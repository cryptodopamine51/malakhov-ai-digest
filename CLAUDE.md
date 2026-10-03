# Malakhov AI Digest — Control Plane

> Главный управляющий файл проекта.
> Он не подгружается автоматически “из памяти” между сессиями: в начале каждой новой работы его нужно открыть явно или запустить `npm run context`.
> Последнее обновление: 2026-10-03

Последняя закрытая инициатива: **Site improvements wave (2026-05-06)** — см. `docs/spec_2026-05-06_site_improvements.md` и `docs/execution_plan_2026-05-06_site_improvements.md`. Включает: cover cascade и UI-icon sanitizer без API spend, sort by `created_at desc` в основных лентах, окно «Самого интересного» 72ч, удаление sticky-заголовка, accent-ссылка на источник, vc.ru keyword variants, editorial clarity rule. Backfill 21 cover применён 2026-05-07 через `scripts/backfill-cover-images.ts --apply`; rollback-snapshot — `articles_cover_snapshot_20260507`.

## Как читать проект

Порядок входа в контекст:
1. `CLAUDE.md`
2. `docs/INDEX.md`
3. Канонический документ по нужной области

Если задача затрагивает статьи и pipeline, смотреть `docs/ARTICLE_SYSTEM.md`.
Если затрагивает данные и границы системы, смотреть `docs/ARCHITECTURE.md`.
Если затрагивает деплой, cron, env или recovery, смотреть `docs/OPERATIONS.md`.

## Что это за проект

Русскоязычное AI-медиа с тремя главными задачами:
1. Делать интересные и читабельные материалы, а не бездушный агрегатор.
2. Расти через SEO и постоянный поток evergreen/news контента.
3. Использовать Telegram как основной канал доставки и возврата аудитории.

Критерий качества: материал должен быть достаточно сильным, чтобы его было интересно читать владельцу проекта без скидки на “это просто агрегатор”.

## Текущее production-ядро — замороженный архив

С 2026-10-03 по прямому указанию владельца сайт работает как статический архив. Размещение: GitHub Pages, ветка `gh-pages`, корень `/`. Рабочий адрес до подключения DNS: https://cryptodopamine51.github.io/malakhov-ai-digest/. Восстановлены 741 опубликованная новость из snapshot 2026-08-01 и 14 локальных гайдов. Автоматическое пополнение остановлено. Все десять расписаний GitHub удалены из YAML, соответствующие workflows отключены через API. Предыдущий VPS недоступен; его timers не удалось проверить или остановить.

Актуальные инструкции — в начале `docs/OPERATIONS.md` и `docs/ARCHITECTURE.md`. Исторические pipeline-команды нельзя запускать или возвращать cron без нового запроса владельца.

## Историческое production-ядро (не активное размещение)

| Слой | Текущее решение |
|---|---|
| Сайт | Next.js 15, App Router, Tailwind CSS, Vercel |
| Данные | Supabase PostgreSQL |
| Ingest | RSS → `pipeline/ingest.ts` |
| Enrichment | `pipeline/enricher.ts` + Claude Sonnet 4.6 |
| Delivery | сайт + Telegram дайджест |
| Проверки | GitHub Actions cron + health/verify/retry workflows |

`legacy/` заморожен. Это не текущий стек и не источник истины.

## Source Of Truth

| Область | Канонический файл |
|---|---|
| Назначение продукта и поверхности | `docs/PROJECT.md` |
| Архитектура и границы системы | `docs/ARCHITECTURE.md` |
| Цикл статьи, media, slug, публикация | `docs/ARTICLE_SYSTEM.md` |
| Runtime, деплой, cron, env, recovery | `docs/OPERATIONS.md` |
| Архитектурные решения | `docs/DECISIONS.md` |
| Дизайн-система | `docs/DESIGN.md` |
| Редакционные правила | `docs/editorial_style_guide.md` |
| Планирование и backlog | `docs/ORCHESTRATOR.md` |

Правило: одна тема = один канонический файл. Временные `spec_*`, `task_*`, `execution_plan_*`, `roadmap_*` не заменяют канонические документы.

## Необсуждаемые правила работы

1. Перед любыми изменениями сначала определить `docs impact`.
2. Если изменение меняет поведение, архитектуру, pipeline, deploy, data flow, публичные URL, editorial rules или product surfaces, соответствующий канонический doc обновляется в том же заходе.
3. Завершённая задача всегда заканчивается одной строкой:
   - `Docs updated: ...`
   - или `Docs impact: no`
4. Изменение поведения без обновления документации считается незавершённой задачей.
5. Перед новой сессией или сложной задачей запускать `npm run context`.

## Документационный цикл

1. Временная спецификация создаётся в `docs/` с датой в имени, если задача большая или исследовательская.
2. После реализации итог переносится в канонический документ.
3. Временный файл остаётся как история работы, но не как текущая правда.
4. Если временный файл начал противоречить каноническому, прав канонический файл.

## Критические инварианты

- Публичный архив читает готовые HTML/JSON и локальные изображения; секреты и база данных ему не нужны.
- Источник сохранённых новостей — recovery snapshot опубликованных строк `articles`; сайт не генерирует контент “на лету”.
- Публичные article URLs должны быть чистыми; legacy-slug адреса только редиректят.
- Новые статьи должны получать релевантные media из исходника, включая видео, если оно тематически подходит.
- `legacy/` не использовать для нового функционала.
- Активный статический деплой идёт через ветку `gh-pages`. Исторические Vercel/VPS deploy-инструкции не применять к архиву.

## Быстрые команды

```bash
npm run context
npm run docs:check
npm run build
npx tsx --test tests/node/pipeline-reliability.test.ts
```

## Что не делать

- Не хранить актуальную архитектуру только в чате.
- Не держать несколько “истин” по одной и той же теме.
- Не менять pipeline или URL-логику без обновления `docs/ARTICLE_SYSTEM.md`.
- Не менять env/deploy/runtime-процессы без обновления `docs/OPERATIONS.md`.
- Не использовать `legacy/` как ориентир для нового кода.

Freeze note (2026-10-03): `vercel.json` also has an empty `crons` list, removing the two historical Telegram fallback schedules on the next production deployment. Vercel remains linked to main but is not the active public archive hosting.
