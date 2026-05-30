# Image Brief: Ошибки внедрения ИИ в компании

**Generation source:** ChatGPT subscription (Plus/Pro/Codex). No image API calls. Local SVG/Canvas is allowed only if an inline decision artifact needs exact Russian text or numbers; this package uses ChatGPT PNGs.

## Goal

Заменить placeholder/generic visuals на понятный editorial-набор:

- обложка должна считываться как разбор провала ИИ-проекта из-за процесса, данных, прав и контроля, а не как абстрактная «ошибка искусственного интеллекта»;
- inline-картинки объясняют блоки статьи: десять ошибок по стадиям, стоимость ошибки с лимитами API, дорожная карта восстановления;
- human-сцены должны выглядеть как локальная российская деловая аудитория, преимущественно славянской/восточноевропейской внешности, в естественной рабочей одежде и конкретном действии;
- никакой апокалиптики, красных alert-экранов и sci-fi: тон аналитический и инженерный.

## Shared Visual System

- Style: realistic business-editorial + tactile infographic objects.
- Palette: off-white background, graphite/deep navy base, one warm amber/terracotta accent.
- Lighting: soft natural light, calm and factual.
- Forbidden: robots, glowing brain, neon, human+robot handshake, generic stock office, fake dashboards with text, apocalyptic red alarms, abstract warning symbols without implementation-process context.
- Topic clarity test: without the headline, a reader should understand that the visuals are about implementation mistakes caused by process, data, access, economics and quality control.

## Scenario Cards

### 1. Cover

- `filename_png`: `oshibki-ii-cover.png`
- `filename_webp`: `oshibki-ii-cover.webp`
- Placement: guide hero
- Aspect: 16:9
- Visual job: `human-scenario`
- Reader takeaway: ошибка внедрения обычно находится в процессе, данных, правах или поддержке.
- Scene: реалистичная editorial-сцена в российской компании. Команда внедрения ИИ разбирает проблемный проект на большом столе. На столе маршрут из десяти модулей; несколько модулей с трещинами/незакрытыми пазами. Рядом карточки данных, доступа и качества без читаемых подписей.
- Must show:
  - российская команда внедрения в конкретном разборе проблемы, не позирует;
  - маршрут проекта из 10 модулей;
  - несколько трещин/незакрытых пазов в модулях;
  - карточки данных, доступа и качества без текста;
  - спокойная инженерная сцена без паники.
- Avoid:
  - роботы, неон, «ИИ вышел из-под контроля»;
  - катастрофа и красные alert-экраны;
  - fake dashboards;
  - люди просто смотрят в ноутбук;
  - читаемый текст, числа и лейблы.
- Acceptance check: без заголовка должно быть понятно, что провал связан с процессом, данными, правами и поддержкой, а не с «магией ИИ».
- Alt: Десять типовых ошибок внедрения ИИ в компании: старт с инструмента, нет владельца, плохие данные, нет лимита расходов.
- Caption: 80% провалов ИИ-проектов — это повторение одних и тех же ошибок, которые видны заранее и стоят меньше, чем кажется.

### 2. Десять ошибок по стадиям

- `filename_png`: `oshibki-ii-10-tipovyh-provalov.png`
- `filename_webp`: `oshibki-ii-10-tipovyh-provalov.webp`
- Placement after H2 slug: `ошибки-внедрения-ии-десять-самых-частых-паттернов`
- Aspect: 3:2
- Visual job: `decision-artifact`
- Reader takeaway: ошибки распределены по этапам: выбор, пилот, запуск, поддержка.
- Scene: горизонтальная roadmap из четырёх стадий без подписей. Вдоль неё десять маркеров ошибок, сгруппированные 3 + 3 + 2 + 2; часть маркеров подсвечена янтарным как самые дорогие риски.
- Must show:
  - 4 последовательные стадии как участки маршрута;
  - 10 маркеров ошибок;
  - группировка 3+3+2+2;
  - несколько более дорогих рисков с тёплой подсветкой;
  - чистая сетка и мягкие тени.
- Avoid:
  - читаемые подписи и номера;
  - alert UI;
  - random warning icons;
  - красная тревожная эстетика;
  - абстрактные карточки без стадий.
- Acceptance check: должно считываться, что ошибки возникают на разных этапах внедрения, а не являются одной общей проблемой.
- Alt: Сетка десяти самых частых ошибок внедрения ИИ в компании.
- Caption: Десять ошибок по стадиям: выбор → пилот → запуск → поддержка.

### 3. Стоимость одной ошибки

- `filename_png`: `oshibki-ii-stoimost-oshibki.png`
- `filename_webp`: `oshibki-ii-stoimost-oshibki.webp`
- Placement after H2 slug: `worked-example-сколько-стоит-ошибка-4-нет-лимита-расходов`
- Aspect: 3:2
- Visual job: `human-scenario`
- Reader takeaway: одна техническая ошибка может быстро превратиться в большой расход.
- Scene: российский финансовый директор и инженер стоят у стола и смотрят на тактильный счётчик API без цифр. Из незакрытого клапана/лимитера уходят янтарные токены в сторону, рядом пустой бюджетный лоток. Сцена спокойная и аналитическая, не катастрофичная.
- Must show:
  - 2 человека из локальной российской деловой аудитории в рабочем действии;
  - тактильный счётчик/API-meter без цифр и текста;
  - открытый клапан/лимитер;
  - янтарные токены уходят мимо бюджета;
  - пустой лоток или папка бюджета.
- Avoid:
  - читаемые суммы, цифры и рубли внутри картинки;
  - красная паника;
  - крипто-монеты;
  - неон;
  - dashboard UI.
- Acceptance check: без заголовка должно быть понятно, что незакрытый технический лимит превращается в расход.
- Alt: Расчёт стоимости одной ошибки «нет лимита расходов» на API.
- Caption: Одна забытая защита: 14 часов, 504 000 запросов, ~1,45 млн ₽ за выходные.

### 4. Дорожная карта восстановления

- `filename_png`: `oshibki-ii-recovery-roadmap.png`
- `filename_webp`: `oshibki-ii-recovery-roadmap.webp`
- Placement after H2 slug: `вывод-malakhov-ai`
- Aspect: 3:2
- Visual job: `decision-artifact`
- Reader takeaway: ошибки чинятся через последовательную дорожную карту, а не через новый инструмент.
- Scene: спокойная roadmap-композиция: десять чек-поинтов вдоль восходящей линии. Каждый чек-поинт превращает трещину в закрытый паз; можно показать до/после в одной изометрической сцене без текста.
- Must show:
  - 10 чек-поинтов;
  - трещины превращаются в закрытые пазы;
  - направление восстановления слева направо;
  - тёплый акцент на завершённых точках;
  - инженерная фактура: пазы, модули, чек-поинты, аккуратная сетка.
- Avoid:
  - подписи и числа;
  - alarm UI;
  - «волшебное исправление одним кликом»;
  - роботы;
  - неон.
- Acceptance check: должно быть понятно, что восстановление идёт по шагам и закрывает причины ошибок.
- Alt: Дорожная карта против десяти ошибок внедрения ИИ.
- Caption: Каждая ошибка снимается за 2–8 часов работы на старте — арифметика повторяется в каждом кейсе провала.

## Production Note

The prompts and this brief use the SEO filenames above. `08-metadata.json` and production meta intentionally keep the old existing image paths until PNGs are generated. When the owner says "картинки положил", sync metadata to these SEO filenames before running:

```bash
npm run images:prep -- --slug=oshibki-vnedreniya-ii-v-kompanii
```

Final expected WebP files:

- `oshibki-ii-cover.webp` (1200x675)
- `oshibki-ii-10-tipovyh-provalov.webp` (1200x800)
- `oshibki-ii-stoimost-oshibki.webp` (1200x800)
- `oshibki-ii-recovery-roadmap.webp` (1200x800)
