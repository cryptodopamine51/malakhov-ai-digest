# Execution plan: AI generation routing and automatic covers

Дата: 2026-05-09
Статус: implementation plan

## Context

Цель задачи - снизить стоимость генерации статей и картинок без просадки редакционного качества Malakhov AI Digest.

Что уже известно по paid lab от 2026-05-07:

| Scenario | Cost on 3 articles | Status | Decision |
|---|---:|---|---|
| Current Claude baseline | `$0.174514` | 3/3 ok | оставить production default до безопасного cutover |
| DeepSeek full writer | `$0.003015` | 3/3 ok | главный кандидат для cheap writer |
| Claude brief -> DeepSeek -> Claude full polish | `$0.253889` | 3/3 ok after retry | не использовать как default, слишком дорого |

Документы с исходными данными:

- `docs/model_routing_lab_results_2026-05-07.md`
- `docs/ai_generation_cost_optimization_2026-05-07.md`

Главный вывод: экономия должна строиться не на Claude-orchestrator для каждой статьи, а на связке `code brief -> DeepSeek writer -> deterministic validators -> selective Claude reviewer`.

## Principles

1. Production default не меняем, пока cheap/balanced mode не пройдёт расширенный lab.
2. Любой новый provider включается только за env-флагом.
3. Стоимость считаем на уровне статьи, включая text и image.
4. Claude используем там, где он даёт редакционную ценность: risky/high-value review, а не full rewrite.
5. Картинки становятся обязательным fallback для будущих статей, но с дневным budget cap.
6. Визуальный стиль должен быть технологичным и редакционным, без generic нейростиля: glowing brains, network spheres, random dashboards, fake UI, corporate stock people.

## Target modes

### Cheap

Для обычного daily flow после успешного lab.

- Orchestrator: deterministic TypeScript brief builder.
- Writer: DeepSeek.
- Reviewer: validators only.
- Claude: только при validator failure или явных risk flags.
- Image: source cover first, then OpenAI Images low.
- Target text cost: `$0.001-0.002` per article.
- Target total with image: around `$0.014-0.016` per normal article.

### Balanced

Кандидат на будущий default, если cheap даёт заметные quality misses.

- Orchestrator: deterministic brief builder.
- Writer: DeepSeek.
- Reviewer: Claude selective reviewer for 25-35% high-risk/high-score pieces.
- Fix strategy: compact JSON patch or issue list, not full article rewrite.
- Image: OpenAI Images low by default, medium only for top visible cards.
- Target total with image: around `$0.017-0.025` average.

### Premium

Для исследований, regulation/legal, homepage lead, evergreen и ручного редакционного контроля.

- Writer: current Claude Batch full article.
- Reviewer: optional compact self-check only for risky materials.
- Image: OpenAI medium/high or manual art direction.
- This remains production default until Phase 5 cutover decision.

## Phase 0. Baseline and fixtures

1. Зафиксировать fixture set на 20 статей:
   - 5 Habr AI / engineering;
   - 4 business/startups/investments;
   - 4 research/science;
   - 3 regulation/legal/geopolitics;
   - 4 mixed lower-risk daily news.
2. Для каждой fixture статьи сохранить:
   - slug;
   - source;
   - primary category;
   - score;
   - current cover status;
   - current Claude cost from `llm_usage_logs`;
   - current title/lead/body metadata.
3. Сформировать manual review sheet/table:
   - factuality;
   - style;
   - structure;
   - lead quality;
   - teaser clickability;
   - image fit;
   - publish decision.

Выход:

- stable fixture list for labs;
- known current baseline cost and quality;
- no production behaviour changes.

## Phase 1. Strict editorial validators

1. Расширить `validateEditorial`:
   - every `link_anchor` must appear verbatim in `editorial_body`;
   - banned phrases scan across title, lead, summary, card teaser, Telegram teaser, body;
   - reject standalone `AI` in Russian editorial text except allowed product/model names;
   - minimum body shape: paragraph count, body length, non-empty lead and teasers;
   - reject empty/generic `quality_reason` when `quality_ok=false`.
2. Вынести validator result в structured object:
   - `ok`;
   - `errors`;
   - `warnings`;
   - `risk_flags`.
3. Добавить unit tests на реальные DeepSeek misses from lab:
   - bad anchors;
   - `AI-агент` vs `ИИ-агент`;
   - banned phrase `в рамках` / `действительно`.

Выход:

- DeepSeek output cannot pass on known style/contract violations;
- validators are provider-neutral;
- production Claude path still works.

## Phase 2. Provider-neutral routing surface

1. Добавить env:
   - `EDITORIAL_ROUTING_MODE=cheap|balanced|premium`;
   - `EDITORIAL_WRITER_PROVIDER=deepseek|anthropic`;
   - `EDITORIAL_REVIEW_POLICY=none|selective|always`;
   - default remains premium/current Claude path.
2. Создать deterministic editorial brief builder:
   - source/category/score;
   - extracted facts;
   - required angle;
   - avoid claims;
   - style notes from current canonical prompt;
   - image scene seed.
3. Добавить DeepSeek writer client behind routing flag.
4. Keep Anthropic Batch as premium path.
5. DeepSeek cheap path can be sync worker first; do not force it into Anthropic-specific batch tables.

Выход:

- cheap/balanced can be launched manually without changing production default;
- routing decisions are auditable per article.

## Phase 3. Selective Claude reviewer

1. Реализовать `shouldReviewWithClaude(article, validation, riskFlags)`:
   - validation failure;
   - high score;
   - `ai-research`;
   - money/funding/valuation;
   - regulation/legal;
   - medical/safety/geopolitics;
   - homepage/top-card candidate.
2. Claude reviewer должен возвращать compact JSON:
   - `pass`;
   - `blocking_issues`;
   - `non_blocking_notes`;
   - `patch_suggestions`;
   - `publish_recommendation`.
3. Не делать full Claude polish by default.
4. Если reviewer fails:
   - cheap mode: mark for manual/premium fallback;
   - balanced mode: one compact rewrite/fix attempt allowed only when cost cap permits.

Выход:

- Claude cost is selective and bounded;
- current expensive hybrid is replaced by reviewer logic.

## Phase 4. Article lab 20

1. Run lab on fixtures:
   - Claude baseline/current DB;
   - DeepSeek cheap;
   - balanced selective review.
2. Store outputs under `tmp/model-routing-lab-*`.
3. Generate report:
   - accepted article count;
   - text cost;
   - reviewer cost;
   - cost per accepted article;
   - validator failures;
   - reviewer-trigger reasons.
4. Manual review by rubric.
5. Decide:
   - cheap acceptable;
   - balanced acceptable;
   - stay premium;
   - category-specific routing.

Выход:

- data-backed choice of routing scenario;
- recommendation for production rollout.

## Phase 5. Image style lab

Цель: выбрать визуальный стиль, который выглядит технологично и редакционно, но не как generic AI art.

1. Выбрать 8-12 representative articles:
   - no-cover future candidates;
   - different categories;
   - at least 3 homepage-like strong stories.
2. Generate low-quality variants for each article:
   - `editorial-photographic`;
   - `tech-still-life`;
   - `abstract-infrastructure`;
   - `documentary-collage`;
   - `minimal-object-metaphor`.
3. Для 2-3 лучших статей additionally generate medium variants.
4. Prompt rules:
   - no readable text;
   - no logos/trademarks;
   - no fake product screenshots;
   - no glowing brain/network sphere clichés;
   - one strong focal object;
   - high thumbnail contrast;
   - restrained palette compatible with site.
5. Evaluate:
   - card thumbnail readability;
   - article hero fit;
   - category feed consistency;
   - visual variety across same topic;
   - low vs medium quality delta;
   - cost per accepted cover.

Выход:

- chosen default image style;
- one or two fallback styles for repeated topics;
- decision whether low is enough for normal articles;
- medium override policy for homepage/top stories.

## Phase 6. Automatic covers for future articles

1. Keep source image as first choice when sanitizer accepts it.
2. For missing cover after article acceptance:
   - generate OpenAI image low;
   - upload/store;
   - write `llm_usage_logs` image row;
   - set `cover_image_url`.
3. Enforce spend caps:
   - `--daily-budget`;
   - `--limit`;
   - no repeated generation for same article unless explicit regenerate flag.
4. Add style rotation:
   - deterministic style seed from article slug/category;
   - prevent 5 same-topic articles from looking identical.
5. Add failure handling:
   - mark failed generation;
   - retry once with alternate prompt/style only if within budget.

Выход:

- every subsequent accepted article gets a cover automatically unless budget is exhausted;
- image spend is visible per article.

## Phase 7. Cost and admin observability

1. Extend reports:
   - text cost by provider/model/operation;
   - image cost by model/quality/style;
   - total cost per accepted article;
   - rejected generation cost;
   - missing cover count.
2. Add daily Telegram admin report:
   - articles ingested/submitted/live;
   - text/image spend;
   - average cost per live article;
   - top expensive articles;
   - generated cover count;
   - failed validations;
   - suggested manual review items.
3. Add dashboard/internal links where useful.

Выход:

- daily visibility into cost and quality;
- regressions are visible before spend drifts.

## Phase 8. Production rollout

1. Start with manual cheap runs on small limits.
2. Enable balanced for one low-risk category or limited daily quota.
3. Compare live quality for 3-5 days.
4. Increase rollout only if:
   - validator failures are understood;
   - manual review accepts quality;
   - average cost hits target;
   - image covers look consistent.
5. Keep premium fallback for:
   - research;
   - regulation/legal;
   - homepage lead;
   - failed cheap/balanced attempts.

Выход:

- chosen default scenario;
- documented rollback path;
- production articles keep quality while cost drops.

## Stop conditions

Остановиться и не включать production routing, если:

- DeepSeek cheap has more than 10-15% manual rejection on the 20-article lab;
- validators produce many false positives on existing Claude articles;
- balanced average text cost approaches current Claude Batch cost;
- generated covers look generic, misleading, or repetitive;
- image workflow can exceed daily budget due to retry/selectors;
- provider errors leave articles half-applied or without observable failure states.

## Immediate next task

Start with Phase 1 and Phase 2:

1. Implement strict validators.
2. Add routing env surface with production default still premium/current Claude.
3. Run targeted tests.
4. Re-run a 5-article cheap lab.
5. Then move to image style lab before enabling automatic cover generation broadly.

## Progress - 2026-05-09

Implemented:

- Phase 1 validator surface:
  - `validateEditorialDetailed()` returns structured errors, warnings and risk flags;
  - `validateEditorial()` remains backward-compatible for existing collect/apply code;
  - validator rejects missing verbatim anchors, banned phrases and standalone `AI` in Russian copy.
- Phase 2 routing surface:
  - `pipeline/editorial-routing.ts`;
  - default config remains `premium` + `anthropic`;
  - `cheap/balanced` select DeepSeek writer with selective Claude reviewer policy;
  - deterministic editorial brief builder replaces Claude orchestrator for lab scenarios.
- Phase 3 reviewer scaffold:
  - `balanced-review` mode in `npm run routing:lab`;
  - compact Claude reviewer returns pass/fail JSON instead of full article rewrite.
- Deterministic repair pass:
  - `pipeline/editorial-repair.ts`;
  - safe replacement of standalone `AI` with `ИИ`;
  - invalid `link_anchors` are dropped before validator/reviewer;
  - long one-paragraph `editorial_body` can be restored into 3-5 paragraphs;
  - overlong titles are shortened at safe punctuation boundaries;
  - banned phrases are removed while preserving paragraph breaks;
  - intended to remove cheap mechanical failures before spending on Claude review.
- Phase 5 image style lab:
  - `npm run image:style-lab`;
  - dry-run prompt/report mode;
  - optional local-only `--apply` with budget cap;
  - five styles: `editorial-photographic`, `tech-still-life`, `abstract-infrastructure`, `documentary-collage`, `minimal-object-metaphor`.

Smoke results:

- `npm run routing:lab -- --limit=2 --missing-cover-only --modes=deepseek-full,balanced-review --apply`
  wrote `tmp/model-routing-lab-1778327390646/report.json`.
- DeepSeek remained very cheap, but strict validators caught the same production blockers:
  - missing verbatim `link_anchors`;
  - standalone `AI` in Russian fields;
  - too-short `card_teaser`.
- Initial reviewer policy was too broad because ordinary LLM explainers triggered legal/research review reasons. Risk detection and reviewer prompt were narrowed so routing reasons are treated as risk signals, not mandatory content sections.
- A paid retry after the narrowing hit DeepSeek `terminated` before usage was captured. Treat this as a reliability requirement: cheap/balanced production routing needs retry/fallback before cutover.
- 5-article paid lab `tmp/model-routing-lab-1778328292656/report.json`:
  - `deepseek-full`: `$0.004320`, 0/5 before the final paragraph-preserving repair fix;
  - `balanced-review`: `$0.035490`, 1/5, with three `terminated` DeepSeek failures and one reviewer rejection for overlong title/weak lead.
- Follow-up DeepSeek-only run `tmp/model-routing-lab-1778329166706/report.json` initially failed 3/3 because the repair pass had collapsed paragraphs. After fixing paragraph preservation and adding paragraph restoration, the saved DeepSeek outputs validate 3/3 locally.
- `npm run image:style-lab -- --limit=1 --per-article=2 --category=all --apply --budget=0.03`
  wrote two local low-quality variants to `tmp/image-style-lab-1778327701418/`.
- Visual read:
  - `editorial-photographic` drifted into fake app/product screens and pseudo-text;
  - `tech-still-life` was closer to the desired technological editorial style.
- Image prompts were tightened to forbid pseudo-text, app UI, fake dashboards, login screens and product comparison screens.

Current recommendation:

1. Do not enable production DeepSeek yet.
2. Next implementation step is retry/fallback around DeepSeek calls:
   - retry once on `terminated`/empty response;
   - if retry fails, mark for premium Claude Batch fallback;
   - preserve partial usage when provider returns it.
3. Add teaser repair/normalization only if the next 5-article lab shows this is still a frequent cheap failure.
4. Rerun 5-article `deepseek-full` + `balanced-review` paid lab after the paragraph repair fix.
5. For image direction, continue with `tech-still-life`, `abstract-infrastructure` and `minimal-object-metaphor`; deprioritize broad `editorial-photographic` unless prompts keep it away from fake UI.
