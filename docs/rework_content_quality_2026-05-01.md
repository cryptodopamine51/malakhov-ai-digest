# Rework: content quality / media hygiene / ranking

Дата перепроверки: 2026-05-01
Основание: повторная проверка `docs/report_content_quality_2026-05-01.md`

## Короткий вывод

Автоматические проверки из отчета повторно проходят, но задачу нельзя считать полностью закрытой по acceptance criteria. Основные хвосты: не завершен production/backfill rollout, не сделан полноценный visual/live smoke, есть риск в fallback-логике блока «Самое интересное», а текущий локальный runtime после build/dev-сценария отдает 500 на части маршрутов из-за отсутствующего `.next/server/vendor-chunks/tailwind-merge.js`.

## Статус доработки от 2026-05-02

- P0 runtime на чистой `.next`: закрыто. Старый `next dev/start` остановлен, production build с Supabase-сетью прошел, `PORT=3001 npm run start` отдал 200 по smoke routes.
- P1 fallback «Самое интересное»: закрыто. Fallback теперь проверяется после `excludeIds`, добавлен тест `rankInterestingArticlesWithFallback uses wider window after excluded fresh page`.
- P1 backfill acceptance: закрыто. Supabase apply выполнен, audit JSONL сохранен, финальный dry-run дает `changed: 0`.
- P1 visual smoke: закрыто. Локальный smoke закрыт через curl и in-app browser; live smoke закрыт на `https://news.malakhovai.ru` после Vercel deploy.
- P2 contract-level tests: закрыто. Добавлены проверки fallback after excludes, legal copy без revoke-control и стабильной pagination без дублей.

## Повторно пройденные проверки

```text
npx tsx --test tests/node/media-sanitizer.test.ts
npx tsx --test tests/node/interest-ranking.test.ts
npx tsx --test tests/node/category-sorting.test.ts
npm run docs:check
npm run build
```

Результат: passed. `npm run build` завершился успешно.

## Доработки

### P0. Перепроверить runtime на чистой `.next`

Текущий локальный runtime не является надежным smoke-сигналом: `next dev` был запущен на `127.0.0.1:3000`, после чего build/start-сценарии начали отдавать 500 для category routes и `next start`.

Наблюдаемый сбой:

```text
Cannot find module './vendor-chunks/tailwind-merge.js'
Require stack:
- .next/server/webpack-runtime.js
- .next/server/app/categories/[category]/page.js
```

Что сделать:

1. Остановить локальный `next dev`.
2. Удалить только build artifact `.next`.
3. Запустить `npm run build`.
4. Запустить `PORT=3001 npm run start`.
5. Проверить `GET /`, `/categories/ai-industry`, `/categories/ai-research`, `/russia`, `/consent`.
6. Если ошибка воспроизводится на чистой сборке, чинить bundling/server import `tailwind-merge` из `lib/utils.ts`.

Критерий готовности: все smoke routes возвращают `200`, без `Cannot find module` в HTML и server logs.

### P1. Починить fallback «Самое интересное» после исключения свежей ленты

Сейчас `getInterestingArticlesByCategory()` выбирает 7-дневный или 30-дневный pool до применения `excludeIds`:

- `lib/articles.ts:209-218`
- вызовы с исключением первой страницы: `app/categories/[category]/page.tsx:200-202`, `app/russia/page.tsx:49-51`

Если в категории 4+ кандидата за 7 дней, но они уже входят в первую свежую страницу, `rankInterestingArticles()` отфильтрует их по `excludeIds` и вернет пустой блок. Fallback на 30 дней при этом не включится.

Что сделать:

1. Сначала ранжировать 7-дневный pool с `excludeIds`.
2. Если после исключений получилось меньше 3 материалов, fetch/rank 30-дневный pool.
3. Добавить тест на сценарий: 7-дневные кандидаты полностью исключены первой страницей, 30-дневные кандидаты доступны, блок должен появиться.

Критерий готовности: «Самое интересное» скрывается только когда после fallback реально меньше 3 viable candidates.

### P1. Завершить backfill acceptance

Отчет честно фиксирует только dry-run:

- `docs/report_content_quality_2026-05-01.md:23`
- полный dry-run меняет `481/575` live-статей;
- `apply` не запускался.

Что сделать:

1. Просмотреть random sample минимум 20 changed articles из dry-run, отдельно по `Habr AI`, `ZDNet AI`, `TechCrunch AI`, `The Verge AI`.
2. Зафиксировать false positives и при необходимости уточнить sanitizer.
3. Запустить `--apply` маленькими батчами с audit JSONL.
4. После каждого батча проверить 5 измененных статей.

Критерий готовности: в live data нет известных Habr career banners / Ars author photos, а sample changed articles не показывает очевидных false positives.

### P1. Сделать visual/live smoke по acceptance checklist

В отчете есть только `curl -I /`, но acceptance требует ручной/визуальный smoke:

- главная light/dark;
- раздел light/dark;
- `/russia`;
- mobile viewport;
- problem article с former Habr banner;
- problem article с former Ars author photo;
- `/cookie-policy`, `/privacy-policy`, `/consent`;
- browser console.

Что сделать:

1. После чистого runtime smoke пройти checklist из `docs/acceptance_criteria_content_quality_2026-05-01.md:149-160`.
2. Сохранить короткий smoke-report: URL, viewport, theme, результат, console errors.

Критерий готовности: нет визуальных регрессий, нет пустых media shells, нет видимой кнопки «Отозвать согласие».

### P2. Усилить тестовое покрытие contract-level проверками

Текущие targeted tests полезные, но не закрывают часть контрактов:

- `category-sorting.test.ts` проверяет локальный comparator, а не Supabase query/API order;
- нет теста fallback «Самое интересное» после `excludeIds`;
- нет render/route smoke для `/consent` без кнопки и footer без «Отзыв согласия»;
- нет API/load-more теста на отсутствие дублей между страницами.

Что сделать:

1. Добавить unit/contract тест для fallback after excludes.
2. Добавить тест или lightweight route smoke для legal copy.
3. Добавить тест стабильности load-more order на page 1/page 2 fixtures.

Критерий готовности: regressions в freshness/interesting/legal paths ловятся до ручного smoke.

## Не блокирует код, но блокирует финальный статус задачи

- Commit не создан.
- Production deploy/Vercel не запускался.
- Supabase apply/backfill не запускался.
- Live smoke на `https://news.malakhovai.ru` не выполнялся.

Пока эти пункты не закрыты, финальный ответ по задаче не сможет выполнить требования из `docs/acceptance_criteria_content_quality_2026-05-01.md:162-171`.
