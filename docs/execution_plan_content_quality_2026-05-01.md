# Execution plan: content quality task

Дата: 2026-05-01
Статус: implementation plan

## Principle

Сначала закрываем системные причины мусорных медиа, затем чистим старые данные, затем правим UI/legal/ranking. Такой порядок нужен, чтобы новые статьи не продолжали заносить баннеры, пока backfill чистит прошлые.

## Phase 0. Baseline and fixtures

1. Собрать проблемные URL/slug:
   - статья с Habr career banner;
   - статья с `Photo of Stephen Clark`;
   - 3-5 свежих статей с нормальными inline images;
   - 3-5 статей без картинок.
2. Зафиксировать текущие `article_images`/`cover_image_url` для этих статей через read-only query.
3. Сделать local screenshots problem pages.

Выход:
- список fixture article ids/slugs для тестов и ручного smoke;
- понимание, какие поля реально заполнены в Supabase.

## Phase 1. Media sanitizer

1. Создать `pipeline/media-sanitizer.ts`.
2. Покрыть unit-тестами:
   - ad/career banner reject;
   - author photo reject;
   - relevant image keep;
   - generic caption reject;
   - legacy `{ src, alt }` shape.
3. Подключить sanitizer в render path:
   - `app/categories/[category]/[slug]/page.tsx`;
   - это сразу скрывает legacy мусор без изменения БД.
4. Подключить sanitizer в pipeline apply path:
   - `pipeline/enrich-collect-batch.ts`;
   - проверить sync path в `pipeline/enricher.ts`, если он пишет media.

Выход:
- новые статьи сохраняют очищенные media;
- старые статьи уже не показывают rejected media на сайте.

## Phase 2. Backfill existing articles

1. Создать `scripts/sanitize-existing-article-media.ts`.
2. Реализовать modes:
   - `--dry-run` default;
   - `--apply`;
   - `--limit=N`;
   - `--source="Habr AI"` optional;
   - `--slug=...` optional.
3. Dry-run на небольшом наборе fixtures.
4. Dry-run на всех live articles.
5. Просмотреть summary.
6. Apply батчами.

Выход:
- Supabase очищен от старых рекламных/author images;
- есть лог изменённых статей.

## Phase 3. Consent cleanup

1. Убрать footer link «Отзыв согласия».
2. Убрать кнопку `RevokeConsentButton` из `/consent`.
3. Переименовать страницу в «Согласие на обработку персональных данных».
4. Обновить ссылки и формулировки в:
   - `/cookie-policy`;
   - `/privacy-policy`;
   - footer.
5. Проверить, можно ли удалить `src/components/RevokeConsentButton.tsx`; удалить только если нет импортов.

Выход:
- нет явной кнопки отзыва;
- юридические страницы не противоречат текущей модели cookie notice.

## Phase 4. Hero contrast

1. Проверить light/dark на главной.
2. Заменить `text-ink opacity-70` на стабильный token/class, например `text-muted` или отдельный CSS class.
3. Если нужен отдельный token:
   - добавить `--hero-muted`;
   - определить для light/dark.
4. Проверить desktop/mobile screenshots.

Выход:
- supporting text читается в обеих темах.

## Phase 5. Unified cards

1. Сравнить текущий `app/page.tsx` и `CategoryArticleList`.
2. Вынести общий компонент при необходимости:
   - `src/components/ArticleFeedList.tsx`;
   - props: `articles`, `featuredFirst`, `emptyText`, `gridClassName`.
3. Использовать одинаковый pattern на главной и в разделах.
4. Проверить visual diff на:
   - `/`;
   - `/categories/ai-industry`;
   - `/russia`.

Выход:
- карточки главной и разделов выглядят как одна дизайн-система.

## Phase 6. Fresh category ordering

1. Изменить `getArticlesByCategoryPage()`:
   - order by freshness first;
   - then score;
   - then stable tie-breaker if feasible.
2. Проверить `app/api/categories/[category]/articles/route.ts`.
3. Добавить тест/fixture на порядок.
4. Проверить load-more.

Выход:
- разделы показывают свежие новости первыми.

## Phase 7. Interesting block MVP

1. Создать `lib/interest-ranking.ts`.
2. Добавить tests с fixed `now`.
3. Добавить `getInterestingArticlesByCategory()` в `lib/articles.ts`.
4. Создать `src/components/InterestingArticles.tsx`.
5. Вставить на category pages и `/russia`.
6. Проверить, что блок скрывается при нехватке candidates.

Выход:
- «Самое интересное» работает отдельно от свежей ленты.

## Phase 8. Docs and deployment

1. Обновить канонические docs:
   - `docs/ARTICLE_SYSTEM.md`;
   - `docs/DESIGN.md`;
   - `docs/PROJECT.md`, если меняется surface;
   - `docs/OPERATIONS.md`, если backfill script остаётся в репо;
   - `docs/DECISIONS.md`, если фиксируем sorting decision.
2. Запустить:
   - `npm run build`;
   - targeted tests;
   - `npm run docs:check`.
3. Deploy production.
4. Live smoke.

## Stop conditions

Остановиться и не делать apply/deploy, если:

- sanitizer dry-run удаляет много явно хороших изображений;
- backfill требует schema change без migration plan;
- category pages становятся заметно медленнее;
- legal copy становится противоречивой.
