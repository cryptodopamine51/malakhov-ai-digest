# Image Brief: Какие бизнес-процессы автоматизировать с помощью ИИ

**Generation source:** ChatGPT subscription (Plus/Pro/Codex). No image API.

## Workflow

1. Положить PNG в `content/evergreen/packages/kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii/raw-images/<filename>.png`.
2. `npm run images:prep -- --slug=kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii`.
3. `npm run evergreen:check -- --slug=kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii`.

## Visual Direction

- Editorial, бизнес-фокус, спокойный.
- Палитра по `docs/DESIGN.md`.
- Запрещено: робот, светящийся мозг, неон, рукопожатие, generic office, fake dashboards с надписями.
- Допустимо: концептуальные карты процессов, абстрактные матрицы, инструменты-метафоры.

## Cover

- `filename_png`: `cover.png`
- `filename_webp`: `cover.webp`
- Aspect: 16:9 (1200×675)
- Prompt: editorial conceptual illustration of a business operations map being filtered through four lenses (effect, complexity, risk, data) into a single highlighted process; muted business palette, no text, no robots, no neon, no people, abstract architectural composition with clean geometric layers.
- Alt: Матрица выбора бизнес-процессов для автоматизации с ИИ: эффект, сложность, риск, данные.
- Caption: Процесс-кандидат на автоматизацию ИИ проходит через четыре фильтра — эффект, сложность, риск и данные — до выбора подрядчика и бюджета.

## Inline Images

| filename_png | filename_webp | Place after H2 slug | Aspect | Source | Prompt | Alt | Caption |
|---|---|---|---|---|---|---|---|
| process-automation-matrix.png | process-automation-matrix.webp | десять-процессов-где-ии-работает-прямо-сейчас | 3:2 | ChatGPT | grid of ten abstract icons representing business sub-processes (sales, support, contracts, documents, content, calls, reviews, HR, finance, search), muted palette, no text | Десять бизнес-процессов, готовых к автоматизации с ИИ в 2026 году | От квалификации лидов до корпоративного поиска — десять рабочих сценариев с разной зрелостью внедрения. |
| process-effect-risk-grid.png | process-effect-risk-grid.webp | матрица-выбора-эффект-х-сложность-х-риск-х-данные | 3:2 | ChatGPT | abstract 4×N matrix with traffic-light coloring (green/yellow/red), no text, muted business palette | Матрица выбора процесса для автоматизации с ИИ: эффект, сложность, риск, данные | Первый проект — только из «зелёных» ячеек по всем четырём фильтрам. |
| when-not-to-automate.png | when-not-to-automate.webp | когда-автоматизация-ии-процесса-не-окупится | 3:2 | ChatGPT | conceptual road sign / stop pattern with seven abstract markers, muted palette, no text, no robots | Семь критериев, когда автоматизация ИИ-процесса не окупится | Когда автоматизация не окупится: мало повторяемости, нет владельца, нестабильный процесс, высокая цена ошибки, хаотичные данные. |

## Owner SLA

После статуса `ready_for_codex` владелец генерирует cover в ChatGPT и кладёт PNG в `raw-images/` в течение 48 часов. Иначе гайд остаётся под `noindex: true`.
