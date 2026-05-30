# Spec — Telegram digest story dedup + selection guard

Дата: 2026-05-30  
Статус: implemented locally; ready for production deploy  
Связанные канонические файлы: `docs/ARTICLE_SYSTEM.md`, `docs/OPERATIONS.md`

## Trigger

Владелец заметил, что в последних двух Telegram-дайджестах один инфоповод про раунд Anthropic
попал три раза. Это означает, что текущий daily digest умеет ограничивать только источник
(`source_name`), но не умеет понимать повтор одного события в разных источниках и на соседних
датах.

## Facts from production data

Источник проверки: `digest_runs.message_text` и связанные `articles` в Supabase.

### Последние два successful digest run

| digest_date | Telegram message | sent_at UTC | visible date | Anthropic funding entries |
|---|---:|---|---|---:|
| 2026-05-30 | 52 | 2026-05-30 08:30 | 29 мая | 1 |
| 2026-05-29 | 51 | 2026-05-29 06:30 | 28 мая | 2 |

За эти дни также есть `skipped_already_claimed` rows от резервного планировщика. Это ожидаемо:
atomic claim работает, двойной отправки в канал не видно.

### Три строки одного инфоповода

| digest | slot | source | title | pub_date UTC | score | dedup_hash |
|---|---:|---|---|---|---:|---|
| 2026-05-29 | 2 | Crunchbase News | Оценка Anthropic достигла $965 млрд после раунда на $65 млрд | 2026-05-28 19:11 | 6 | `7d7b6...` |
| 2026-05-29 | 5 | TechCrunch AI | Anthropic привлёк $65 млрд при оценке почти $1 трлн | 2026-05-28 18:52 | 5 | `b0d21...` |
| 2026-05-30 | 1 | The Decoder | Anthropic привлекла $65 млрд в раунде Series H при оценке почти $1 трлн | 2026-05-28 21:30 | 6 | `9c55d...` |

Причина перескока на следующий дайджест: The Decoder опубликовал материал в 21:30 UTC, то есть уже
после начала следующего MSK-окна (`2026-05-28 21:00 UTC` = `2026-05-29 00:00 MSK`).

### Candidate pools

Для дайджеста 2026-05-29 было 17 eligible статей. Текущий алгоритм выбрал top-5 после source cap:

1. The Verge AI, score 8 — AI-фильм Tribeca
2. Crunchbase News, score 6 — Anthropic funding
3. The Decoder, score 6 — Mistral Vibe
4. Google Research Blog, score 5 — Gemini for Science
5. TechCrunch AI, score 5 — Anthropic funding

Для дайджеста 2026-05-30 было 22 eligible статьи. Текущий алгоритм выбрал:

1. The Decoder, score 6 — Anthropic funding
2. The Decoder, score 6 — Claude Opus 4.8
3. TechCrunch AI, score 5 — Groq funding
4. 404 Media, score 5 — dark patterns in chatbots
5. Habr AI, score 5 — команда веб-продукта с ИИ

## Current behavior

`bot/daily-digest-core.ts`:

- берёт top-25 за вчерашний MSK-день по `score desc, pub_date desc`;
- проверяет, что страницы доступны;
- применяет `applyDiversityCap(perSourceCap=2, target=5)`;
- строит Telegram HTML и отправляет без content-composition preflight;
- после успешной отправки ставит `tg_sent=true` только выбранным article rows.

`pipeline/rss-parser.ts` / `pipeline/ingest.ts`:

- `dedup_hash` строится из normalized title + canonical URL;
- одинаковый инфоповод из разных источников получает разные hashes и становится разными статьями;
- это нормально для сайта, но недостаточно для daily digest.

## Root causes

1. **Нет story-level dedup.** Система различает article rows, но не различает событие. Crunchbase,
   TechCrunch и The Decoder про один и тот же раунд выглядят как три независимые новости.
2. **Source diversity не решает topic diversity.** Кэп `source_name <= 2` убирает монополию Habr,
   но пропускает один инфоповод из разных источников.
3. **`tg_sent` защищает только exact row.** После отправки TechCrunch/Crunchbase не запрещают
   The Decoder с тем же событием на следующий день.
4. **MSK day window усиливает проблему.** Источник, опубликованный после 21:00 UTC, попадает уже
   в следующий дайджест, даже если событие было покрыто вчера.
5. **Перед отправкой нет guard-а состава.** `buildDigestText()` форматирует то, что выбрал selector;
   он не проверяет duplicate stories, entity concentration или recent repeats.

## Goal

Daily Telegram digest должен оставаться подборкой 5 главных событий дня, а не 5 лучших article rows.

Правило качества:

- в одном дайджесте не должно быть двух материалов про один и тот же инфоповод;
- инфоповод, уже отправленный в successful digest за последние 72 часа, не должен попадать снова,
  если это не явно новый тип события;
- разные события одной компании допустимы, но концентрация одной primary entity должна быть
  ограничена.

## Non-goals

- Не меняем формат Telegram-поста в этой задаче.
- Не отключаем источники и не режем сайт: на сайте несколько источников про один крупный сюжет
  могут оставаться отдельными статьями.
- Не добавляем LLM/embedding в критический send path первой волной. Cron должен быть дешёвым,
  детерминированным и проверяемым тестами.

## Proposed implementation

### Wave 1 — Extract pure digest selector

Файлы:

- `bot/daily-digest-core.ts`
- новый `bot/digest-selection.ts`
- `tests/node/digest-story-dedup.test.ts`

Сделать selection отдельной чистой функцией:

```ts
selectDigestArticles({
  candidates,
  recentSentArticles,
  target: 5,
  perSourceCap: 2,
  perPrimaryEntityCap: 2,
  recentStoryWindowHours: 72,
})
```

Сохранить существующий source cap, но перестать выбирать прямо через `applyDiversityCap()`.

### Wave 2 — Deterministic story key

Добавить `deriveDigestStory(article)`:

- `primaryEntity`: Anthropic, Claude, OpenAI, GPT, Google, Gemini, DeepMind, Nvidia, Groq,
  Mistral, Meta, Llama, Microsoft, Copilot, Yandex, GigaChat, Sber, etc.
- `eventType`: `funding`, `model_release`, `product_launch`, `benchmark`, `research`,
  `regulation`, `security`, `partnership`, `acquisition`, `business_case`, `other`.
- `numericAnchors`: нормализованные ключевые числа из title/teaser для funding/valuation
  (`65b`, `965b`, `1t`, etc.).
- `storyKey`: `${primaryEntity}:${eventType}:${signature}`.

Важно: `Claude Opus 4.8` и `Anthropic funding` должны получить разные story keys, хотя обе темы
связаны с Anthropic. Материал 404 Media про dark patterns не должен получать primary entity
`Anthropic`, если Claude там только один из перечисленных чатботов.

### Wave 3 — Intra-digest dedup + recent-memory guard

Правила выбора:

1. Если `storyKey` strong, максимум 1 статья с таким key в финальных 5.
2. Если `primaryEntity` strong, максимум 2 статьи с этой entity в финальных 5.
3. Если такой `storyKey` уже был в successful digest за последние 72 часа — пропустить кандидата.
4. Если после skip-ов слотов меньше 5, добирать из расширенного candidate pool.

Технически:

- поднять `.limit(25)` до `.limit(50)`, чтобы после story dedup хватало замен;
- перед selection загрузить последние successful `digest_runs` за 72 часа, взять `article_ids`,
  затем загрузить соответствующие articles и посчитать их story keys;
- если recent load падает, не ронять digest, но логировать warning и писать diagnostic.

### Wave 4 — Telegram pre-send composition guard

Перед `sendTelegramMessage()` добавить `validateDigestComposition(digest, diagnostics)`:

- `duplicateStoryKeys.length === 0`;
- `primaryEntityDistribution` не нарушает cap;
- `sourceDistribution` не нарушает cap;
- все URLs/teasers есть;
- если validator нашёл проблему, selector должен попробовать replacement pass;
- если после replacement осталось меньше 3 статей, не отправлять в канал и писать `low_articles`
  с диагностикой админу.

Это чинит не только текущий кейс, но и будущие ситуации “две новости про один раунд / один релиз /
одно исследование”.

### Wave 5 — Observability

Добавить diagnostics в `digest_runs`.

Варианты:

1. Minimal: новые JSONB columns:
   - `selection_diagnostics jsonb`
   - `story_keys text[]`
   - `primary_entities text[]`
2. Если не хотим миграцию первой волной: логировать diagnostics в stdout и добавить позже.

Рекомендуемый вариант — JSONB column, потому что проблема выявляется только глазами в Telegram,
а должна быть видна в internal dashboard / ops report.

Пример diagnostics:

```json
{
  "candidateCount": 22,
  "selectedCount": 5,
  "sourceDistribution": { "The Decoder": 2, "TechCrunch AI": 1 },
  "entityDistribution": { "Anthropic": 2, "Groq": 1 },
  "skipped": [
    {
      "articleId": "...",
      "reason": "recent_story_duplicate",
      "storyKey": "anthropic:funding:65b-965b"
    }
  ]
}
```

### Wave 6 — Retro audit script

Новый скрипт:

```bash
npx tsx scripts/audit-digest-selection.ts --days=14
```

Он должен:

- реконструировать eligible pool по MSK-дням;
- показать current selection vs proposed selection;
- вывести dropped duplicate stories и replacements;
- иметь `--date=YYYY-MM-DD` для точечного разбора.

Acceptance на текущем кейсе:

- 2026-05-29: в финальном списке остаётся только одна Anthropic funding story; второй слот
  заменяется следующей лучшей статьёй.
- 2026-05-30: The Decoder funding story пропускается как `recent_story_duplicate`, Claude Opus 4.8
  остаётся, потому что это другой `eventType`.
- Source cap продолжает работать.

## Tests

Минимальный набор:

- `deriveDigestStory()` одинаково ключует:
  - Crunchbase: `Anthropic Nears $1T Valuation... $65B Funding Round`
  - TechCrunch: `Anthropic raises $65 Billion...`
  - The Decoder: `Anthropic ... raising $65 billion in Series H`
- `deriveDigestStory()` различает:
  - Anthropic funding
  - Claude Opus 4.8 model release
- selector drops duplicate story inside same digest.
- selector drops recent duplicate story from previous successful digest.
- selector allows two different Anthropic-related events, but not three strong primary-entity slots.
- existing idempotency tests still pass:
  - `tests/node/tg-digest-idempotency.test.ts`
  - `tests/node/digest-runs-completeness.test.ts`

## Verification commands

```bash
npx tsx --test tests/node/digest-story-dedup.test.ts
npx tsx --test tests/node/digest-diversity.test.ts tests/node/tg-digest-idempotency.test.ts tests/node/digest-runs-completeness.test.ts
npx tsx scripts/audit-digest-selection.ts --date=2026-05-29
npx tsx scripts/audit-digest-selection.ts --date=2026-05-30
npm run docs:check
npm run build
```

## Implementation log

2026-05-30:

- Added `bot/digest-selection.ts` with deterministic story derivation, source cap,
  primary-entity cap, intra-digest duplicate-story skip, and 72-hour recent-memory skip.
- Integrated selector into `bot/daily-digest-core.ts`: candidate pool top-25 → top-50,
  recent successful `digest_runs.article_ids` are loaded before selection, diagnostics are logged
  before Telegram send.
- Added `scripts/audit-digest-selection.ts` and package script `digest:audit-selection`.
- Added `tests/node/digest-story-dedup.test.ts`.
- Retro audit passed on incident dates:
  - `2026-05-29`: TechCrunch Anthropic funding skipped as `duplicate_story`;
  - `2026-05-30`: The Decoder Anthropic funding skipped as `recent_story_duplicate`; Claude Opus
    4.8 remains selected as `model_release`.

## Rollout

1. Implement selector and tests locally.
2. Run retro audit for the last 14 days; attach before/after summary to this spec.
3. Deploy code without changing cron schedule.
4. Watch next 3 successful `digest_runs`:
   - no duplicate story keys;
   - `articles_count=5`;
   - no unexpected `low_articles`.
5. If diagnostics column is added, surface story/source/entity distribution in ops summary later.

## Risks

- Deterministic regex can over-merge unrelated stories. Mitigation: only strong story keys trigger
  recent-memory skip; weak/generic stories keep current behavior.
- Entity cap can be too strict on major launch days. Mitigation: cap primary entity at 2, not 1.
- Candidate pool can run out after dedup on quiet days. Mitigation: increase pool to 50 and fall back
  to best weak-key candidates before `low_articles`.
- DB migration for diagnostics touches production schema. Mitigation: make diagnostics optional in
  code path, ship selector first if needed.

## Docs impact for implementation

When code changes land:

- `docs/ARTICLE_SYSTEM.md` — update Telegram digest selection contract: source cap + story dedup +
  recent successful digest memory + composition guard.
- `docs/OPERATIONS.md` — update digest diagnostics/runbook if `digest_runs` gets diagnostics columns
  or new audit script.
- `CLAUDE.md` / `AGENTS.md` — add initiative summary after closure.

Docs impact: yes — implementation must update canonical docs.
