# Spec — Digest editorial priority + cover preference fix

Дата: 2026-05-22
Статус: **closed 2026-05-23 morning**. Wave 1/2/3 закрыты 2026-05-22 late evening,
Wave 4 + broader-backfill + recent-rescore — 2026-05-23 morning.
Связанные канонические файлы: `docs/ARTICLE_SYSTEM.md`, `docs/OPERATIONS.md`

## Проблема

### 1. Главные индустриальные сюжеты теряются в Telegram-дайджесте

Наблюдение владельца (2026-05-22): «у меня вообще нет инфы о Google I/O 2026, при этом в ТГ приходят какого-то второго сорта новости».

Факты из БД (14 дней):

- Google I/O 2026 **был** покрыт. За 19–21 мая мы поймали 14 live-материалов с упоминанием Google/Gemini/DeepMind (The Verge AI, The Decoder, TechCrunch, Ars Technica, ZDNet, Habr).
- Из них в Telegram попал **только** Habr-разбор «Google I/O 2026: что реально вышло» и DeepMind Asia Accelerator (потому что source=DeepMind даёт +3 AI_LABS).
- Все остальные Google-сюжеты со score=4–5 проиграли Habr-материалам со score=6 и vc.ru со score=7.

Дайджесты 19–22 мая показывают, что 4 из 5 слотов почти каждый день занимает Habr AI (CUDA OOM, Flutter 3.44, Dart 3.12, Spring ИИ, голосовой бот в финтехе, ИИ-рекрутер и т.п.) — материал интересный, но «второго эшелона» по индустриальной значимости.

#### Корень — формула `pipeline/scorer.ts`

```
ai-russia                +2
source_lang === 'ru'     +1   ← дублирует ai-russia сигнал
length > 200             +1
length > 1000            +1
cover_image_url          +1
AI_LABS match by source  +3   ← матч только по source_name; The Verge / TechCrunch не получают
TOP_OUTLETS              +1
pub_date < 6h            +1
```

- Любой ru-материал с обложкой длиннее 1000 символов автоматически получает базовый 6.
- The Verge / TechCrunch / Ars Technica с Google-новостью могут собрать максимум 5.
- AI_LABS не учитывает упоминание лаборатории в `original_title` — только source_name.

#### Корень — выборка дайджеста

`bot/daily-digest-core.ts:567` берёт top-8 по `score desc` без diversity-кэпа. Поэтому Habr монополизирует 4–5 слотов.

#### Корень — отсутствует Google product blog

`pipeline/feeds.config.ts` содержит `Google Research Blog` и `Google DeepMind Blog`, но продуктовые Gemini/Veo/Imagen анонсы публикуются на `blog.google` (нет в фидах). К нам они попадают только через посредников (Verge/TechCrunch) с задержкой и без +3 AI_LABS-бонуса.

### 2. AI-обложка перетирает реальные продуктовые фото

Кейс: `https://news.malakhovai.ru/categories/ai-startups/flipper-devices-...`

- Fetcher вытащил 5 продуктовых фото Flipper One из `leonardo.osnova.io`, сохранил в `article_images`.
- Submit/collect sanitizer промоутил первую inline-картинку в cover (`coverPromotedFromInline=true`).
- Через 2 часа `scripts/generate-ai-covers.ts` запустился и перетёр cover на AI-иллюстрацию «Russian enterprise operations room … cautious managers».

#### Корень — `needsAiCover()` в `scripts/generate-ai-covers.ts:389`

```ts
function needsAiCover(article) {
  if (!article.cover_image_url) return true
  if (article.cover_image_url.includes('/article-images/ai-covers/')) return false
  if (!getUsableCoverUrl(article)) return true
  if (article.cover_image_url.includes('/article-images/template-covers/')) return true
  if (article.cover_image_url.includes('/article-images/stock-covers/')) return true
  return ['Habr AI', 'vc.ru', 'vc.ru AI/стартапы', 'CNews'].includes(article.source_name)
}
```

Для этих 4 источников AI-cover генерируется **безусловно** — даже когда у статьи в `article_images` лежат пригодные продуктовые фото. `getUsableCoverUrl` передаёт `articleImages: null` в sanitizer, поэтому не учитывает реальную картину.

#### Масштаб (14 дней)

```
image_cover_generation: 122 шт, $1.61 total
  Habr AI            90 ($1.157)   — почти всегда нет продуктовых фото, AI ок
  CNews              20 ($0.260)   — то же
  vc.ru AI/стартапы  5  ($0.102)   — 2/5 имели готовые inline-фото; одна из них — Flipper
  ZDNet AI           3
  The Verge AI       2
  TechCrunch AI      2
```

Vc.ru типично публикует launch-стори с фото продукта. Замена на generic AI — это потеря editorial value.

Bonus-finding: prompt scene-matcher в `generate-ai-covers.ts::chooseScene` для Flipper выбрал «AI adoption in Russian enterprise» — никак не связано со статьёй. Сцены подбираются по индексу/категории, не по сущностям статьи. Это отдельная боль, фиксим вторым шагом.

## Цели

1. Главные индустриальные сюжеты (Gemini-launches, OpenAI-релизы, M&A, регуляторные решения) попадают в TG-дайджест, даже если в тот же день Habr выпустил серию dev-материалов.
2. Реальные продуктовые фото из vc.ru/TechCrunch/Verge никогда не замещаются AI-обложкой.
3. Стоимость AI-обложек не вырастает; в идеале — снижается за счёт явного skip при наличии inline.

## Не-цели

- Не переосмысливаем сам Telegram-формат (5 карточек + хедер) — структуру оставляем.
- Не отключаем Habr/CNews ленты — они остаются нужными для российского сегмента.
- Не строим персонализацию.

## Объём изменений

### A. Перебалансировка scorer

Файл: `pipeline/scorer.ts`, `pipeline/scorer.config.ts`.

A1. Удвоение «ru» убираем:
- `ai-russia` бонус: +2 → **+1**.
- `source_lang === 'ru'`: +1 → **0** (удаляем).

A2. Расширяем «AI labs» детектор: смотреть не только `source_name`, но и токены в `original_title` (а для длинных материалов — в первом килобайте `original_text`). Расширенный набор:
```
openai · gpt-4 · gpt-5 · chatgpt · sora
anthropic · claude
google · gemini · deepmind · veo · imagen
meta · llama
mistral · cohere
nvidia · cuda · blackwell
microsoft · copilot · phi
xai · grok
```
Бонус: **+2** за match по тексту (вместо +3 по source_name — чтобы не перегружать; источник уже даёт +1 через TOP_OUTLETS).

A3. Major-announcement signal: триггеры `unveils|launches|announces|releases|introduces|представил|запустил|анонсиров|выпуст` в `original_title` + одновременное упоминание модели/продукта из списка A2 → **+2**.

A4. `length > 1000` → менять на soft, **+1 только если есть editorial_body после enrich**, а не raw original_text. Сырая длина не должна сама по себе давать score.

A5. Cover bonus `+1 if cover_image_url` оставляем только если это «настоящая» обложка: не из `/article-images/ai-covers/` и не `/template-covers/`. Сейчас AI-cover даёт тот же бонус, что и продуктовое фото.

Acceptance:
- Прогнать `scoreArticle` на ретро-данных за последние 7 дней (`scripts/score-rebalance-dry-run.ts` — новый), сравнить top-10 по дням до/после.
- Для дня 2026-05-19: материалы The Verge/TechCrunch/Decoder про Gemini 3.5 Flash / Google I/O должны попадать в top-5 хотя бы в один из дайджестов 19–20 мая.

### B. Расширение источников

Файл: `pipeline/feeds.config.ts`.

B1. Добавить feed:
```ts
{
  name: 'Google Blog',
  url: 'https://blog.google/technology/ai/rss/',
  lang: 'en',
  topics: ['ai-labs', 'ai-industry'],
}
```

Проверить, что endpoint живой (HEAD-запрос перед добавлением; если основной AI-rss отвечает 404, fallback — корневой `https://blog.google/rss/` с `needsKeywordFilter: true` + `EN_AI_CORE_KEYWORDS`).

B2. Источники, явно подпадающие под расширенный AI_LABS-детектор (Microsoft Blogs, NVIDIA Blog), оставляем как есть — A2 уже даёт им +2 через text-match.

B3. Обновить scoring AI_LABS source-match список синхронно с feeds: убрать жёсткий `Google Research` (он остаётся), добавить детектирование `Google Blog` и `Microsoft Blogs` для +3 source-match (либо переезжаем полностью на text-match из A2 и source-match убираем). Я склоняюсь к **полностью text-match**, потому что это даёт правильный сигнал и для статей, репостящих анонс.

### C. Diversity-кэп в Telegram-дайджесте

Файл: `bot/daily-digest-core.ts`.

C1. После основного SELECT, перед `.slice(0, 5)`, добавить per-source-кэп: **не более 2 статей с одним `source_name`** среди финальных 5.

Реализация — после фильтра live-доступности:
```
selected = []
remaining = articles
while selected.length < 5 && remaining.length:
  pick = remaining[0] (top by score)
  if count(selected, s => s.source_name === pick.source_name) >= 2: skip
  else: push to selected
  remaining.shift()
```

C2. Минимум 1 слот «индустриальный»: если среди топ-8 есть статья с TOP_OUTLETS source или с major-announcement signal (см. A3), она получает приоритет над любой Habr-статьёй того же score-bucket. Реализация: после первого прохода, если ни один слот не занят TOP_OUTLETS/major — перезаписываем последний по score-rank слот ближайшим подходящим.

C3. `digest_runs` начинает писать в `payload` distribution по source_name (`{ "Habr AI": 2, "The Verge AI": 1, ... }`) — нужно для проверки эффекта кэпа из дашборда.

Acceptance:
- Ретро-симуляция на 2026-05-19 / 20 / 21: ни один из дайджестов не должен показывать 4 Habr AI подряд.

### D. AI-cover должен уважать существующие inline-картинки

Файлы: `scripts/generate-ai-covers.ts`, `lib/media-sanitizer.ts`.

D1. Переписать `needsAiCover(article)`:

```ts
function needsAiCover(article: ArticleRow): boolean {
  // AI cover уже сгенерён ранее — не трогаем
  if (article.cover_image_url?.includes('/article-images/ai-covers/')) return false

  // Попробовать заранее «сгенерировать» cover из inline через sanitizer (с articleImages!)
  const sanitized = sanitizeArticleMedia({
    coverImageUrl: article.cover_image_url,
    articleImages: article.article_images,
    context: { ... },
  })

  // Если sanitizer вернул usable cover (исходный или промоутированный из inline) — НЕ генерим AI
  if (sanitized.coverImageUrl) {
    if (sanitized.coverPromotedFromInline) {
      // Бонусом: записать cover_image_url в БД, чтобы render-time fallback не оставался
      // в зависимости от sanitizer-а каждый раз.
      // Это back-fill при необходимости — отдельная step D3.
      return false
    }
    // Источник дал нормальный cover — генерить не надо
    return false
  }

  // Если живого cover нет ни в article.cover_image_url, ни в inline — да, AI-cover нужен
  if (!sanitized.coverImageUrl) {
    return true
  }

  // template/stock — допустимо заменить на AI
  if (article.cover_image_url?.includes('/article-images/template-covers/')) return true
  if (article.cover_image_url?.includes('/article-images/stock-covers/')) return true

  return false
}
```

Убрать хардкод `['Habr AI', 'vc.ru', 'vc.ru AI/стартапы', 'CNews']` — поведение должно определяться **наличием usable inline**, а не именем источника.

D2. Sanitizer для vc.ru — отдельная мелкая правка: добавить `vc.ru|vc\.ru` в `CONTEXTUAL_IMAGE_SOURCE_RE` (`lib/media-sanitizer.ts:70`). Это позволит inline-картинкам vc.ru с generic captions (например, «Источник здесь и далее: Flipper Devices») проходить sanitizer, потому что vc.ru как источник в большинстве своём публикует editorial-фото в теле. Для Habr оставляем `habrastorage.org`-only фильтр (уже есть).

D3. Скрипт `scripts/backfill-cover-from-inline.ts` (новый): прогон по live-статьям где `cover_image_url` указывает на `/article-images/ai-covers/` И `article_images.length > 0` И в первой inline есть strong-subject-match — заменить cover на inline. По данным аудита это ~2 статьи за 14 дней, копеечный backfill. Сначала `--dry-run`, владелец просматривает diff, потом `--apply`.

D4. Scene-matcher в `generate-ai-covers.ts::chooseScene` — сейчас выбирает сцену по index/category. Сделать его context-aware: смотреть на product/entity keywords в `ru_title`/`lead` и выбирать «device close-up» для product-launch, «portrait composition» для people-focused, и т.д. Это minimal upgrade — добавить 3 правила перед текущим switch (отдельный PR, не блокирует A/B/C/D1-D3).

Acceptance:
- После `--apply` `needsAiCover` возвращает false для статьи bfe0a125 (Flipper) и cover ссылается на одну из leonardo.osnova ссылок.
- За следующие 7 дней количество image_cover_generation для vc.ru/Verge/TechCrunch/ZDNet падает до ~0 (только когда у статьи реально нет inline).
- Total AI-cover cost не растёт.

### E. Документация

- Обновить `docs/ARTICLE_SYSTEM.md` секции `Score and publish gate` и `Cover image`: новые scorer-правила, описание diversity-кэпа в дайджесте, новое поведение AI-cover.
- В `CLAUDE.md` строкой добавить: «Последняя инициатива: digest editorial priority + cover fix (2026-05-22)».

## Файлы, которые меняются

```
pipeline/scorer.ts                          — A
pipeline/scorer.config.ts                   — A (вспомогательные регэкспы)
pipeline/feeds.config.ts                    — B
bot/daily-digest-core.ts                    — C
scripts/generate-ai-covers.ts               — D1, D4
lib/media-sanitizer.ts                      — D2 (CONTEXTUAL_IMAGE_SOURCE_RE)
scripts/backfill-cover-from-inline.ts       — D3 (новый)
scripts/score-rebalance-dry-run.ts          — A acceptance (новый, временный)
docs/ARTICLE_SYSTEM.md                      — E
CLAUDE.md                                   — E
```

## План выполнения

1. **Wave 1 — Scorer + Digest diversity (A + C).** Дешёвая правка двух файлов; ретро-симуляция на 7 днях; обновить `ARTICLE_SYSTEM.md` секцию score. Эффект: следующий же дайджест должен показать новую структуру.
2. **Wave 2 — Cover preference fix (D1 + D2 + D3).** Меняет поведение scheduled-cron `generate-ai-covers`. Без D3 эффект только на будущие статьи; D3 чинит исторические.
3. **Wave 3 — Google Blog feed (B).** Один новый источник; следить за `source_runs` 3 дня и калибровать keyword filter.
4. **Wave 4 — Scene-matcher fix (D4).** Не блокирует пользу от Wave 2, но улучшает оставшиеся AI-cover кейсы.

Каждая wave — отдельный коммит с DoD ниже.

## DoD по waves

### Wave 1
- [ ] `scoreArticle` обновлён по A1–A5.
- [ ] Diversity-кэп работает: не более 2 статей с одним source_name в финальных 5.
- [ ] Ретро-симуляция за 2026-05-19/20/21 показывает попадание The Verge/Decoder Gemini-сюжетов в top-5 хотя бы одного дайджеста.
- [ ] `tests/node/scorer.test.ts` (расширить или создать) покрывает ai-russia, AI_LABS-text-match, major-announcement signal.
- [ ] `docs/ARTICLE_SYSTEM.md` секция «Score and publish gate» обновлена.

### Wave 2
- [ ] `needsAiCover()` использует `article_images` и не дёргает OpenAI при наличии promoted-from-inline cover.
- [ ] `lib/media-sanitizer.ts` `CONTEXTUAL_IMAGE_SOURCE_RE` включает vc.ru.
- [ ] `scripts/backfill-cover-from-inline.ts --dry-run` показывает корректный diff; `--apply` восстанавливает Flipper-cover.
- [ ] Smoke на странице Flipper-статьи: cover показывает leonardo.osnova-фото устройства.
- [ ] 7-дневный мониторинг `image_cover_generation` для vc.ru/Verge/TechCrunch/ZDNet → ноль или близко.
- [ ] `docs/ARTICLE_SYSTEM.md` секция «Cover image» обновлена.

### Wave 3
- [ ] `blog.google/technology/ai/rss/` живой (если 404 — fallback на `blog.google/rss/` + AI keyword filter).
- [ ] За первые 72 часа `source_runs` для Google Blog: ≥3 ingested, off-topic-rate <20%.

### Wave 4
- [ ] `chooseScene` учитывает product/people/research-сигналы из ru_title.
- [ ] 5 случайных AI-обложек за следующие 3 дня визуально соответствуют теме статьи (ручной check владельца).

## Риски

- A2 расширение AI_LABS-text-match может «поднять» дешёвые материалы про OpenAI/Gemini, которые на самом деле slop. Mitigation: бонус +2 (не +3), и он применяется поверх существующих сигналов длины/обложки, а не замещает их.
- C1 diversity-кэп может вытолкнуть полезный Habr-материал в пользу слабого Verge-материала с тем же score. Mitigation: TOP_OUTLETS/major-announcement бонус в A3 поднимает «правильные» Verge-материалы выше; слабые Verge не пройдут score-gate.
- D1 убирает страховку «если ничего нет — генерим cover». Mitigation: новая `needsAiCover` возвращает true ровно тогда, когда sanitizer не нашёл usable cover вообще — то есть оригинальная страховка сохранена через семантику, а не через source_name-хардкод.

## Открытые вопросы для владельца

1. ОК ли убрать `+1 source_lang === 'ru'` полностью? Я считаю да — это дублирование `ai-russia`, и страдает в основном неприоритетная EN-индустрия. Если хочется сохранить ru-приоритет — оставить +1, но снизить ai-russia до +0.
2. По diversity-кэпу: 2 статьи с одного source — норм, или ужесточить до 1? 2 — потому что иногда Habr выдаёт два сильных разных сюжета.
3. Wave 4 (scene-matcher) делать сейчас или отложить до следующей итерации? Видимый профит от Wave 2 уже большой.

Docs impact: yes — `docs/ARTICLE_SYSTEM.md`, `CLAUDE.md` после реализации.
