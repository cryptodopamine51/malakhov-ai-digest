# Malakhov AI Digest — Control Plane

> Главный управляющий файл проекта.
> Он не подгружается автоматически “из памяти” между сессиями: в начале каждой новой работы его нужно открыть явно или запустить `npm run context`.
> Последнее обновление: 2026-06-11

Текущая инициатива (open 2026-06-11): **Монетизация: Admitad + Метрика + money-контент** —
`docs/spec_2026-06-11_monetization_execution.md`. Выполнено 2026-06-11: B1 (Admitad meta-тег
`verify-admitad: c970c0609c` в `app/layout.tsx`), B4 (Cursor-статья — title/lead/body обновлены
под запрос «оплатить cursor», FAQ добавлен). B3 заблокирован: OAuth-токен `YANDEX_METRIKA_OAUTH_TOKEN`
имеет только `metrika:read`; curl-команды и инструкция для владельца — `docs/OPERATIONS.md`.
Ждёт: A2 (owner: кнопка верификации Admitad после деплоя), B3-разблокировка (токен с write-правами).

Предыдущая инициатива (open 2026-06-10): **Полный аудит дайджеста: техника + SEO + развитие** —
`docs/spec_2026-06-10_digest_full_audit.md` (метрики: `docs/baseline_2026-06-10.md`).
Дополнение 2026-06-11: по `docs/spec_2026-06-11_cost_quality_wave.md` закрыты только W1–W3:
batch-cost учитывает Anthropic Batch discount, risk-флаги сужены, premium source text cap включён,
год-санитайзер применён к article body, DeepSeek repair-pass стоит перед дорогим retry,
Anthropic degraded-mode авто-включается через `anthropic_unavailable`, добавлены daily
LLM-judge и one-tap owner feedback. W4–W6 не тронуты.
Оба P0-инцидента **разрешены 2026-06-10 вечером**:
1. **Anthropic credits** — владелец пополнил billing → retry-failed зелёный (ручной dispatch
   проверен), очередь pending разобрана, 23 публикации за день и растёт. Stale-алёрты
   (`batch_submit_failed` ×4, `claude_parse_failed`) закрыты в `pipeline_alerts`.
2. **Telegram channel posts** — pg_cron ожил: план на 2026-06-10 создан, слот 5 отправлен
   21:00 МСК (success). Новый монитор `tg_channel_posts_missing` за время инцидента отработал
   корректно (critical в 20:43), закрыт после восстановления.
Сделано агентом (фаза 1, аудит): верификация тех-долга senior review (CI ✅, npm test ✅);
off-topic волна 2 — снято **37** consumer-статей; Lighthouse-замеры (LCP главной 9,3 с);
закоммичена обложка гайда id 4.
Сделано агентом (фаза 2, волна реализации 2026-06-10):
- **Cover mirroring**: внешние hotlink-обложки зеркалятся в R2 (WebP 1200w + варианты -400/-800) —
  `pipeline/cover-mirror.ts` в `prepareEditorialApplication` + backfill
  `scripts/mirror-covers-to-r2.ts` (**913/919 live зеркалировано**; 958 KB JPEG → 107 KB base /
  5,9 KB mobile-вариант). R2-env добавлен в enrich/collect/retry workflows. `remotePatterns`
  сужен до R2 + own domain; оптимизатор Vercel остаётся выключенным намеренно (лимит Hobby).
- **Per-source daily cap** (`SOURCE_DAILY_PUBLISH_CAP`=10, MSK-день) в `claimBatch` — против
  перекоса Habr (39% потока). Тесты source-daily-cap 5/5.
- **Importance в отбор channel posts**: `rankDigestCandidates` подключён в `buildChannelPostPlan`
  (раньше только в legacy-дайджесте).
- **Монитор молчания канала**: `pipeline/tg-channel-monitor.ts` в pipeline-health (critical
  `tg_channel_posts_missing`, если к 13:00 МСК ноль success). Тесты 6/6.
- **Год-санитайзер captions** (`hasStaleYearHallucination`) — ловит «WWDC 2025»-галлюцинации.
- Починен `scripts/audit-digest-selection.ts` (узкий select вместо `*`); удалены остатки
  `legacy/` и `local_dev.db` с диска; схема веток задокументирована в OPERATIONS.md → Deploy.
Сделано агентом (фаза 3, SEO growth x2 — `docs/task_seo_growth_x2_2026-06-10.md`, P0–P2):
- **Sitemap cap снят**: `getAllArticlesForSitemap()` пагинирует Supabase `.range()` страницами
  по 1000 (раньше REST-лимит молча резал ~623 URL). Тест `tests/node/sitemap-pagination.test.ts`.
- **Гайды id 7/9 открыты для индексации**: настоящие обложки (138/131 KB), `noindex: false`,
  `evergreen:check` ok. Кластер «ИИ-агенты» теперь в индексе.
- **Pillar-гайд `kak-vnedrit-ii-v-biznes-2026` доведён до стандарта**: восстановлен evergreen
  package, SEO-имя обложки (124 KB), 2 inline internal links, чистка «AI-*»-формулировок,
  `verifiedAt: 2026-06-10`, `evergreen:check` ok.
- **Guide bridge стал контентным**: `getGuideBridgeForArticle()` — агентные новости ведут на
  гайды кластера «ИИ-агенты» (sales-сигнал → id 9), остальное — по категории как раньше.
  Тест `tests/node/guide-bridge.test.ts`.
Открытые рычаги за владельцем: цели Метрики, R2 custom domain, агрегаторы, Supabase Free/Pro
решение. Следующие волны SEO x2: P3 (link_anchors в свежих статьях), P4 (5–8 новых гайдов).

Предыдущая инициатива (closed 2026-05-30): **Telegram digest story dedup + selection guard**. Триггер от владельца: в двух последних Telegram-дайджестах один инфоповод про раунд Anthropic попал три раза (Crunchbase/TechCrunch/The Decoder). Корень: `dedup_hash` различает article rows по title+URL, `applyDiversityCap` ограничивал только `source_name`, а `tg_sent` защищал только конкретную строку, не событие и не соседний MSK-день.
- Новый `bot/digest-selection.ts`: deterministic `deriveDigestStory()` строит `storyKey = primaryEntity:eventType:signature` (пример `anthropic:funding:65b`), различает `Anthropic funding` и `Claude Opus 4.8 model_release`, нормализует money anchors `$65B`/`65 млрд`/`$650M`.
- `runDailyDigest()` теперь берёт top-50, после live-check вызывает `selectDigestArticles()` с `perSourceCap=2`, `perPrimaryEntityCap=2`, `target=5`, загружает recent memory последних successful `digest_runs.article_ids` за 72 часа и пропускает strong `storyKey`, уже отправленный недавно. `validateDigestComposition()` логирует duplicate story keys/source/entity distribution/skipped reasons перед отправкой.
- Добавлен read-only audit: `npm run digest:audit-selection -- --date=2026-05-30` / `--days=14`. На incident-датах: 2026-05-29 второй Anthropic funding skip=`duplicate_story`; 2026-05-30 The Decoder funding skip=`recent_story_duplicate`, Claude Opus остаётся.
- Deploy follow-up: Vercel build упал на unrelated 60s SSG page timeout из-за article recommendations. `app/categories/[category]/[slug]/page.tsx` теперь пропускает `getArticleRecommendations()` только во время `npm run build`; runtime ISR считает рекомендации как раньше.
- Тесты: `tests/node/digest-story-dedup.test.ts` + existing digest idempotency/diversity/completeness. Canonical docs обновлены: `docs/ARTICLE_SYSTEM.md`, `docs/OPERATIONS.md`. План/аудит: `docs/spec_2026-05-30_digest_story_dedup.md`.

Предыдущая инициатива (closed 2026-05-26): **Cover storage переезд Supabase Storage → Cloudflare R2** (инцидент `exceed_egress_quota`). Триггер: Supabase заблокировал проект за превышение egress-квоты (Free 5 GB/мес) → весь cron-pipeline упал (RSS/Enrich/Collect Batch/Covers/Health/Retry/Publish Verify). Корень: Vercel Hobby image-лимит исчерпан 2026-05-22 → `next.config` `images.unoptimized=true` → полноразмерные обложки отдавались посетителям прямо из метрического Supabase egress → выжгли 5 GB за ~3 дня. R2 (egress бесплатен) убирает этот класс отказа.
- Новый `lib/r2.ts` — S3-совместимый слой (`@aws-sdk/client-s3`): `uploadToR2`, `isR2Configured`, `r2PublicUrl`. Ключи объектов префиксуются `article-images/`, чтобы публичный URL содержал `/article-images/...` (нужно для `classifyCover`/`needsAiCover` и `isArticleImagesStorageUrl`).
- Upload переведён на R2 в `pipeline/image-generator.ts`, `scripts/generate-ai-covers.ts`, `scripts/backfill-template-covers.ts`, `scripts/backfill-stock-covers.ts`, `scripts/replace-test-covers-with-editorial-templates.ts`. `lib/media-sanitizer.ts::isArticleImagesStorageUrl` теперь распознаёт и legacy Supabase-storage URL, и R2-домен (env `R2_PUBLIC_BASE_URL` + fallback `*.r2.dev`). Тесты `media-sanitizer.test.ts` 23/23 pass; smoke-test R2 (PUT→public GET→DELETE) зелёный.
- `scripts/migrate-covers-to-r2.ts` (новый) — переносит существующие Supabase-storage обложки в R2 и переписывает `cover_image_url`. **Требует разблокированного Supabase** (сейчас падает на `exceed_egress_quota`).
- R2-секреты (`R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET/PUBLIC_BASE_URL`) добавлены в GitHub Actions secrets и оба env-блока `ai-covers.yml`, в `.env.local` и `.env.example`. `R2_PUBLIC_BASE_URL` сейчас `pub-*.r2.dev` (dev-URL, rate-limited; прод — custom domain).
- **Резолюция (2026-05-26):** владелец апгрейднул Supabase до Pro → блок снят. Прогнана миграция `scripts/migrate-covers-to-r2.ts`: **migrated=453, failed=0** — все legacy Supabase-storage обложки на R2, `cover_image_url` переписаны (проверено: live feed отдаёт `pub-*.r2.dev/article-images/...`, cover GET 200). Все упавшие workflow'ы перезапущены и зелёные (RSS/Enrich/Collect Batch/Publish Verify/Retry/Health). Сайт и pipeline восстановлены. После переезда egress Supabase должен стать крошечным → можно вернуться на Free (проверить egress за обычный день).
- **Операционный урок:** прод-редеплой при egress-заблокированном Supabase **стирает защитный stale ISR-кеш** → страницы рендерятся пустыми (`/api/feed` total:0), хотя данные в БД целы. Не делать прод-деплой, пока Supabase под рестрикшеном; если кеш уже сброшен — восстановление только через разблокировку Supabase + редеплой (откат Vercel на тёплый кеш на Hobby недоступен: «upgrade to pro»).
- Docs updated: `docs/ARTICLE_SYSTEM.md` (Cover image — R2 + migration note), `docs/OPERATIONS.md` (env `R2_*`, cover-секции, новая «Cover storage: Supabase → R2 migration»), `.env.example`, `CLAUDE.md`.

Предыдущая инициатива (closed 2026-05-23, morning): **Wave 4 scene matcher + recent rescore + broader cover backfill + sanitizer stock-placeholder filter**. Закрытие хвостов после `spec_2026-05-22_digest_editorial_priority.md`:
- `scripts/generate-ai-covers.ts::chooseScene` теперь context-aware. До старой regex-цепочки три двойных-сигнала: `PRODUCT_LAUNCH_NOUN_RE + ANNOUNCEMENT_VERB_RE` → `product_launch` (tactile hardware close-up); `MODEL_RELEASE_RE + ANNOUNCEMENT_VERB_RE` → `model_release` (foundation-model launch tableau); `PEOPLE_NEWS_RE` → `people_news` (institutional silhouettes). Убирает типичный фейл «Russian enterprise operations room» для Flipper-подобных материалов. Hardware-toкens: устройство/девайс/гаджет/карманн/компьютер/ноутбук/смартфон/очки XR/часы/наушник/чип/процессор/ускорител/робот/шлем + EN equivalents + GPU/TPU/ASIC/accelerator. Файл получил CLI-entry guard: `main()` запускается только при прямом вызове, импорт из тестов не дёргает DB. Тесты `tests/node/scene-matcher.test.ts` (7/7 pass).
- `scripts/rescore-recent.ts` (новый) — пересчёт `articles.score` по текущей формуле для live-статей последних N дней. Применён за 3 дня: 77 из 86 статей получили новый score (16 −3, 36 −1, 22 +1, 2 +3, 1 +4 — Spotify launches с AI mention, 1 −4 — Hugging Face Blog без specific lab token в title). Habr-материалы массово упали с 6 до 3 — теряют дублирование `ai-russia +2`/`source_lang=ru +1` и raw-длину; индустриальные launch-стори с AI-lab text-match + announcement bundle поднимаются. Эффект — ближайший дайджест возьмёт обновлённые score без ожидания нового ingest.
- `scripts/backfill-cover-from-inline.ts` — broader apply: 28 статей из 36 кандидатов получили обратно настоящие cover'ы (Habr habrastorage, leonardo.osnova, source CDN). 8 статей оставлены на AI-cover: 2 CNews со stock-плейсхолдером, 6 без usable inline.
- `lib/media-sanitizer.ts` — новый reject code `stock_placeholder` для URL-паттерна `gemini_generated_image|ai_generated_image`. CNews повторно использует один такой URL для разных статей; без фильтра broader backfill промоутил бы одну и ту же картинку как cover для нескольких неродственных материалов. См. `docs/ARTICLE_SYSTEM.md` Media sanitizer.
- Doc impact: `docs/OPERATIONS.md` (Cover-from-inline backfill — счётчики/итоги; `scripts/generate-ai-covers.ts` после Wave 2/4 — scene matcher и CLI guard; Re-score recent articles — новая секция), `docs/ARTICLE_SYSTEM.md` (Media sanitizer — `stock_placeholder` reject), `docs/spec_2026-05-22_digest_editorial_priority.md` (Wave 4 теперь closed, не deferred).

Предыдущая инициатива (closed 2026-05-22, night): **Image pipeline quality + SEO filename convention + smart matching**. Триггер от владельца: «места где картинки не подгрузились» на `/guides/ii-dlya-malogo-biznesa-s-chego-nachat`. Корневая причина — `WEBP_QUALITY=82` без `effort`/`subsample` tuning давал compression ~50× на ChatGPT-иллюстрациях 1200×800 (output 27–44 KB вместо нормальных 60–100 KB) → visible artifacts, выглядит как «не загрузилось».
- `scripts/images-prep.ts` переписан. Quality split: `COVER_WEBP_QUALITY=90`, `INLINE_WEBP_QUALITY=88`, `WEBP_EFFORT=6`, `smartSubsample=false` (full 4:4:4 chroma — критично для графики с тонкими линиями и текстовыми метафорами). Новая функция `planFiles` делает два прохода: pass 1 — точный stem-матч PNG к meta slot'у, pass 2 — оставшиеся random-имена (`ChatGPT_image_<ts>.png`) маппятся по алфавитному порядку на declared meta order (cover → inline в порядке `inlineImagesByHeading`). Лог печатает `renamed ← <random.png>` для каждого замапленного файла. Владельцу больше не нужно вручную переименовывать PNG из ChatGPT.
- `tests/node/images-prep.test.ts` — 10 тестов (resolveDimensions, buildMetaSlots, indexMetaByFilename, planFiles smart matching по 3 сценариям). 10/10 pass.
- Re-prep id 3 (`ii-dlya-malogo-biznesa-s-chego-nachat`): cover 38→63 KB, pilot-30-days-roadmap 44→61 KB, scenarios-grid 27→33 KB, when-not-to-start 36→51 KB. Total 145→208 KB на странице.
- **SEO filename convention** (owner decision 2026-05-22). Cover = `<slug>-cover.webp`, inline = `<slug-short>-<section-keyword>.webp` (ASCII, lowercase, hyphens, ≤ 60 символов; без generic `cover.webp`, `image1.webp`). Применяется к новым гайдам с этой сессии; 3 уже опубликованных (`kak-vnedrit-ii-v-biznes-2026`, `skolko-stoit-vnedrenie-ii-v-kompaniyu`, `ii-dlya-malogo-biznesa-s-chego-nachat`) — generic names оставлены, чтобы не ломать production-URL'ы и OG-image references.
- Doc impact: `docs/editorial/seo-article-publication-standard.md` (новая секция `SEO filename convention` в §11, workflow обновлён под smart-matching и новые quality settings), `docs/OPERATIONS.md` (Evergreen image workflow, история quality), `content/evergreen/templates/{image-brief,editorial-pass}.template.md`, `articles ever green/Проект 1/Промпт-для-создания-одной-статьи.txt`, `articles ever green/Проект 2/Промпт-для-финальной-редактуры.txt`.

Предыдущая инициатива (closed 2026-05-22, late evening): **Digest editorial priority + cover fix** —
`docs/spec_2026-05-22_digest_editorial_priority.md`. Закрыты Wave 1 (scorer rebalance +
diversity-кэп), Wave 2 (cover preference fix) и Wave 3 (Google Blog feed).
- `pipeline/scorer.ts` переписан. Убрано удвоение `ai-russia +2` + `source_lang=ru +1`
  (теперь только `ai-russia +1`). Детектор AI-лабораторий/продуктов работает по
  `original_title` / `ru_title` / первому килобайту `original_text` через Unicode word-boundary
  (`\P{L}`): openai/chatgpt/gpt-N/sora/anthropic/claude/deepmind/gemini/veo/imagen/mistral/
  cohere/xai/grok/llama/nvidia/blackwell/copilot/phi-N/yandexgpt/gigachat → `+2`. Major-announcement
  bundle (`+2` поверх AI-lab match): EN-глаголы unveils/launches/announces/releases/introduces/
  debuts + ru-стемы `представ`/`запусти`/`запуска`/`анонсир`/`выпустил`/`выпустит` в заголовке.
  Длина `editorial_body > 1000` (а не raw text). Обложки `/article-images/(ai|template|stock)-covers/`
  больше не дают `+1` — fill-in не сигнал качества. Тесты `tests/node/scorer.test.ts`.
- `bot/daily-digest-core.ts` — diversity-кэп: SELECT расширен до top-25,
  `applyDiversityCap(perSourceCap=2, target=5)` режет не более 2 статей с одного `source_name`.
  Без этого Habr AI забирал 4–5 из 5 слотов и заталкивал индустриальные сюжеты ниже. Тесты
  `tests/node/digest-diversity.test.ts`.
- `pipeline/feeds.config.ts` — добавлен `Google Blog` (`blog.google/technology/ai/rss/`,
  `needsKeywordFilter: true`, `EN_AI_CORE_KEYWORDS`, title-only). Раньше Google product-анонсы
  долетали через посредников.
- `scripts/generate-ai-covers.ts::needsAiCover()` переписан: источник истины —
  `sanitizeArticleMedia` со ВСЕМ доступным медиа (cover + `article_images`). Если sanitizer
  промоутил inline или валидировал исходный cover — AI не генерируем. Хардкод
  `['Habr AI','vc.ru','vc.ru AI/стартапы','CNews']` убран. SELECT теперь тащит `article_images`.
- `lib/media-sanitizer.ts::CONTEXTUAL_IMAGE_SOURCE_RE` — добавлен `vc\.ru`, чтобы inline-картинки
  vc.ru с generic-caption проходили sanitizer.
- `scripts/backfill-cover-from-inline.ts` (новый) — сканирует статьи с AI-cover и непустым
  `article_images`, прогоняет sanitizer'ом, заменяет AI-cover на promoted-from-inline.
  Применено к Flipper-статье (`flipper-devices-vypustila-karmannyy-linux-kompyuter-flipper`)
  — на странице теперь реальное фото устройства из `leonardo.osnova.io`. Broader backfill за
  ~24 другие статьи (преимущественно Habr) on hold — владелец решает после spot-check.

Wave 4 (context-aware scene-matcher в `chooseScene`) перенесён в отдельную итерацию: фикс из
Wave 2 уже устраняет основную боль (AI-cover поверх продуктовых фото); сцена для редких
оставшихся AI-обложек — secondary улучшение.

Doc impact этой сессии: `docs/ARTICLE_SYSTEM.md` (Score and publish gate с новой формулой,
Telegram digest selection с diversity-кэпом, Cover image с новым `needsAiCover` и backfill,
Sources с Google Blog и `vc.ru` в `CONTEXTUAL_IMAGE_SOURCE_RE`), `CLAUDE.md` (это резюме),
`docs/spec_2026-05-22_digest_editorial_priority.md` (план).

Предыдущая инициатива (closed 2026-05-22, evening): **Evergreen series burst #1** — за одну сессию закрыты 4 новых гайда серии «ИИ для бизнеса» (id 3–6 из `content/evergreen/topics.json`), все по новому quality bar:
- **id 3** «ИИ для малого бизнеса: с чего начать» (`/guides/ii-dlya-malogo-biznesa-s-chego-nachat`) — package сделан в соседнем чате, опубликован под `noindex: true` + placeholder cover.
- **id 4** «Какие бизнес-процессы автоматизировать с помощью ИИ» (`/guides/kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii`) — матрица 4 фильтров, 10 сценариев, кейс агентства, worked example поддержки интернет-магазина.
- **id 5** «Ошибки внедрения ИИ в компании» (`/guides/oshibki-vnedreniya-ii-v-kompanii`) — анти-гайд из 10 ошибок по стадиям, кейс провала B2B SaaS, worked example цены ошибки лимита API (1,45 млн ₽ за выходные).
- **id 6** «Как выбрать первый ИИ-проект в бизнесе» (`/guides/kak-vybrat-pervyj-ii-proekt-v-biznese`) — взвешенный скоринг 7 критериев / 100 баллов, 12 типовых кандидатов с оценками, кейс дистрибьютора, worked example скоринга для отзывов.
Все четыре package'а полные (12 файлов), `evergreen:check` проходит с единственным cover-warn (12 KB placeholder, ждёт ChatGPT-генерации владельцем). `npm run build` exit 0. `topics.json`: id 3–6 переведены в `ready_for_codex`. Cover-генерация и снятие `noindex` — owner step.

Предыдущая инициатива (closed 2026-05-22, morning): **Evergreen open-questions closure** — `docs/spec_2026-05-21_evergreen-quality-standard.md` §9, §10, §13. Ответы владельца:
- **CTA**: чеклист-lead-magnet выпилен; разрешённые поверхности — `telegram-digest` (`@malakhovaidigest`), `contacts` (`malakhovai.ru/contacts`), `telegram-personal` (`@malakhovai`). `DEFAULT_FINAL_CTA_CARDS` в `app/guides/[slug]/page.tsx` и meta `kak-vnedrit-ii-v-biznes-2026.json` перешиты на эти три слота. CTA нельзя обещать артефакты, которых нет.
- **Indexation**: `noindex: true` — транзиентное состояние «нет cover», снимается сразу после готовности cover + `npm run images:prep` + `evergreen:check` green. Никакого 3–7-дневного review-окна.
- **Worked example**: только статический Markdown, без React Client Components / интерактивных калькуляторов.
- **Russian white-list (внутренний, не публиковать)**: Tier 1 — Яков и Партнёры, НИУ ВШЭ ИСИЭЗ, TAdviser, CNews Analytics. Tier 2 — Sber/SberAI blog, Yandex Research. Tier 3 — Forbes Russia, Ведомости.Технологии. С пометкой «фактчекать»: Habr, vc.ru. Исключены: РБК Тренды, Коммерсант. Полный список с обоснованиями — в `docs/editorial/seo-article-publication-standard.md` §12.
- **Темп выпуска**: владелец сам решает; опционально планируется auto-draft pipeline через `mcp__scheduled-tasks__create_scheduled_task` (см. §13 spec'и). Узкое место — cover в ChatGPT-подписке — остаётся ручным. MCP-мост в ChatGPT не строим (нет публичного API; через Chrome MCP шатко).

Doc impact этой сессии: `app/guides/[slug]/page.tsx`, `content/guides/meta/{kak-vnedrit-ii-v-biznes-2026,skolko-stoit-vnedrenie-ii-v-kompaniyu}.json`, `docs/spec_2026-05-21_evergreen-quality-standard.md` (§9 closed, §10 DoD updated, §13 added), `docs/editorial/seo-article-publication-standard.md` (CTA rule, noindex policy, worked-example rule, white-list §12), `docs/editorial_style_guide.md` (CTA / indexation / white-list lines), `content/evergreen/templates/{codex-publication-task,publication-checklist,editorial-pass}.template.md`, `articles ever green/Проект 1/Промпт-для-создания-одной-статьи.txt`, `articles ever green/Проект 2/Промпт-для-финальной-редактуры.txt`.

Предыдущая закрытая инициатива: **Evergreen quality wave (2026-05-21)** — `docs/spec_2026-05-21_evergreen-quality-standard.md`. Поднимает планку для серии из 30 evergreen-гайдов (после выпуска `skolko-stoit-vnedrenie-ii-v-kompaniyu`): обязательны factual anchor в первом предложении лида, видимая «Актуальность проверена: <дата>», numerical worked example, развёрнутый кейс с маркером источника, counter-strategy H2 «Когда не стоит / не окупится», ≥ 2 inline-ссылок в теле, CTA cap (≤ 2 inline + 1 final-блок с 3 карточками), 152-ФЗ + GigaChat/YandexGPT в российском контексте. Реализовано: `GuideMeta` получает обязательное `verifiedAt` и опциональное `caseSourcing`; `app/guides/[slug]/page.tsx::buildJsonLd` теперь эмитит `author = Person` (`/about#person`), `wordCount`, `articleSection`, `keywords`; mobile TOC сворачивается в `<details>`; `scripts/evergreen-check.ts` дополнен 10 правилами (lead anchor, verifiedAt, case/counter-strategy/inline links, CTA cap, cover ≥ 80 KB, noindex старше 14 дней); `scripts/images-prep.ts` + `npm run images:prep` конвертирует PNG из ChatGPT в production-WebP (cover 1200×675, inline 1200×800/1200×1200, quality 82). Cost-статья переписана по новому стандарту (factual anchor, кейс «AI-квалификация лидов (Редакционный пример)», H2 «Когда внедрение ИИ не окупится», доп. inline-link в `/categories/ai-industry`); cover остаётся 12 KB до ручной регенерации владельцем через ChatGPT (warn остаётся, errors — нет). Картинки делаются только через подписку ChatGPT/Codex; image API не используется. Шаблоны (`image-brief`, `editorial-pass`) и промпты «Проект 1 / Проект 2» обновлены под новый bar.

Предыдущая закрытая инициатива: **SEO improvements wave (2026-05-20→05-21)** — см. `docs/spec_2026-05-20_seo_improvements_wave.md` (план + лог сессий) и `docs/spec_2026-05-20_seo_improvements_wave_progress.md` (подробный per-iteration журнал). Включает (API spend = 0):
- ISR-кеш для главной, `/russia`, `/categories/[category]` через убирание `searchParams` со страниц + Load-more клиент (`HomeFeedList` + `/api/feed`);
- off-topic blocklist (`OFF_TOPIC_KEYWORDS`) перед per-feed keyword filter; `ZDNet AI` / `Wired AI` получили `needsKeywordFilter: true`;
- runtime cover fallback в `sanitizeArticleMedia` (промоут первой sanitized inline в cover) + `SITE_LOGO_URL` brand-fallback для `og:image` / `NewsArticle.image` / `publisher.logo`; article cover теперь 1200×630;
- article-level `BreadcrumbList` JSON-LD + `NewsArticle.abstract` / `wordCount` / `articleSection`;
- `/news-sitemap.xml` (Google News, 48h окно, ISR 10м); SEO-title главной + Organization `sameAs` (Telegram); `WebSite.potentialAction: SearchAction` + страница `/search`;
- `robots.txt` с явными allow для 13 LLM-ботов; `/llms.txt` дополнен кластерами и гайдами; `/llms-full.txt` (топ 100 статей + все гайды); `/about` (`AboutPage`); `/sources` (`CollectionPage` / `ItemList`); `/archive/<date>` теперь `noindex, follow`;
- system prompt Claude: `link_anchors 3–5` (soft warning gate); slug cap 75 с word-boundary cut (`pipeline/slug.ts::capSlugAtWordBoundary`);
- `scripts/indexnow-batch.ts` для post-deploy ping (готов к запуску владельцем);
- Person-author swap: `NewsArticle.author`, `Organization.founder` и `/about` mainEntity ссылаются на одного Person (Иван Малахов) с jobTitle, описанием и портретом (`public/about/editor.jpg`).

Предыдущая инициатива: **Site improvements wave (2026-05-06)** — `docs/spec_2026-05-06_site_improvements.md`.

Отложено до подтверждения владельца (см. §6 spec): evergreen guide generation (🟡 API), card_teaser regen Опция B (🟡 API), alt-text generation Опция B (🟡 API), cover-image generation для остатка (🟡 API).

## Как читать проект

Порядок входа в контекст:
1. `CLAUDE.md`
2. `docs/INDEX.md`
3. Канонический документ по нужной области

Если задача затрагивает статьи и pipeline, смотреть `docs/ARTICLE_SYSTEM.md`.
Если затрагивает данные и границы системы, смотреть `docs/ARCHITECTURE.md`.
Если затрагивает деплой, cron, env или recovery, смотреть `docs/OPERATIONS.md`.

## Что это за проект

Русскоязычное AI-медиа с тремя главными задачами:
1. Делать интересные и читабельные материалы, а не бездушный агрегатор.
2. Расти через SEO и постоянный поток evergreen/news контента.
3. Использовать Telegram как основной канал доставки и возврата аудитории.

Критерий качества: материал должен быть достаточно сильным, чтобы его было интересно читать владельцу проекта без скидки на “это просто агрегатор”.

## Текущее production-ядро

| Слой | Текущее решение |
|---|---|
| Сайт | Next.js 15, App Router, Tailwind CSS, Vercel |
| Данные | Supabase PostgreSQL |
| Ingest | RSS → `pipeline/ingest.ts` |
| Enrichment | `editorial:routing --mode=cheap` (DeepSeek-first writer + Claude Sonnet 4.6 selective reviewer / Anthropic Batch fallback). См. `docs/ARTICLE_SYSTEM.md`. |
| Delivery | сайт + Telegram дайджест |
| Проверки | GitHub Actions cron + health/verify/retry workflows |

`legacy/` заморожен. Это не текущий стек и не источник истины.

## Source Of Truth

| Область | Канонический файл |
|---|---|
| Назначение продукта и поверхности | `docs/PROJECT.md` |
| Архитектура и границы системы | `docs/ARCHITECTURE.md` |
| Цикл статьи, media, slug, публикация | `docs/ARTICLE_SYSTEM.md` |
| Runtime, деплой, cron, env, recovery | `docs/OPERATIONS.md` |
| Архитектурные решения | `docs/DECISIONS.md` |
| Дизайн-система | `docs/DESIGN.md` |
| Редакционные правила | `docs/editorial_style_guide.md` |
| SEO-стандарт статей и evergreen-гайдов | `docs/editorial/seo-article-publication-standard.md` |
| **Выпуск evergreen-статьи под ключ** (одна инструкция для агента) | **`docs/EVERGREEN_AGENT.md`** |
| Планирование и backlog | `docs/ORCHESTRATOR.md` |

Правило: одна тема = один канонический файл. Временные `spec_*`, `task_*`, `execution_plan_*`, `roadmap_*` не заменяют канонические документы.

## Необсуждаемые правила работы

1. Перед любыми изменениями сначала определить `docs impact`.
2. Если изменение меняет поведение, архитектуру, pipeline, deploy, data flow, публичные URL, editorial rules или product surfaces, соответствующий канонический doc обновляется в том же заходе.
3. Завершённая задача всегда заканчивается одной строкой:
   - `Docs updated: ...`
   - или `Docs impact: no`
4. Изменение поведения без обновления документации считается незавершённой задачей.
5. Перед новой сессией или сложной задачей запускать `npm run context`.
6. Feature-задачи считаются завершёнными только после production-deploy и post-deploy проверки; не возвращаться только с локальной реализацией, если нет явного запроса “пока не деплой”.

## Документационный цикл

1. Временная спецификация создаётся в `docs/` с датой в имени, если задача большая или исследовательская.
2. После реализации итог переносится в канонический документ.
3. Временный файл остаётся как история работы, но не как текущая правда.
4. Если временный файл начал противоречить каноническому, прав канонический файл.

## Критические инварианты

- Публичный сайт читает из Supabase и не использует service key на клиенте.
- Источником статьи является строка в `articles`; сайт не генерирует контент “на лету”.
- Публичные article URLs должны быть чистыми; legacy-slug адреса только редиректят.
- Новые статьи должны получать релевантные media из исходника, включая видео, если оно тематически подходит.
- Для новых или существенно редактируемых evergreen/manual материалов обязательно применять `docs/editorial/seo-article-publication-standard.md`: SEO-бриф, intent, anti-cannibalization, metadata, image alt, source/fact-checking, internal links и publication checklist.
- Для автоматических RSS-news статей SEO-стандарт применяется только в рамках текущего pipeline contract (`original_url`, categories, `ru_title`, `card_teaser`, `lead`, `slug`, `cover_image_url`, `quality_ok`, `publish_status`). Не требовать ручной SERP/competitor brief перед каждой cron-публикацией.
- Canonical для news-сайта всегда `https://news.malakhovai.ru`; не использовать `malakhovai.ru` или env-derived URL в canonical, sitemap, RSS, `llms.txt`, `og:url` и article links.
- FAQPage schema разрешена только там, где FAQ видим на странице. Для news articles FAQ не добавлять без отдельного изменения render/schema.
- `legacy/` не использовать для нового функционала.
- Продакшен-деплой идёт через Vercel и GitHub/Vercel flow, не ручным копированием файлов.

## Быстрые команды

```bash
npm run context
npm run docs:check
npm run build
npx tsx --test tests/node/pipeline-reliability.test.ts
```

## Что не делать

- Не хранить актуальную архитектуру только в чате.
- Не держать несколько “истин” по одной и той же теме.
- Не менять pipeline или URL-логику без обновления `docs/ARTICLE_SYSTEM.md`.
- Не менять env/deploy/runtime-процессы без обновления `docs/OPERATIONS.md`.
- Не использовать `legacy/` как ориентир для нового кода.
