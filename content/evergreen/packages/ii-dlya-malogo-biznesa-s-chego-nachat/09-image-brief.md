# Image Brief: ИИ для малого бизнеса: с чего начать

**Generation source:** ChatGPT subscription (Plus/Pro/Codex). No image API calls from this workflow — neither OpenAI Images, nor Anthropic, nor any runtime generator. Локальные SVG/Canvas-схемы допустимы как замена для матриц, roadmap и сравнений.

## Workflow

1. Codex/агент готовит для каждого изображения: `prompt`, `negative_prompt`, `alt`, `caption`, `aspect`, `filename_png`, `filename_webp`.
2. Владелец/редактор открывает ChatGPT, копирует prompt, генерирует PNG, сохраняет в `content/evergreen/packages/ii-dlya-malogo-biznesa-s-chego-nachat/raw-images/<filename>.png`. Имя файла должно совпадать с `filename_png` из brief.
3. Запускает `npm run images:prep -- --slug=ii-dlya-malogo-biznesa-s-chego-nachat`. Скрипт берёт PNG, режет под нужный размер, конвертирует в WebP quality 82 и кладёт в `public/images/guides/ii-dlya-malogo-biznesa-s-chego-nachat/<filename>.webp`.
4. `npm run evergreen:check -- --slug=ii-dlya-malogo-biznesa-s-chego-nachat` проверяет наличие файлов и плотность cover (≥ 80 KB).

## Visual Direction

- Style: Malakhov AI Digest editorial — спокойный, фактологический, бизнес-фокус. Референс: обложки vc.ru, Bloomberg, The Verge editorial pieces.
- Палитра: глубокий тёмно-синий / графит как доминанта, тёплый акцент (терракот, охра, янтарь), молочно-белый фон диаграмм. Не пастель.
- Запрещено внутри изображения: читаемый текст, watermarks, fake-панели с надписями.
- Запрещённые сюжеты: роботы, светящийся мозг, неон, рукопожатие человек+робот, generic office stock (люди в костюмах у монитора), стоковые «руки на ноутбуке».
- Допустимо: концептуальные иллюстрации, абстрактные схемы потоков, бизнес-метафоры (карта, мост, инструменты, конструктор), city/architecture metaphors, изометрия в editorial-стиле.

## Sizing matrix

| Тип | ChatGPT (генерация) | Финальный WebP | Назначение |
|---|---|---|---|
| Cover | 1792×1024 (затем crop) | 1200×675 (16:9) | hero, og:image |
| Inline diagram/scene | 1792×1024 или 1024×1024 | 1200×800 (3:2) | в теле статьи |
| Inline square | 1024×1024 | 1200×1200 | специфические визуалы |

## Cover

- `filename_png`: `cover.png`
- `filename_webp`: `cover.webp`
- Финальный путь: `public/images/guides/ii-dlya-malogo-biznesa-s-chego-nachat/cover.webp`
- Placement: guide hero
- Aspect: 16:9
- Prompt:
  > Editorial concept illustration for a Russian business magazine article about small business adopting AI in 2026. Composition: a small craft workshop or boutique storefront on the left side, opening into a clean diagram-like map on the right showing four converging paths labeled by simple geometric icons (a chat bubble, a knowledge book, a megaphone, a document). Top-down isometric perspective. Muted palette: graphite, deep navy, warm terracotta accent, off-white background. No people, no robots, no glowing screens, no neon. Tone: calm, factual, business-editorial — like a vc.ru or Bloomberg lead illustration. Soft natural lighting, no text or labels inside the image.
- Negative prompt / anti-cliché:
  > No robots, no glowing brain, no handshake, no human-robot handshake, no readable text or numbers inside the image, no neon sci-fi, no generic office stock with people in suits at monitors, no fake panels with text, no watermarks, no clichéd "AI cloud" or wireframe head, no stock-photo hands on keyboards.
- Alt: ИИ для малого бизнеса: четыре сценария первого пилота — продажи, поддержка, маркетинг, документы
- Caption: Малому бизнесу удобнее начать ИИ с одного узкого сценария и пилота на 30 дней, чем с абстрактной цифровизации.

## Inline Image 1 — scenarios-grid

- `filename_png`: `scenarios-grid.png`
- `filename_webp`: `scenarios-grid.webp`
- Финальный путь: `public/images/guides/ii-dlya-malogo-biznesa-s-chego-nachat/scenarios-grid.webp`
- Place after H2 slug: `четыре-сценария-где-ии-работает-у-малого-бизнеса-прямо-сейчас`
- Aspect: 3:2 (1200×800 финал)
- Prompt:
  > Editorial 2×2 conceptual grid showing four business scenarios where AI works for small business: top-left — a chat-bubble cluster (sales replies), top-right — an open book with a question mark (knowledge-base support), bottom-left — a megaphone with confetti shapes (marketing content), bottom-right — a stack of forms with a checkmark (documents). Clean editorial illustration, isometric or flat geometric. Muted palette: graphite, deep navy, terracotta accent, off-white background. No people, no robots, no readable text inside icons. Style — calm and factual, like a Bloomberg or vc.ru explainer infographic.
- Negative prompt:
  > No robots, no glowing brain, no readable text or numbers inside the image, no fake panels, no neon, no human-robot handshake, no generic office stock, no watermarks, no clichéd "AI head" or wireframe brain.
- Alt: Четыре сценария ИИ для малого бизнеса: продажи, поддержка, маркетинг, документы
- Caption: Четыре рабочих сценария первого пилота: ответы на заявки, поддержка по базе знаний, контент для соцсетей и типовые документы.

## Inline Image 2 — pilot-30-days-roadmap

- `filename_png`: `pilot-30-days-roadmap.png`
- `filename_webp`: `pilot-30-days-roadmap.webp`
- Финальный путь: `public/images/guides/ii-dlya-malogo-biznesa-s-chego-nachat/pilot-30-days-roadmap.webp`
- Place after H2 slug: `с-чего-начать-7-шагов-первого-пилота-за-30-дней`
- Aspect: 3:2 (1200×800 финал)
- Prompt:
  > Horizontal editorial roadmap illustration showing a calm, factual 30-day pilot path. Left to right: a starting marker, then seven evenly spaced waypoints (small geometric markers like circles and squares of varying size), ending in a fork — one path continues forward, one curves back. The path is drawn on a clean diagram-like surface, with a soft topographic background. Muted palette: graphite, deep navy, warm terracotta accent, off-white background. No people, no robots, no readable labels or numbers. Style — editorial business explainer, like a Bloomberg or Harvard Business Review article header.
- Negative prompt:
  > No robots, no glowing brain, no readable text or numbers inside the image, no neon timelines, no calendar pages with dates, no human figures, no generic office stock, no watermarks, no clichéd "AI brain" or wireframe head.
- Alt: Дорожная карта первого пилота ИИ за 30 дней для малого бизнеса
- Caption: Семь шагов первого пилота: процесс, метрика, данные, владелец, лимит, узкий запуск, решение stop/go на 31-й день.

## Inline Image 3 — when-not-to-start

- `filename_png`: `when-not-to-start.png`
- `filename_webp`: `when-not-to-start.webp`
- Финальный путь: `public/images/guides/ii-dlya-malogo-biznesa-s-chego-nachat/when-not-to-start.webp`
- Place after H2 slug: `когда-внедрение-ии-малому-бизнесу-не-окупится`
- Aspect: 3:2 (1200×800 финал)
- Prompt:
  > Editorial conceptual illustration of caution and pause: an unfinished bridge that stops mid-span over a small canyon, with six small "warning" markers along the path (simple geometric shapes — triangle, diamond, square, octagon, hexagon, circle) without any readable text. The bridge is drawn in clean isometric style, with calm engineering-blueprint mood. Muted palette: graphite, deep navy, warm amber accent, off-white background. Atmosphere — factual, not alarming. No people, no robots, no neon, no readable text inside the image. Style — like a Bloomberg or The Verge feature illustration.
- Negative prompt:
  > No robots, no glowing brain, no readable text or numbers, no stop signs with letters, no neon, no human figures, no handshake, no generic office stock, no watermarks, no apocalyptic mood — keep it calm and analytical.
- Alt: Шесть критериев, когда малому бизнесу не стоит запускать пилот ИИ
- Caption: Когда пилот ИИ малому бизнесу не окупится: мало повторяемости, нет владельца, нестабильный процесс, регуляторные риски, премиум-ниша, нет 20 часов владельца.

## Local SVG / Diagram Candidates

Не применяются для этого выпуска: все 4 картинки (cover + 3 inline) генерируются в ChatGPT.

## Owner SLA

После статуса `ready_for_codex` владелец/редактор обязуется сгенерировать cover + 3 inline в ChatGPT и положить PNG в `raw-images/` в течение 48 часов. Иначе гайд переходит в `blocked` со статусом «cover_pending».
