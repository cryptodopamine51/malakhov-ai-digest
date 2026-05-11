# Final report: fallback-first generation and covers

Date: 2026-05-11
Status: implemented; deployment path is main branch to GitHub/Vercel production

## What changed

- `enrich.yml` now runs fallback-first editorial routing every 30 minutes:
  `npm run editorial:routing -- --mode=cheap --limit=15 --apply --deepseek-daily-budget=0.25`.
- Low-risk articles try DeepSeek first, then deterministic repair, strict validation,
  slug guard and media sanitizer.
- High-risk articles, DeepSeek/API failures, parse failures, hard validator errors and
  `quality_ok=false` are routed to the existing Anthropic Batch fallback as
  `editorial_premium_fallback`.
- Anthropic Batch tables and collector remain in place; `enrich-collect-batch.yml` still
  applies fallback results.
- AI cover generation is scheduled every 2 hours through `ai-covers.yml` with low quality,
  `gpt-image-1.5`, `1536x1024`, and `--daily-budget=1`.
- DeepSeek rates in `pipeline/model-pricing.ts` were aligned with current provider pricing
  so budget guards and cost reports do not undercount cache-hit or Pro usage.

## Covers applied now

Manual production apply was run for the current window:

- 2026-05-10 published articles: 4 missing Habr covers were generated and written.
- 2026-05-11 published articles: no AI cover was needed; the one live article already had a source cover.
- Cost logged today: 4 images × `$0.013` = `$0.052`.

Generated covers:

- `pochti-god-s-ii-pomoshchnikom-kak-razrabotchik-delal-futboln`
- `mistral-medium-3-5-kandinsky-6-0-i-chatgpt-v-tablitsakh-glav`
- `kakie-arkhitektury-koda-rabotayut-luchshe-vsego-kogda-kod-pi`
- `cursor-kak-instrument-onbordinga-opyt-frontend-razrabotchika`

## Budget estimate

Recent production baseline:

- Last completed 7-day average: about 33.6 live articles/day.
- Claude Batch text spend: about `$1.88/day`.
- Articles that still need AI covers after source sanitizer: about 13/day.

New expected cost:

| Scenario | Text/day | Images/day | Total/day | Total/month |
|---|---:|---:|---:|---:|
| Target, 85% low-risk DeepSeek acceptance | ~$0.53 | ~$0.17 | ~$0.70 | ~$21 |
| Conservative, 70% low-risk acceptance | ~$0.77 | ~$0.17 | ~$0.94 | ~$28 |
| Stress, 50% low-risk fallback | ~$1.09 | ~$0.17 | ~$1.26 | ~$38 |
| Old Claude-only baseline + full covers | ~$1.88 | ~$0.17 | ~$2.05 | ~$62 |

Assumptions:

- DeepSeek accepted article: about `$0.001-0.002`.
- Claude fallback article: current observed average about `$0.05-0.07`.
- Image cover: `$0.013` per `gpt-image-1.5` low landscape image.
- The image workflow has a hard logical cap of `$1/day`.
- The DeepSeek workflow cap is `$0.25/day`; expected normal usage is far below it.

Current price references checked on 2026-05-11:

- OpenAI `gpt-image-1.5` low `1536x1024`: `$0.013/image`.
- OpenAI pricing: https://platform.openai.com/docs/pricing
- OpenAI `gpt-image-1.5` model page: https://platform.openai.com/docs/models/gpt-image-1.5
- DeepSeek pricing: https://api-docs.deepseek.com/quick_start/pricing
- DeepSeek `deepseek-v4-flash`: `$0.028/M` cache-hit input, `$0.14/M` cache-miss input, `$0.28/M` output.
- Anthropic pricing: https://docs.anthropic.com/en/docs/about-claude/pricing
- Anthropic Sonnet 4.6-compatible pricing used by the project: `$3/M` input, `$15/M` output, 50% savings with Batch.

## Architecture check

No conflict with `CLAUDE.md` invariants:

- The public site still reads already-materialized `articles` rows.
- No content is generated on public request.
- Service role remains server/Action-side only.
- Public URLs and publish verification are unchanged.
- `legacy/` is not used.
- Deployment remains GitHub/Vercel flow.

Docs updated:

- `docs/ARTICLE_SYSTEM.md`
- `docs/OPERATIONS.md`
- `docs/DECISIONS.md`
- `docs/task_ai_generation_fallback_routing_and_covers_2026-05-11.md`

## Verification

- `npx tsx --test tests/node/model-pricing.test.ts tests/node/editorial-routing.test.ts tests/node/batch-enrich.test.ts`
- `npm run docs:check`
- `npx tsc --noEmit`
- `npm run editorial:routing -- --mode=cheap --limit=3`
- `npm run build`

## Follow-up items

- Watch the first 20 DeepSeek-routed articles manually for style quality and fact discipline.
- Check fallback rate after 1-2 days via `llm_usage_logs` operations:
  `deepseek_editorial_writer`, `editorial_premium_fallback`, `claude_selective_reviewer`.
- If cheap acceptance falls below 70% or style quality is weak, revert `enrich.yml` to
  `npm run enrich-submit-batch` while keeping the manual routing tool for lab runs.

## Follow-up audit on 2026-05-11

- GitHub repository secrets now include `DEEPSEEK_API_KEY` and `OPENAI_API_KEY`.
- `enrich.yml` and `ai-covers.yml` now have GitHub Actions concurrency groups and 90-minute
  job timeouts, so scheduled runs do not overlap or hang indefinitely.
- `cheap` routing config now defaults to no Claude reviewer, matching the production runner;
  `balanced` remains the selective-review mode.
- AI cover dry-run can inspect candidates without `OPENAI_API_KEY`; `--apply` still requires it.
- `llm_usage_logs` after the manual cover apply currently show only
  `image_cover_generation:ok = 4` for `$0.052`; no `deepseek_editorial_writer` rows exist yet,
  so fallback-rate review remains pending until the first scheduled routing runs complete.
