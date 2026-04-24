# Execution Plan: Layout Remediation

Дата: 2026-04-21  
Статус: planned  
Тип документа: рабочий execution plan, не source of truth

## Цель плана

Исправить главные проблемы вёрстки и визуального ритма без хаотичного “косметического тюнинга”:

- убрать ранний переход в тесные desktop-like layout patterns;
- выровнять breakpoint-логику между header, home feed и article page;
- улучшить читаемость статьи на планшетах и небольших ноутбуках;
- сделать карточки и верхние секции менее монотонными;
- провести изменения с понятными тестами и приёмкой.

## Контекст и зафиксированные проблемы

### 1. Страница статьи уходит в 2 колонки слишком рано

Сейчас двухколоночная сетка включается уже с `md`, из-за чего на ширинах 768–1024 основной текст сжимается.

Файл:
- `app/articles/[slug]/page.tsx`

Кодовая точка:
- `md:grid md:grid-cols-[200px_1fr] md:gap-12`

### 2. Главная слишком рано уходит в 3 колонки

Лента и блок “Топ за сегодня” используют `md:grid-cols-3`, что на планшетах даёт узкие карточки.

Файл:
- `app/page.tsx`

Кодовые точки:
- `topToday` grid
- `feed` grid

### 3. Breakpoint-логика хедера расходится с контентом

Контент уже ведёт себя как desktop с `md`, а header остаётся mobile/burger до `lg`.

Файл:
- `src/components/Header.tsx`

### 4. Верх статьи слишком плотный

`lead`, `summary`, `video`, `glossary` и начало body стоят слишком близко друг к другу и воспринимаются как стек карточек без нормального ритма.

Файл:
- `app/articles/[slug]/page.tsx`

### 5. Карточки ленты слишком однотипные

Одинаковый силуэт, одинаковый ритм и одинаковая плотность создают ощущение “сеточного шума”.

Файл:
- `src/components/ArticleCard.tsx`

### 6. Featured card без изображения иногда выглядит пустой

Высота карточки фиксирована, но текстовый блок ограничен по ширине, из-за чего появляется ощущение недозаполненности.

Файл:
- `src/components/ArticleCard.tsx`

## Целевой результат

После правок:

- article page на планшете остаётся комфортной для чтения;
- home feed имеет более естественную адаптивную сетку `1 -> 2 -> 3`;
- header визуально согласован с ширинами контента;
- верх статьи получает более спокойный вертикальный ритм;
- карточки на главной отличаются по плотности и визуальному весу;
- нет горизонтальных переполнений и “зажатых” блоков на стандартных ширинах.

## Scope

Входит в этот этап:

- breakpoint-перестройка для home/article/header;
- spacing и vertical rhythm article page;
- корректировка силуэтов карточек;
- приведение основных листингов к более устойчивой адаптивной сетке.

Не входит в этот этап:

- полный редизайн визуальной системы;
- новая типографическая система;
- новая home-концепция с hero-иллюстрациями по всему сайту;
- переписывание editorial blocks;
- redesign sources/topic pages beyond necessary grid cleanup.

## Порядок реализации

### Phase 1. Breakpoint alignment

Цель:
- выровнять правило, когда интерфейс становится desktop-like.

Изменения:
- article page: отложить 2-column layout минимум до `lg`;
- home feed: перейти с `1/3` на `1/2/3`;
- related cards: проверить, не давать 3 карточки слишком рано;
- header: либо раньше включать desktop-nav, либо сделать промежуточное tablet state.

Основные файлы:
- `app/articles/[slug]/page.tsx`
- `app/page.tsx`
- `src/components/Header.tsx`
- `src/components/ArticleCard.tsx`

### Phase 2. Article page rhythm

Цель:
- убрать ощущение “кучи блоков” в начале статьи.

Изменения:
- увеличить отступы между `lead`, `summary`, `video`, `glossary`, body start;
- проверить высоту и поведение cover image;
- проверить визуальный баланс sidebar после сдвига breakpoint;
- убедиться, что mobile meta block не разваливается при большом числе topic badges.

Основной файл:
- `app/articles/[slug]/page.tsx`

### Phase 3. Card system cleanup

Цель:
- ослабить монотонность листингов.

Изменения:
- немного развести пропорции default / featured / related;
- проверить высоту featured no-image variant;
- скорректировать плотность текста и нижних meta rows;
- при необходимости уменьшить визуальную тяжесть одинаковых рамок.

Основной файл:
- `src/components/ArticleCard.tsx`

### Phase 4. Home page cleanup

Цель:
- сделать главную более ровной по ритму на основных ширинах.

Изменения:
- поправить spacing между hero, top section и feed;
- привести pagination/archive links к более аккуратному поведению на mobile;
- проверить, что featured card и последующий grid читаются как один композиционный блок.

Основной файл:
- `app/page.tsx`

### Phase 5. Secondary surfaces sanity pass

Цель:
- убедиться, что после базовых правок не осталось явных перекосов на topic/source pages.

Проверяем:
- `app/topics/[topic]/page.tsx`
- `app/sources/page.tsx`

Править только если есть прямой layout-regression или явная несогласованность с новым responsive contour.

## Тактические правила для реализации

1. Не распыляться на “ещё чуть-чуть поправить цвет/шрифт/иконку”.
2. Сначала исправлять breakpoint и measure problems, потом декоративные вещи.
3. Если блок читается плохо на 768–1024, это баг вёрстки, а не “особенность”.
4. Не вводить новый визуальный язык внутри одного прохода.
5. Все правки должны быть совместимы с текущими данными статьи: длинные заголовки, 2–3 topic badges, отсутствие cover image, наличие video/glossary/tables.

## Файловый план

### Обязательные файлы первого прохода

- `app/articles/[slug]/page.tsx`
- `app/page.tsx`
- `src/components/Header.tsx`
- `src/components/ArticleCard.tsx`

### Файлы второго уровня

- `app/topics/[topic]/page.tsx`
- `app/sources/page.tsx`
- `app/globals.css`

## Тесты

### Автоматические

После каждого этапа:

```bash
npx tsc --noEmit
npm run build
npm run docs:check
```

Если правки затрагивают article rendering logic, дополнительно:

```bash
npx tsx --test tests/node/pipeline-reliability.test.ts
```

### Ручной layout QA

Проверять минимум на ширинах:

- `375px`
- `768px`
- `1024px`
- `1280px`
- `1440px`

Обязательные страницы:

- `/`
- одна article page с cover image
- одна article page без хорошей cover image
- одна article page с video block
- один topic page
- `/sources`

Что проверять руками:

- нет горизонтального скролла;
- нет схлопывания текста в узкую колонку;
- нет налезания meta/tags на соседние элементы;
- header не выглядит “мобильным остатком” на tablet widths;
- article top blocks читаются как editorial rhythm, а не как стек случайных плашек;
- карточки на главной не выглядят как одинаковые плитки одного веса.

## Acceptance Criteria

### 1. Article readability

- На ширинах `768–1023px` article page остаётся одноколоночной или эквивалентно комфортной по measure.
- Основной текст не выглядит зажатым рядом с sidebar.
- Верх статьи имеет визуально заметные паузы между `lead`, `summary`, `video`, `glossary` и body.

### 2. Home responsiveness

- Главная использует более естественный responsive contour:
  - mobile: 1 колонка
  - tablet: 2 колонки там, где это уместно
  - desktop: 3 колонки
- Featured card не ломает композицию секции на tablet widths.

### 3. Header consistency

- На ширинах, где контент уже воспринимается как desktop, header не выглядит как mobile-shell с бургером без причины.
- Мобильное меню не ломает ритм и не переполняется.

### 4. Card quality

- Default, featured и related cards визуально различаются по весу и роли.
- Featured no-image variant не выглядит пустой.
- Meta-row карточек не ломается на длинных source names.

### 5. General layout stability

- Нет горизонтального overflow на основных страницах.
- Нет явно сломанных line-clamp/spacing состояний на длинных заголовках.
- Cover/video/table blocks не выбивают основную колонку по ширине.

## Definition Of Done

Задача считается завершённой, когда:

- все обязательные файлы первого прохода приведены к новому responsive contour;
- автоматические проверки проходят;
- ручной layout QA пройден на agreed widths;
- изменения зафиксированы в канонических docs, если реально поменялись layout rules или design system expectations.

## Post-Implementation Docs Sync

После реализации проверить, нужно ли обновить:

- `docs/DESIGN.md`
- `docs/PROJECT.md`

Если изменятся только конкретные breakpoints/spacings без смены общей visual direction, достаточно обновить `docs/DESIGN.md`.
