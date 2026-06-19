# Image Brief: ИИ для производства: сценарии, внедрение и окупаемость

**Generation source:** ChatGPT subscription (Plus/Pro/Codex). No image API calls from this workflow. Inline-схемы можно заменить локальными SVG/Canvas, если это ускорит публикацию и пройдёт `images:prep`.

## SEO filename convention

- Cover: `ii-dlya-proizvodstva-scenarii-vnedrenie-cover.webp`
- Inline: `ii-proizvodstvo-scenarii.webp`, `ii-proizvodstvo-okupaemost.webp`, `ii-proizvodstvo-plan-pilota.webp`
- ASCII only, lowercase, hyphen-separated, ≤ 60 символов.
- Не использовать generic-имена `cover.webp`, `image1.webp`, `diagram.webp`, `untitled.webp`.

## Workflow

1. Владелец/редактор открывает ChatGPT и копирует готовый prompt из `12-chatgpt-image-prompts.md`.
2. Каждый PNG сохранить в `content/evergreen/packages/ii-dlya-proizvodstva-scenarii-vnedrenie/raw-images/` с именем из блока `Save As`.
3. Запустить:

```bash
npm run images:prep -- --slug=ii-dlya-proizvodstva-scenarii-vnedrenie
```

4. Скрипт положит WebP в `public/images/guides/ii-dlya-proizvodstva-scenarii-vnedrenie/`, создаст `-480.webp` и `-768.webp`.
5. После этого можно запускать:

```bash
npm run evergreen:check -- --slug=ii-dlya-proizvodstva-scenarii-vnedrenie
```

## Visual Direction

- Стиль: спокойная business-editorial иллюстрация, ближе к Bloomberg / vc.ru / The Verge feature, без рекламной глянцевости.
- Палитра: графит, тёмно-синий, молочно-белый, тёплый акцент охра/янтарь/терракот.
- Запрещено внутри изображения: читаемый текст, числа, лейблы, watermark, имитация экранов с надписями.
- Запрещённые сюжеты: роботы, светящийся мозг, неон, рукопожатие человек+робот, generic office stock.
- Допустимо: производственная линия, камеры, датчики, физические карточки без текста, абстрактные потоки данных, инженерная карта процесса, аккуратная изометрия.

## Sizing matrix

| Тип | ChatGPT | Финальный WebP | Назначение |
|---|---|---|---|
| Cover | 1792×1024 | 1200×675 | hero, og:image |
| Inline | 1792×1024 | 1200×800 | тело статьи |

## Cover

- `filename_png`: `ii-dlya-proizvodstva-scenarii-vnedrenie-cover.png`
- `filename_webp`: `ii-dlya-proizvodstva-scenarii-vnedrenie-cover.webp`
- Финальный путь: `public/images/guides/ii-dlya-proizvodstva-scenarii-vnedrenie/ii-dlya-proizvodstva-scenarii-vnedrenie-cover.webp`
- Placement: guide hero
- Aspect: 16:9
- Prompt: современная производственная линия с одной точкой визуального контроля; камера над конвейером, датчики на оборудовании, инженерная карта процесса на физическом столе без читаемого текста; человек-контролёр рядом, но не в центре; ощущение точного инженерного пилота без фантастики.
- Negative prompt: no robots, no glowing brain, no handshake, no readable text, no neon, no generic office stock, no panels with text.
- Alt: Производственная линия с камерами контроля качества, датчиками и картой пилота по ИИ.
- Caption: ИИ на производстве стоит запускать вокруг одной измеримой потери: брака, простоя, ручной проверки или повторной обработки.

## Inline Images

| filename_png | filename_webp | Place after H2 slug | Aspect | Source | Prompt / SVG brief | Alt | Caption |
|---|---|---|---|---|---|---|---|
| `ii-proizvodstvo-scenarii.png` | `ii-proizvodstvo-scenarii.webp` | `матрица-сценариев-данные-пилот-метрика-риск` | 3:2 | ChatGPT / local SVG | Изометрическая карта производственного участка: несколько зон процесса, над ними абстрактные маркеры данных, метрик и рисков без текста. Четыре-пять сценариев показаны как отдельные станции одной линии. | Матрица сценариев ИИ для производства по данным, пилоту, метрике и риску. | Первый производственный пилот выбирают по данным, цене ошибки, владельцу метрики и практической готовности технологии. |
| `ii-proizvodstvo-okupaemost.png` | `ii-proizvodstvo-okupaemost.webp` | `расчет-окупаемости-контроля-качества-пример` | 3:2 | ChatGPT / local SVG | Физическая инженерная доска без читаемого текста: поток изделий, ручная проверка, снижение повторной обработки, расходы поддержки и результат пилота показаны как блоки и стрелки. | Схема расчёта окупаемости пилота компьютерного зрения для контроля качества. | Окупаемость контроля качества складывается из экономии времени, снижения повторной обработки, поддержки решения и стоимости пилота. |
| `ii-proizvodstvo-plan-pilota.png` | `ii-proizvodstvo-plan-pilota.webp` | `вывод-malakhov-ai` | 3:2 | ChatGPT / local SVG | Дорожная карта первого производственного пилота без текста: участок линии, сбор данных за несколько недель, проверка на смене, интеграции и масштабирование показаны как последовательность инженерных блоков. | План первого пилота ИИ на производственной линии от метрики до масштабирования. | Хороший первый проект начинается с одной линии, одной потери, базовой линии за 2-4 недели и проверки эффекта на реальной смене. |

## Owner SLA

После статуса `ready_for_codex` владелец/редактор генерирует 4 PNG в ChatGPT и кладёт их в `raw-images/`. До этого публикация и полный `evergreen:check` заблокированы отсутствием WebP и responsive variants.
