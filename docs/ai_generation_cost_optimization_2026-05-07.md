# AI generation cost optimization - 2026-05-07

## Коротко для тебя

Сейчас сайт уже имеет рабочий production pipeline: RSS попадает в `articles`, затем `enrich-submit-batch` отправляет статьи в Anthropic Batch, `enrich-collect-batch` применяет JSON-результат, сайт публикует готовую строку из Supabase. Главная проблема не в архитектуре, а в том, что почти весь editorial text сейчас пишет Claude Sonnet 4.6, а у части хороших live-статей нет обложек.

По фактическому `npm run cost:report` за последние 2 дня:

- Claude log cost: `$5.2300` за 120 статей, в среднем `$0.0436` на статью.
- Важно: текущий код считает Anthropic Batch по list price и, вероятно, не применяет 50% Batch discount. Реальный биллинг Anthropic может быть ближе к `$0.0218` на статью, но dashboard/cost guard сейчас видит более высокий conservative cost.
- Из последних 40 quality-статей 12 были без cover. Это уже видно в production данных.

Практичный вывод:

- DeepSeek как основной writer может снизить text cost примерно с `$0.02-0.05` до около `$0.0013` на статью.
- Claude orchestrator + DeepSeek + Claude full polish невыгоден для всех статей: dry-run lab показывает около `$0.0677` на статью, дороже Claude full.
- Дешёвый вариант должен быть: code/template orchestrator -> DeepSeek writer -> schema/quality validator -> Claude reviewer только выборочно.
- OpenAI Images low даёт автоматическую обложку за `$0.013` на статью на `gpt-image-1.5` landscape 1536x1024. Если будет доступен `gpt-image-2`, low landscape ещё дешевле, около `$0.005`.

## Что уже добавлено в код

1. `pipeline/model-pricing.ts`
   - Единый расчёт стоимости Anthropic, DeepSeek и OpenAI Images.
   - Поддержка Anthropic Batch discount mode для будущего исправления текущего over-reporting.
   - Поддержка OpenAI image low/medium/high per-image estimates.

2. `scripts/model-routing-lab.ts`
   - Dry-run и apply lab для сравнения на реальных статьях:
     - `claude-full`
     - `deepseek-full`
     - `hybrid`: Claude brief -> DeepSeek draft -> Claude polish
   - По умолчанию не вызывает API и не тратит деньги.
   - В `--apply` пишет результаты в `tmp/model-routing-lab-*`.

3. `scripts/article-cost-report.ts`
   - Per-article report по `llm_usage_logs`:
     - input tokens
     - output tokens
     - cache tokens
     - text cost
     - image cost
     - total cost

4. `scripts/generate-ai-covers.ts`
   - Default quality переключён на `low`.
   - Добавлен `--category=all`.
   - Добавлен `--daily-budget=N` / `OPENAI_IMAGE_DAILY_BUDGET_USD`.
   - Успешные и failed image attempts пишутся в `llm_usage_logs` как `provider='openai'`, `operation='image_cover_generation'`.

5. `.github/workflows/ai-covers.yml`
   - Автоматический scheduled workflow каждые 2 часа.
   - Команда: `npm run covers:ai-low -- --category=all --latest-day --limit=12 --apply --daily-budget=1`.
   - Daily hard budget: `$1` по OpenAI Images.

6. Новые npm команды:
   - `npm run routing:lab`
   - `npm run cost:articles`
   - `npm run covers:ai-low`

## Текущая архитектура

### Text pipeline

1. `pipeline/ingest.ts`
   - Читает RSS.
   - Создаёт raw rows в `articles`.

2. `pipeline/enrich-submit-batch.ts`
   - Берёт `pending` / `retry_wait`.
   - Fetch-ит source HTML через `pipeline/fetcher.ts`.
   - Прогоняет media sanitizer.
   - Считает score и category gates.
   - Строит Claude request через `pipeline/claude.ts::buildEditorialMessageParams`.
   - Создаёт `anthropic_batch_items`.
   - Отправляет Anthropic Batch через `pipeline/anthropic-batch.ts`.

3. `pipeline/enrich-collect-batch.ts`
   - Poll-ит Anthropic Batch.
   - Импортирует usage/result в `anthropic_batch_items` и `llm_usage_logs`.
   - Парсит editorial JSON через `parseEditorialJson`.
   - Валидирует через `validateEditorial`.
   - Применяет результат через RPC `apply_anthropic_batch_item_result`.

4. `pipeline/llm-usage.ts`
   - Единый per-call/per-item audit trail.
   - Сейчас исторически Anthropic-first, но таблица уже generic (`provider`, `model`, `operation`).

### Image pipeline

1. Source cover extraction:
   - `pipeline/fetcher.ts` берёт og/twitter/json-ld/inline images.
   - `lib/media-sanitizer.ts` отбрасывает плохие изображения.

2. Manual/fallback image scripts:
   - `scripts/backfill-cover-images.ts` - source-only backfill без LLM.
   - `scripts/backfill-stock-covers.ts` - stock fallback.
   - `scripts/generate-ai-covers.ts` - OpenAI Images fallback.

3. Старый experimental path:
   - `pipeline/image-director.ts` использует Claude для visual prompt.
   - `pipeline/image-generator.ts` использует DALL-E 3.
   - Это дороже и не должно быть default для массовых обложек.

## Где внедрять model routing

### Минимальные точки

1. `pipeline/claude.ts`
   - Вынести `MODEL`, `MAX_TOKENS`, `TEMPERATURE`, system prompt и cost estimation в provider-neutral layer.
   - Оставить текущий prompt как canonical editorial contract.

2. `pipeline/anthropic-batch.ts`
   - Сейчас Anthropic-specific transport и table naming.
   - Для быстрого теста не трогать.
   - Для production routing сделать generic `editorial_jobs` или оставить Anthropic Batch только для premium mode, а DeepSeek запускать sync/mini-batch отдельным worker.

3. `pipeline/enrich-submit-batch.ts`
   - Точка выбора mode:
     - `EDITORIAL_ROUTING_MODE=cheap|balanced|premium`
     - `EDITORIAL_WRITER_PROVIDER=deepseek|anthropic`
     - `EDITORIAL_REVIEW_POLICY=none|selective|always`

4. `pipeline/enrich-collect-batch.ts`
   - Точка применения результата должна быть provider-neutral:
     - parse JSON
     - validate JSON
     - quality gate
     - media sanitize
     - apply RPC

5. `pipeline/llm-usage.ts`
   - Уже подходит для multi-provider.
   - Нужно добавить report grouping by provider/model and operation.

6. `scripts/generate-ai-covers.ts`
   - Уже стал OpenAI Images low fallback.
   - Следующий шаг: route image model by visibility:
     - low for normal articles
     - medium only for homepage/top category cards
     - source/stock/template before paid image when suitable

## Recommended architecture

### Cheap mode

Use for normal daily flow.

- Orchestrator: code + templates, no Claude.
- Writer: `deepseek-v4-flash`.
- Reviewer: deterministic validators only.
- Claude reviewer: only if:
  - `validateEditorial` fails once;
  - source is `ai-research`;
  - score is very high;
  - text has high-risk factual patterns: money, medical, legal/regulation, geopolitics.
- Image: source cover first, then OpenAI Images low.

Expected cost:

- Text: around `$0.001-0.002` per article.
- Image: `$0.013` per article on `gpt-image-1.5` low.
- Total: around `$0.014-0.016` per article.

### Balanced mode

Use as default after test if DeepSeek quality is good but needs guardrails.

- Orchestrator: code + short structured brief.
- Writer: DeepSeek.
- Reviewer: Claude selective reviewer for top 25-35% by risk/score/category.
- Polish: Claude compact patch, not full article rewrite.
- Image: OpenAI Images low for all missing covers, medium only for top visible cards.

Expected cost:

- Text: around `$0.004-0.010` average if Claude reviewer is compact and selective.
- Image: `$0.013` normal, `$0.05` only for selected top cards.
- Total: around `$0.017-0.025` for normal articles.

### Premium mode

Use for investigations, research, high-visibility homepage blocks.

- Writer: Claude Sonnet 4.6 via Batch API.
- Reviewer: Claude or same model self-check only for high-risk pieces.
- Image: OpenAI medium/high or manual art direction.

Expected cost:

- Text logged today: around `$0.0436` per article.
- If Anthropic Batch discount is applied by billing: around `$0.0218`.
- Image low: +`$0.013`; image medium: +`$0.05`.

## Test plan-run

Dry-run, no API cost:

```bash
npm run routing:lab -- --limit=3 --missing-cover-only
```

Observed dry-run on 2026-05-07:

| Mode | Approx cost/article | Notes |
|---|---:|---|
| `claude-full` | `$0.0527` | Sync estimate, not Batch discounted |
| `deepseek-full` | `$0.00128` | About 40x cheaper than Claude sync |
| `hybrid` | `$0.0677` | Too expensive if used for every article |

Real run on the same 3 articles:

```bash
DEEPSEEK_API_KEY=... ANTHROPIC_API_KEY=... \
npm run routing:lab -- --limit=3 --missing-cover-only --apply
```

Outputs land in:

```text
tmp/model-routing-lab-*/report.json
tmp/model-routing-lab-*/*-claude-full.json
tmp/model-routing-lab-*/*-deepseek-full.json
tmp/model-routing-lab-*/*-hybrid.json
```

Manual evaluation rubric:

- factuality: no facts not in source or safe context;
- lead: first sentence has a concrete anchor;
- style: no banned phrases from `docs/editorial_style_guide.md`;
- structure: 3-7 paragraphs, good AI-news media rhythm;
- useful context: explains why it matters without inventing data;
- JSON validity and `validateEditorial`;
- Telegram teaser clickability;
- cost per accepted article, not just per generated article.

## Image prompt strategy

Do not use Claude image director for every article. It adds text-model cost before image cost.

Use deterministic prompt builder from article fields:

- title;
- lead/card teaser/editorial excerpt;
- topics/categories;
- scene rotation;
- source/category heuristics.

Keep the current prompt principles:

- one clear focal point;
- editorial conceptual photomontage;
- tactile paper texture;
- no readable text, no logos, no trademarks, no watermarks;
- avoid generic AI brains, network spheres, business people, dashboards;
- strong thumbnail contrast.

For image quality:

- normal article: OpenAI low;
- homepage/top story: medium override;
- weak low result: regenerate once with different scene;
- repeated theme: rotate scene template instead of asking Claude to invent again.

## Expected cost reduction

### Text

Current logged Claude:

- `$5.2300 / 120 = $0.0436` per article.

Possible actual Anthropic billed cost with Batch discount:

- about `$0.0218` per article if 50% discount applies to the whole batch workload.

DeepSeek full writer estimate:

- about `$0.0013` per article.

Reduction:

- vs logged Claude: about 97%.
- vs estimated discounted Claude Batch: about 94%.

### Images

Current manual medium reference:

- `gpt-image-1.5 medium 1536x1024`: `$0.05`.

New default:

- `gpt-image-1.5 low 1536x1024`: `$0.013`.

Reduction:

- about 74% cheaper than medium.

If `gpt-image-2` access is available:

- low landscape can be around `$0.005`, about 90% cheaper than `gpt-image-1.5 medium`.

### Combined

Conservative balanced target:

- DeepSeek text: `$0.0013`.
- OpenAI image low: `$0.013`.
- Selective Claude review average: `$0.003-0.009`.
- Total target: `$0.017-0.025` per article.

This is cheaper than current Claude-only text before images, and it gives every article a cover.

## Risks

1. DeepSeek quality
   - Risk: style drift, weaker Russian editorial rhythm, hallucinated context.
   - Mitigation: strict JSON schema, source-grounding prompt, validation, selective Claude reviewer.

2. Hybrid over-cost
   - Risk: Claude orchestrator + Claude polish costs more than current flow.
   - Mitigation: no Claude orchestrator by default; use deterministic brief builder.

3. Cost observability mismatch
   - Risk: current Claude cost logs likely do not apply Anthropic Batch 50% discount.
   - Mitigation: store `list_cost_usd` and `billed_estimated_cost_usd`, or apply batch flag in `usageFromMessage` when importing batch results.

4. Image quality on low
   - Risk: low images may be less refined.
   - Mitigation: use low for all normal covers, medium for top cards, regenerate one bad low result.

5. Automatic image workflow spend
   - Risk: broken selector could generate too many images.
   - Mitigation: `--limit=12`, `--daily-budget=1`, `llm_usage_logs` image rows.

6. Provider lock-in / fallback
   - Risk: DeepSeek or OpenAI image API outage.
   - Mitigation: cheap mode can fall back to Claude Batch or template covers.

## Cheaper orchestration layer

Claude as orchestrator is not worth it for every article. The dry-run hybrid estimate is higher than Claude full.

Recommended orchestration:

1. Code extracts:
   - category;
   - source;
   - score;
   - title;
   - lead/source excerpt;
   - risk flags.

2. Template builds a brief:
   - `angle`;
   - `must_include_facts`;
   - `avoid_claims`;
   - `style_notes`;
   - `image_scene_seed`.

3. DeepSeek writes the article.

4. Code validates.

5. Claude reviews only selected articles.

This keeps Claude where it is valuable: final judgment on risky/high-value pieces.

## Daily Telegram admin report

Да, это стоит сделать. В проекте уже есть `TELEGRAM_ADMIN_CHAT_ID`, `fireAlert`, `getHealthSummary`, `digest_runs`, `llm_usage_logs`.

Recommended daily admin message:

- how many RSS items were seen/inserted/deduped/rejected;
- how many articles were submitted to LLM;
- how many became live;
- rejected breakdown: low score, low visual, research too short, parse failed;
- text spend by provider/model;
- image spend by model/quality;
- average cost per live article;
- top 5 most expensive articles;
- missing cover count;
- generated cover count;
- open alerts and stuck batches;
- source noise: sources with high reject/dedup/fetch error ratio;
- budget remaining for text and images;
- suggested action: "review these 3 failed/high-cost items".

Implementation:

- `scripts/admin-daily-report.ts`;
- scheduled workflow or Supabase pg_cron at 09:05 MSK;
- message goes only to admin chat, not channel;
- report should include links to `/internal/dashboard`.

## Implementation plan

### Phase 1 - test without production routing

Done:

- Add routing lab.
- Add per-article cost report.
- Add image cost logging.
- Add OpenAI low image workflow with budget.

Next commands:

```bash
npm run routing:lab -- --limit=3 --missing-cover-only --apply
npm run cost:articles -- --days=2 --limit=20
npm run covers:ai-low -- --category=all --latest-day --limit=12 --apply --daily-budget=1
```

### Phase 2 - production cheap mode behind env

Add:

- `EDITORIAL_ROUTING_MODE=cheap|balanced|premium`;
- DeepSeek provider client;
- deterministic editorial brief builder;
- selective reviewer policy;
- provider-neutral result storage or a separate `editorial_provider_jobs` table.

### Phase 3 - dashboard/admin

Add:

- provider/model cost report;
- image cost section;
- daily Telegram admin summary.

## Best next step

Run the real 3-article model lab with `--apply`, then read the three outputs side by side:

1. Claude full.
2. DeepSeek full.
3. Hybrid.

If DeepSeek full is acceptable after minor validation, do not build Claude orchestrator. Build cheap/balanced production routing with DeepSeek writer and selective Claude reviewer.

## Pricing sources checked

- OpenAI image generation guide: https://platform.openai.com/docs/guides/image-generation
- OpenAI API pricing: https://platform.openai.com/docs/pricing
- Anthropic pricing: https://docs.anthropic.com/en/docs/about-claude/pricing
- Anthropic Message Batches: https://docs.anthropic.com/en/docs/build-with-claude/message-batches
- DeepSeek pricing: https://api-docs.deepseek.com/quick_start/pricing
