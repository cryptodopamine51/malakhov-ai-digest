# Task: Article Cover Image Lab

Дата: 2026-04-25

## Контекст

Нужно закрыть проблему статей без нормальных картинок: карточки и страницы не должны выглядеть пустыми, даже если источник не дал хорошую обложку.

Ограничения:

- базовый вариант должен быть бесплатным;
- платный вариант допустим только как тонкий слой для важных материалов;
- целевой лимит платной генерации: до `0.50 USD/day`;
- визуальный язык должен выглядеть как редакционная упаковка Malakhov AI Digest, а не как случайный stock или placeholder.

## Предложенная стратегия

Строим не один источник картинок, а fallback-лесенку:

1. `source image`  
   Используем `cover_image_url` из исходника, если она чистая и не принадлежит источникам с текстовыми/мусорными обложками.

2. `stock editorial treatment`  
   Берём бесплатное фото из stock API как фон, но не ставим его как есть: поверх добавляем фирменный editorial treatment, muted palette, paper frame, grain и графические слои.

3. `local SVG/editorial template`  
   Бесплатный локальный fallback. Генерируется кодом без API и без внешних ключей. Это главный кандидат на покрытие всех статей без картинки.

4. `cover bank`  
   Пул заранее подготовленных фирменных обложек по рубрикам и мотивам. Хорош для long tail и старых статей, где не хочется тратить деньги.

5. `AI budget cover`  
   Платная генерация только для главных материалов: `score >= 7`, hero, Telegram preview, evergreen. При цене порядка `$0.016/image` для low-quality генерации лимит `0.50 USD/day` даёт примерно 30 изображений в день, но practically лучше начинать с 5-10.

## Что уже сделано

Создана отдельная визуальная лаборатория:

- route: `/demo/image-lab`
- файл: `app/demo/image-lab/page.tsx`
- страница не индексируется: `robots: { index: false }`
- страница `force-dynamic`, чтобы брать свежие статьи, когда Supabase доступен;
- при недоступной базе есть fallback-набор демо-статей.

На странице каждая статья показывается в пяти режимах:

- `Source`
- `Stock edit`
- `Local SVG`
- `Cover bank`
- `AI budget`

Для stock-режима пока используются статичные Unsplash URL как визуальный mock, без API-интеграции и без сохранения в storage.

Для локальных режимов используются inline SVG-композиции:

- `SystemMotif`
- `ArchiveMotif`
- `AIMotif`

Это сделано специально как frontend visual test, а не как production pipeline.

## Проверки, которые уже прошли

Команды:

```bash
npx tsc --noEmit
npm run docs:check
npx tsx --test tests/node/batch-enrich.test.ts
npm run build
```

Результат:

- TypeScript check прошёл;
- docs impact check прошёл;
- batch enrichment regression test прошёл;
- production build прошёл;
- route `/demo/image-lab` появился в Next route table.

Во время build были DNS/fetch warnings к Supabase:

```text
getaddrinfo ENOTFOUND oziddrpkwzsdtsibauon.supabase.co
```

Сборку это не сломало. Это нужно перепроверить в нормальной сетевой среде, потому что на момент проверки часть сетевого доступа была ограничена.

## Финальная проверка перед deploy

Дата: 2026-04-25

Команды:

```bash
npm run context
npx tsc --noEmit
npm run docs:check
npx tsx --test tests/node/batch-enrich.test.ts
npm run build
```

Результат:

- `/demo/image-lab` отдаёт `200 OK` локально;
- metadata содержит `robots: noindex`;
- desktop screenshot показывает пять вариантов обложек в ряд на `xl`;
- mobile smoke screenshot показывает одноколоночную раскладку;
- внешний stock/source image mock переведён на `next/image` без server-side optimization, чтобы локальная проверка не зависела от Next image optimizer fetch к внешним URL;
- `npm run build` прошёл, но во время prerender старых `/articles/[slug]` оставались сетевые warnings/ретраи к Supabase (`ConnectTimeoutError`, `ECONNRESET`), не связанные с `/demo/image-lab`.

## Что нужно перепроверить вручную

Открыть локально:

```text
http://localhost:3000/demo/image-lab
```

Проверить:

1. Страница открывается и показывает реальные статьи при доступном Supabase.
2. Если Supabase недоступен, показываются fallback demo articles.
3. Source images:
   - не показываются для `Habr AI`, `vc.ru`, `CNews`;
   - показываются для источников с нормальным `cover_image_url`.
4. Stock edit:
   - картинки грузятся;
   - stock не выглядит как случайный корпоративный фон;
   - attribution/credit не ломает карточку.
5. Local SVG:
   - выглядит достаточно редакционно, чтобы быть бесплатным fallback;
   - не выглядит как пустая заглушка;
   - не конфликтует с текущей палитрой сайта.
6. Cover bank:
   - визуально отличается от Local SVG;
   - может жить как повторно используемый набор обложек.
7. AI budget:
   - выглядит как направление для будущей генерации, а не как текущая production-реализация.
8. Mobile layout:
   - карточки не разваливаются;
   - подписи и бейджи не переполняются;
   - изображения держат aspect ratio.
9. Desktop layout:
   - 5 вариантов рядом читаются;
   - карточки не выглядят слишком мелкими на `xl`.

## Что нужно решить после визуального теста

1. Выбрать 1-2 бесплатных визуальных направления:
   - `Local SVG`
   - `Cover bank`
   - `Stock edit`

2. Решить, нужен ли stock API:
   - Pexels;
   - Pixabay;
   - Unsplash.

3. Если нужен stock API, определить политику:
   - hotlink или скачивание в Supabase Storage;
   - attribution;
   - cache;
   - allowlist тем;
   - запрет generic office / smiling business / random robot.

4. Решить, нужен ли платный AI слой:
   - только top score;
   - дневной бюджет;
   - ручной approve или auto-publish;
   - хранение prompt/version/provider metadata.

5. После выбора направления сделать production-схему:
   - таблица или поля для `cover_strategy`;
   - job для backfill статей без картинок;
   - storage upload;
   - source/stock/generated metadata;
   - интеграция в `ArticleCard` и article page.

## Рекомендуемый следующий шаг

Провести визуальный тест `/demo/image-lab` и выбрать:

- лучший бесплатный fallback;
- нужен ли stock layer;
- стоит ли тратить до `$0.50/day` на AI cover только для hero/top статей.

После этого можно делать production implementation без гадания по стилю.
