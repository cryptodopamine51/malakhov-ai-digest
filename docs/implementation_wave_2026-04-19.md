# Волна доработки: визуал, наполнение разделов, медиа и источники

**Дата:** 2026-04-19
**Контекст:** после выката editorial light redesign в production выявлены хвосты по UI и пробелы в контентном слое.
**Цель волны:** довести сайт до состояния, где визуал стабилен, разделы не пустые, статьи выглядят как редакционный продукт, а входящий поток источников покрывает top-tier AI рынок.

## Приоритет выполнения

1. Источники для парсинга: сначала собрать и утвердить top-tier source set.
2. Backfill разделов `Лаборатории`, `Инвестиции`, `Стартапы`: довести каждую рубрику до 7–10 качественных материалов.
3. Медиа в статьях: отказаться от тупого хвостового сброса картинок внизу и перейти к встроенным редакционным визуалам.
4. UI cleanup: исправить невидимый текст hero на главной и убрать дублирование блока `Читать также`.

## Связанные документы

- [spec_ui_cleanup_hero_and_related_2026-04-19.md](/Users/malast/malakhov-ai-digest/docs/spec_ui_cleanup_hero_and_related_2026-04-19.md)
- [spec_backfill_sections_labs_investments_startups_2026-04-19.md](/Users/malast/malakhov-ai-digest/docs/spec_backfill_sections_labs_investments_startups_2026-04-19.md)
- [spec_article_media_strategy_2026-04-19.md](/Users/malast/malakhov-ai-digest/docs/spec_article_media_strategy_2026-04-19.md)
- [spec_source_expansion_top_tier_2026-04-19.md](/Users/malast/malakhov-ai-digest/docs/spec_source_expansion_top_tier_2026-04-19.md)

## Общие требования к реализации

- Любая UI-правка проходит через `npm run lint` и production build.
- Любая правка контентного пайплайна сопровождается тестами на классификацию, фильтрацию и формат выхода.
- Для данных и дат использовать один agreed timezone policy: `Europe/Moscow`.
- Не добавлять “магические” исключения без документирования в соответствующем spec-файле.
- Если задача меняет схему базы или формат editorial output, обновлять `lib/supabase.ts`, `docs/` и соответствующие pipeline-тесты в одном наборе изменений.

## Definition of Done волны

- На главной hero-подзаголовок читаем в light и dark theme.
- В статье нет текстового блока `Читать также:` внутри body, а related-материалы остаются только карточками внизу.
- В разделах `Лаборатории`, `Инвестиции`, `Стартапы` отображается минимум по 7 качественных статей на production.
- Inline media strategy для статей внедрена или хотя бы подготовлена end-to-end на уровне схемы/пайплайна/рендера без тупого gallery-dump внизу.
- Сформирован и утверждён список top-tier источников для парсинга с приоритетами, RSS/HTML strategy и редакционным rationale.
