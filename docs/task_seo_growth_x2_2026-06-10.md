# SEO growth x2 — локальный план реализации

Дата: 2026-06-10  
Цель: увеличить органический трафик за следующую неделю через исправление индексации, открытие готовых evergreen-страниц и усиление внутренней перелинковки.

## Исходное состояние

- Production-домен: `https://news.malakhovai.ru`.
- `robots.txt`, `sitemap.xml`, `news-sitemap.xml`, `rss.xml`, `llms.txt`, `llms-full.txt` доступны.
- В Supabase: 1623 live/verified статьи со slug.
- В публичном `sitemap.xml`: 1000 article URL. Причина: `getAllArticlesForSitemap()` в `lib/articles.ts` не пагинирует Supabase REST-запрос, а REST API возвращает максимум 1000 строк.
- В `news-sitemap.xml`: 95 свежих URL за 48 часов, это корректно.
- Индексируемых evergreen-гайдов: 6.
- Два готовых гайда про ИИ-агентов стоят в `noindex`; оба проходят `evergreen:check`, но имеют warning по слабой cover-картинке.
- Гайд `kak-vnedrit-ii-v-biznes-2026` не проходит текущий evergreen standard.

## Приоритет 0 — исправить sitemap cap

### Задача

Убрать потерю ~623 live URL из основного sitemap.

### Файлы

- `lib/articles.ts`
- `app/sitemap.ts`
- опционально тест: `tests/node/sitemap-pagination.test.ts`

### Реализация

1. Вынести общий фильтр live/verified статей для sitemap.
2. В `getAllArticlesForSitemap()` заменить одиночный Supabase-запрос на пагинированную выборку через `.range(from, to)`.
3. Размер страницы: 1000.
4. Останавливать цикл, когда вернулось меньше page size.
5. Дедуп по `toPublicArticleSlug()` оставить.
6. На текущем объёме можно оставить один `sitemap.xml`: 1623 article URL далеко ниже лимита 50 000 URL и 50 MB. Sitemap index пока не нужен.

### Проверка

```bash
npm run build
node - <<'NODE'
const https = require('https')
https.get('https://news.malakhovai.ru/sitemap.xml', (res) => {
  let d = ''
  res.on('data', (c) => d += c)
  res.on('end', () => {
    const locs = [...d.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    console.log({ total: locs.length, article: locs.filter((u) => u.includes('/categories/')).length })
  })
})
NODE
```

Локально перед деплоем можно проверить через `next build` route summary. После деплоя ожидаемый sitemap: примерно 1642 URL total = 13 static + 6 guides + 1623 articles.

### Acceptance criteria

- `getAllArticlesForSitemap()` возвращает все 1623 live/verified article URL.
- `sitemap.xml` после deploy содержит больше 1600 article URL.
- Все URL в sitemap canonical и отдают `200`.

## Приоритет 1 — открыть два noindex-гайда про ИИ-агентов

### Задача

Добавить в индекс готовые страницы под растущий спрос:

- `/guides/ii-agenty-dlya-biznesa-chto-eto-i-gde-primenyat`
- `/guides/ii-agenty-v-prodazhah`

### Файлы

- `content/guides/meta/ii-agenty-dlya-biznesa-chto-eto-i-gde-primenyat.json`
- `content/guides/meta/ii-agenty-v-prodazhah.json`
- `public/images/guides/ii-agenty-dlya-biznesa-chto-eto-i-gde-primenyat/...`
- `public/images/guides/ii-agenty-v-prodazhah/...`

### Реализация

1. Перегенерировать cover-картинки через ChatGPT subscription, не image API.
2. Прогнать `npm run images:prep -- --slug=<slug>` при наличии raw PNG.
3. Убедиться, что final WebP cover >= 50 KB.
4. Снять `noindex: true` -> `noindex: false`.
5. Обновить `updatedAt` и при необходимости `verifiedAt`.
6. Прогнать checker.

### Проверка

```bash
npm run evergreen:check -- --slug=ii-agenty-dlya-biznesa-chto-eto-i-gde-primenyat
npm run evergreen:check -- --slug=ii-agenty-v-prodazhah
npm run build
```

После deploy:

```bash
curl -sSI https://news.malakhovai.ru/guides/ii-agenty-dlya-biznesa-chto-eto-i-gde-primenyat
curl -sSI https://news.malakhovai.ru/guides/ii-agenty-v-prodazhah
```

### Acceptance criteria

- Оба гайда без `noindex`.
- Оба есть в `sitemap.xml`.
- Оба возвращают `200`.
- Оба проходят `evergreen:check`.

## Приоритет 2 — восстановить главный evergreen-гайд

### Задача

Довести `/guides/kak-vnedrit-ii-v-biznes-2026` до текущего SEO standard.

### Найденные проблемы

- Нет package в `content/evergreen/packages/kak-vnedrit-ii-v-biznes-2026`.
- Cover `cover.webp` слишком слабый и с generic filename.
- В markdown 0 inline internal links на `/guides|/categories|/russia`.
- Есть mixed `AI-*` wording.

### Файлы

- `content/guides/kak-vnedrit-ii-v-biznes-2026.md`
- `content/guides/meta/kak-vnedrit-ii-v-biznes-2026.json`
- `content/evergreen/packages/kak-vnedrit-ii-v-biznes-2026/*`
- `public/images/guides/kak-vnedrit-ii-v-biznes-2026/*`

### Реализация

1. Создать недостающий evergreen package или восстановить его по опубликованному гайду.
2. Заменить `AI-*` на русский `ИИ-*` или нормальные русские конструкции.
3. Добавить минимум 2 inline internal links:
   - на `/guides/skolko-stoit-vnedrenie-ii-v-kompaniyu`
   - на `/guides/kak-vybrat-pervyj-ii-proekt-v-biznese`
   - при необходимости на `/russia` или релевантную категорию.
4. Перегенерировать cover с SEO filename.
5. Обновить metadata `cover.src`, `updatedAt`, `verifiedAt`.
6. Прогнать `evergreen:check`.

### Проверка

```bash
npm run evergreen:check -- --slug=kak-vnedrit-ii-v-biznes-2026
npm run build
```

### Acceptance criteria

- Checker проходит без errors.
- Cover >= 50 KB.
- Минимум 2 inline internal links.
- Страница остаётся indexable и возвращает `200`.

## Приоритет 3 — внутренние ссылки из новостей на evergreen

### Задача

Поднять вес evergreen-страниц через свежие новости и category pages.

### Реализация

1. Составить mapping:
   - агентные новости -> `ii-agenty-dlya-biznesa...`, `ii-agenty-v-prodazhah`
   - бизнес/ROI новости -> `skolko-stoit-vnedrenie-ii...`, `kak-vybrat-pervyj...`
   - ошибки/провалы -> `oshibki-vnedreniya-ii...`
2. Для последних 50 live-статей добавить/проверить `link_anchors`, чтобы `resolveAnchorLinks()` мог вставить релевантные ссылки.
3. Не добавлять ссылки, если якорь не встречается дословно в `editorial_body`.
4. После правок прогнать валидатор статей.

### Файлы

- `lib/articles.ts` если нужен smarter resolver.
- `pipeline/claude.ts` / editorial prompt только если надо улучшать будущую генерацию.
- Production DB `articles.link_anchors` / `editorial_body` для ручных точечных правок.

### Acceptance criteria

- Минимум 30 свежих статей имеют релевантные inline links на evergreen.
- Не ломается `validateEditorialDetailed()`.
- Публичные статьи отдают `200`.

## Приоритет 4 — новые evergreen-гайды на неделю

### Цель

Выпустить 5–8 новых evergreen-страниц под низко- и среднечастотные коммерческо-информационные запросы.

### Кандидаты

1. `stoimost-ii-agenta-dlya-biznesa`
   - primary keyword: стоимость ИИ-агента
   - intent: commercial-adjacent
2. `ii-agent-dlya-otdela-prodazh`
   - primary keyword: ИИ-агент для продаж
   - intent: practical
3. `ii-dlya-podderzhki-klientov`
   - primary keyword: ИИ для поддержки клиентов
   - intent: practical
4. `lokalnye-llm-dlya-biznesa`
   - primary keyword: локальные LLM для бизнеса
   - intent: practical
5. `kak-vybrat-podryadchika-po-ii`
   - primary keyword: подрядчик по ИИ
   - intent: commercial-adjacent
6. `rag-dlya-biznesa-chto-eto`
   - primary keyword: RAG для бизнеса
   - intent: informational/practical
7. `ii-avtomatizatsiya-dokumentov`
   - primary keyword: автоматизация документов ИИ
   - intent: practical
8. `ii-vnedrenie-v-otdele-marketinga`
   - primary keyword: ИИ в маркетинге для бизнеса
   - intent: practical

### Workflow

Для каждого slug:

```bash
npm run evergreen:new -- --slug=<slug>
# заполнить package, финальный markdown, metadata, image prompts
npm run images:prep -- --slug=<slug>
npm run evergreen:check -- --slug=<slug>
npm run build
```

### Acceptance criteria

- Каждый гайд проходит `evergreen:check`.
- У каждого есть cover >= 50 KB.
- У каждого минимум 2 inline internal links.
- У каждого visible FAQ, если emitted `FAQPage`.
- После deploy каждый URL есть в `sitemap.xml`.

## Приоритет 5 — облегчить главную и категории

### Наблюдение

- Главная HTML: около 514 KB.
- Категория `ai-industry`: около 467 KB.
- Статья: около 80 KB.
- Гайд: около 276 KB.

### Задача

Уменьшить HTML вес главной и категорий без потери SEO-контента первого экрана.

### Возможные изменения

1. Сократить initial article payload на главной с текущего объёма до 12–16 карточек.
2. Для category pages держать 20 карточек, но проверить, не рендерятся ли лишние данные в HTML.
3. Убедиться, что lazy load через `/api/feed` и `/api/categories/<category>/articles` не попадает в индексируемый HTML как дублирующий мусор.
4. Не переводить страницы в dynamic rendering.

### Проверка

```bash
npm run build
curl -sL -o /dev/null -w 'size=%{size_download} ttfb=%{time_starttransfer} total=%{time_total}\n' https://news.malakhovai.ru/
curl -sL -o /dev/null -w 'size=%{size_download} ttfb=%{time_starttransfer} total=%{time_total}\n' https://news.malakhovai.ru/categories/ai-industry
```

### Acceptance criteria

- Главная HTML < 350 KB.
- Category HTML < 350 KB.
- Route summary остаётся Static/SSG + ISR.

## Деплой

Перед deploy:

```bash
git status --short
npm run build
```

Deploy:

```bash
vercel deploy --prod
```

После deploy:

```bash
curl -sSI https://news.malakhovai.ru/sitemap.xml
curl -sSI https://news.malakhovai.ru/news-sitemap.xml
curl -sSI https://news.malakhovai.ru/guides/ii-agenty-dlya-biznesa-chto-eto-i-gde-primenyat
curl -sSI https://news.malakhovai.ru/guides/ii-agenty-v-prodazhah
```

## Финальная проверка роста

Нужны внешние данные:

- Google Search Console: impressions, clicks, CTR по страницам и запросам.
- Yandex Webmaster: индексирование sitemap и быстрые страницы.
- Логи/аналитика сайта: organic sessions, top landing pages.

Без GSC/Analytics можно проверять только техническую готовность, но не доказанный x2.


---

## Прогресс

- **P0 — DONE (2026-06-10).** `getAllArticlesForSitemap()` пагинирует `.range()` по 1000 строк
  (инжектируемый `fetchPage` для тестов), дедуп по `toPublicArticleSlug()` сохранён.
  Тест `tests/node/sitemap-pagination.test.ts`. Пост-деплой проверка sitemap — ниже.
- **P1 — DONE (2026-06-10).** Обложки от владельца прогнаны: id 7 — 138 KB, id 9 — 131 KB
  (>= 50 KB bar); `noindex: false`, `updatedAt: 2026-06-10`; `evergreen:check` ok по обоим.
- **P2 — DONE (2026-06-10).** Пакет `content/evergreen/packages/kak-vnedrit-ii-v-biznes-2026/`
  восстановлен (13 файлов); cover `ii-vnedrenie-biznes-cover.webp` 124 KB c SEO-именем;
  2 inline internal links в лиде (cost-гайд + выбор первого проекта); «AI-*»-формулировки
  зачищены; `verifiedAt: 2026-06-10`; `evergreen:check` ok.
- **Бонус к P3:** `getGuideBridgeForArticle()` в `lib/guide-bridge.ts` — мост из новостей
  выбирается по контенту (агентные новости → гайды кластера «ИИ-агенты», sales-сигнал → id 9),
  фолбэк — прежний категорийный мост. Тест `tests/node/guide-bridge.test.ts`.
- **P3 (link_anchors в 50 свежих статьях, DB-правки) и P4 (новые гайды)** — не начаты,
  следующая итерация.
