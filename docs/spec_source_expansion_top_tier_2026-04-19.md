# Спека: расширение top-tier источников для парсинга

## Приоритет

**Это первоочередная задача.** Без сильного source set дальше бессмысленно полировать сайт: входящий поток останется слабым.

## Цель

Собрать, отранжировать и внедрить лучший practical source set по AI-рынку:
- новости;
- продуктовые релизы;
- исследовательские анонсы;
- funding / M&A;
- стартапы;
- open-source и dev tooling;
- policy / infrastructure только если это реально двигает рынок.

## Принципы source policy

- Источник добавляется не “потому что известный”, а потому что стабильно даёт signal.
- Приоритет у первоисточников и сильных отраслевых изданий.
- Нужен баланс:
  - official labs;
  - high-signal tech press;
  - venture / startup / funding;
  - research;
  - enterprise infra;
  - strong Russian-language coverage.
- Не тянуть слабый агрегатный шум ради количества.

## Целевая структура source set

### A. Official labs / product orgs

- OpenAI
- Anthropic
- Google DeepMind / Google AI / Google Research
- Meta AI
- Microsoft AI / Azure AI
- Mistral
- Cohere
- Hugging Face
- xAI
- NVIDIA AI / NVIDIA Blog
- Amazon / AWS AI where signal is real

### B. Tier-1 tech/business press

- MIT Technology Review AI
- The Information
- Financial Times Tech / AI if legally parsable feed exists
- Wired AI
- Ars Technica AI
- The Verge AI
- TechCrunch AI / enterprise AI
- VentureBeat AI
- Semafor / Bloomberg / Reuters tech only if feed quality is high and parsing feasible

### C. Startups / venture / deals

- Crunchbase News AI
- Sifted AI
- a16z
- Sequoia
- Lightspeed
- YC Blog / YC news
- NVentures / corporate VC posts where useful

### D. Research / benchmarks / open-source

- Papers with Code blog/news if signal remains high
- Hugging Face
- Eleuther / Allen AI / AI2 updates
- Stanford HAI / BAIR / major lab blogs where release quality is stable

### E. RU coverage

- Habr AI
- CNews
- vc.ru selective feeds
- TAdviser / ComNews / RB.ru only after signal check
- Официальные блоги Яндекса, Сбера, T-Банка, МТС AI и др. при наличии качественных RSS/HTML маршрутов

## Что сделать

### 1. Сформировать longlist

Для каждого кандидата зафиксировать:
- `source_name`
- домен
- тип источника
- страна / язык
- есть ли RSS
- если нет RSS: HTML strategy
- частота публикаций
- signal quality score 1..5
- noise risk 1..5
- темы, которые покрывает лучше всего

### 2. Сузить до approved top set

Разделить источники на:
- `Tier A` — must ingest
- `Tier B` — ingest if parser stable
- `Tier C` — candidate / backlog

### 3. Техническая интеграция

- Добавить approved sources в ingest-конфиг.
- Для не-RSS источников описать безопасную HTML ingestion strategy.
- Для каждого источника определить:
  - dedupe policy;
  - timeout / retry;
  - extraction quirks;
  - topic mapping hints.

### 4. Проверка output quality

- Прогнать ingest минимум на 3–5 дней истории или на тестовой выборке.
- Посмотреть, какие источники реально дали useful output, а какие только шум.

## Ожидаемые артефакты

### 1. Каталог источников

Новый файл, например:
- `docs/source_catalog_top_tier_2026-04-19.md`

В нём таблица по всем кандидатам.

### 2. Approved config

Обновлённый код/конфиг источников в pipeline.

### 3. Тесты и smoke-check

- smoke test ingest по списку must-have sources;
- проверка, что RSS/HTML маршрут жив;
- логирование процента успешного fetch по каждому источнику.

## Тесты

### Data / smoke

- Для каждого `Tier A` источника:
  - fetch успешен;
  - минимум один item парсится корректно;
  - title / url / pubDate / sourceName не пустые.

### Quality

- На выборке из 50 новых items доля “очевидного мусора” не превышает agreed threshold.
- В top results появляются реальные релизы labs, сделки, обновления моделей и toolchain.

### Regression

- Старые рабочие источники не ломаются при расширении списка.

## Критерии приёмки

- Сформирован документированный top-tier source catalog.
- Утверждён список `Tier A` и `Tier B`.
- В ingest реально добавлены новые качественные источники.
- Через этот набор начинают подтягиваться лучшие новости/обновления рынка, а не случайный шум.
