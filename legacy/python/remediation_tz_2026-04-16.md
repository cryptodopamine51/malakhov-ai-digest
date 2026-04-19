# ТЗ на доработку проекта `malakhov-ai-digest`

Дата: 2026-04-16

Статус: рабочее ТЗ для последовательного исправления проекта до состояния “понятный прод, понятный runtime, предсказуемый контент, проверяемый результат”.

Связанные документы:

- `docs/architecture_review_2026-04-16.md`
- `docs/architecture_current.md`
- `README.md`

## 1. Цель

Привести проект в состояние, при котором:

- сайт стабильно открывается по одному корректному продовому контуру;
- на сайте отображается актуальный и понятный контент, а не смесь demo/stub/legacy данных;
- Telegram-дайджест отправляется в ожидаемый канал и соответствует реальному контентному контуру;
- в проекте есть один основной runtime и один понятный operational path;
- качество результата подтверждается тестами, ручными проверками и понятными критериями приёмки.

## 2. Главный принцип

Сначала не “улучшать всё”, а устранить архитектурную раздвоенность:

1. Определить канонический продовый контур.
2. Отключить или явно пометить вторичный/legacy-контур.
3. Только после этого чинить контент, pipeline и delivery.

Без этого любое частичное исправление будет давать ложные сигналы.

## 3. Зафиксированные факты, от которых отталкиваемся

### 3.1. Legacy `articles`-контур жив

Проверка `scripts/check-db.ts` показала:

- `Всего статей: 28`
- `Обогащено: 28`
- `Опубликовано: 13`
- `Отправлено в TG: 6`

Значит старый `articles`-pipeline не пустой.

### 3.2. Legacy GitHub Actions реально работают

Активны и запускаются:

- `RSS Parse`
- `Enrich Articles`
- `Telegram Daily Digest`

По крайней мере часть раннов `success`.

### 3.3. Current backend тоже жив

Рабочий IP: `82.22.146.66`

Он отдаёт:

- `/`
- `/api/events`
- `/api/issues`

То есть новый FastAPI-контур существует и публично доступен.

### 3.4. Домен раздвоен

`news.malakhovai.ru` резолвится в:

- `82.22.146.66` — рабочий current backend
- `76.76.21.21` — вероятно старый Vercel/legacy endpoint, где TLS ломается

Это production bug.

### 3.5. Current issues могут публиковаться пустыми

Проверка `/api/issues/40` показала:

- issue `status=ready`
- `section_counts` по нулям
- внутри только stub-карточки с `event_id = null`

Это недопустимо для публичного выпуска.

### 3.6. Current public content выглядит как demo/грязный слой

На current homepage видны события уровня:

- `OpenAI представила OpenAI`
- `CyberAgent moves faster с ChatGPT корпоративный and Codex`

Это выглядит как неряшливый или seeded контент и требует очистки контура.

### 3.7. Current GitHub workflows не работают как production scheduler

`daily_digest.yml` и `weekly_digest.yml` имеют failure на уровне workflow file issue и не дают нормального живого cron-контура.

## 4. Что считаем основными проблемами

### P0. Домен и прод раздвоены

Симптом:

- один домен указывает на два разных контура;
- часть трафика попадает на битый TLS endpoint.

Риск:

- пользователи видят разные версии проекта;
- диагностика становится ложной;
- Telegram и сайт могут жить в разных мирах.

### P0. Нет одного канонического production path

Симптом:

- legacy `articles`-pipeline жив;
- current `event-layer` backend тоже жив;
- нет формального решения, что из этого настоящий прод.

Риск:

- сайт и Telegram опираются на разные данные;
- команда смотрит не туда при поиске проблем;
- “починили одно, сломали другое”.

### P0. Current pipeline публикует пустые/stub issues

Симптом:

- `ready` issue без реальных `event_id`;
- публичные заглушки в выпуске.

Риск:

- пользователь видит фейковую “готовность” продукта;
- Telegram/сайт теряют доверие.

### P1. Content pipeline не очищен от demo/seed/legacy примесей

Симптом:

- неряшливые тайтлы;
- сомнительные summaries;
- historical/demo signals в публичном слое.

Риск:

- продукт выглядит недоделанным даже при живом runtime.

### P1. Operational docs и CI/CD не совпадают с реальностью

Симптом:

- current и legacy workflow живут одновременно;
- README и docs до недавнего времени не отражали current runtime;
- нет единой карты запуска.

### P2. Legacy ingest нестабилен

Симптом:

- таймауты по фидам;
- есть ранны с `получено 0 записей` после успешного обхода части RSS.

## 5. Канонический порядок работ

Работы делаются строго в этом порядке.

### Этап 1. Определение канонического продового контура

Нужно принять одно архитектурное решение:

- Вариант A: текущий прод = `FastAPI + event-layer`
- Вариант B: текущий прод = legacy `Next/Supabase/articles`

Рекомендованный вариант: `A`.

Если выбирается `A`, то:

- legacy `articles`-контур помечается как legacy;
- current backend становится единственным источником истины для публичного сайта и основного дайджеста.

Если выбирается `B`, то current backend выводится из публичного домена и перестаёт считаться продом.

### Этап 2. Починка DNS и доменного контура

Задачи:

- проверить DNS-записи `A`/`CNAME` для `news.malakhovai.ru`;
- убрать битый endpoint `76.76.21.21`, если он больше не нужен;
- убедиться, что домен указывает ровно в один production target;
- проверить TLS/сертификат именно для этого target.

### Этап 3. Выключение двусмысленности в CI/CD

Если канонический контур = current:

- старые workflow `rss-parse.yml`, `enrich.yml`, `tg-digest.yml` либо:
  - отключить,
  - либо оставить только как explicit legacy/manual.
- current workflow привести в рабочее состояние:
  - `daily_digest.yml`
  - `weekly_digest.yml`

Если канонический контур = legacy:

- current workflow и current public site не должны оставаться “как будто прод”.

### Этап 4. Исправление current issue builder

Нужно запретить публикацию пустых выпусков.

Правила:

- issue со всеми `event_id = null` не может стать публичным `ready`;
- issue с `section_counts` == 0 по всем основным секциям не может стать публичным;
- stub-тексты допустимы только для internal preview/debug, но не для публичного issue;
- публичный `/issues/{id}` должен содержать реальные карточки либо не публиковаться вообще.

### Этап 5. Очистка публичного current content layer

Нужно проверить и очистить:

- seeded/demo events;
- некачественные titles;
- шаблонные summaries;
- мусорные карточки и слабые AI-события;
- некачественный Russia/Alpha слой, если он тоже seeded.

### Этап 6. Проверка Telegram delivery

После выбора канонического контура:

- подтвердить фактический target channel/chat;
- подтвердить, что сообщение реально приходит туда, куда ожидается;
- проверить, что ссылки внутри сообщения ведут на живой правильный сайт;
- проверить, что message body не строится из мусорных/legacy материалов.

### Этап 7. Очистка legacy-слоя

Не обязательно сразу удалять, но нужно формально разнести:

- legacy workflow
- legacy env
- legacy schema
- legacy app/pages/components

Минимум:

- явная маркировка;
- отсутствие случайного запуска “не того” контура;
- отсутствие ложных ожиданий, что `articles` автоматически кормят current site.

## 6. Конкретные задачи по коду и инфраструктуре

### 6.1. DNS / продовый маршрут

Сделать:

- проверить текущие DNS записи у провайдера;
- проверить, зачем остаётся `76.76.21.21`;
- удалить/заменить битую запись;
- зафиксировать актуальную схему домена в docs.

Готово, когда:

- `news.malakhovai.ru` резолвится в один ожидаемый production target;
- `curl -I https://news.malakhovai.ru` стабильно отвечает без TLS errors;
- нет ситуации “часть пользователей видит одно, часть другое”.

### 6.2. Current workflow repair

Сделать:

- выяснить причину `workflow file issue` для `daily_digest.yml` и `weekly_digest.yml`;
- исправить workflow-файлы;
- вручную запустить оба workflow;
- убедиться, что они реально проходят.

Готово, когда:

- `gh run list --workflow '.github/workflows/daily_digest.yml'` показывает успешный `workflow_dispatch`;
- то же для weekly;
- scheduled path не ломается на уровне workflow parsing.

### 6.3. Current issue-builder anti-stub guard

Сделать:

- найти место, где пустые daily/weekly issues переводятся в `ready`;
- ввести guard:
  - если в issue нет достаточного числа реальных `event_id`, issue остаётся `draft`/`empty`/`suppressed`;
  - публичные endpoints не должны показывать stub issue как полноценный выпуск;
- при необходимости разделить internal placeholder и public publishable issue.

Готово, когда:

- `/api/issues/{id}` для пустого дня не отдаёт публичный ready-выпуск из заглушек;
- homepage/issues archive не подхватывают пустой issue как нормальный “последний выпуск”.

### 6.4. Public content quality cleanup

Сделать:

- найти, откуда берутся demo/seed events;
- отделить seeded/demo content от production content;
- не показывать demo-источники в публичном продовом слое;
- очистить или пересоздать данные, если продовая БД уже загрязнена.

Готово, когда:

- homepage показывает понятные реальные материалы;
- titles и summaries не выглядят как демо-плейсхолдеры;
- `/api/events?limit=5` возвращает нормальный редакционный результат.

### 6.5. Telegram delivery validation

Сделать:

- проверить соответствие `TELEGRAM_CHANNEL_ID` ожидаемому каналу;
- сделать тестовый manual send;
- проверить сообщение в целевом канале руками;
- проверить, что в сообщении нет битых ссылок и странных masked URLs.

Готово, когда:

- сообщение реально видно в целевом канале;
- ссылки открывают живой домен;
- состав дайджеста соответствует выбранному каноническому контуру.

### 6.6. Legacy runtime demotion

Сделать:

- пометить legacy workflow как legacy/manual-only или отключить;
- при необходимости переместить legacy docs/скрипты в отдельный блок;
- не допускать, чтобы legacy runtime выглядел как основной путь.

Готово, когда:

- в репозитории невозможно спутать current production path с legacy.

## 7. Тесты

Ниже обязательный тестовый контур после каждого значимого этапа.

### 7.1. Инфраструктурные проверки

Проверки:

```bash
dig +short news.malakhovai.ru
curl -I https://news.malakhovai.ru
curl https://news.malakhovai.ru/health
```

Ожидание:

- один корректный production target;
- нет TLS handshake errors;
- health endpoint отвечает `200`.

### 7.2. Current public API smoke checks

Проверки:

```bash
curl 'https://news.malakhovai.ru/api/events?limit=5'
curl 'https://news.malakhovai.ru/api/issues?limit=5'
curl 'https://news.malakhovai.ru/'
```

Ожидание:

- endpoint'ы доступны;
- нет пустых ready issues в публичном слое;
- homepage показывает содержательный контент.

### 7.3. Current issue anti-stub checks

Обязательные сценарии:

1. День без достаточного числа событий.
2. День с 1-2 слабыми событиями.
3. День с нормальным набором событий.

Для каждого сценария:

- build issue
- получить issue через public/internal endpoints
- убедиться, что publishable logic работает корректно

Ожидание:

- пустой день не становится публичным полноценным выпуском;
- сильный день становится.

### 7.4. Python test suite

Запуск:

```bash
pytest -q
```

Минимум должны проходить:

- `tests/api/test_site_shell.py`
- `tests/api/test_issue_endpoints.py`
- `tests/api/test_public_read_api.py`
- `tests/api/test_quality_report_endpoint.py`
- `tests/digest/test_digest_builder_and_delivery.py`
- `tests/pipeline/test_process_events_service.py`
- `tests/test_migrations.py`

Если для новой логики anti-stub guard текущих тестов недостаточно, добавить новые.

### 7.5. GitHub Actions / workflow checks

Проверки:

```bash
gh workflow list --repo cryptodopamine51/malakhov-ai-digest
gh run list --repo cryptodopamine51/malakhov-ai-digest --limit 20
```

Ожидание:

- нужные workflow активны;
- current production workflow проходят;
- legacy workflow либо отключены, либо явно помечены и не мешают.

### 7.6. Telegram end-to-end check

Проверки:

- manual run send flow
- открыть сообщение в Telegram
- открыть ссылки из сообщения

Ожидание:

- сообщение видно в нужном канале;
- ссылки ведут на рабочий домен;
- дайджест состоит из корректного контента.

## 8. Критерии приёмки

Проект считается приведённым в порядок, только если выполнены все пункты ниже.

### A. Production routing

- `news.malakhovai.ru` ведёт в один корректный production target.
- Нет битых TLS endpoint'ов по тому же домену.

### B. Canonical architecture

- Формально зафиксировано, какой контур является основным production runtime.
- Legacy-контур больше не маскируется под основной.

### C. Public site quality

- Homepage открывается стабильно.
- На homepage нет demo/грязных/stub материалов.
- `/issues` и `/issues/{id}` не показывают пустые pseudo-issues как полноценные выпуски.

### D. Data / pipeline consistency

- Сайт, API и delivery смотрят в один и тот же канонический контур.
- Нет ситуации, когда Telegram живёт по `articles`, а сайт по unrelated demo `events`, если это не оговорено явно.

### E. CI/CD

- Current workflow запускаются и проходят.
- Legacy workflow либо выключены, либо явно оставлены как legacy/manual.

### F. Telegram delivery

- Сообщение реально приходит в нужный канал.
- Содержимое дайджеста соответствует каноническому контентному слою.

### G. Tests

- `pytest -q` проходит.
- Дополнительные smoke checks по site/API/DNS выполнены.

## 9. Что не считается завершением

Следующие вещи не считаются достаточным результатом:

- “домен иногда открывается, значит норм”;
- “один из двух контуров работает”;
- “issue ready, даже если внутри только заглушки”;
- “GitHub Actions success, но сайт смотрит в другой слой”;
- “в Telegram логически отправилось, но человек в канале не видит сообщение”.

## 10. Артефакты, которые нужно приложить после выполнения

После завершения работ нужно собрать доказательства:

1. Текущее состояние DNS:
   - вывод `dig +short news.malakhovai.ru`

2. Проверка сайта:
   - `curl -I https://news.malakhovai.ru`
   - `curl https://news.malakhovai.ru/health`

3. Проверка API:
   - `/api/events?limit=5`
   - `/api/issues?limit=5`

4. Проверка workflow:
   - `gh run list --limit 20`

5. Проверка Telegram:
   - подтверждение ручного тестового сообщения в нужный канал

6. Проверка тестов:
   - итог `pytest -q`

## 11. Приоритет выполнения

Жёсткий порядок:

1. DNS / production routing
2. Canonical production decision
3. Current workflow repair
4. Anti-stub guard for issues
5. Public content cleanup
6. Telegram target validation
7. Legacy demotion / repo hygiene

## 12. Прямое рабочее указание

Нельзя переходить к “косметике” и удобствам, пока не закрыты:

- раздвоенный домен,
- раздвоенный production contour,
- публикация пустых issues.

Сначала закрыть системные причины, потом уже улучшать контент и developer experience.
