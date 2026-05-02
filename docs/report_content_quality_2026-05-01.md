# Отчет по задаче content quality / media hygiene / ranking

Дата: 2026-05-01
Рабочий HEAD до коммита: `9cbd7af`
Статус: доработки применены, Supabase backfill выполнен, production deploy выполнен, local/live smoke пройден.

## Выполнено

- Добавлен общий media sanitizer: `lib/media-sanitizer.ts`, `pipeline/media-sanitizer.ts` как re-export.
- Sanitizer подключен в `pipeline/enrich-submit-batch.ts`, `pipeline/enrich-collect-batch.ts`, render статьи и карточки.
- `pipeline/fetcher.ts` теперь собирает контекст inline images: caption/title, размеры, parent class/id, parent href, figure class/id; исключает sidebar/related/promo/author regions.
- Добавлен backfill script `scripts/sanitize-existing-article-media.ts` с dry-run/apply, limit/slug/source filters, summary и audit JSONL для apply.
- `/consent` переупакован в страницу «Согласие на обработку персональных данных» без кнопки отзыва; footer/cookie/privacy тексты обновлены; `src/components/RevokeConsentButton.tsx` удален.
- Hero supporting text переведен на semantic token `--hero-muted` / `text-hero-muted`.
- Главная и разделы используют общий pattern ленты через `src/components/ArticleFeedList.tsx`: первая карточка featured, остальные grid.
- `getArticlesByCategoryPage()` сортирует основную ленту по свежести: `pub_date desc nulls last`, затем `created_at desc`, `score desc`, `id desc`.
- Добавлен deterministic interest ranking: `lib/interest-ranking.ts`.
- Добавлен блок `src/components/InterestingArticles.tsx` на `/categories/[category]` и `/russia`; скрывается при <3 кандидатов.
- Обновлены canonical docs: `docs/ARTICLE_SYSTEM.md`, `docs/DESIGN.md`, `docs/PROJECT.md`, `docs/OPERATIONS.md`, `docs/DECISIONS.md`.

## Backfill

Backfill применен к live Supabase через `scripts/sanitize-existing-article-media.ts`.

Перед apply был повторно просмотрен dry-run sample по общему срезу и источникам `Habr AI`, `ZDNet AI`, `TechCrunch AI`, `The Verge AI`. По результатам sample уточнены правила sanitizer:

- trusted editorial inline images с пустым/generic caption больше не удаляются автоматически;
- URL author/profile/headshot по-прежнему удаляются;
- `обучени*` больше не считается promo-copy, чтобы не ломать материалы про обучение моделей;
- `high-profile` больше не матчится как author profile.

Финальный dry-run перед apply:

```text
npx tsx scripts/sanitize-existing-article-media.ts --dry-run
scanned: 600
changed: 503
cover_removed: 153
inline_removed: 420
by_reason:
  irrelevant_caption: 253
  text_cover: 142
  promo_text: 79
  author_photo: 77
  generic_caption: 21
  ad_url: 1
```

Apply:

```text
npx tsx scripts/sanitize-existing-article-media.ts --apply
scanned: 600
changed: 503
cover_removed: 153
inline_removed: 420
audit_file: tmp/media-sanitizer-audit-2026-05-01T22-15-34-084Z.jsonl
```

После исправления canonical JSON comparison в backfill script был выполнен короткий повторный apply для 2 нормализационных строк:

```text
npx tsx scripts/sanitize-existing-article-media.ts --apply
scanned: 600
changed: 2
audit_file: tmp/media-sanitizer-audit-2026-05-01T22-17-34-834Z.jsonl
```

Финальная идемпотентность:

```text
npx tsx scripts/sanitize-existing-article-media.ts --dry-run
scanned: 600
changed: 0
cover_removed: 0
inline_removed: 0
```

## Проверки

```text
npx tsx --test tests/node/media-sanitizer.test.ts
npx tsx --test tests/node/interest-ranking.test.ts
npx tsx --test tests/node/category-sorting.test.ts
npx tsx --test tests/node/legal-consent-copy.test.ts
npm run docs:check
npm run build
```

Все проверки прошли. Targeted node tests: 21 passed.

Production build с сетевым доступом к Supabase:

```text
npm run build
✓ Generating static pages (340/340)
```

Локальный production smoke (`PORT=3001 npm run start`):

```text
200 /
200 /categories/ai-industry
200 /categories/ai-research
200 /russia
200 /consent
200 /cookie-policy
200 /privacy-policy
```

Browser smoke через in-app browser:

```text
home light/dark: ok, console errors 0
category light/dark mobile: ok, console errors 0
/russia mobile: ok, "Самое интересное" visible, console errors 0
/consent, /cookie-policy, /privacy-policy: ok, revoke-copy absent, console errors 0
problem Habr article: "Хабр Карьера" absent
problem Ars article: author-photo markers absent
```

Production deploy:

```text
vercel deploy --prod --yes
deployment id: dpl_BmY8wv3QZ33KtNMSyw4FifoXW2Ms
deployment url: https://malakhov-ai-digest-6hj1emuay-ivan-malakhovs-projects-58b15501.vercel.app
alias: https://news.malakhovai.ru
readyState: READY
```

Live smoke на `https://news.malakhovai.ru`:

```text
200 /
200 /categories/ai-industry
200 /categories/ai-research
200 /russia
200 /consent
200 /cookie-policy
200 /privacy-policy
200 /categories/ai-russia/5-skillov-iz-ofitsialnogo-marketpleysa-claude-code-chto-rabo
200 /categories/ai-research/sud-musk-protiv-openai-stal-proverkoy-missii-kompanii-altman
```

Live content checks:

```text
"Самое интересное": present on /categories/ai-industry, /categories/ai-research, /russia
"Отозвать согласие" / "Отзыв согласия": absent
former Habr banner markers: absent
former Ars author-photo markers: absent
production browser smoke: page console errors 0
```

## Остаточные риски

- Interest ranking пока серверный TypeScript MVP без precomputed view/RPC; если category pages замедлятся, следующий шаг — SQL/RPC или materialized view.
