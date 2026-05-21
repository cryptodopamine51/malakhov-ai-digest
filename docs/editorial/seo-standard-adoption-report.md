# SEO Standard Adoption Report

Дата аудита: 2026-05-13

Проект: Malakhov AI Digest (`news.malakhovai.ru`)

## 1. Scope

Аудит выполнен по текущей архитектуре проекта, без предположений о будущей CMS. Основные источники фактов:

- `CLAUDE.md`, `README.md`, `docs/INDEX.md`
- `docs/PROJECT.md`, `docs/ARCHITECTURE.md`, `docs/ARTICLE_SYSTEM.md`, `docs/editorial_style_guide.md`
- `app/layout.tsx`, `app/categories/[category]/[slug]/page.tsx`, `app/guides/[slug]/page.tsx`
- `app/sitemap.ts`, `app/robots.ts`, `app/rss.xml/route.ts`, `app/llms.txt/route.ts`
- `lib/articles.ts`, `lib/article-slugs.ts`, `lib/guides.ts`, `lib/site.ts`, `lib/category-meta.ts`
- `pipeline/ingest.ts`, `pipeline/enrich-submit-batch.ts`, `pipeline/enrich-collect-batch.ts`, `pipeline/editorial-apply.ts`, `pipeline/claude.ts`, `pipeline/fetcher.ts`, `pipeline/publish-verify.ts`
- `supabase/schema.sql`, `supabase/migrations/001_content_engine.sql`, `005_pipeline_reliability.sql`, `013_categories_model.sql`, `014_observability_publication.sql`, `20260423195035_enable_public_article_rls.sql`

## 2. Current Architecture Summary

Проект имеет два разных типа SEO-контента:

1. **Автоматические news articles**: RSS -> `articles` в Supabase -> enrichment -> `publish_ready` -> `publish-verify` -> `live` -> публичная страница `/categories/<primary_category>/<slug>`.
2. **Evergreen guides**: Markdown в `content/guides/`, metadata registry в `lib/guides.ts`, публичные страницы `/guides/<slug>`.

Это важно для стандарта: полный pre-writing SEO-brief применим к evergreen и ручным материалам, но не должен блокировать автоматический RSS news pipeline.

## 3. Fact-Based Content Entities

| Сущность | Фактическое имя / источник | Комментарий |
|---|---|---|
| Article | `articles` table, `Article` interface in `lib/supabase.ts` | Главная сущность news-пайплайна. |
| Raw item | `ParsedItem` in `pipeline/rss-parser.ts`; raw row in `articles` after `pipeline/ingest.ts` | До enrichment содержит source metadata, topics/category, dedup hash. |
| Editorial item | `anthropic_batch_items`, `EditorialOutput` in `pipeline/claude.ts` | Provider result и structured editorial output. |
| Event | Public event entity не найден | В текущем коде нет отдельной публичной модели events. |
| Issue | `digest_runs` operational table only | Публичных issue pages / digest issue entities не найдено. |
| Category / section | `categories` table, `primary_category`, `secondary_categories`, `lib/categories.ts` | Canonical статьи строится по primary category. |
| Legacy topic | `articles.topics`, `TopicBadge`, `app/topics/[topic]` redirect | Read-only legacy слой для совместимости. |
| Source | `source_name`, `pipeline/feeds.config.ts`, `/sources`, `/sources/[source]` | Источник хранится в статье и имеет публичную навигацию. |
| Author | Organization only | Персональных авторов нет; JSON-LD author/publisher = `Malakhov AI Дайджест`. |
| Image | `cover_image_url`, `article_images`, guide `cover`, `inlineImagesByHeading` | Article images берутся из source или Supabase Storage fallback; guides используют локальные WebP. |
| Video | `article_videos` | Поддерживается на страницах статей и в `NewsArticle.video`. |
| Tag | Guide `tags`; article `topics` legacy | Для news canonical/category логика опирается на `primary_category`, не на tags. |
| Digest item | Article used by `bot/daily-digest.ts` / `bot/daily-digest-core.ts` | Отдельной публичной модели digest item не найдено. |

## 4. Candidate SEO Blocks Mapping

| Блок стандарта | Статус | Где уже есть в проекте | Конфликт / риск | Решение |
|---|---|---|---|---|
| 1. SEO-бриф перед написанием статьи | missing | Для news pipeline есть source/category brief в `pipeline/claude.ts::buildEditorialUserMessage`; для evergreen metadata вручную задана в `lib/guides.ts`. Полного SEO-брифа в docs/code не найдено. | Если требовать ручной brief для каждой RSS-новости, это конфликтует с автоматическим pipeline. | Ввести обязательный brief для evergreen и ручных материалов; для RSS-news считать входным brief source URL, source title, categories, score и fetched content. |
| 2. Основной поисковый запрос | missing | У guides есть `tags` и `seoTitle` в `lib/guides.ts`, но нет поля primary query. У news статей нет SEO-query field. | Добавление обязательного DB-поля под keyword для news потребует миграции и UI/пайплайн изменений. | В стандарте требовать primary query только в pre-writing brief для evergreen/manual; для news использовать тему/source event без DB-поля. |
| 3. Дополнительные запросы | missing | Не найдено отдельное поле или документированная практика. | То же, что для primary query: нельзя требовать это от RSS-пайплайна до изменения схемы. | Ввести как recommended для evergreen/manual; future improvement для отдельного metadata layer. |
| 4. Поисковый интент | missing | В `docs/PROJECT.md` есть аудитория и SEO-цели, но intent per article не фиксируется. | Полный intent-анализ для short news замедлит публикацию. | Для evergreen/manual сделать mandatory; для news - кратко проверять, что материал отвечает на "что произошло / почему важно / что это меняет". |
| 5. Анализ конкурентов / сильных страниц выдачи | needs_adaptation | Не найдено в коде или docs. | Live SERP-анализ не является частью automated pipeline и зависит от внешних сервисов. | Делать для evergreen/manual и крупных explainers; не требовать для каждой RSS-news статьи. |
| 6. Уникальная ценность Malakhov AI Digest | partially_implemented | `CLAUDE.md` требует "не бездушный агрегатор"; `pipeline/claude.ts` просит добавлять контекст и раскрывать тему; `docs/editorial_style_guide.md` задает тон. | Prompt допускает контекст "если знаешь", что требует осторожности с фактами. | Закрепить в стандарте: ценность = русский контекст, объяснение последствий, связь с AI-рынком; факты не выдумывать. |
| 7. Проверка каннибализации | missing | Есть related/internal linking в `lib/articles.ts::getArticleRecommendations` и `resolveAnchorLinks`, но pre-publication cannibalization check не найден. | Для news автоматическая проверка по всем live URL может быть затратной; для guides она важна. | Для evergreen/manual обязать поиск по `content/guides`, `lib/guides.ts`, Supabase live articles и sitemap; для news - recommended при близких темах. |
| 8. Решение: новая статья / обновление старой / объединение / canonical | needs_adaptation | Canonical и redirects реализованы в `lib/article-slugs.ts`, `app/articles/[slug]/page.tsx`, `app/topics/[topic]/page.tsx`; guide registry есть в `lib/guides.ts`. Workflow выбора update vs new не найден. | Автоматический news pipeline всегда создает новые rows по dedup hash; evergreen нужно обновлять старый guide, а не плодить дубль. | В стандарте разделить: RSS-news создает новую статью при новом source/dedup; evergreen/manual сначала решает update vs new vs merge. |
| 9. Структура статьи: H1, лид, краткий вывод, H2/H3, основной разбор, вывод, FAQ | needs_adaptation | News page: H1, lead, summary, body in `app/categories/[category]/[slug]/page.tsx`; prompt fields in `pipeline/claude.ts`. Guides: H1/H2/H3/FAQ in `content/guides/...` and `app/guides/[slug]/page.tsx`. | News render обычно не поддерживает H2/H3/FAQ as structured article sections; forcing them would conflict with current short news format. | Для news требовать H1, lead, summary, body; H2/H3/FAQ только для evergreen/manual long-form guides. |
| 10. Title | partially_implemented | News metadata `title = ru_title ?? original_title` in `app/categories/[category]/[slug]/page.tsx`; guide `seoTitle` in `lib/guides.ts`. | У news нет отдельного SEO title, поэтому editorial `ru_title` одновременно H1 и title. | Зафиксировать лимит и качество `ru_title`; отдельный SEO title оставить future improvement. |
| 11. Meta description | already_implemented | News `description = card_teaser ?? lead`; guides `description` / `ogDescription` in `lib/guides.ts`; category descriptions in `lib/category-meta.ts`. | `card_teaser` не всегда является идеальной search snippet description. | Стандарт: для news `card_teaser` primary, `lead` fallback; для guides description отдельная и не дублирует H1. |
| 12. H1 | already_implemented | News H1 renders title in `app/categories/[category]/[slug]/page.tsx`; guides H1 in `app/guides/[slug]/page.tsx`; category H1 in `app/categories/[category]/page.tsx`. | Нет отдельного guard на один H1, но фактические templates его соблюдают. | Сохранить: один H1 на page, без дословного повторения первого абзаца. |
| 13. Человекочитаемый URL / slug | already_implemented | `pipeline/slug.ts::generateSlug`, `normalizeSlug`, `assertAsciiSlug`; URL builder `lib/article-slugs.ts`; docs in `docs/ARTICLE_SYSTEM.md`. | Legacy hex suffix stripped by `toPublicArticleSlug`; collision suffixes controlled in slug path. | Сохранить ASCII slug, без UUID/hex в public URL; все ссылки строить через builders. |
| 14. Canonical | already_implemented | `alternates.canonical` in article/category/source/archive/guide pages; hard production domain in `lib/site.ts`; redirects in legacy routes. | Использование env domain в SEO links запрещено проектом. | Сохранить `SITE_URL = https://news.malakhovai.ru` as canonical source. |
| 15. Open Graph | already_implemented | Root metadata in `app/layout.tsx`; article OG in `app/categories/[category]/[slug]/page.tsx`; guide OG in `app/guides/[slug]/page.tsx`; category/source/archive OG. | Some listing pages omit explicit image; root fallback applies. | Для article/guide always provide title, description, url, image fallback. |
| 16. Twitter Card | already_implemented | Root and article/guide/category metadata include `twitter.card = summary_large_image`; `twitter:url` set through `other`. | Some non-article pages do not set Twitter image explicitly. | For article/guide keep `summary_large_image`; listing pages can rely on site fallback unless a custom image exists. |
| 17. Article / NewsArticle / BlogPosting JSON-LD | already_implemented | News `NewsArticle` in `app/categories/[category]/[slug]/page.tsx`; guide `Article` in `app/guides/[slug]/page.tsx`; root Organization/WebSite in `app/layout.tsx`. | News publisher logo uses `/og-default.png` in page JSON-LD, while `SITE_LOGO_URL` exists for Organization. | Keep current schema; consider aligning NewsArticle publisher logo with `SITE_LOGO_URL` later. |
| 18. FAQPage schema при наличии FAQ | partially_implemented | Guides have `faq` in `lib/guides.ts` and `FAQPage` in `app/guides/[slug]/page.tsx`; news articles have no FAQ field/render. | Adding FAQPage to news without visible FAQ would be invalid. | FAQPage allowed only for visible guide/manual FAQ. News FAQ requires schema/render changes first. |
| 19. Изображение 16:9 | partially_implemented | Guide cover is `1200x675` in `lib/guides.ts`; sitemap and OG use it. News cover is source/fallback `cover_image_url`; render dimensions are `1200x460`, not guaranteed 16:9. | Requiring 16:9 source image for every news article conflicts with RSS source realities. | Mandatory 16:9 for evergreen/local generated covers; recommended for news fallback covers. |
| 20. Изображение 1:1 для соцсетей | missing | Не найдено отдельного 1:1 social image pipeline or metadata. | Требование 1:1 не используется Next metadata сейчас. | Defer: оставить future improvement for social assets/OG variants. |
| 21. `og:image` | already_implemented | News uses sanitized cover or `/og-default.png`; guide uses `guide.cover`; root has `/og-default.png`. | Source covers can be blocked by external hosts or be low quality; sanitizer mitigates. | Keep fallback rule; generated/local covers preferred for evergreen and important cards. |
| 22. Alt-текст | partially_implemented | Article cover `alt={title}`; inline images use extracted `alt` or fallback title; guides have explicit alt per image in `lib/guides.ts`. | Source image alt may be empty/generic; cover alt=title is acceptable fallback but not descriptive. | Mandatory descriptive alt for evergreen/local/generated images; news source images may use title fallback. |
| 23. Человекочитаемое имя файла изображения | partially_implemented | Guide images use readable local names under `public/images/guides/<slug>/`; generated fallback docs mention storage prefixes in `docs/ARTICLE_SYSTEM.md`. | News source images are external and cannot be renamed; generated storage filenames need script-specific handling. | Require readable filenames for local guide/generated assets; not applicable to external source images. |
| 24. Сжатие изображений | partially_implemented | `sharp` dependency exists; guide images are WebP; docs describe WebP fallback in Supabase Storage (`docs/ARTICLE_SYSTEM.md`). | No universal compression gate visible for all source images. | Keep WebP for generated/local assets; do not block source images solely for compression. |
| 25. Источники и фактчекинг | already_implemented | Source URL/name stored in `articles`; source attribution renders on article page; `pipeline/claude.ts` is source-grounded; `/sources` surface exists. | Prompt allows adding known context, which can become unsupported if not constrained. | Standard: facts, numbers and claims must come from source or explicitly safe context; speculative context must be labelled. |
| 26. Разделение фактов, оценок и гипотез | partially_implemented | Editorial prompt requires facts from source and context; `docs/editorial_style_guide.md` bans ambiguity. Explicit fact/opinion/hypothesis labels not found. | High-risk topics (money/legal/medical/geopolitics) need stricter separation than current article format. | Add rule to standard; route high-risk claims through validation/reviewer when available. |
| 27. Правила использования AI-generated content | partially_implemented | `pipeline/claude.ts` defines strict JSON, banned phrases, grounding; `validateEditorialDetailed()` and `editorial-repair.ts` enforce shape; `docs/editorial_style_guide.md` is prompt source. | No public disclosure policy or human review step for all AI-generated news. | Standard should focus on source-grounding, no fabricated facts, validator gates, and human review for evergreen/high-risk manual materials. |
| 28. Внутренние ссылки | already_implemented | `link_anchors` from editorial output; `resolveAnchorLinks` and body linking in article page; guide related links in `lib/guides.ts`; `ArticleSectionNav`. | Auto anchors can miss or over-link; validator checks anchor text appears in body, not topical quality. | Keep 0-3 contextual anchors; avoid generic anchors; add manual links in guides. |
| 29. Ссылки на категории | already_implemented | Breadcrumb category link in article page; `ArticleSectionNav`; `TopicTabs`; canonical category pages. | Legacy `topics` badges still render in sidebar, while canonical category uses `primary_category`. | Standard: canonical category link = `primary_category`; legacy topics are display-only until cutover. |
| 30. Ссылки на связанные статьи | already_implemented | `getArticleRecommendations(article, 3)` and `ArticleRecommendations` on article page. | Ranking is deterministic but not manual editorial curation. | Keep automatic recommendations; for evergreen/manual add hand-picked related links. |
| 31. Ссылки на выпуски дайджеста | not_relevant | Public digest issue pages/entities not found. `digest_runs` is operational, Telegram digest uses articles. | Requiring issue links would create links to non-existing public surface. | Do not include as mandatory. Future only if public digest issue pages are added. |
| 32. CTA | already_implemented | `TelegramCTA` on news article pages; guide CTAs in `app/guides/[slug]/page.tsx`. | CTA should not obscure content or become repetitive. | Keep compact Telegram/newsletter style CTA; for guides allow practical CTA. |
| 33. Sitemap | already_implemented | `app/sitemap.ts` includes static routes, guides and live articles; `revalidate = 1800`; `getAllArticlesForSitemap()`. | Freshness depends on ISR and live filters; DB/env errors can reduce sitemap. | Keep ISR sitemap; only live/verified/quality articles should appear. |
| 34. Robots/indexing status | already_implemented | `app/robots.ts` allows public site, disallows `/demo/`, `/internal/`, `/api/`, `/_next/`; page metadata has default index/follow; demo/internal noindex. | Need avoid accidental noindex on public article/guide routes. | Standard checklist includes robots/indexing verification before publishing new templates. |
| 35. Страница отдаёт 200 | already_implemented | `pipeline/publish-verify.ts` HEAD-checks publish_ready URLs; RPC promotes to `live`; live samples monitor regressions; internal verify route exists. | `scripts/check-links.ts` still checks legacy `/articles/<slug>` paths, not canonical category URLs. | Keep publish verify; update link-check script later to canonical URLs. |
| 36. Проверка мобильной версии | missing | Responsive classes exist in page components, but no mobile SEO QA checklist or automated screenshot test found. | Manual-only verification can miss layout regressions. | Add to standard as mandatory for evergreen/manual template changes; future Playwright/mobile smoke for article templates. |
| 37. Проверка битых ссылок | partially_implemented | `scripts/check-links.ts` exists; README documents it. Publish verify checks articles. | `scripts/check-links.ts` builds `/articles/<slug>` legacy URL and does not check internal/external links inside article content. | Use publish verify for article URL liveness; future update check-links to canonical URLs and content links. |
| 38. Отправка URL в Google Search Console | defer | No GSC API integration found. Sitemap is in place; docs/wave SEO mentions manual GSC monitoring. | API/manual submission depends on owner account access. | Defer as manual post-publication step; Google uses sitemap meanwhile. |
| 39. Отправка URL в Яндекс Вебмастер | partially_implemented | `lib/indexnow.ts`, `app/indexnow.txt/route.ts`, `pipeline/publish-verify.ts` ping IndexNow for Yandex/Bing. | IndexNow is not identical to manual Yandex Webmaster URL submission; missing key means no-op. | Treat IndexNow as automatic Yandex/Bing notification; manual Yandex Webmaster check remains recommended. |
| 40. Проверка индексации через 24-72 часа | defer | `docs/wave_seo_indexation_2026-05-09.md` documents manual monitoring; no automation found. | Requires external webmaster tools. | Add manual post-publication checklist for important evergreen/manual URLs. |
| 41. Проверка CTR и показов через 7-14 дней | defer | No Search Console/Yandex API integration found. | Requires external analytics/search console access. | Add manual review for evergreen/manual articles; not mandatory for every RSS-news item. |
| 42. Обновление evergreen-статей | partially_implemented | Guide metadata has `updatedAt`; sitemap guide routes use `lastModified` and `monthly`; content in `content/guides`. | No scheduled review cadence or owner process found. | Standard should require update log/cadence for evergreen guides and update existing guide over duplicate. |
| 43. Финальный чек-лист "можно публиковать" | missing | Quality gates exist (`quality_ok`, validator, publish verify), but no human-readable SEO publication checklist. | Without a checklist, manual evergreen changes can skip canonical/images/schema checks. | Create `docs/editorial/seo-article-publication-standard.md` with checklist. |
| 44. Статус готовности материала к публикации | already_implemented | `publish_status` enum in migrations and `lib/supabase.ts`; `quality_ok`, `publish_ready_at`, `verified_live`, `published_at`; RPC `publish_article`. | Legacy `published` boolean still exists for compatibility and can confuse new logic. | Standard should use status fields, not legacy boolean alone: publishable = `quality_ok=true`, `publish_status='live'`, `verified_live=true`, `published=true`. |

## 5. Main Adoption Decisions

1. **Do not turn the candidate checklist into a blocking rule for every RSS-news item.** The automated pipeline publishes many short factual news articles; full SERP/competitor/keyword brief belongs to evergreen and manual long-form work.
2. **Use existing architecture for metadata.** News articles use `ru_title`, `card_teaser`, `lead`, `slug`, `cover_image_url`, `primary_category`; guides use `lib/guides.ts` metadata.
3. **Canonical URL policy is already strong.** The standard must preserve `news.malakhovai.ru`, `SITE_URL`, `getArticlePath()` and primary category canonical.
4. **FAQ is guide/manual only for now.** News articles have no FAQ field/render; adding FAQPage schema to news without visible FAQ would be a schema risk.
5. **Indexing is mostly implemented technically.** Sitemap ISR and IndexNow exist; Google Search Console and Yandex Webmaster checks remain manual/post-publication steps.
6. **The main gap is editorial SEO planning.** Primary query, intent, cannibalization, competitor analysis and evergreen update cadence need a documented process rather than immediate schema changes.

## 6. Recommended Immediate Standard

Create `docs/editorial/seo-article-publication-standard.md` as the current standard for Claude/Codex and human editing. It should:

- be mandatory for evergreen guides and manual long-form materials;
- adapt automated RSS-news requirements to the existing `articles` pipeline;
- distinguish mandatory, recommended and future rules;
- point to concrete implementation files instead of inventing a CMS model;
- avoid DB/schema requirements until a later dedicated migration.
