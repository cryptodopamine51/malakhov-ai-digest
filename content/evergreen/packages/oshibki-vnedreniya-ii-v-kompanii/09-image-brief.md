# Image Brief: Ошибки внедрения ИИ в компании

**Generation source:** ChatGPT subscription. No image API.

## Workflow

1. PNG → `content/evergreen/packages/oshibki-vnedreniya-ii-v-kompanii/raw-images/<filename>.png`.
2. `npm run images:prep -- --slug=oshibki-vnedreniya-ii-v-kompanii`.
3. `npm run evergreen:check -- --slug=oshibki-vnedreniya-ii-v-kompanii`.

## Visual Direction

Editorial, спокойный, бизнес-фокус. Палитра по `docs/DESIGN.md`. Запрещено: робот, неон, рукопожатие, generic office, fake dashboards с надписями, светящийся мозг.

## Cover

- `filename_png`: `cover.png` / `filename_webp`: `cover.webp`
- Aspect 16:9 (1200×675)
- Prompt: editorial conceptual illustration of ten warning signs / stop markers arranged along a four-stage timeline (selection, pilot, launch, support); muted business palette, no readable text, no robots, abstract architectural composition.
- Alt: Десять типовых ошибок внедрения ИИ в компании: старт с инструмента, нет владельца, плохие данные, нет лимита расходов.
- Caption: 80% провалов ИИ-проектов — это повторение одних и тех же ошибок, которые видны заранее и стоят меньше, чем кажется.

## Inline Images

| filename_png | filename_webp | Place after H2 slug | Aspect | Prompt | Alt | Caption |
|---|---|---|---|---|---|---|
| top-mistakes-grid.png | top-mistakes-grid.webp | десять-самых-частых-ошибок-внедрения-ии | 3:2 | grid of ten abstract warning glyphs grouped by stage (selection / pilot / launch / support), muted palette, no text | Сетка десяти самых частых ошибок внедрения ИИ в компании | Десять ошибок по стадиям: выбор → пилот → запуск → поддержка. |
| mistake-cost-flow.png | mistake-cost-flow.webp | worked-example-skolko-stoit-oshibka-4-net-limita-rashodov | 3:2 | abstract flow of an unbounded loop expanding into a large cost amount, muted business palette, no text | Расчёт стоимости одной ошибки «нет лимита расходов» на API | Одна забытая защита: 14 часов, 504 000 запросов, ~1,45 млн ₽ за выходные. |
| recovery-roadmap.png | recovery-roadmap.webp | vyvod-malakhov-ai | 3:2 | abstract 10-step recovery roadmap arranged across four stages, muted business palette, no text | Дорожная карта против десяти ошибок внедрения ИИ | Каждая ошибка снимается за 2–8 часов работы на старте. |

## Owner SLA

После `ready_for_codex` владелец генерирует cover в ChatGPT за 48 часов; иначе гайд остаётся под `noindex: true`.
