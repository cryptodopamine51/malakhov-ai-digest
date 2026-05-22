# Spec: Evergreen Quality Standard Upgrade

Дата: 2026-05-21
Автор: редакция Malakhov AI
Статус: реализована 2026-05-21 (см. раздел «Implementation status»)

## 1. Контекст и цель

Codex выпустил вторую evergreen-статью (`/guides/skolko-stoit-vnedrenie-ii-v-kompaniyu`, ветка `codex/evergreen-cost-guide-prod`, коммит `bb0e83e`, сейчас `noindex: true`). Это первый тест production-конвейера на 30 материалов: `content/evergreen/topics.json`, шаблоны, scaffold, `evergreen:check`, registry `content/guides/meta/`.

Аудит показал: процесс работает, но текстовая планка и редакторский угол ниже эталона (`kak-vnedrit-ii-v-biznes-2026`). Если выпускать остальные 28 статей в текущем формате, мы получим серию ровных, но безличных гайдов — это убьёт цель «сочный evergreen», ради которой проект начался.

Эта спека описывает апгрейд **общего стандарта**, а не точечную правку одной статьи. После реализации правок текущая cost-статья прогоняется через новый стандарт как первая контрольная точка, остальные 28 пишутся уже по обновлённому процессу.

Главные принципы:

- стандарт обязан выдерживать поток без бесконечного ручного редактирования;
- картинки делаем **только через подписку ChatGPT/Codex**, не через image API;
- кейсы — приоритетно рыночные с тихой пометкой источника, синтетические — только когда рыночных нет и с явной маркировкой;
- автоматический контроль (`evergreen:check`) ловит самые частые отклонения, чтобы редактор не тратил время на формальные правки.

Не цель: вылизывать cost-статью до бесконечности. Цель — поднять планку для всей серии.

## 2. Что не так в текущей cost-статье (компактно)

Аудит проводился по [content/guides/skolko-stoit-vnedrenie-ii-v-kompaniyu.md](../content/guides/skolko-stoit-vnedrenie-ii-v-kompaniyu.md) и [content/guides/meta/skolko-stoit-vnedrenie-ii-v-kompaniyu.json](../content/guides/meta/skolko-stoit-vnedrenie-ii-v-kompaniyu.json). Сравнение с `kak-vnedrit-ii-v-biznes-2026.md`.

| Проблема | Эталон в первом гайде | Действие в стандарте |
|---|---|---|
| Лид без factual anchor (нет числа/источника в первом абзаце) | 257 млрд ₽, 71%, 88%, 30% в первом screen | Жёсткий rule + automatic check |
| H2 «Калькулятор» не содержит расчётов | Worked example с числами и формулой ROI | Rule: для числовых intents — обязательный numerical example |
| 3 сценария — только таблицы без кейсов | Развёрнутый мини-кейс с конкретикой и метриками | Rule: ≥1 кейс с структурой Ситуация → Сценарий → Метрики |
| Бюджетные диапазоны без методологии | Цифры с явной атрибуцией источника | Rule: либо источник, либо явный «Методология редакционной оценки» |
| Нет блока «когда не окупится» | Раздел про риски | Rule: counter-strategy блок обязателен |
| Дата актуальности спрятана в самом низу | — | Render `verifiedAt` в видимой шапке |
| Author = Organization в JSON-LD | Person через `/about#person` (commit `c413021`) | Привести guide JSON-LD в соответствие с news |
| 1 internal link в теле + 3 в footer | 5+ контекстуальных ссылок | Минимум 2 inline-ссылки в теле |
| 5 CTA в одной статье | 2 inline + 3 final | Cap: максимум 2 inline + 1 final block |
| 152-ФЗ не упомянут | Упомянут в разделе «Регуляторные риски» | Чек: для бизнес-кластера — 152-ФЗ обязателен |

Эти пункты вшиваются в стандарт ниже, чтобы Codex не повторял их 28 раз.

## 3. Editorial bar — обязательные элементы любого гайда

### 3.1. Лид и первый экран

- Первое предложение лида содержит **минимум один factual anchor**: число с единицей, имя собственное, дата или источник.
- В первом screen (первые ~700 знаков после H1) должно быть понятно: что обещает статья, что нового по сравнению с SERP, на ком фокус.
- Если статья про деньги/тарифы/метрики/сравнения — в шапке статьи render `Актуальность проверена: <дата>` (новое поле `verifiedAt` в meta, см. раздел 7).

### 3.2. Numerical worked examples

Для всех гайдов с числовым intent (стоимость, ROI, окупаемость, метрики, конверсии, сравнения тарифов):

- Минимум **один развёрнутый расчёт** в теле статьи с конкретными числами и формулой. Шаблон: «Ситуация → данные → формула → результат → выводы».
- Не подменять расчёт таблицей категорий расходов.
- Если есть H2 «Калькулятор», он обязан содержать расчёт. Опционально — добавить client-side калькулятор (отдельная задача, не блокирует выпуск).

### 3.3. Кейсы

Иерархия источников (от лучшего к худшему):

1. **Рыночный кейс из публичного источника**: case study от McKinsey/BCG/Gartner, кейс на Habr/vc.ru от российской компании, blog-пост вендора с указанием цифр, отчёты «Яков и Партнёры», НИУ ВШЭ, IDC.
2. **Анонимизированный кейс** ("компания из e-commerce, ~1000 заявок/день"): когда есть знание рынка, но конкретный источник назвать нельзя.
3. **Синтетический пример (редакционный)**: построен из реалистичных бенчмарков, **обязательно** помечен как «Редакционный пример» под заголовком кейса.

Запрещено: синтетический кейс без пометки, придуманные названия компаний, выдуманные цифры из публичных источников.

Структура кейса в тексте:

```
### <короткий заголовок кейса>
Источник: <ссылка с маленьким размером шрифта> | Редакционный пример

Ситуация. <2-3 предложения с конкретикой: масштаб, отрасль, проблема>
Что делает ИИ. <процесс>
Что нужно для пилота. <чек-лист>
Метрики. <2-4 KPI с цифрами>
Бизнес-логика / итог. <вывод>
```

Минимум — **один развёрнутый кейс** на гайд. Для коротких explainers (≤6000 знаков) можно укрупнить пример, не делая полный кейс.

### 3.4. Counter-strategy блок

Каждый практический гайд должен содержать раздел «Когда не стоит / когда не окупится / когда лучше не начинать / какие сценарии пропустить». Это сильный дифференциатор vs интеграторских материалов, где «когда не надо» отсутствует.

Минимум 3–5 пунктов с практическими критериями. Не общие «когда нет бюджета», а конкретные «нет повторяемости процесса», «нет владельца результата», «нет SLA на критичный процесс», «регуляторно запрещено», «процесс меняется чаще раз в месяц».

### 3.5. Российский контекст и регуляторика

Для статей в кластерах «ИИ для бизнеса», «ИИ-агенты», «Маркетинг и контент»:

- если статья касается данных, клиентов, договоров, HR, финансов — упомянуть 152-ФЗ, режим коммерческой тайны, отраслевые ограничения;
- для тарифов — упомянуть GigaChat/YandexGPT как локальные альтернативы OpenAI/Anthropic с актуальной датой проверки;
- для маркетинга — упомянуть Яндекс.Директ, ВКонтакте, OK как локальные surfaces.

### 3.6. Объём

Сохраняем ориентиры из `task_evergreen_content_agent_2026-05-20.md`:

- главные хабы: 10 000–18 000 знаков (текущая cost-статья — 32 000 в markdown ≈ 26 000 чистого текста, попадает);
- статьи про инструменты: 6 000–12 000;
- глоссарные/узкие: 2 000–5 000.

Не раздувать ради объёма. Лучше короче и плотнее.

### 3.7. Запрещённые приёмы

- ссылаться на ещё не опубликованные гайды как на готовые страницы (`/guides/<future-slug>`);
- придумывать цифры, кейсы, тарифы, кейсы клиентов;
- FAQ, которого нет в видимом тексте (FAQPage schema без visible FAQ);
- general talk «ИИ меняет бизнес» без механики;
- инфобиз-клише («секрет успешного внедрения», «3 шага к ИИ-трансформации», «прорыв»);
- дублирующее markdown TOC при наличии sticky aside (см. раздел 7).

## 4. Картинки через подписку ChatGPT

### 4.1. Контракт

- **Image API не используется** ни через OpenAI, ни через Anthropic, ни через какие-либо runtime-генераторы. Это политика проекта и она не меняется на основе текущей задачи.
- Все картинки evergreen-гайдов делаются: (а) вручную через ChatGPT/Codex-подписку владельца, либо (б) как локальные SVG/Canvas-композиции (для матриц, схем, calculator-диаграмм).
- Финальный файл — **WebP**, владелец/редактор кладёт PNG → скрипт конвертирует.

### 4.2. Размеры

| Тип | Размер ChatGPT (генерация) | Финальный размер (WebP) | Назначение |
|---|---|---|---|
| Cover | 1792×1024 (затем crop) | 1200×675 (16:9) | hero, og:image |
| Inline (диаграмма/схема) | 1792×1024 или 1024×1024 | 1200×800 (3:2) | в теле статьи |
| Inline (квадрат, опционально) | 1024×1024 | 1200×1200 | для специфических визуалов |

### 4.3. Workflow

1. **Codex/агент** в `09-image-brief.md` готовит для каждого изображения:
   - `filename` (например, `cost-control-matrix.webp`);
   - `placement` (`hero` или slug H2-заголовка, после которого вставляется);
   - `prompt` для ChatGPT: 4–8 строк, концепция + стиль + ограничения;
   - `negative` (что НЕ должно быть: роботы, светящийся мозг, неон, рукопожатие человек+робот, generic office stock, читаемый текст внутри картинки, watermarks);
   - `alt` (описательный, для слепых пользователей и SEO);
   - `caption` (раскрывает что изображено и зачем);
   - `aspect` (16:9 для cover, 3:2 для inline).
2. **Владелец/редактор** открывает ChatGPT (Plus/Pro), копирует prompt, генерирует PNG. Сохраняет в:
   ```
   content/evergreen/packages/<slug>/raw-images/<filename>.png
   ```
   Имя файла должно совпадать с тем, что указано в brief (без `.png`).
3. **Конвертация**: запускает `npm run images:prep -- --slug=<slug>`. Скрипт:
   - читает `raw-images/*.png`;
   - смотрит в `09-image-brief.md` или `08-metadata.json` нужный размер;
   - resizes и crops через `sharp` (уже dependency);
   - конвертирует в WebP (quality 82, lossy);
   - кладёт в `public/images/guides/<slug>/<filename>.webp`;
   - выводит размер итогового файла.
4. `evergreen:check` уже проверяет наличие файлов по путям из meta. Дополнительно — проверять, что cover не SVG-плоский (есть минимальная плотность, см. раздел 7.3).

### 4.4. Стиль

Из `articles ever green/Проект 1/Контент-стандарт-Malakhov-AI.txt` + текущий visual guide:

- редакторский, спокойный, фактологический;
- референс — обложки vc.ru / Bloomberg / The Verge editorial pieces, не tech-stock;
- цветовая палитра проекта (см. `docs/DESIGN.md`);
- без читаемого текста внутри изображения (текст в caption);
- без роботов, неона, светящихся мозгов, рукопожатий человек+робот;
- без generic office (люди в костюмах смотрят на монитор), без fake-dashboard с надписями;
- допустимо: концептуальные иллюстрации, абстрактные схемы потоков, бизнес-метафоры (карта, мост, инструменты, конструктор), city/architecture metaphors.

### 4.5. Локальные SVG-диаграммы

Допустимы как замена для:

- матриц выбора (2×2, 3×3);
- roadmap 30/60/90;
- сравнительных диаграмм пилот vs production;
- калькуляторов (визуализация формулы).

Делать через локальный TS-скрипт с генерацией SVG → конвертация в WebP через `sharp`. Не использовать для cover (cover всегда генерируется в ChatGPT).

### 4.6. Cover текущей cost-статьи

Картинки cost-статьи — тонкие SVG (10–12 КБ), не соответствуют новой планке. Apply: перегенерировать **только cover** через ChatGPT-подписку владельца. Inline-схемы можно оставить (они уместны как функциональные диаграммы).

## 5. SEO baseline для всех гайдов

### 5.1. JSON-LD

Текущий `buildJsonLd()` в [app/guides/[slug]/page.tsx](../app/guides/[slug]/page.tsx) ставит `author: Organization`. Менять на:

```ts
author: {
  '@type': 'Person',
  '@id': `${SITE_URL}/about#person`,
  name: 'Иван Малахов',
  url: `${SITE_URL}/about`,
  jobTitle: 'Editor, Malakhov AI Digest',
}
```

(консистентно с news article wave, commit `c413021`)

Добавить в `Article` schema:

- `wordCount` (считаем при build из markdown);
- `articleSection` = `guide.category`;
- `keywords` = `guide.tags.join(', ')`;
- `inLanguage: 'ru-RU'` уже есть.

### 5.2. Title и description

- `seoTitle` ≤ 60 знаков, содержит primary keyword + год или дифференциатор;
- `description` 140–160 знаков, без clickbait, с конкретикой;
- `ogDescription` 140–200 знаков, более продающая, но фактическая.

### 5.3. Internal linking

Стандарт: 2–5 контекстуальных ссылок **в теле** + 2–4 в related-section. Для гайдов 2026:

- ссылки в первом экране — на главный хаб кластера (для cost-статьи это `kak-vnedrit-ii-v-biznes-2026`);
- ссылки в середине — на категории `/categories/<category>` или `/russia` для тематических переходов;
- ссылки в конце — `relatedLinks` (используют существующий блок).

Запрещено линковать на ещё не опубликованные гайды.

Если ссылок недостаточно — добавляем в `evergreen:check` warning «менее 2 inline ссылок в теле», не блокирует.

### 5.4. CTA

Максимум:

- 1–2 inline-CTA в теле (в виде `inlineCtas` в meta JSON);
- 1 final-CTA блок с 3 карточками (`ctaCards`).

Не обещать lead-magnet, которого не существует. Если CTA «получить чеклист в Telegram» — у владельца должен быть готов сам чеклист.

### 5.5. FAQ

- 6–10 вопросов;
- каждый ответ — 2–4 предложения, конкретный, отвечает на вопрос;
- FAQ visible в markdown, mirrored в `08-metadata.json`;
- FAQ#1 не дублирует summary-таблицу из лида;
- FAQ schema эмитируется только когда FAQ visible (правило уже есть).

### 5.6. Видимая дата актуальности

В шапке гайда render блок:

```
Обновлено: <updatedAt> | Актуальность проверена: <verifiedAt>
```

`verifiedAt` — новое поле в meta JSON (см. раздел 7).

### 5.7. Noindex flow

- черновик публикуется с `noindex: true`;
- после ревизии владельца — снимаем `noindex` и пушим;
- `scripts/indexnow-batch.ts` пингует Yandex/Bing при следующем deploy;
- `npm run evergreen:check` — должен warn'ить, если статья сидит в `noindex` > 14 дней (track через git history).

## 6. Обновление инструкций для агента и Codex

### 6.1. Промпт для Project 1 (создание статьи)

Файл: [articles ever green/Проект 1/Промпт-для-создания-одной-статьи.txt](../articles%20ever%20green/Проект%201/Промпт-для-создания-одной-статьи.txt)

Добавить блок «Обязательные элементы любой статьи»:

```
В каждой статье обязательно:
1. Лид с factual anchor в первом предложении (число + источник + дата).
2. Видимая дата проверки актуальности.
3. Минимум один развёрнутый numerical worked example для статей с числовым intent.
4. Минимум один кейс по структуре Ситуация → Сценарий → Метрики → Вывод.
   Приоритет: реальный публичный → анонимизированный → редакционный (помечать).
5. Counter-strategy блок «когда не стоит / не окупится / не подходит».
6. Российский контекст и упоминание 152-ФЗ для статей о данных, клиентах, HR.
7. 2-5 внутренних ссылок в теле статьи (не считая related).
8. Не более 2 inline-CTA и 1 final CTA-блок с 3 карточками.

Запрещено:
- придумывать цифры, тарифы, имена компаний, кейсы клиентов;
- ссылаться на ещё не опубликованные гайды как на готовые страницы;
- использовать FAQPage schema без visible FAQ;
- инфобиз-клише («секрет», «прорыв», «революция», «3 шага к ИИ-трансформации»);
- дублирующее markdown TOC при наличии sticky aside.
```

### 6.2. Промпт для Project 2 (финальная редактура)

Файл: [articles ever green/Проект 2/Промпт-для-финальной-редактуры.txt](../articles%20ever%20green/Проект%202/Промпт-для-финальной-редактуры.txt)

Добавить чек-лист редактора:

```
Финальная редактура обязана подтвердить:
1. Первое предложение лида содержит число / имя / дату / источник.
2. Есть видимая дата проверки актуальности.
3. Есть хотя бы один развёрнутый расчёт (для числовых intents).
4. Есть кейс с конкретикой (источник или пометка «редакционный пример»).
5. Есть counter-strategy блок.
6. Учтён российский контекст и регуляторика (если применимо).
7. ≥2 внутренних ссылок в теле, не считая related.
8. CTA не больше 2 inline + 1 final.
9. JSON-LD требования: author = Person, wordCount, articleSection.
10. Картинки готовятся через подписку ChatGPT, не через API.
```

### 6.3. Image brief template

Файл: [content/evergreen/templates/image-brief.template.md](../content/evergreen/templates/image-brief.template.md)

Добавить:

- блок «Generation source: ChatGPT subscription (no image API)»;
- explicit поля `prompt`, `negative_prompt`, `aspect`, `filename_png`, `filename_webp`;
- инструкцию для владельца: «Сохрани PNG в `raw-images/<filename>.png`, затем `npm run images:prep -- --slug=<slug>`».

### 6.4. Editorial pass template

Файл: [content/evergreen/templates/editorial-pass.template.md](../content/evergreen/templates/editorial-pass.template.md)

Добавить чек-лист из 6.2.

## 7. Технические задачи

### 7.1. `lib/guides.ts` и meta schema

Файл: [lib/guides.ts](../lib/guides.ts)

Добавить в `GuideMeta`:

- `verifiedAt: string` (ISO-date, обязательное);
- `caseSourcing?: 'public' | 'anonymized' | 'editorial'` (optional, информативное).

Backfill для существующих двух гайдов: `verifiedAt = updatedAt`.

### 7.2. `app/guides/[slug]/page.tsx` render

Файл: [app/guides/[slug]/page.tsx](../app/guides/[slug]/page.tsx)

- Заменить `author: Organization` на Person по образцу NewsArticle (см. 5.1).
- Добавить `wordCount`, `articleSection`, `keywords` в `articleSchema`.
- В header render `Актуальность проверена: <verifiedAt>`.
- Mobile: дублирующее markdown TOC сворачивать в `<details><summary>В статье</summary>...</details>`. Альтернатива — убирать markdown TOC и оставлять только sticky aside (но он не показан на mobile).
- `inlineCtas` cap: warn в build, если более 2 inline CTA.

### 7.3. `scripts/evergreen-check.ts` правила

Файл: [scripts/evergreen-check.ts](../scripts/evergreen-check.ts)

Добавить проверки:

| Правило | Тип | Что проверяет |
|---|---|---|
| `lead_has_anchor` | warn | В первых 700 символах после H1 есть число `\d+` или CAPSLOCK слово (имя собственное) |
| `verifiedAt_present` | error | meta содержит `verifiedAt` |
| `verifiedAt_recent` | warn | `verifiedAt` не старше 180 дней относительно сегодня |
| `inline_internal_links` | warn | В body не меньше 2 ссылок `(/guides|/categories|/russia)/...` (не считая related из meta) |
| `cta_count` | warn | `inlineCtas.length + ctaCards.length ≤ 5` |
| `case_block_present` | warn | В markdown есть хотя бы один H3, который начинается на «Кейс», «Сценарий», «Ситуация», «Мини-кейс» или маркируется `Редакционный пример` |
| `counter_strategy_present` | warn | Есть H2 содержащий «не стоит», «не окупится», «не подходит», «когда не» или равный «Ошибки внедрения» |
| `noindex_age` | warn | Если `noindex: true` и git-log первого touch старше 14 дней |
| `forbidden_future_links` | error | Ссылки `/guides/<slug>` все ведут на существующие markdown файлы (уже есть) |
| `cover_min_size` | warn | Cover файл ≥ 80 КБ (тонкий SVG-WebP ≈ 10–12 КБ, что мало для cover) |

Warnings не блокируют, errors блокируют.

### 7.4. Новый скрипт `scripts/images-prep.ts`

Назначение: конвертировать PNG из ChatGPT в production-WebP по правильным размерам.

```
npm run images:prep -- --slug=<slug>
```

Что делает:

- читает `content/evergreen/packages/<slug>/raw-images/*.png`;
- мэтчит файлы с `08-metadata.json` (cover + inlineImagesByHeading) по filename без расширения;
- для cover — resize+crop до 1200×675, WebP quality 82;
- для inline — 1200×800 (или 1200×1200 для квадратных), WebP quality 82;
- кладёт в `public/images/guides/<slug>/<filename>.webp`;
- если PNG > 5 МБ — warn (наверняка ChatGPT-источник без сжатия);
- выводит сводку: сколько файлов сконвертировано, итоговый суммарный размер.

Dependencies: `sharp` уже есть в `package.json`.

В `package.json` добавить:

```json
"images:prep": "tsx scripts/images-prep.ts"
```

### 7.5. Тесты

Минимум — node test для:

- `scripts/images-prep.ts` (snapshot resize до правильных размеров);
- `scripts/evergreen-check.ts` (новые rules — lead anchor, counter strategy, noindex age);
- `lib/guides.ts` (`verifiedAt` обязательность).

### 7.6. Backfill cost-статьи под новый стандарт

После апгрейда — прогон через новый `evergreen:check`. Ожидаемые warnings:

- `lead_has_anchor` — fail, фиксим лид;
- `counter_strategy_present` — fail, добавляем H2 «Когда внедрение не окупится»;
- `case_block_present` — fail, развёртываем один из 3 сценариев в полный кейс;
- `inline_internal_links` — fail, добавляем 1–2 ссылки в тело;
- `cover_min_size` — fail, перегенерируем cover в ChatGPT.

Тех правки в одном PR: JSON-LD author swap, `verifiedAt` render, `wordCount`, fix mobile TOC.

## 8. Обновление канонических документов

После реализации спеки апдейтим:

- [docs/editorial/seo-article-publication-standard.md](editorial/seo-article-publication-standard.md) — секции 7 (editorial value), 11 (image), 14 (internal linking), 15 (structured data), 17 (publication readiness).
- [docs/editorial_style_guide.md](editorial_style_guide.md) — добавить раздел «Evergreen quality bar» (lead anchor, кейсы, counter-strategy).
- [docs/ARTICLE_SYSTEM.md](ARTICLE_SYSTEM.md) — meta schema (`verifiedAt`, `caseSourcing`), новый скрипт `images:prep`.
- [docs/OPERATIONS.md](OPERATIONS.md) — workflow картинок через подписку ChatGPT (раздел про image pipeline).
- [CLAUDE.md](../CLAUDE.md) — отметить, что текущая закрытая инициатива переходит к «Evergreen quality wave» и сослаться на эту спеку.
- [docs/task_evergreen_content_agent_2026-05-20.md](task_evergreen_content_agent_2026-05-20.md) — отметить процессуальные изменения (image workflow, новые поля meta).

## 9. Открытые вопросы для владельца — закрыто 2026-05-22

1. **Telegram lead-magnet** → **CTA-чеклиста больше нет**. Чеклист в Telegram реально не существовал, обещание было фейковым. Final CTA-блок и inline-CTA в `kak-vnedrit-ii-v-biznes-2026` заменены на три honest CTA: «AI-новости в Telegram» (дайджест-канал, реально выходит), «Архитектурный разбор ИИ» (заявка на consultation через `malakhovai.ru/contacts`), «Личный разговор» (личный Telegram `@malakhovai`). Никаких обещаний бесплатных артефактов, которых нет.
2. **Темп выпуска** → **владелец сам решает** + опционально автоматический pipeline. Согласовано: я могу собрать draft-конвейер на `mcp__scheduled-tasks__create_scheduled_task` (через Claude Code Max-подписку, не API), который раз в N дней пишет следующий черновик в `content/evergreen/queue/`, открывает PR, помечает тему как `draft_ready`. Владелец генерирует cover в ChatGPT, OK, merge. См. §13 (новая секция).
3. **Картинки** → **владелец делает сам в ChatGPT**. Никакого MCP-моста в ChatGPT-подписку не строим: публичного API нет, через Chrome MCP — шатко (2FA/UI/ToS). Текущий ручной путь остаётся. DALL-E через API отклонено как нарушающее бюджет=0 (даже $2.24 за 28 covers).
4. **Кейсы по российскому рынку** → **внутренний white-list 8 источников** (не светим публично, чтобы не уменьшать стимул читателя обратиться). Tier 1 (доверяем без оговорок): Яков и Партнёры, НИУ ВШЭ ИСИЭЗ, TAdviser, CNews Analytics. Tier 2 (первоисточники для локальных моделей): Sber/SberAI blog, Yandex Research. Tier 3 (журналистский фактчек выше среднего): Forbes Russia, Ведомости.Технологии. С пометкой «фактчекать»: Habr (смотреть карму/комменты), vc.ru (отделять от рекламных постов). Сознательно исключены: РБК Тренды (часто промо), Коммерсант (мало AI-кейсов). См. white-list в `docs/editorial/seo-article-publication-standard.md` §12.
5. **Indexation cadence** → **публикуем сразу, без `noindex`-окна**. Cost-статью — оставляем `noindex: true` до момента, когда владелец положит cover из ChatGPT и запустит `npm run images:prep`. После этого сразу `noindex: false` + `npx tsx scripts/indexnow-batch.ts --apply`. Для всех будущих гайдов: `noindex: true` ставится только в момент draft (до первого деплоя) и снимается сразу после готовности cover — не как 3-7-дневное окно ревью.
6. **Calculator интерактивный** → **нет, ограничиваемся статическим worked example**. Не делаем React Client Component для ROI/cost статей. Worked example по шаблону «Ситуация → данные → формула → результат → выводы» в markdown достаточно. Это правило закреплено в SEO-стандарте.
7. **`updatedAt` vs `verifiedAt`** → **оба поля остаются обязательными**. Не переопределяли — текущая логика валидна (см. реализацию `GuideMeta` в `lib/guides.ts`).

## 10. Definition of Done

Спека считается реализованной, когда:

- [ ] `lib/guides.ts`: `verifiedAt` обязательное поле, `caseSourcing` опциональное;
- [ ] [app/guides/[slug]/page.tsx](../app/guides/[slug]/page.tsx): JSON-LD author = Person, `wordCount`, `articleSection`, `keywords`; render `verifiedAt` в header; mobile TOC сворачивается;
- [ ] `scripts/evergreen-check.ts`: новые 10 правил из 7.3;
- [ ] `scripts/images-prep.ts` написан, в `package.json` добавлен `images:prep`;
- [ ] image-brief и editorial-pass templates обновлены;
- [ ] Промпт Project 1 и Project 2 обновлены по разделам 6.1 и 6.2;
- [ ] [docs/editorial/seo-article-publication-standard.md](editorial/seo-article-publication-standard.md) обновлён;
- [ ] [docs/editorial_style_guide.md](editorial_style_guide.md) обновлён;
- [ ] [docs/ARTICLE_SYSTEM.md](ARTICLE_SYSTEM.md) обновлён;
- [ ] [docs/OPERATIONS.md](OPERATIONS.md) обновлён (image workflow);
- [ ] cost-статья пересобрана по новому стандарту, прошла `evergreen:check` без errors, `noindex` снят, в indexnow подана;
- [ ] open questions раздела 9 закрыты владельцем.

## 11. Рекомендуемый порядок реализации

Этапы сделаны так, чтобы можно было прерваться в любом месте без частично сломанного состояния:

1. **Спека утверждена владельцем** (open questions закрыты, темп выпуска зафиксирован).
2. **Templates + промпты** (один PR, без кода): updates по 6.1, 6.2, 6.3, 6.4.
3. **Tech: meta schema + JSON-LD** (второй PR): `verifiedAt` в `lib/guides.ts`, JSON-LD swap, `wordCount`, `articleSection`. Backfill для обоих существующих гайдов.
4. **Tech: `evergreen:check` правила** (третий PR): новые rules из 7.3 + тесты.
5. **Tech: `scripts/images-prep.ts`** (четвёртый PR): script + npm-команда + минимальный тест.
6. **Cost-статья по новому стандарту** (пятый PR): фикс лида, кейс, counter-strategy, internal links, cover regen в ChatGPT, snimaem noindex.
7. **Canonical docs update** (шестой PR): seo-standard, style-guide, ARTICLE_SYSTEM, OPERATIONS, CLAUDE.md.

После 7 этапа стандарт готов к массовому выпуску оставшихся 28 материалов.

Docs impact: создан новый spec-файл [docs/spec_2026-05-21_evergreen-quality-standard.md](spec_2026-05-21_evergreen-quality-standard.md). После реализации этапов 2–7 канонические документы обновятся согласно разделу 8.

## 12. Implementation status (2026-05-21)

| DoD пункт | Статус | Где |
|---|---|---|
| `lib/guides.ts`: `verifiedAt` обязательное поле, `caseSourcing` опциональное | ✅ done | `lib/guides.ts::GuideMeta` |
| `app/guides/[slug]/page.tsx`: JSON-LD author = Person, `wordCount`, `articleSection`, `keywords`; render `verifiedAt` в header; mobile TOC сворачивается | ✅ done | `app/guides/[slug]/page.tsx::buildJsonLd`, `stripInlineToc`, `<details>` для mobile TOC |
| `scripts/evergreen-check.ts`: новые 10 правил из 7.3 | ✅ done | `scripts/evergreen-check.ts` (`leadHasAnchor`, `hasCaseBlock`, `hasCounterStrategy`, `countInlineInternalLinks`, verifiedAt/caseSourcing/CTA проверки, cover_min_size, noindex_age) |
| `scripts/images-prep.ts` написан, в `package.json` добавлен `images:prep` | ✅ done | `scripts/images-prep.ts`, `package.json` |
| image-brief и editorial-pass templates обновлены | ✅ done | `content/evergreen/templates/image-brief.template.md`, `content/evergreen/templates/editorial-pass.template.md` |
| Промпт Project 1 и Project 2 обновлены по разделам 6.1 и 6.2 | ✅ done | `articles ever green/Проект 1/Промпт-для-создания-одной-статьи.txt`, `articles ever green/Проект 2/Промпт-для-финальной-редактуры.txt` |
| `docs/editorial/seo-article-publication-standard.md` обновлён | ✅ done | секции 7 (Evergreen quality bar), 11 (image workflow), 14 (linking + CTA cap), 15 (JSON-LD Person/wordCount/articleSection/keywords), 17 (publication readiness) |
| `docs/editorial_style_guide.md` обновлён | ✅ done | секция «Evergreen quality bar» |
| `docs/ARTICLE_SYSTEM.md` обновлён | ✅ done | блок про `GuideMeta`, `verifiedAt`, `caseSourcing` и image pipeline в «Связанные поверхности» |
| `docs/OPERATIONS.md` обновлён (image workflow) | ✅ done | `npm run images:prep` в Основных командах, секция «Evergreen image workflow (ChatGPT subscription)» |
| Тесты | ✅ done | `tests/node/evergreen-quality-standard.test.ts`, `tests/node/guides-verified-at.test.ts`, `tests/node/images-prep.test.ts` |
| Cost-статья пересобрана по новому стандарту | ✅ done (контент); ⏸ cover regen — owner step | лид с factual anchor (257 млрд ₽ / Gartner 30%), кейс «AI-квалификация лидов (Редакционный пример)», H2 «Когда внедрение ИИ не окупится», доп. inline-link на `/categories/ai-industry` |
| Cost-статья прошла `evergreen:check` без errors | ✅ done | только `cover_min_size` остаётся warning, ждёт ChatGPT regen |
| `noindex` снят, в indexnow подана | ⏸ owner step | требует cover regen в ChatGPT перед публикацией, см. §11 пункт 6 |
| Open questions раздела 9 закрыты владельцем | ✅ done 2026-05-22 | см. §9 (closed), §13 (auto-draft pipeline) |

После того как владелец сгенерит cover в ChatGPT (≥ 80 KB WebP), положит PNG в `content/evergreen/packages/skolko-stoit-vnedrenie-ii-v-kompaniyu/raw-images/cover.png`, запустит `npm run images:prep -- --slug=skolko-stoit-vnedrenie-ii-v-kompaniyu` и проверит результат — можно снять `noindex: true` в `content/guides/meta/skolko-stoit-vnedrenie-ii-v-kompaniyu.json` и подать URL через `npx tsx scripts/indexnow-batch.ts` (требует `INDEXNOW_KEY` в окружении).

## 13. Auto-draft pipeline (планируется к запуску после согласования темпа)

> Источник: ответы владельца 2026-05-22 на вопросы §9.2.

Цель: 28 оставшихся гайдов выпускать без активного участия владельца на стороне написания.
Узкое место — cover в ChatGPT — остаётся ручным.

**Архитектура:**

1. `content/evergreen/queue.json` — приоритетный backlog тем. Структура:
   ```json
   {
     "items": [
       {
         "topic": "ИИ-агенты для отдела продаж: что они реально делают",
         "cluster": "ИИ для бизнеса",
         "primaryKeyword": "ии агенты для продаж",
         "intent": "evergreen",
         "status": "pending | draft_ready | published",
         "createdAt": "2026-05-22",
         "draftBranch": null
       }
     ]
   }
   ```
2. `mcp__scheduled-tasks__create_scheduled_task` запускает новую Claude Code сессию по cron. Промпт сессии:
   - Берёт следующий `pending` item из `queue.json`.
   - Делает WebFetch на 3–5 материалов white-list'а (§12 SEO-стандарта) для свежих цифр и кейсов.
   - Создаёт ветку `evergreen/<slug>` от `main`.
   - Пишет полный draft по `articles ever green/Проект 1/Промпт-для-создания-одной-статьи.txt` + редактуру по `Проект 2/...`.
   - Генерит `content/guides/<slug>.md` + `content/guides/meta/<slug>.json` с `noindex: true`, `verifiedAt`, `caseSourcing`.
   - Формирует `content/evergreen/packages/<slug>/09-image-brief.md` с готовым промптом для ChatGPT.
   - Запускает `npm run evergreen:check -- --slug=<slug>`. Если errors — fail, ветку не коммитит.
   - Если pass — commit + push, открывает PR с чеклистом для владельца: `[ ] cover.png в raw-images/ → npm run images:prep → noindex:false → merge`.
   - Помечает тему в queue.json как `draft_ready` + ссылку на PR.
3. Владелец приходит → PR → один промпт в ChatGPT для cover → drop PNG → `npm run images:prep` → снимает `noindex` → merge → автодеплой → `npx tsx scripts/indexnow-batch.ts --apply`.

**Что нужно для запуска (TBD):**

- Owner выбирает темп: 2 дня / 3 дня / 7 дней между запусками.
- Owner даёт backlog 28 тем или поручает мне составить из текущей cluster-карты (categories: ai-industry, ai-russia, ai-startups, coding × intent-кластеры).
- Подтверждение, что Claude Code Max-подписка позволяет scheduled tasks (если ограничение — переходим на GitHub Actions cron с personal access token).
- Перед автоматизацией — первые 2 гайда я делаю в живой сессии с владельцем для калибровки качества.

**Риски:**

- Quality drift в фоне без живого ревью. Митигация: первые 2 гайда live, после — `evergreen:check` errors как hard gate.
- Claude-квота кончилась → задача упадёт молча. Митигация: alert в Telegram через существующий `bot/health-check` или новый ping.
- WebFetch на white-list источники — некоторые могут блокировать (Forbes/Ведомости ставят paywall, ВШЭ ISSEK иногда блокирует не-RU IP). Митигация: если источник недоступен, помечаем кейс `caseSourcing: "anonymized"` или `"editorial"` и не выдумываем цифры.
