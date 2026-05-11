# Задача: fallback-first AI generation routing и автоматические обложки

Дата: 2026-05-11
Статус: implemented
Приоритет: high

Связанные документы:

- `docs/execution_plan_ai_generation_routing_and_covers_2026-05-09.md`
- `docs/model_routing_lab_results_2026-05-07.md`
- `docs/ai_generation_cost_optimization_2026-05-07.md`

## Контекст

Текущий production enrich остаётся на Claude Batch и даёт стабильное качество, но стоит заметно дороже
DeepSeek. В рамках model-routing lab проверили гипотезу:

- DeepSeek как основной writer;
- deterministic repair/validator как дешёвый quality gate;
- Claude reviewer только выборочно;
- OpenAI Images low как fallback для cover.

Финальный cheap-only paid run:

```text
tmp/model-routing-lab-1778502652408/report.json
```

Итог:

| Mode | Count | Cost | Provider output | Final hard validation |
|---|---:|---:|---:|---:|
| `deepseek-full` | 5 | `$0.005318` | 5/5 | 5/5 after final validator tuning |

Средняя стоимость DeepSeek writer на выборке: около `$0.00106/article`.

Что уже реализовано в коде:

- `pipeline/claude.ts`
  - `validateEditorialDetailed()` with structured errors/warnings/risk flags;
  - stricter anchors, banned phrases, `AI`/`ИИ` checks;
  - camelCase/product lead anchors accepted;
  - short `card_teaser` 50-59 chars is warning, not hard reject.
- `pipeline/editorial-routing.ts`
  - `cheap|balanced|premium` config surface;
  - deterministic brief builder;
  - selective Claude reviewer policy.
- `pipeline/editorial-repair.ts`
  - safe `AI` -> `ИИ`;
  - invalid anchor removal;
  - paragraph restoration;
  - title shortening;
  - banned phrase cleanup.
- `scripts/model-routing-lab.ts`
  - `deepseek-full`;
  - `balanced-review`;
  - DeepSeek timeout/retry config.
- `scripts/image-style-lab.ts`
  - local-only image style lab with budget cap.

## Цель

Сделать production-ready fallback-first routing, который снижает стоимость обычных статей, но не
рискует публикацией плохого материала.

Новая схема должна:

1. пробовать DeepSeek writer для дешёвого черновика;
2. применять deterministic repair;
3. прогонять strict validator;
4. если всё хорошо и статья low-risk — принимать результат;
5. если provider/API/validator fails — fallback на текущий Claude Batch path;
6. если статья high-risk/high-score — прогонять compact Claude reviewer;
7. автоматически закрывать missing covers через OpenAI Images low с budget cap.

## Не цели

- Не удалять текущий Anthropic Batch path.
- Не переводить весь production cron на DeepSeek одним переключателем.
- Не использовать старый `hybrid` как default: Claude brief -> DeepSeek -> Claude full polish оказался дороже Claude baseline.
- Не генерировать medium/high обложки массово.
- Не переписывать schema batch tables до отдельного решения.

## Архитектурное решение

### Routing modes

`premium`:

- текущий Claude Batch full article;
- остаётся production default;
- fallback для всех failed cheap/balanced попыток.

`cheap`:

- deterministic brief;
- DeepSeek writer;
- deterministic repair;
- strict validator;
- no Claude reviewer unless validator/risk policy forces fallback.

`balanced`:

- same as cheap;
- compact Claude reviewer for high-risk/high-score articles;
- reviewer returns JSON pass/fail/notes, not full rewrite.

### Fallback-first rule

DeepSeek не должен владеть final production outcome без fallback:

```text
DeepSeek API error -> Claude Batch fallback
DeepSeek timeout -> retry -> Claude Batch fallback
Validator hard error after repair -> Claude Batch fallback
Claude reviewer reject -> Claude Batch fallback or manual review
```

## Implementation scope

### Phase 1. Production routing runner

Добавить отдельный safe worker/script, не заменяющий сразу `enrich-submit-batch`.

Предлагаемый вариант:

```text
scripts/run-editorial-routing.ts
```

Команды:

```bash
npm run editorial:routing -- --limit=5
npm run editorial:routing -- --limit=5 --mode=cheap --apply
npm run editorial:routing -- --limit=5 --mode=balanced --apply
```

Требования:

- default dry-run;
- `--apply` обязателен для записи;
- `--limit` обязателен или default <= 5;
- production default в cron не меняется;
- выбрать статьи из `pending`/eligible set без конфликтов с Anthropic Batch ownership;
- если не удаётся безопасно интегрировать с current article state, runner должен работать как lab/manual tool до следующей schema/task.

Выход:

- можно вручную прогнать cheap/balanced на малом лимите;
- результат either applied, rejected, or routed to premium fallback;
- нет частично опубликованных статей.

### Phase 2. Provider-neutral result application

Вынести общий apply contract для editorial output:

- parse JSON;
- repair;
- validate;
- quality gate;
- slug generation/assertion;
- media sanitize;
- write attempts;
- cost log;
- article update/RPC.

Важно:

- не дублировать логику `enrich-collect-batch.ts` ad hoc;
- не ломать Anthropic Batch path;
- сохранить `validateEditorial()` compatibility-wrapper.

Выход:

- DeepSeek/Claude outputs проходят один и тот же final gate.

### Phase 3. Cost and attempts observability

Записывать usage по каждой попытке:

- provider;
- model;
- operation;
- input/output/cache tokens;
- estimated cost;
- result status;
- fallback reason;
- validator errors/warnings;
- repair fixes.

Минимальные operation names:

- `deepseek_editorial_writer`;
- `claude_selective_reviewer`;
- `editorial_premium_fallback`;
- `image_cover_generation`.

Выход:

- `npm run cost:articles` показывает text/image/total cost per article;
- можно посчитать accepted cost, failed cost, fallback rate.

### Phase 4. Limited rollout

Запускать только вручную:

```bash
npm run editorial:routing -- --mode=cheap --limit=3 --apply
```

Ограничения:

- только low-risk categories сначала;
- exclude `ai-research`, legal/regulation, medical, geopolitics;
- fallback на Claude Batch для любых hard errors;
- daily DeepSeek budget/logical cap;
- no scheduled cron until manual acceptance.

Acceptance gate:

- 20 manually reviewed articles;
- >= 85% accepted or safely routed to fallback;
- no direct publish of validator-failed output;
- average accepted DeepSeek text cost near `$0.001-0.002`;
- fallback rate understood.

### Phase 5. Automatic covers

Использовать уже добавленный low-cost cover path:

```bash
npm run covers:ai-low -- --category=all --latest-day --limit=12 --apply --daily-budget=1
```

Image style decision after lab:

- primary candidates:
  - `tech-still-life`;
  - `abstract-infrastructure`;
  - `minimal-object-metaphor`.
- avoid/deprioritize:
  - broad `editorial-photographic`, unless prompts reliably avoid fake UI and pseudo-text.

Production rules:

- source cover first if sanitizer accepts it;
- OpenAI low only for missing/weak covers;
- medium only manual/high-visibility override;
- no fake UI, pseudo-text, product screens, dashboards with numbers;
- log every image attempt to `llm_usage_logs`;
- hard daily budget cap.

Выход:

- subsequent accepted articles get a cover unless budget exhausted;
- cover cost visible per article.

## Acceptance criteria

### Functional

- Current Claude Batch production path still works unchanged.
- New routing runner is opt-in and dry-run by default.
- DeepSeek result is never applied without repair + validation.
- Hard validation failure triggers fallback, not publish.
- High-risk/high-score article triggers reviewer or premium fallback.
- Image generation respects daily budget and does not overwrite good source/AI covers.

### Quality

- 20-article manual review passes before scheduled rollout.
- No banned phrases in applied output.
- No standalone `AI` in Russian copy except allowed names.
- `link_anchors` are verbatim or removed.
- Body has >= 3 paragraphs and >= 1200 chars.
- Covers look like serious tech editorial imagery, not generic AI art.

### Cost

- Cheap text target: `$0.001-0.002/article`.
- Balanced average target: below current Claude baseline after fallback/reviewer mix.
- Image low target: `$0.013/article` on `gpt-image-1.5 1536x1024`.

### Safety

- No global cron cutover until manual review.
- Fallback path leaves article in known state.
- Every provider failure is observable.
- Failed image attempts do not retry indefinitely.

## Required tests/checks

```bash
npx tsc --noEmit
npm run docs:check
npx tsx --test tests/node/batch-enrich.test.ts
npx tsx --test tests/node/editorial-routing.test.ts
npx tsx --test tests/node/editorial-repair.test.ts
npx tsx --test tests/node/model-pricing.test.ts
npm run routing:lab -- --limit=5 --missing-cover-only --modes=deepseek-full
npm run image:style-lab -- --limit=2 --per-article=3 --category=all
```

Before any production apply:

```bash
npm run cost:articles -- --days=2 --limit=20
npm run editorial:routing -- --mode=cheap --limit=3
```

## Stop conditions

Stop and keep Claude Batch default if:

- DeepSeek API timeout/failure rate remains high after retries;
- manual review rejects more than 15% of validator-passing cheap outputs;
- fallback accounting is unclear;
- balanced mode average cost approaches Claude Batch baseline;
- image outputs repeatedly contain pseudo-text, fake UI, logos or misleading visual claims;
- any path can publish validator-failed output.

## Current recommendation

Implement fallback-first routing next, but do not schedule it. Run manually on small limits,
review outputs, then decide whether `cheap` can cover low-risk daily news. Keep Claude Batch as
default and as fallback until the 20-article review is clean.

## Implementation result — 2026-05-11

Implemented in production code:

- `npm run editorial:routing` as opt-in manual runner with dry-run default and `--apply` gate.
- DeepSeek writer path with operation `deepseek_editorial_writer`, retry/empty-output handling,
  daily logical budget cap and `llm_usage_logs` accounting.
- Provider-neutral final gate in `pipeline/editorial-apply.ts`: parse JSON, deterministic repair,
  strict validation, slug guard, media sanitizer and direct claim-safe apply.
- Premium fallback path that queues normal Anthropic Batch items with operation
  `editorial_premium_fallback`; scheduled Anthropic Batch collect/apply remains unchanged as
  production default and fallback executor.
- Balanced reviewer path with compact Claude QA operation `claude_selective_reviewer`.
- `npm run cost:articles` now prints per-article operation breakdown, so fallback/reviewer/image
  cost is visible next to text/image/total.
- `ai-covers.yml` is scheduled again for low-quality OpenAI Images covers with `--daily-budget=1`.
- After owner approval on 2026-05-11, `enrich.yml` now uses fallback-first cheap routing
  every 30 minutes instead of direct `enrich-submit-batch`.

Still intentionally not done:

- No schema rewrite for batch tables.
- No medium/high mass image generation.
