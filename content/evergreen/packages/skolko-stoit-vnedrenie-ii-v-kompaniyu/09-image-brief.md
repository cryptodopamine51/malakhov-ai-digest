# Image Brief: Сколько стоит внедрение ИИ в компанию

**Generation source:** ChatGPT subscription (Plus/Pro/Codex). No image API.

## Goal

Заменить текущие абстрактные SVG/WebP на более понятный editorial-набор:

- обложка должна считываться как планирование бюджета ИИ-проекта;
- inline-картинки объясняют блоки статьи: статьи бюджета, пилот vs рабочий запуск, калькулятор, снижение стоимости;
- люди допустимы и желательны там, где помогают читателю узнать себя и процесс;
- точный текст внутри картинок не нужен; captions несут объяснение.

## Shared Visual System

- Style: realistic business-editorial + tactile infographic objects.
- Palette: off-white background, graphite/deep navy base, one warm amber/terracotta accent.
- Lighting: soft natural light, calm and factual.
- Forbidden: robots, glowing brain, neon, human+robot handshake, generic stock office, fake dashboards with text.
- Typography: cover has no text. Inline may have only very short labels if unavoidable; one clean sans-serif style, no mixed fonts.

## Scenario Cards

| filename_png | filename_webp | Place after H2 slug | Aspect | Visual job | Reader takeaway | Scene / must show | Alt | Caption |
|---|---|---|---|---|---|---|---|---|
| `cena-ii-cover.png` | `cena-ii-cover.webp` | hero | 16:9 | human-scenario + conceptual-cover | Внедрение ИИ стоит как проектный бюджет из нескольких слоёв, а не как одна подписка. | CEO/собственник, финансовый руководитель и технический специалист разбирают на столе карту бюджета ИИ-проекта: данные, интеграции, API, безопасность, контроль качества, поддержка. | Бюджет внедрения ИИ как карта расходов на процессы, данные, интеграции и поддержку | Стоимость внедрения ИИ складывается из процесса, данных, интеграций, контроля и поддержки, а не только из тарифа модели. |
| `cena-ii-statyi-budzheta.png` | `cena-ii-statyi-budzheta.webp` | `из-чего-складывается-бюджет-внедрения-ии` | 3:2 | decision-artifact | Бюджет состоит из восьми обязательных блоков; модель/API — только один слой. | Разрез единой конструкции бюджета как 8 слоёв: процесс, данные, модель/API, интеграции, интерфейс, безопасность, контроль качества, поддержка; предметные иконки без текста. | Схема статей бюджета внедрения ИИ: данные, интеграции, API, безопасность и поддержка | Самые недооцененные статьи бюджета — данные, интеграции, контроль качества и поддержка после запуска. |
| `cena-ii-pilot-vs-zapusk.png` | `cena-ii-pilot-vs-zapusk.webp` | `сколько-стоит-быстрый-пилот-по-ии` | 3:2 | decision-artifact + human-scenario | Пилот дешевле, потому что проверяет гипотезу; рабочий запуск дороже из-за прав, логов, мониторинга и поддержки. | Слева компактный 30-60-дневный пилот из 3-4 элементов; справа рабочий контур с опорами доступа, логов, мониторинга, поддержки; 1-2 человека сравнивают путь. | Сравнение бюджета пилота по ИИ и рабочего внедрения | Пилот проверяет гипотезу. Рабочий контур добавляет права, логи, мониторинг, доступность и поддержку. |
| `cena-ii-kalkulyator.png` | `cena-ii-kalkulyator.webp` | `калькулятор-бюджета-внедрения-ии` | 3:2 | decision-artifact | Считать нужно два бюджета: разовый запуск и ежемесячную эксплуатацию. | Две колонки на tabletop-макете: запуск как разовая сборка, эксплуатация как повторяющийся цикл; жетоны расходов и петля recurring cost без текста. | Калькулятор бюджета проекта по ИИ: запуск и ежемесячная эксплуатация | Считать нужно два бюджета: разовый запуск и ежемесячную эксплуатацию. |
| `cena-ii-snizit-stoimost.png` | `cena-ii-snizit-stoimost.webp` | `как-снизить-стоимость-без-потери-качества` | 3:2 | decision-artifact | Стоимость снижается за счёт узкого процесса, ручной проверки, лимитов и контроля, а не просто дешёвой модели. | Премиальная 3x3 матрица рычагов: один процесс, ручная проверка, конструкторы, база знаний, разделение моделей, ограничение прав, лимиты, резервный сценарий, итеративность; 3 главных рычага подсвечены. | Матрица снижения стоимости внедрения ИИ без потери качества | Бюджет снижается, когда проект ограничен одним процессом, понятными правами и ручной проверкой на старте. |

## Production Note

Статья переключена на новые SEO-имена в:

- `content/evergreen/packages/skolko-stoit-vnedrenie-ii-v-kompaniyu/08-metadata.json`
- `content/guides/meta/skolko-stoit-vnedrenie-ii-v-kompaniyu.json`

`npm run images:prep -- --slug=skolko-stoit-vnedrenie-ii-v-kompaniyu` уже создает финальные WebP из этого brief:

- `cena-ii-cover.webp`
- `cena-ii-statyi-budzheta.webp`
- `cena-ii-pilot-vs-zapusk.webp`
- `cena-ii-kalkulyator.webp`
- `cena-ii-snizit-stoimost.webp`

Старые WebP (`cover.webp`, `ai-budget-breakdown.webp`, `pilot-vs-working-launch.webp`, `ai-budget-calculator.webp`, `cost-control-matrix.webp`) оставлены в `public/images/` как совместимость для уже известных URL, но production meta их больше не использует.
