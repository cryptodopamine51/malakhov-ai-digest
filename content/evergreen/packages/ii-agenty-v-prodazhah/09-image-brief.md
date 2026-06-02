# Image Brief: ИИ-агенты в продажах

**Generation source:** ChatGPT subscription (Plus/Pro/Codex). No image API calls from this workflow — neither OpenAI Images, nor Anthropic, nor any runtime generator. Локальные SVG/Canvas-схемы допустимы как замена для матриц, roadmap и сравнений.

## SEO filename convention (обязательно, with 2026-05-22 update)

Имена файлов — SEO-сигнал в поисковой картинной выдаче. Convention:

- **Cover**: `ii-agenty-v-prodazhah-cover.webp` (либо `<primary-keyword>-<short-modifier>.webp`, если slug длинный).
- **Inline**: `<slug-short>-<section-keyword>.webp`. Slug-short = первые 2–4 значимые слова из slug гайда.
- ASCII only, lowercase, hyphen-separated, ≤ 60 символов.
- Не использовать generic-имена `image1.webp`, `diagram.webp`, `untitled.webp` — они теряют SEO-сигнал.

Примеры для `slug=ii-dlya-malogo-biznesa-s-chego-nachat`:
- `ii-malyy-biznes-cover.webp`
- `ii-malyy-biznes-4-scenariya.webp`
- `ii-malyy-biznes-plan-30-dney.webp`
- `ii-malyy-biznes-kogda-ne-stoit.webp`

## Workflow

1. Codex/агент готовит для каждого изображения: `prompt`, `negative_prompt`, `alt`, `caption`, `aspect`, `filename_png`, `filename_webp` по SEO convention выше. Эти filename'ы попадают в `08-metadata.json::cover.src` и `inlineImagesByHeading[*].src` ещё до генерации PNG.
2. Владелец/редактор открывает ChatGPT, копирует prompt, генерирует PNG. Сохранять можно **с любым именем** (ChatGPT часто отдаёт `ChatGPT_image_<timestamp>.png` и подобное) — главное, чтобы все PNG для одной статьи лежали в `content/evergreen/packages/ii-agenty-v-prodazhah/raw-images/`.
3. Запускает `npm run images:prep -- --slug=ii-agenty-v-prodazhah`. Скрипт:
   - Сначала ищет PNG с именем, совпадающим с одним из meta-slot stem'ов (точный матч → точный slot).
   - Оставшиеся PNG с random-именами маппит на оставшиеся slot'ы по алфавитному порядку имени PNG vs declared meta order (cover первый, дальше inline в порядке `inlineImagesByHeading`). В логах рядом с каждым slot'ом печатается `renamed ← <random.png>`.
   - Финальные WebP именуются по meta stem'у — SEO-имена соблюдены автоматически.
   - Качество: cover q=90, inline q=88, effort=6, smartSubsample=false (full 4:4:4 chroma — критично для графики с тонкими линиями и текстовыми метафорами).
4. `npm run evergreen:check -- --slug=ii-agenty-v-prodazhah` проверяет наличие файлов и плотность cover (≥ 80 KB).

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

- `filename_png`: `ii-agenty-v-prodazhah-cover.png` (SEO convention — см. секцию выше)
- `filename_webp`: `ii-agenty-v-prodazhah-cover.webp`
- Финальный путь: `public/images/guides/ii-agenty-v-prodazhah/ii-agenty-v-prodazhah-cover.webp`
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
