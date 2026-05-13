# Evergreen Article Playbook

Практический стандарт для SEO-опорных evergreen-гайдов на `news.malakhovai.ru`.

## Цель

Evergreen-статья должна быть не новостью, а устойчивой опорной страницей: закрывать
долгоживущий поисковый интент, объяснять тему лучше обычной ленты и вести читателя дальше —
в связанные разделы, свежие статьи, Telegram или заявку на AI-проект.

## Файлы

- Markdown: `content/guides/<slug>.md`.
- Metadata и регистрация: `lib/guides.ts`.
- Изображения: `public/images/guides/<slug>/`.
- Рендер: `app/guides/[slug]/page.tsx`.
- Layout/spacing standard: `src/components/guideArticleStyles.ts`.
- Sticky navigation и back-to-top: `src/components/GuideScrollTools.tsx`.

## Структура Материала

1. Один `H1` в markdown, совпадающий по смыслу с `guide.title`.
2. В начале: краткое резюме, аудитория материала и практический результат.
3. Основные разделы через `H2`; подуровни через `H3`.
4. После смысловых блоков использовать таблицы, списки, цитаты и иллюстрации только там, где они
   помогают принять решение.
5. FAQ добавлять в конце и дублировать в `guide.faq`, чтобы JSON-LD оставался синхронным.
6. Ручной раздел `Оглавление` можно оставить в markdown для редактора, но шаблон его не рендерит:
   публичная навигация строится автоматически из `H2`.

## Верстка

- Desktop: sticky-содержание слева, статья справа, основная колонка до 760px.
- Mobile: sticky горизонтальное содержание под обложкой.
- Кнопка «Наверх» появляется после глубокого скролла.
- Отступы не задавать вручную в каждом блоке. Использовать `guideArticleStyles`:
  H2 — `mt-14 mb-4`, H3 — `mt-9 mb-3`, абзац — `mb-5`, media/table/CTA — `my-8` или
  `my-10`, финальные секции — `mt-14 pt-10`.

## CTA И Перелинковка

- Чеклист и подписка ведут в Telegram.
- CTA «Обсудить AI-проект» ведёт на `https://malakhovai.ru/contacts`, где открывается форма
  «Контакты».
- В конце всегда должны быть:
  - связанные разделы из `guide.relatedLinks`;
  - связанные live-статьи из `guide.relatedArticleCategories`.
- В тексте добавлять внутренние ссылки на релевантные разделы и статьи, но без переспама.

## SEO Checklist

- `slug` короткий, человекочитаемый, без дат кроме случаев, когда год нужен интенту.
- `seoTitle` до 60-70 символов, `description` до 150-170 символов, без кликбейта.
- `ogDescription` короче и практичнее обычного description.
- Canonical и sitemap должны оставаться на `https://news.malakhovai.ru`.
- Новый гайд должен быть добавлен в `getAllGuides()` через metadata в `lib/guides.ts`; после
  этого `app/sitemap.ts` добавит URL автоматически как monthly guide route.
- Cover: `cover.webp`, 1200x675, содержательный alt и caption.
- Inline images: понятные имена (`ai-project-matrix.webp`, `ai-economics.webp`), WebP, без
  тяжёлых исходников в public, alt описывает смысл картинки.
- FAQ должен соответствовать реальным вопросам пользователя и быть представлен в JSON-LD.
- Связанные статьи должны вести через canonical article card URL, а не на legacy `/articles/<slug>`.

## Публикационный Чеклист

1. Добавить markdown, metadata, FAQ, `relatedLinks`, `relatedArticleCategories`.
2. Положить оптимизированные WebP в `public/images/guides/<slug>/`.
3. Проверить локально `/guides/<slug>` на desktop и mobile.
4. Прогнать `npm run docs:check`, `npm run lint`, `npm run build`.
5. После merge проверить production URL, sitemap и наличие sticky-содержания / CTA / related.
