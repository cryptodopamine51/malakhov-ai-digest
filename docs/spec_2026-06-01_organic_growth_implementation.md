# Spec: реализация плана роста органики и воронки в услуги

> Рабочий документ (не канонический). Дата: 2026-06-01.
> База: `docs/report_2026-06-01_organic_growth.md`. Решения владельца — §8.5 отчёта.
> Порядок волн = приоритет §5 отчёта: сначала «заткнуть воронку», потом чистка темы,
> параллельно — долгоиграющий актив.

## Решения, зашитые в план
- Главный оффер сайта услуг — **консультация**. База текста — `malakhovai.ru`.
- Обложки гайдов — только от владельца (template-обложки не используем).
- Авторство: гайды — видимый байлайн с фото и личным TG; новости — «редакция» + карточка автора.
- Продвигаем личный TG `@malakhovai` отдельно от канала-дайджеста `@malakhovaidigest`.

---

## Прогресс

- **Волна 1 — DONE (2026-06-01).** T1 (единый `src/components/AuthorCard.tsx` + фикс перепутанных
  channel/personal TG fallback'ов в `TelegramCTA`/`Footer`/`.env.example`/`lib/site.ts`), T2
  (акцентный CTA-блок консультации в новости), T3 (мост «Разобраться глубже» на гайд по
  `primary_category` через `lib/guide-bridge.ts` + усиленный блок «Читать дальше»), T4 (страница
  `/services` с ProfessionalService+BreadcrumbList JSON-LD, UTM на консультацию, в sitemap и nav).
  Проверено визуально в браузере (desktop+mobile): канал «Подписаться»→`@malakhovaidigest`, личный
  «Личный Telegram»→`@malakhovai`, консультация→`/services` (на новости с UTM). Build/тесты зелёные.
- **T5 — DONE (2026-06-01).** Часть A: расширен `OFF_TOPIC_KEYWORDS` (`pipeline/keyword-filters.ts`)
  по топ-запросам Вебмастера; фильтр глобальный на ingest; тест в `tests/node/rss-parser-rejected.test.ts`
  (9/9). Часть B: `scripts/withdraw-off-topic.ts` (idempotent, dry-run/apply) — сняты **8** off-topic
  ZDNet-статей в `publish_status='withdrawn'` (NAS, 2× Sony-наушники, 2× NordVPN, RS-232,
  Android-файл-менеджер, Fitbit/Whoop). 2 borderline (`falcongaze` DLP-с-ИИ, `flutter-3.44`
  Agentic Hot Reload) оставлены live — есть реальная AI-грань. Источник off-topic: статьи
  просочились до включения `needsKeywordFilter` у ZDNet (теперь закрыто). Деплой не требуется
  (ISR подхватит withdrawn). Опционально: пинг IndexNow по снятым URL — шаг владельца.
- **T8 — DONE (2026-06-01).** Добавлен «вес важности истории» в `lib/interest-ranking.ts`.
  - Story-derivation вынесена из `bot/digest-selection.ts` в новый `lib/story-signal.ts`
    (`deriveDigestStory`, `extractNumericAnchors`, типы `DigestStory`/`DigestEventType`/
    `DigestSelectionArticle`); `bot/digest-selection.ts` ре-экспортит их — дайджест и его тесты
    работают без изменений API (digest-story-dedup 10/10, digest-diversity 4/4 зелёные).
  - `getStoryImportance()` складывает 4 сигнала: `eventTypeWeight` (funding/model_release/
    acquisition=3, product_launch/partnership/regulation/security=2, benchmark/research/
    business_case=1, other=0), `magnitudeBonus` (денежный тир ≥$1B→3 / ≥$100M→2 / любая→1),
    `entityBonus` (+1 primaryEntity, +0.5 strong), `multiSourceBonus` (пред-проход
    `buildStorySourceCounts`: storyKey→число различных source_name; 2→1, 3→2, ≥4→3).
  - Ребаланс весов: `freshness×3 → ×2`, добавлен `importance×1.5` в блоке «Самое интересное»;
    в рекомендациях importance мягкий (`×0.8`) — тай-брейк, не перебивает relevance.
  - Тесты: 3 новых кейса в `tests/node/interest-ranking.test.ts` (мульти-источниковый крупный
    funding обгоняет свежий проходняк; model_release известной лабы > мелкий апдейт той же
    свежести; мягкий буст в рекомендациях). Полный прогон interest-ranking 12/12; все 9
    существующих кейсов зелёные; `tsc --noEmit` чисто. Без боевой БД, без деплоя (render-time).
  - **Аудит охвата `pipeline/feeds.config.ts` (read-only, без правок).** Блокеров для T8 нет:
    multiSource-буст считается по нашему пулу, и крупные сюжеты обычно подхватываются ≥2
    посредниками (TechCrunch/Verge/Decoder/Crunchbase) → буст срабатывает. Зафиксированные дыры
    охвата (кандидаты на отдельную задачу, требуют подтверждения владельца): нет first-party
    фидов у **Anthropic** (главный для проекта entity — только через посредников), **Mistral**,
    **xAI**, **Meta/Llama**, а также ru-лаб **Sber/SberAI** и **Yandex Research** (Tier 2
    white-list). Отключённые по 404: Axios Pro Rata, a16z, vc.ru Финансы/Стартапы. Риск для
    importance: важная история из одного-единственного фида не получит multiSource-буст, но
    eventType/magnitude/entity всё равно работают.
  - **Проверка first-party фидов (2026-06-01, по итогу аудита).** Живьём прозондированы эндпоинты
    лабораторий из дыр охвата — пригодного AI-RSS нет: Anthropic (`/rss.xml`,`/feed.xml`,
    `/news.rss`,`/news/atom.xml` → 404), Mistral (`/rss.xml`,`/feed.xml`,`/news/feed.xml` → 404),
    xAI (`/rss.xml`,`/blog/rss.xml` → 403 Cloudflare), Meta AI (`ai.meta.com/blog/{rss,feed}.xml`
    → 404; `about.fb.com/news/feed` валиден, но это широкий корпоративный newsroom — отклонён как
    шум против цели T5), Cohere/Stability (`?format=rss` → SPA HTML), Yandex Research
    (`/blog/rss.xml` → HTML-SPA). Итог: в `pipeline/feeds.config.ts` ничего не добавлено; добавлен
    документированный блок проверенных-непригодных эндпоинтов, чтобы не перепроверять каждый раз.
    Перепроверять при следующем ревью охвата.
  - **Importance занесён и в Telegram-дайджест (2026-06-01, дополнение).** Тот же
    `lib/story-signal.ts::getStoryImportance` подключён к отбору дайджеста через новый
    `rankDigestCandidates()` в `bot/digest-selection.ts`: кандидаты детерминированно
    переупорядочиваются по `editorial score + DIGEST_IMPORTANCE_WEIGHT (0.5) × importance`
    ПЕРЕД `selectDigestArticles`; caps/storyKey-дедуп/recent-memory не трогаются. Подключено в
    активном боевом пути `bot/channel-post-core.ts::buildChannelPostPlan` (5 фото-постов) и в
    legacy `bot/daily-digest-core.ts::runClaimedDigest` для консистентности. Эффект: мульти-
    источниковый крупный сюжет (Anthropic $65B из 3 изданий) поднимается к топу и берёт слот,
    а его дубли отсекаются как `duplicate_story`, а не топится проходняком. Тесты: новый
    `tests/node/digest-importance.test.ts` (3 кейса: подъём над выше-raw-score проходняком;
    rank→select держит caps — один funding в слотах, дубли skipped; детерминизм). Прогоны
    digest-importance/digest-story-dedup/digest-diversity/channel-post/tg-digest-idempotency
    зелёные; `tsc --noEmit` чисто. Без боевой БД.
- **T9 — DONE (2026-06-01).** Процесс закрепления выстреливших тем зафиксирован в
  `docs/ORCHESTRATOR.md` (новая секция «Закрепление выстреливших тем из поиска»): каденс раз в
  2–4 недели, источник сигнала Я.Вебмастер/GSC, правило решения (нет покрытия → запись в
  `content/evergreen/topics.json` `status: planned` → выпуск по `docs/EVERGREEN_AGENT.md`),
  шаблон и журнал ревью. Чистый docs, без кода.
- **T6 — тех-часть DONE (2026-06-01); подача за владельцем.** Проверено: `/news-sitemap.xml`
  полностью соответствует протоколу Google News (обязательные `news:`-теги, 48ч окно, ≤1000 URL,
  ISR 10м), оба sitemap-а в `robots.txt`, `/rss.xml` валиден — изменений в коде не потребовалось.
  В `docs/OPERATIONS.md` добавлена секция «Новостные агрегаторы» с тех-вердиктом, чеклистом подачи
  и таблицей статусов; в `docs/PROJECT.md` — поверхность дистрибуции. Подача в Google Publisher
  Center / Я.Вебмастер — зона владельца (статус «ожидает подачи»). Яндекс-новостной формат
  (СМИ-регистрация + отдельный `yandex:`-RSS) — решение владельца, не начато.
- **T7 — хаб кластера «ИИ-агенты» DONE (2026-06-01); обложки + снятие noindex за владельцем.**
  Выпущен первый гайд коммерческого кластера: `id 7` «ИИ-агенты для бизнеса: что это и где
  применять» (`/guides/ii-agenty-dlya-biznesa-chto-eto-i-gde-primenyat`). Пакет
  `content/evergreen/packages/ii-agenty-dlya-biznesa-chto-eto-i-gde-primenyat/` полный (13 файлов),
  `07-final-article.md` ~10k знаков по quality bar (factual anchor Gartner в лиде, кейс
  «Редакционный пример» с H3 «Ситуация», counter-strategy H2 «Когда ИИ-агенты не стоит внедрять»,
  worked example окупаемости, российский контекст 152-ФЗ/GigaChat/YandexGPT, ≥2 внутренних ссылок,
  7 FAQ). Продакшен-копии в `content/guides/...md` + `content/guides/meta/...json`, `noindex: true`.
  Воронка: 2 inline-CTA + 3 ctaCards (`telegram-digest`/`contacts`/`telegram-personal`); путь на
  `/services` идёт через глобальный `AuthorCard`, как у соседних гайдов кластера «ИИ для бизнеса».
  `topics.json` id 7 → `ready_for_codex`. `evergreen:check` зелёный (единственный warn — placeholder
  cover 12 KB), `npm run build` exit 0 (страница в SSG-списке), `tsc --noEmit` чисто, рендер
  проверен в preview (все секции, CTA, кейс, FAQ, cover 1200px, без console-ошибок). Обложка +
  3 inline-картинки — placeholder'ы (копии cover соседнего гайда); генерация в ChatGPT, прогон
  `images:prep` и снятие `noindex` — зона владельца.
- **T7 — гайд `id 9` «ИИ-агенты в продажах» DONE (2026-06-02); обложки + снятие noindex за владельцем.**
  Второй гайд кластера «ИИ-агенты»: `id 9` «ИИ-агенты в продажах: сценарии, кейс и расчёт
  окупаемости» (`/guides/ii-agenty-v-prodazhah`). Пакет
  `content/evergreen/packages/ii-agenty-v-prodazhah/` полный (13 файлов), `07-final-article.md`
  ~14k знаков по quality bar (factual anchor McKinsey/Salesforce в лиде, таблица
  «менеджер/сценарный бот/ИИ-агент», 5 сценариев с оценкой зрелости, кейс квалификации+follow-up
  в B2B «Редакционный пример» с H3 «Ситуация», worked example окупаемости агента квалификации,
  counter-strategy H2 «Когда ИИ-агенты в продажах не стоит внедрять», российский контекст
  152-ФЗ/GigaChat/YandexGPT/amoCRM/Bitrix24, 4 внутренних ссылки на хаб id 7,
  `/guides/kak-vybrat-pervyj-ii-proekt-v-biznese`, `/categories/ai-industry`, `/russia`, 7 FAQ).
  Продакшен-копии в `content/guides/ii-agenty-v-prodazhah.md` + `.../meta/...json`, `noindex: true`.
  Воронка: 2 inline-CTA + 3 ctaCards (`telegram-digest`/`contacts`/`telegram-personal`); путь на
  `/services` через глобальный `AuthorCard`. `topics.json` id 9 → `ready_for_codex`.
  `evergreen:check` зелёный (единственный warn — placeholder cover 12 KB), `npm run build` exit 0
  (страница в SSG-списке), `tsc --noEmit` чисто, рендер проверен в preview (HTTP 200, все секции,
  оба inline-CTA, 3 inline-картинки сматчились по slug-заголовкам, FAQ, без console-ошибок).
  Cover + 3 inline (`ii-prodazhi-cover/scenarii/okupaemost/itog.webp`) — placeholder'ы (копии cover
  соседнего гайда); генерация в ChatGPT, прогон `images:prep` и снятие `noindex` — зона владельца.
- **Осталось:** T7 — остальные гайды кластеров «ИИ-агенты» (id 8, 10–12) и «Инструменты и сравнения»
  (id 25–30); по каждому — обложки владельца и снятие `noindex` после готовности.

---

## Волна 1 — Воронка (быстрые победы, дни)

### T1. Карточка автора + личный TG (единый компонент)
- **Создать** `src/components/AuthorCard.tsx`: фото (`public/about/editor.jpg`), имя,
  одна строка-роль, 2 кнопки — личный TG (`@malakhovai`) и консультация (`/services`,
  с переходом далее на `malakhovai.ru/contacts`).
- **Гайды** (`app/guides/[slug]/page.tsx`): видимый байлайн вверху (имя + фото + дата +
  «Актуальность проверена») и `AuthorCard` в конце.
- **Новости** (`app/categories/[category]/[slug]/page.tsx`): строка «Подготовлено
  редакцией Malakhov AI» + `AuthorCard` рядом с `TelegramCTA` (строка ~754).
- **Env/конфиг:** личный TG — отдельная переменная (не путать с
  `NEXT_PUBLIC_TELEGRAM_CHANNEL_URL`). Канал-дайджест и личный TG — разные кнопки.
- **Acceptance:** на гайде виден автор+фото; на новости виден «редакция»+карточка; обе TG-ссылки
  ведут в нужные аккаунты; мобильная верстка без наложений.
- **Docs impact:** `docs/PROJECT.md` (surfaces/CTA), `docs/DESIGN.md` (новый компонент),
  `docs/editorial/seo-article-publication-standard.md` §14 (разрешённые CTA + личный TG).

### T2. CTA на консультацию в новостях
- В зоне CTA новости (рядом с T1) — компактный блок «Внедряю ИИ в бизнес — обсудить задачу»
  → `/services`. UTM-метки для трекинга.
- **Acceptance:** клик ведёт на `/services`; не дублирует Telegram-CTA визуально.
- **Docs impact:** `docs/PROJECT.md`, SEO-стандарт §14.

### T3. Мост «новость → гайд» + усиление related
- На странице новости — видимый блок «Разобраться глубже» со ссылкой на тематически
  релевантный гайд (маппинг `primary_category`/`topics` → гайд из `lib/guides.ts`).
  Напр. ai-startups/ai-investments → «Как внедрить ИИ в бизнес», coding → AI-coding гайд.
- Поднять заметность related-блока (заголовок «Читать дальше», выше по странице),
  проверить рендер на мобильных (цель — поднять глубину просмотра с 1,27).
- **Acceptance:** на каждой новости есть ≥1 внутренняя ссылка на гайд или related; блок виден на мобиле.
- **Docs impact:** `docs/ARTICLE_SYSTEM.md` (рендер/перелинковка), `docs/PROJECT.md`.

### T4. Страница услуг `/services`
- **Создать** `app/services/page.tsx` (индексируемая, ISR). Структура: оффер (консультация)
  → что входит (аудит / пилот / полное внедрение) → для кого → как проходит → заявка
  (`malakhovai.ru/contacts`) + личный TG.
- Тексты на базе `malakhovai.ru`; финальные формулировки и обложку даёт владелец.
- Metadata + canonical (`news.malakhovai.ru/services`), schema (`Service`/`ProfessionalService`
  или `WebPage` + `Person`), добавить в `app/sitemap.ts` и в навигацию (Header/Footer).
- **Acceptance:** страница 200, в sitemap, в меню, заявка/TG кликаются, schema валидна.
- **Docs impact:** `docs/PROJECT.md` (новая surface), SEO-стандарт §15 (schema), `docs/ARCHITECTURE.md` если нужно.

---

## Волна 2 — Тематическая чистота (1–2 недели)

### T5. Аудит и чистка не-AI контента
- Свериться с топ-запросами Яндекс.Вебмастера (rs232c, NAS, nordvpn, sony xm6, whoop…):
  найти соответствующие live-статьи, перевести нерелевантные в `noindex`/`withdrawn`.
- Ужесточить широкие фиды (`pipeline/feeds.config.ts`), расширить `OFF_TOPIC_KEYWORDS`
  (`pipeline/keyword-filters.ts`) по реально замеченным запросам.
- **Acceptance:** не-AI запросы уходят из индекса; новые off-topic items режутся на ingest.
- **Docs impact:** `docs/ARTICLE_SYSTEM.md` (Sources and feed filters).

### T6. Регистрация в новостных агрегаторах (владелец + проверка)
- Проверить и подать: Яндекс (Вебмастер/Дзен новостной формат) и Google Publisher Center.
- Технически убедиться, что `/news-sitemap.xml` соответствует требованиям агрегаторов.
- **Acceptance:** заявки поданы, статус зафиксирован; news-sitemap проходит валидацию.
- **Docs impact:** `docs/OPERATIONS.md` (новостные агрегаторы), `docs/PROJECT.md`.

---

## Волна 3 — Долгоиграющий актив + качество отбора (постоянный поток)

### T7. Выпуск гайдов по коммерческим кластерам
- Приоритет: «ИИ-агенты» (id 7–12) и «Инструменты и сравнения» (id 25–30) из
  `content/evergreen/topics.json`. Процесс — по `docs/EVERGREEN_AGENT.md`.
- Обложки от владельца (узкое место осознанно оставлено ручным).
- Все гайды перелинковываются на `/services` и используют `AuthorCard` (T1).
- **Acceptance:** `evergreen:check` зелёный, гайд в sitemap, перелинковка на услуги.
- **Docs impact:** `docs/ARTICLE_SYSTEM.md` если меняется guide-логика; иначе no.

### T8. «Вес важности истории» в отборе (новая логика)
- Добавить в скоринг/ранжирование сигнал важности: масштаб (тиры суммы сделки, релиз модели
  vs мелкий апдейт) + известность игрока + **подтверждение несколькими источниками**
  (переиспользовать `storyKey` из `bot/digest-selection.ts`: много источников по теме → буст,
  а не только дедуп).
- Пересмотреть веса в `lib/interest-ranking.ts` (свежесть ×3 vs качество ×1) — чтобы «интересное»
  значило «важное за период», а не только «самое новое».
- Аудит охвата `pipeline/feeds.config.ts`: нет ли дыр в источниках, где темы ломаются первыми.
- **Acceptance:** на исторических датах важные сюжеты (крупные раунды/релизы, мульти-источник)
  поднимаются выше проходных; покрыто тестами (`tests/node/`).
- **Docs impact:** `docs/ARTICLE_SYSTEM.md` (Score и publish gate / digest selection).

### T9. Закрепление выстреливших тем (процесс)
- Раз в 2–4 недели смотреть топ-запросы Вебмастера → под повторяющиеся темы заводить
  evergreen-гайд (напр. «как ИИ-стартапы привлекают инвестиции» под funding-запросы).
- **Acceptance:** процесс зафиксирован; первый гайд под выстрелившую тему выпущен.
- **Docs impact:** `docs/ORCHESTRATOR.md` (backlog/процесс).

---

## Последовательность
1. Волна 1 (T1–T4) — даёт воронку и точку приземления уже на текущем трафике.
2. Волна 2 (T5–T6) — чистит тему и открывает новостные карусели.
3. Волна 3 (T7–T9) — наращивает долгоиграющий трафик и поднимает качество отбора.

Каждая задача закрывается строкой `Docs updated: ...` или `Docs impact: no` (правило CLAUDE.md).
