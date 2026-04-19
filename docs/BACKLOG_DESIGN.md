# Дизайн: бэклог доработок

> Создан 2026-04-19. Обновлён 2026-04-19 (итерация 2).
> Приоритет: P1 — критично, P2 — важно, P3 — улучшение.
> ✅ — выполнено.

---

## ✅ Выполнено

- ✅ Шрифты: Playfair Display → Onest + IBM Plex Mono (mono только для чисел в статблоках)
- ✅ Акцентный синий: `#0055FF` → `#0A84FF` / `#40A0FF` (dark) — Apple system blue, modern/tech
- ✅ Иконка Telegram — синяя (`#26A5E4`)
- ✅ font-mono убран из всех лейблов/кикеров (Onest `font-serif` вместо)
- ✅ Глоссарий перемещён под «Кратко», перед телом статьи
- ✅ SVG-изображение из /demo убрано (картинки будут добавлены позже по шаблону)
- ✅ EditorialBlocks: 7 блоков (StatGrid, Timeline, EntityGrid, Thesis, PullQuote, Signal, Comparison)
- ✅ Демо-статья `/demo` с полным набором блоков
- ✅ Двухколоночный лейаут статьи (sidebar 200px + main) с sidebar на десктопе
- ✅ Pull-quote в реальных статьях: автоизвлечение из summary[1] при score ≥ 3 и summary ≥ 3 пунктов
- ✅ Заголовок статьи в хедере при скролле (StickyArticleTitle, top-14, fade in после 320px)
- ✅ Wireframe SVG иллюстрации для всех 7 категорий (ai-industry, ai-research, ai-labs, ai-investments, ai-startups, ai-russia, coding)
- ✅ Skeleton-loading карточек (ArticleCardSkeleton, ArticleCardSkeletonCompact)
- ✅ Featured card gradient overlay — уже был реализован
- ✅ ТОП-индикатор (border-l-accent) — уже был реализован при score ≥ 7
- ✅ Хедер: линия появляется при скролле (scrollY > 8)
- ✅ letter-spacing: -0.015em для font-serif (Onest) глобально
- ✅ Глоссарий: плавная анимация через grid-template-rows
- ✅ Время чтения: '~1 мин' для коротких статей (< 600 символов)
- ✅ /sources — страница работает, реализована полностью

## Остаток (требует pipeline-изменений)

### EditorialBlocks через enricher для всех статей
**Что**: автогенерация structured blocks (StatGrid, Timeline, EntityGrid) через Claude в enricher.ts
**Почему**: требует нового поля `editorial_blocks JSON` в БД, миграцию, изменение pipeline/enricher.ts
**Текущее состояние**: pull-quote работает через frontend-автоdetection из summary; остальные блоки — только для showcase-slugs

### Картинки для статей по шаблону
**Договорённость**: пользователь подготовит шаблон, после чего добавить генерацию

---

---

## P1 — Критичные

### 1. Двухколоночный лейаут страницы статьи
**Что**: DESIGN.md описывает layout 25% sidebar + 70% текст, но реализована одна колонка.
**Файл**: `app/articles/[slug]/page.tsx`
**Что сделать**: добавить sidebar с источником, датой, иконкой, курсивной редакционной заметкой. На мобайле — скрыть или вынести вверх.

### 2. Pull-quote из текста статьи
**Что**: `EditorialPullQuote` создан, но не используется в реальных статьях — нужно добавить поле `pull_quote` в article-schema или выделять из `editorial_body` через маркер `>>`.
**Файл**: `lib/supabase.ts`, `app/articles/[slug]/page.tsx`

### 3. Картинки для статей по шаблону
**Что**: обложки статей — пока заглушки или внешние URL. Нужно сделать генерацию по единому шаблону (OG-image style).
**Договорённость**: сделать позже, пользователь подготовит шаблон.

### 4. Прогресс-бар читаемости заголовка при скролле
**Что**: sticky-хедер должен показывать заголовок статьи при скролле вниз (описано в DESIGN.md, не реализовано).
**Файл**: `src/components/Header.tsx`, `src/components/ReadingProgress.tsx`

---

## P2 — Важные

### 4. Wireframe-иллюстрации для страниц категорий
**Что**: категории (Индустрия, Исследования, Лаборатории) должны иметь SVG-иллюстрацию в hero. Сейчас — просто текст.
**Файл**: `app/topics/[topic]/page.tsx`
**Подход**: создать набор из 6–7 SVG-иллюстраций в `/public/wireframes/` по одному на категорию.

### 5. EditorialBlocks в реальных статьях — не только showcase
**Что**: сейчас блоки жёстко привязаны к одному slug. Нужна система тегов в БД или поле `editorial_blocks` (JSON), чтобы любая статья могла получить блоки.
**Файл**: `app/articles/[slug]/page.tsx`, `lib/supabase.ts`, `pipeline/enricher.ts`
**Правила когда использовать блоки** (задать в enricher.ts):
  - `EditorialStatGrid`: статьи с финансовыми данными (score ≥ 4, топики ai-investments, ai-industry)
  - `EditorialTimeline`: статьи о развитии продуктов/компаний с временным контекстом
  - `EditorialComparison`: статьи с явным противопоставлением двух подходов/продуктов
  - `EditorialPullQuote`: любая статья с ярким тезисом, score ≥ 3
  - `EditorialSignal`: всегда для статей с очевидными risk/opportunity сигналами (ai-investments)
  - `EditorialEntityGrid`: статьи с несколькими упоминаемыми игроками рынка

### 6. Skeleton-loading для карточек
**Что**: описано в DESIGN.md, не реализовано. При SSR-переходах страницы — пустота вместо контента.
**Файл**: `src/components/ArticleCard.tsx`

### 7. Featured-карточка с gradient overlay
**Что**: описана в DESIGN.md как "Gradient overlay снизу: linear-gradient(transparent, rgba(0,0,0,0.75))". Используется ли в текущей реализации — уточнить.
**Файл**: `src/components/ArticleCard.tsx`

### 8. Индикатор ТОП дня у карточки
**Что**: левая полоска `3px solid #0055FF` у карточек с высоким score — описана в DESIGN.md, не реализована.
**Файл**: `src/components/ArticleCard.tsx`

---

## P3 — Улучшения

### 9. Время чтения — выровнять логику
**Что**: `readingMinutes` считается через деление на 1200 (символов). Для коротких статей (< 600 символов) показывается "1 мин" — это неточно для читателя. Добавить минимум "~1 мин" с тильдой.

### 10. Глоссарий — улучшить стилистику
**Что**: `<details>` глоссарий функционально работает, но анимация раскрытия резкая. Добавить `grid-rows` transition.
**Файл**: `app/articles/[slug]/page.tsx`

### 11. Страница `/sources` — карточки источников
**Что**: описана в DESIGN.md, роут существует, но реализация — уточнить полноту.

### 12. Хедер: линия при скролле
**Что**: "Нижняя линия 1px solid #E5E5E5 появляется при скролле" — не реализована (хедер всегда без линии или всегда с ней).
**Файл**: `src/components/Header.tsx`

### 13. letter-spacing для `font-serif` заголовков
**Что**: Onest при больших размерах (H1 hero) выигрывает от `letter-spacing: -0.02em` до `-0.03em`. Добавить в globals.css или в tailwind utilities.

---

## Правило для EditorialBlocks — когда что использовать

| Блок | Условие | Не использовать |
|---|---|---|
| `EditorialStatGrid` | ≥ 3 числовых данных в тексте | Без конкретных цифр |
| `EditorialTimeline` | История события / эволюция продукта | Одноразовые новости |
| `EditorialComparison` | Явное противопоставление 2+ вещей | Если это неочевидно |
| `EditorialEntityGrid` | ≥ 3 упомянутых игрока с ролями | Общие упоминания без контекста |
| `EditorialPullQuote` | Есть сильный тезис / цитата | В каждой статье |
| `EditorialSignal` | Явный risk или opportunity | Нейтральные новости |
| `EditorialThesis` | Статья с нетривиальным выводом | Новостные заметки без аналитики |
