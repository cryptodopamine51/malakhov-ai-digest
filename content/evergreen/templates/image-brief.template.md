# Image Brief: {{title}}

**Generation source:** ChatGPT subscription (Plus/Pro/Codex). No image API calls from this workflow — neither OpenAI Images, nor Anthropic, nor any runtime generator. Локальные SVG/Canvas-схемы допустимы как замена для матриц, roadmap и сравнений.

## Workflow

1. Codex/агент готовит для каждого изображения: `prompt`, `negative_prompt`, `alt`, `caption`, `aspect`, `filename_png`, `filename_webp`.
2. Владелец/редактор открывает ChatGPT, копирует prompt, генерирует PNG, сохраняет в `content/evergreen/packages/{{slug}}/raw-images/<filename>.png`. Имя файла должно совпадать с `filename_png` из brief.
3. Запускает `npm run images:prep -- --slug={{slug}}`. Скрипт берёт PNG, режет под нужный размер, конвертирует в WebP quality 82 и кладёт в `public/images/guides/{{slug}}/<filename>.webp`.
4. `npm run evergreen:check -- --slug={{slug}}` проверяет наличие файлов и плотность cover (≥ 80 KB).

## Visual Direction

- Style: Malakhov AI Digest editorial — спокойный, фактологический, бизнес-фокус. Референс: обложки vc.ru, Bloomberg, The Verge editorial pieces.
- Палитра: см. `docs/DESIGN.md`.
- Запрещено внутри изображения: читаемый текст, watermarks, fake dashboards с надписями.
- Запрещённые сюжеты: роботы, светящийся мозг, неон, рукопожатие человек+робот, generic office stock (люди в костюмах у монитора).
- Допустимо: концептуальные иллюстрации, абстрактные схемы потоков, бизнес-метафоры (карта, мост, инструменты, конструктор), city/architecture metaphors.

## Sizing matrix

| Тип | ChatGPT (генерация) | Финальный WebP | Назначение |
|---|---|---|---|
| Cover | 1792×1024 (затем crop) | 1200×675 (16:9) | hero, og:image |
| Inline diagram/scene | 1792×1024 или 1024×1024 | 1200×800 (3:2) | в теле статьи |
| Inline square | 1024×1024 | 1200×1200 | специфические визуалы |

## Cover

- `filename_png`: `cover.png`
- `filename_webp`: `cover.webp`
- Финальный путь: `public/images/guides/{{slug}}/cover.webp`
- Placement: guide hero
- Aspect: 16:9
- Prompt:
  - TBD (4–8 строк: концепция + стиль + ограничения)
- Negative prompt / anti-cliché:
  - No robots, no glowing brain, no handshake, no readable text, no neon sci-fi, no generic office stock, no fake dashboards with text.
- Alt (для слепых пользователей и SEO):
  - TBD
- Caption (раскрывает, что изображено и зачем):
  - TBD

## Inline Images

| filename_png | filename_webp | Place after H2 slug | Aspect | Source | Prompt / SVG brief | Alt | Caption |
|---|---|---|---|---|---|---|---|
| tbd.png | tbd.webp | tbd | 3:2 | ChatGPT / local SVG | TBD | TBD | TBD |

## Local SVG / Diagram Candidates

Можно заменять inline images локальными SVG (через TS-скрипт + конвертация в WebP через `sharp`):

- Matrix 2×2 / 3×3:
- Roadmap 30/60/90:
- Workflow / процессный flow:
- Cost model / диаграмма формулы:

Cover всегда генерируется в ChatGPT, не как SVG.

## Owner SLA

После статуса `ready_for_codex` владелец/редактор обязуется сгенерировать cover в ChatGPT и положить PNG в `raw-images/` в течение 48 часов. Иначе гайд переходит в `blocked` со статусом «cover_pending».
