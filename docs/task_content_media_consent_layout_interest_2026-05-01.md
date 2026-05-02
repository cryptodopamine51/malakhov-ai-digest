# Задача: медиа-гигиена, согласие, визуальная консистентность и блок «Самое интересное»

Дата: 2026-05-01
Статус: draft-ready
Цель: закрыть пользовательские замечания по рекламным баннерам, нерелевантным изображениям, юридическому блоку согласия, контрасту главного экрана, карточкам главной, сортировке разделов и модулю интересного контента.

## Разбивка на рабочие документы

Этот файл оставлен как исходный общий task brief. Для реализации использовать пакет документов:

- `docs/task_content_quality_index_2026-05-01.md`
- `docs/spec_content_quality_requirements_2026-05-01.md`
- `docs/file_map_content_quality_2026-05-01.md`
- `docs/spec_media_sanitizer_2026-05-01.md`
- `docs/spec_interest_ranking_2026-05-01.md`
- `docs/execution_plan_content_quality_2026-05-01.md`
- `docs/rollout_backfill_content_quality_2026-05-01.md`
- `docs/acceptance_criteria_content_quality_2026-05-01.md`

## Контекст

На сайте в статьи попадают изображения из исходных материалов. Сейчас `pipeline/fetcher.ts` собирает inline-картинки широкими селекторами (`article img`, `.content img`, `.post img`, `main img`, `[class*="article"] img`, `[class*="content"] img`) и отсекает только совсем очевидные пиксели, логотипы, иконки и аватары по `src`. В статье рендер затем дополнительно проверяет только осмысленность подписи через `isMeaningfulCaption()` в `app/categories/[category]/[slug]/page.tsx`.

Из-за этого в публичные статьи могут попадать рекламные баннеры, промо-картинки и портреты авторов, например:
- баннер «Хабр Карьера Курсы»;
- `Photo of Stephen Clark · Источник: Ars Technica`, где картинка относится к автору/корреспонденту, а не к теме статьи.

В разделах `getArticlesByCategoryPage()` сейчас сортирует по `score desc`, затем `created_at desc`, поэтому новая статья может оказаться ниже старой более скоринговой. Отдельный блок «Самое интересное» должен взять на себя ранжирование по интересности, а основной список раздела должен быть свежим.

## Исследование по модулю «Самое интересное»

Готовые библиотеки полноценной персонализации есть, но они тяжеловаты для текущей стадии, потому что у сайта нет аккаунтов, явных лайков/дизлайков и нормальной матрицы пользователь-статья:

- Microsoft Recommenders содержит набор production-подходов и news/article алгоритмы вроде DKN, LSTUR, NAML, NRMS, SAR, LightFM и TF-IDF; это хороший reference, но не стоит тащить весь Python/ML-контур в MVP без событий пользователей: https://github.com/recommenders-team/recommenders
- TensorFlow Recommenders закрывает полный workflow подготовки данных, обучения, оценки и деплоя моделей, но требует отдельного ML-контура: https://github.com/tensorflow/recommenders
- LightFM полезен как гибридная рекомендация с user/item metadata и лучше переживает cold start, но всё равно требует implicit/explicit feedback: https://github.com/lyst/lightfm
- implicit быстро обучает ALS/BPR/nearest-neighbor модели на implicit feedback, но без событий просмотра/кликов это преждевременно: https://github.com/benfred/implicit
- X For You open-source repo полезен как архитектурный пример: candidates -> hydration -> filtering -> scoring -> diversity -> selection. Для нас сейчас достаточно взять pipeline-идею, а не модель: https://github.com/xai-org/x-algorithm
- Для неперсонализированной новостной поверхности лучше стартовать с прозрачного hot-ranking: свежесть + редакционный score + доверие источника + разнообразие. Формулы Hacker News / Reddit-style ranking хороши как простая база с time decay: https://www.righto.com/2009/06/how-does-newsyc-ranking-work.html

Решение для MVP: не подключать ML-библиотеку сразу. Сделать детерминированный `interest_rank` в TypeScript/Supabase, собрать события просмотров/кликов для будущего шага и оставить в документации путь к LightFM/implicit/TFRS, когда появится достаточный объём feedback.

## Scope

### 1. Убрать рекламные баннеры из всех статей и закрыть системно

Файлы:
- `pipeline/fetcher.ts`
- новый `pipeline/media-sanitizer.ts`
- `pipeline/enrich-collect-batch.ts`
- новый скрипт `scripts/sanitize-existing-article-media.ts`
- `app/categories/[category]/[slug]/page.tsx`
- тесты в `tests/node/`

Работы:
1. Вынести общую функцию `sanitizeArticleMedia()`:
   - вход: `cover_image_url`, `article_images`, `source_name`, `original_url`, `original_title`, `original_text`;
   - выход: очищенные `cover_image_url`, `article_images`, плюс `media_reject_reasons` для логов.
2. Добавить reject-правила для рекламных и промо-изображений:
   - `alt`, `title`, `src`, `href`, parent class/id содержат `ad`, `ads`, `advert`, `banner`, `promo`, `sponsor`, `career`, `job`, `vacancy`, `курс`, `курсы`, `карьера`, `реклама`, `промо`, `партнерский`;
   - домены и пути: `adfox`, `doubleclick`, `yandex/direct`, `yabs`, `career.habr.com`, `promo`, `banner`;
   - подозрительные соотношения сторон для баннеров: очень широкие изображения, например `ratio >= 2.8`, если нет явной связи с заголовком.
3. Усилить extraction в `pipeline/fetcher.ts`:
   - собирать контекст изображения: ближайший `figure`, `figcaption`, parent class/id, parent link href;
   - исключать картинки внутри `aside`, `nav`, `footer`, `header`, `.promo`, `.advert`, `.banner`, `.career`, `.jobs`, `.sidebar`, `.related`, `.recommend`;
   - не брать изображения из блоков, которые Readability не включил бы в основной article body.
4. Backfill:
   - создать скрипт, который сканирует live-статьи с `article_images`/`cover_image_url`;
   - применяет тот же sanitizer;
   - обновляет Supabase только если есть изменения;
   - логирует `article_id`, `slug`, удалённые URL и причину.
5. Приёмка:
   - на старых статьях нет баннера «Хабр Карьера Курсы» и аналогичных рекламных изображений;
   - новые статьи не сохраняют такие изображения в `article_images`;
   - тесты покрывают Habr career banner, generic ad banner, sponsor/promo image.

### 2. Устранить нерелевантные картинки и авторские портреты

Файлы:
- `pipeline/media-sanitizer.ts`
- `pipeline/fetcher.ts`
- `app/categories/[category]/[slug]/page.tsx`
- `scripts/sanitize-existing-article-media.ts`

Работы:
1. Добавить правила против author/byline/headshot изображений:
   - alt/caption начинается с `Photo of`, `Portrait of`, `Author`, `Byline`, `Headshot`, `Фото автора`, `Автор`;
   - parent class/id содержит `author`, `byline`, `bio`, `profile`, `avatar`, `contributor`;
   - изображение маленькое или портретное и caption не содержит сущностей из заголовка/лида.
2. Добавить простую релевантность caption:
   - нормализовать title + lead + summary + original_title в набор токенов/имен;
   - оставить inline image только если caption/alt содержит хотя бы одну значимую сущность из статьи или проходит source-specific whitelist;
   - если caption generic (`image`, `photo`, `illustration`, `source`, URL, имя автора) — удалить.
3. Source-specific правила:
   - Ars Technica: отсеивать author portraits (`Photo of <person>`) и byline images;
   - Habr AI: отсеивать career/course promo;
   - CNews/vc.ru: не брать text-cover как inline image, если уже есть редакционный placeholder.
4. Рендер-страховка:
   - в `selectInlineImages()` использовать sanitizer повторно, а не только `isMeaningfulCaption()`;
   - если картинка сомнительная, не показывать её даже если она уже лежит в БД.
5. Приёмка:
   - кейс `Photo of Stephen Clark · Источник: Ars Technica` исчезает из статьи;
   - в статье не остаётся пустого места на позиции удалённой картинки;
   - если релевантных картинок нет, статья выглядит нормально с текстом, таблицами и редакционными блоками.

### 3. Убрать «Отзыв согласия» как отдельную явную кнопку/раздел

Файлы:
- `src/components/Footer.tsx`
- `app/consent/page.tsx`
- `src/components/RevokeConsentButton.tsx`
- `app/cookie-policy/page.tsx`
- `app/privacy-policy/page.tsx`

Работы:
1. Убрать пункт «Отзыв согласия» из footer.
2. Переименовать юридический контур:
   - заменить публичный смысл `/consent` на «Согласие на обработку персональных данных»;
   - убрать видимую кнопку `Отозвать согласие`;
   - оставить техническую возможность opt-out только как текстовую инструкцию через настройки браузера/письмо, если юридически нужно.
3. Проверить внутренние ссылки:
   - cookie-policy и privacy-policy должны ссылаться на «Согласие на обработку персональных данных», а не на «Отзыв согласия»;
   - убрать формулировки, которые явно призывают нажать кнопку отзыва.
4. Приёмка:
   - на сайте нет кнопки «Отозвать согласие»;
   - footer не содержит «Отзыв согласия»;
   - `/consent` не выглядит как страница opt-out, если маршрут оставляем для SEO/совместимости.

### 4. Починить контраст текста hero на светлой и тёмной теме

Файлы:
- `app/page.tsx`
- `app/globals.css`
- `src/components/ThemeToggle.tsx`

Работы:
1. Разобрать, почему текст «Ежедневная редакционная лента...» инвертируется некорректно.
2. Зафиксировать semantic tokens:
   - фон hero должен быть `bg-base` или отдельный токен `--hero-bg`;
   - текст должен быть `text-muted` или `color-mix(...)`, но без opacity, которая может ломать читаемость на разных темах.
3. Добавить ручной visual QA:
   - desktop light;
   - desktop dark;
   - mobile light;
   - mobile dark.
4. Приёмка:
   - текст читается на обеих темах;
   - контраст не хуже WCAG AA для обычного текста, где возможно.

### 5. Сделать карточки на главной визуально такими же, как внутри разделов

Файлы:
- `app/page.tsx`
- `src/components/ArticleCard.tsx`
- `src/components/CategoryArticleList.tsx`

Работы:
1. Сравнить главную и разделы:
   - разделы используют `CategoryArticleList`: первая карточка `featured`, остальные `default`;
   - главная в «Все новости» сейчас выводит только grid `default`.
2. Принять единый паттерн:
   - либо переиспользовать общий компонент `ArticleFeedList`;
   - либо привести `app/page.tsx` к тому же поведению: первый материал блока как `featured`, остальные как grid.
3. Избежать вложенных карточек и сохранить текущий restrained newsroom style.
4. Приёмка:
   - визуальный скрин главной и раздела показывает одинаковую систему карточек;
   - нет разъезда высот, битых placeholder-картинок и лишних decorative differences.

### 6. В разделах сначала показывать свежие новости

Файлы:
- `lib/articles.ts`
- `app/api/categories/[category]/articles/route.ts`
- `src/components/CategoryArticleList.tsx`
- тесты для пагинации.

Работы:
1. Изменить основной список разделов:
   - `getArticlesByCategoryPage()` должен сортировать по `created_at desc` или `pub_date desc nulls last`, затем `score desc`;
   - то же должно использоваться API load-more.
2. Не смешивать задачу с «интересностью»:
   - основной список раздела = свежесть;
   - «Самое интересное» = отдельный блок и отдельный запрос.
3. Проверить pagination stability:
   - при одинаковой дате добавить tie-breaker `id` или `created_at + score + id`, если Supabase API позволяет;
   - не допустить дублей между страницами при load-more.
4. Приёмка:
   - в каждом разделе первые карточки самые свежие;
   - load-more сохраняет порядок;
   - тест покрывает, что старый high-score материал не поднимается выше более свежего в обычной ленте.

### 7. Добавить блок «Самое интересное» в разделах

Файлы:
- новый `lib/interest-ranking.ts`
- `lib/articles.ts`
- `app/categories/[category]/page.tsx`
- `src/components/CategoryArticleList.tsx` или новый `src/components/InterestingArticles.tsx`
- возможно новая Supabase RPC/view после прототипа.

MVP-алгоритм:
1. Candidate pool:
   - live + quality_ok + verified_live;
   - текущая категория: `primary_category = category OR secondary_categories contains category`;
   - окно: последние 7 дней, fallback 30 дней;
   - исключить статьи, уже показанные в первой свежей странице, если блок стоит ниже hero.
2. Score:
   - `editorial_score = article.score`;
   - `freshness = exp(-ageHours / 48)` или HN-style decay;
   - `source_weight` по доверенным источникам;
   - `content_quality_bonus`: есть lead, summary, editorial_body, нормальный slug;
   - `media_penalty`: подозрительная/отсутствующая после sanitizer картинка не должна давать бонус;
   - `diversity_penalty`: не более 1 статьи от одного source в top-4, не более 2 подряд из одной темы.
3. Формула для старта:
   - `interest = score * 1.0 + freshness * 3.0 + sourceWeight + qualityBonus - duplicatePenalty`;
   - хранить формулу в коде рядом с тестами, не размазывать по UI.
4. UI:
   - блок «Самое интересное» в каждом разделе после hero/tabs и перед свежей лентой;
   - 3-4 карточки, компактнее hero, но заметнее обычной сетки;
   - без персонализации и без скрытого tracking на первом этапе.
5. Следующий этап после MVP:
   - начать собирать anonymous events: article impression, article click, dwell bucket;
   - хранить только агрегаты по статье/категории за день, без пользовательского профиля;
   - когда будет достаточный объём, рассмотреть LightFM/implicit или TensorFlow Recommenders.
6. Приёмка:
   - блок не дублирует очевидно свежую ленту один-в-один;
   - «Самое интересное» можно объяснить по debug components;
   - если данных мало, блок скрывается, а не показывает мусор.

## Сквозная приёмка

1. `npm run build` проходит.
2. Добавлены unit-тесты для `media-sanitizer` и `interest-ranking`.
3. Добавлен dry-run backfill для текущих статей, в логах видны удалённые ad/author images.
4. На live smoke:
   - главная light/dark;
   - один раздел light/dark;
   - статья с бывшим Habr banner;
   - статья с бывшим Ars Technica author photo;
   - mobile viewport.
5. В Supabase не остаются рекламные/авторские inline images в опубликованных статьях после backfill.
6. Документы и footer не показывают явную кнопку «Отозвать согласие».

## Риски и решения

- Ложные удаления хороших иллюстраций: сначала делать sanitizer в dry-run и логировать причины; source-specific allowlist вводить только на проверенных источниках.
- Производительность: не считать interest-rank на клиенте. Для MVP ранжировать в server function после выборки ограниченного pool, затем при необходимости вынести в SQL/RPC.
- Юридический контур: перед удалением opt-out кнопки согласовать формулировки cookie/privacy с юристом, чтобы не потерять управляемость согласия.
- Персонализация: не внедрять пользовательские профили до явного решения по privacy. Для первого релиза достаточно редакционного/агрегированного ranking.

## Предлагаемый порядок выполнения

1. Media sanitizer + tests.
2. Backfill cleanup existing articles.
3. Article render fallback using sanitizer.
4. Consent page/footer cleanup.
5. Hero contrast fix.
6. Main/category card unification.
7. Category freshness sorting.
8. «Самое интересное» MVP.
9. Final smoke + deploy.
