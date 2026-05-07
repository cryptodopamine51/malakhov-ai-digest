# Model routing paid lab results - 2026-05-07

## Run

Main paid run:

```bash
npm run routing:lab -- --limit=3 --missing-cover-only --modes=deepseek-full,hybrid --apply
```

Main report:

```text
tmp/model-routing-lab-1778151040732/report.json
```

Hybrid retry for failed second article:

```bash
npm run routing:lab -- --slugs=skott-gellouey-katastrofizatsiya-vokrug-ii-instrument-privle --modes=hybrid --apply
```

Retry report:

```text
tmp/model-routing-lab-1778151562989/report.json
```

One earlier smoke run checked that DeepSeek credentials were available:

```text
tmp/model-routing-lab-1778150989818/report.json
```

## Articles

1. `perplexity-pri-otsenke-21-mlrd-kto-chetyre-cheloveka-zapusti`
2. `skott-gellouey-katastrofizatsiya-vokrug-ii-instrument-privle`
3. `durable-state-dlya-ii-agentov-razresheniya-sessii-i-fonovye`

Baseline is the current published Claude Sonnet 4.6 version in Supabase.

## Costs

Baseline Claude logged cost for the same 3 articles:

| Article | Claude logged cost |
|---|---:|
| Perplexity | `$0.066575` |
| Scott Galloway | `$0.056521` |
| Durable state | `$0.051418` |
| Total | `$0.174514` |

DeepSeek full paid lab:

| Article | Cost | Status |
|---|---:|---|
| Perplexity | `$0.000673` | ok |
| Scott Galloway | `$0.001311` | ok |
| Durable state | `$0.001031` | ok |
| Total | `$0.003015` | 3/3 ok |

Hybrid paid lab:

| Article | Cost | Status |
|---|---:|---|
| Perplexity | `$0.086744` | ok |
| Scott Galloway | `$0.086712` | ok after retry |
| Durable state | `$0.080433` | ok |
| Total successful | `$0.253889` | 3/3 ok after retry |

There was one additional failed hybrid attempt for Scott Galloway with `error=terminated`. The report did not capture partial step costs for that failed attempt, so real provider billing may be slightly higher than `$0.253889`.

## Quality comparison

### DeepSeek full

Overall: usable, cheap, but not ready as unattended production default without stricter validation and selective review.

Strengths:

- All 3 outputs passed current `validateEditorial`.
- All 3 returned `quality_ok=true`.
- Russian text is generally readable.
- Cost reduction is very large: `$0.003015` vs Claude logged `$0.174514`, about 98.3% cheaper on this sample.

Issues:

- Style compliance is weaker than Claude:
  - Durable state output uses `AI-агентов` and `AI-агент` repeatedly instead of `ИИ`.
  - Scott Galloway output triggered a banned-word scan hit for `действительно`.
- Link anchors can violate the prompt contract:
  - Perplexity DeepSeek had 2 `link_anchors` not found verbatim in `editorial_body`.
- Perplexity DeepSeek is shorter and flatter than Claude/hybrid:
  - 2059 chars, 3 paragraphs.
  - It is publishable, but less magazine-like and less developed.
- It tends to compress context and produce a competent summary rather than a strong editorial piece.

Verdict:

- Strong candidate for cheap draft writer.
- Do not ship without:
  - anchor validator;
  - `AI -> ИИ` post-check except product names;
  - banned phrase validator;
  - selective Claude review for high-value/risky pieces.

### Hybrid

Overall: best quality on two articles, but too expensive and less reliable than desired.

Strengths:

- Perplexity hybrid is close to the current Claude baseline quality:
  - 3579 chars, 6 paragraphs.
  - Stronger angle and better narrative than DeepSeek full.
- Scott Galloway hybrid retry is strong:
  - keeps the central argument;
  - lead is sharper than DeepSeek;
  - good Telegram teaser.
- Durable hybrid is more detailed than DeepSeek.

Issues:

- Cost is too high:
  - `$0.253889` for 3 successful hybrid outputs vs `$0.174514` Claude logged baseline.
  - Hybrid is about 45.5% more expensive than current Claude logged baseline on this sample.
- Reliability issue:
  - one hybrid attempt failed with `terminated` and required retry.
- Current hybrid implementation uses full Claude polish, so it pays for a long Claude final output.
- Quality still needs validators:
  - Durable hybrid contains banned phrase `в рамках`.
  - Scott hybrid retry has 2 link anchors not found verbatim in `editorial_body`.

Verdict:

- Do not use current `Claude brief -> DeepSeek draft -> Claude full polish` as default.
- If hybrid is kept, change it to cheap targeted Claude reviewer that returns JSON patch or pass/fail notes, not a full rewritten article.

## Baseline Claude

Claude baseline remains the most consistent editorial output:

- strongest lead discipline;
- fewer style violations;
- better body depth;
- better Telegram teaser quality.

But cost is materially higher than DeepSeek:

- Current logged sample average: `$0.058171` per article.
- DeepSeek sample average: `$0.001005` per article.

Even if Anthropic Batch billing discount makes real Claude cost about 50% lower, DeepSeek is still roughly 95%+ cheaper on this sample.

## Recommendation

Use this routing direction:

1. Cheap mode:
   - deterministic code/template orchestration;
   - DeepSeek full writer;
   - strict validators;
   - OpenAI Images low cover.

2. Balanced mode:
   - DeepSeek writer;
   - Claude selective reviewer only for:
     - `ai-research`;
     - high score;
     - money/legal/regulation/medical/high-risk topics;
     - validator failures.
   - Reviewer should return compact corrections or JSON patch, not rewrite the whole article.

3. Premium mode:
   - current Claude Batch full article.

## Required fixes before production DeepSeek routing

1. Extend `validateEditorial`:
   - every `link_anchor` must be present in `editorial_body`;
   - banned phrase scan across title/lead/summary/teasers/body;
   - reject standalone `AI` in Russian text except product/model names.

2. Add DeepSeek provider path behind env:
   - `EDITORIAL_ROUTING_MODE=cheap|balanced|premium`;
   - `EDITORIAL_WRITER_PROVIDER=deepseek|anthropic`;
   - `EDITORIAL_REVIEW_POLICY=none|selective|always`.

3. Change hybrid design:
   - no Claude orchestrator by default;
   - no full Claude polish by default;
   - Claude reviewer returns compact patch/checklist only.

4. Improve lab reporting:
   - record partial step costs on failures;
   - write lab usage into `llm_usage_logs` with `operation='editorial_routing_lab'` if desired.

## Best next step

Implement cheap/balanced routing behind env using DeepSeek writer plus stricter validators. Keep production default on Claude until 10-20 more articles are sampled and manually reviewed.
