# File map: content quality task

Дата: 2026-05-01
Статус: implementation file map

## Pipeline и media extraction

| Файл | Роль сейчас | Что менять |
|---|---|---|
| `pipeline/fetcher.ts` | Fetch HTML, Readability text, `og:image`, inline images, tables, videos | Усилить extraction: parent context, figcaption, исключение ad/author/sidebar regions, передача expanded image metadata |
| `pipeline/enrich-collect-batch.ts` | Применяет batch result и пишет статью через RPC | Прогнать `articleContext.article_images` и `cover_image_url` через sanitizer перед `apply_anthropic_batch_item_result` |
| `pipeline/enricher.ts` | Sync enrichment path | Проверить, есть ли отдельная запись media в sync path; если есть, применить sanitizer там тоже |
| `pipeline/generate-images.ts` | Генерация обложек для статей без нормальной картинки | Не генерировать поверх статей, где картинка удалена как ad/author, без явного флага; использовать как fallback после sanitizer |
| `pipeline/scorer.ts` | Score допуска к редактору | Не смешивать с `interest_rank`; максимум использовать как входной фактор |

## Новый код

| Файл | Назначение |
|---|---|
| `pipeline/media-sanitizer.ts` | Общая функция фильтрации `cover_image_url` и `article_images` с причинами удаления |
| `lib/interest-ranking.ts` | Детерминированный ranking для блока «Самое интересное» |
| `src/components/InterestingArticles.tsx` | UI блока «Самое интересное» в разделах |
| `scripts/sanitize-existing-article-media.ts` | Dry-run/apply backfill по уже опубликованным статьям |
| `tests/node/media-sanitizer.test.ts` | Unit-тесты рекламных/author/generic images |
| `tests/node/interest-ranking.test.ts` | Unit-тесты freshness, diversity, tie-breakers |
| `tests/node/category-sorting.test.ts` | Unit/contract тест сортировки разделов |

## Article render

| Файл | Роль сейчас | Что менять |
|---|---|---|
| `app/categories/[category]/[slug]/page.tsx` | Канонический рендер статьи, inline images/tables/videos, related | Использовать sanitizer в `selectInlineImages()`; не показывать сомнительные legacy images |
| `src/components/ArticleCard.tsx` | Карточки default/featured/related | Согласовать варианты для главной и разделов; возможно исправить duplicate `time` в `RelatedCard`, если актуально в текущем дереве |
| `src/components/SafeImage.tsx` | Безопасная обёртка image | Проверить fallback при удалённых/битых images |

## Home и category pages

| Файл | Роль сейчас | Что менять |
|---|---|---|
| `app/page.tsx` | Главная, hero, свежие заголовки, hot story, все новости | Починить hero contrast; привести «Все новости» к visual pattern разделов |
| `app/categories/[category]/page.tsx` | Страница раздела | Добавить «Самое интересное»; сохранить свежую ленту ниже |
| `app/russia/page.tsx` | Специальная страница Russia | Повторить изменения category page или вынести общий компонент |
| `src/components/CategoryArticleList.tsx` | Client load-more для разделов | Убедиться, что порядок свежести сохраняется при подгрузке; возможно выделить общий `ArticleFeedList` |
| `app/api/categories/[category]/articles/route.ts` | JSON load-more | Использовать тот же order, что и server render |
| `lib/articles.ts` | Public article queries | Добавить fresh query и interesting query; разделить обычную сортировку и interest ranking |

## Legal/consent

| Файл | Роль сейчас | Что менять |
|---|---|---|
| `src/components/Footer.tsx` | Footer links | Убрать «Отзыв согласия», оставить политики |
| `app/consent/page.tsx` | Сейчас юридический контур согласия/отзыва | Переупаковать в «Согласие на обработку персональных данных» без кнопки |
| `src/components/RevokeConsentButton.tsx` | Кнопка отзыва | Удалить из рендера; возможно удалить файл после проверки импортов |
| `app/cookie-policy/page.tsx` | Cookie policy | Убрать CTA на явный отзыв, заменить на инструкции/контакты |
| `app/privacy-policy/page.tsx` | Privacy policy | Обновить ссылки и формулировки |

## Styles/theme

| Файл | Роль сейчас | Что менять |
|---|---|---|
| `app/globals.css` | CSS variables light/dark | Добавить/уточнить semantic token для hero supporting text |
| `src/components/ThemeToggle.tsx` | Переключение темы | Проверить, что `data-theme="light"` не ломает CSS tokens |
| `docs/DESIGN.md` | Канонический дизайн-док | После реализации зафиксировать новые правила |

## Supabase/data

| Область | Что проверить |
|---|---|
| `articles.cover_image_url` | Очистить ad/author/irrelevant cover только если sanitizer уверен |
| `articles.article_images` | Основной объект backfill |
| `articles.score` | Использовать как вход в interest ranking, не как главный order в свежих разделах |
| `articles.created_at`, `pub_date` | Выбрать canonical freshness field для category order |
| RLS/public reads | Backfill выполнять service role script, public reads остаются через anon |

## Docs impact after implementation

| Изменение | Канонический документ |
|---|---|
| Media sanitizer/extraction/render | `docs/ARTICLE_SYSTEM.md` |
| Category order, interesting block | `docs/ARTICLE_SYSTEM.md`, `docs/PROJECT.md` |
| Hero contrast/cards | `docs/DESIGN.md` |
| Backfill/smoke | `docs/OPERATIONS.md` |
| Sorting decision | `docs/DECISIONS.md` |
