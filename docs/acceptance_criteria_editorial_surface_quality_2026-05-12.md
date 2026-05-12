# Acceptance Criteria: Editorial Surface Quality 2026-05-12

> Parent task: `docs/task_editorial_surface_quality_2026-05-12.md`
> Execution plan: `docs/execution_plan_editorial_surface_quality_2026-05-12.md`

## Homepage

- [ ] On homepage page 1, the article shown in `Главное сегодня` is not the first featured article in `Все новости`.
- [ ] `Свежие заголовки` still excludes the hot story.
- [ ] `Все новости` keeps fresh-feed ordering by `created_at desc` with existing tie-breakers.
- [ ] Pagination still works for `/?page=2` and invalid high page redirects to the last valid page.

## Priority Covers

- [ ] There is a documented command or package script for homepage-priority AI cover generation.
- [ ] Priority mode selects only homepage-visible priority candidates: hot story and first `All news` featured article after exclusions.
- [ ] Priority mode uses OpenAI Images through the existing script path and updates only `articles.cover_image_url`.
- [ ] Priority mode uses `gpt-image-1.5` and `quality=medium` unless `gpt-image-2` access is explicitly verified and documented.
- [ ] Daily budget cap applies before generation.
- [ ] Success and failure attempts are written to `llm_usage_logs` with `operation='image_cover_generation'`.
- [ ] Public page requests do not call OpenAI or write Supabase Storage.

## Article Recommendations

- [ ] Article page no longer uses only `primary_category + score desc` for recommendations.
- [ ] Recommendations exclude the current article.
- [ ] Recommendations prefer fresh, relevant articles and fall back to a wider window only when needed.
- [ ] Source diversity prevents one source from dominating when alternatives exist.
- [ ] If fewer than the minimum viable recommendations exist, the block hides instead of showing placeholders.
- [ ] Desktop layout is a grid.
- [ ] Mobile layout supports horizontal scroll with snap and no autoplay.

## Section Navigation After Article

- [ ] A compact `Продолжить по разделам` section appears after recommendations.
- [ ] The current primary category is first and visually active.
- [ ] Links follow canonical section URLs.
- [ ] The component uses the same section order as the site navigation or `TopicTabs`.
- [ ] The block does not use large cards or explanatory marketing copy.

## Inline Images

- [ ] `interleaveBodyMedia()` or its replacement never appends leftover images to the end of the article body.
- [ ] The final article body block is not an image.
- [ ] More than 2-3 images can render when the article is long enough and images are thematic.
- [ ] Short articles naturally render fewer images.
- [ ] Images are spaced between paragraphs and not clustered.
- [ ] Tables, video, pull quotes, Telegram CTA, recommendations, and section navigation still render.

## vc.ru

- [ ] Current vc.ru feed health is documented with recent `source_runs`.
- [ ] The latest `publish_ready` vc.ru article has a resolved explanation:
  - transitioned to live;
  - fixed if stuck;
  - or captured as a concrete follow-up with owner and trigger condition.
- [ ] If vc.ru produces no live article for 7 days, there is a source-health or manual follow-up path.

## Copy Cleanup

- [ ] Footer shows exactly `© 2026 news.malakhovai.ru` in the bottom copyright line.
- [ ] Footer no longer contains `Все материалы переработаны редакцией`.
- [ ] Article page source footer no longer contains `Переработано редакцией Malakhov AI Дайджест`.
- [ ] Source attribution and original source outbound link remain present.

## Hero Subtitle

- [ ] Homepage hero subtitle is readable in light theme.
- [ ] Homepage hero subtitle is readable in dark theme.
- [ ] The fix preserves the existing editorial minimal hero, without a full decorative redesign.

## Documentation

- [ ] `docs/ARTICLE_SYSTEM.md` updated for changed article/media/homepage behavior.
- [ ] `docs/OPERATIONS.md` updated if cover command/workflow changes.
- [ ] `docs/DESIGN.md` updated for hero subtitle, recommendations, and section navigation.
- [ ] `docs/PROJECT.md` updated if after-article section navigation is treated as a product surface.
- [ ] `docs/DECISIONS.md` updated only if a new durable architecture decision is made.

## Required Checks

- [ ] `npm run docs:check`
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] `npx tsx --test tests/node/interest-ranking.test.ts tests/node/media-sanitizer.test.ts tests/node/pagination.test.ts`
- [ ] Any new helper tests added for homepage exclusions, recommendations, or image slotting pass.

## Manual Production Smoke

- [ ] Open `https://news.malakhovai.ru/`.
- [ ] Verify no homepage duplicate between `Главное сегодня` and first `Все новости`.
- [ ] Toggle light/dark and verify hero subtitle.
- [ ] Open a known article that previously ended with image tail.
- [ ] Verify article ends with editorial blocks/CTA/recommendations/navigation, not an image.
- [ ] Verify recommendations and section chips on desktop and mobile viewport.
- [ ] Verify footer copy.
