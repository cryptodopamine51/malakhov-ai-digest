# Operational Checklist

Дата: 2026-04-16

Цель: короткий список внешних действий, которые нельзя полностью закрыть локальными изменениями в репозитории.

## 1. DNS и домен

Нужно сделать руками в панели DNS:

- открыть DNS-записи для `news.malakhovai.ru`
- проверить, почему домен указывает одновременно на:
  - `82.22.146.66`
  - `76.76.21.21`
- если current production = FastAPI/Caddy/Render/VPS контур на `82.22.146.66`, удалить или отключить запись на `76.76.21.21`
- дождаться обновления DNS

Проверка:

```bash
dig +short news.malakhovai.ru
curl -I https://news.malakhovai.ru
```

Ожидание:

- остаётся один корректный production target
- нет TLS handshake errors

## 2. Выбор единственного production-контура

Нужно принять одно решение:

- основной прод = current `FastAPI + event-layer`
- legacy `articles`-контур = legacy/manual only

Если это решение принято, дальше:

- не считать legacy `articles` главным источником данных для сайта
- не диагностировать “пустой сайт” только через `scripts/check-db.ts`

## 3. Пуш изменений и деплой

После review:

- закоммитить текущие изменения
- запушить в нужную ветку
- задеплоить current backend/site

Проверка после деплоя:

```bash
curl https://news.malakhovai.ru/health
curl 'https://news.malakhovai.ru/api/issues?limit=5'
curl 'https://news.malakhovai.ru/api/events?limit=5'
```

Ожидание:

- health = `200`
- в public issues нет пустых stub-выпусков
- public events отдаются нормально

## 4. GitHub Actions / current workflow

Нужно проверить уже после пуша:

```bash
gh workflow list --repo cryptodopamine51/malakhov-ai-digest
gh run list --repo cryptodopamine51/malakhov-ai-digest --limit 20
```

Особенно:

- `.github/workflows/daily_digest.yml`
- `.github/workflows/weekly_digest.yml`

Нужно:

- вручную запустить `workflow_dispatch`
- убедиться, что current workflow реально стартуют и не падают на `workflow file issue`

Если падают:

- открыть `gh run view --log <run_id>`
- прислать точный лог ошибки

## 5. Telegram канал

Нужно руками проверить конечную доставку:

- какой именно канал привязан к `TELEGRAM_CHANNEL_ID`
- пришло ли туда сообщение
- совпадает ли это с тем каналом, который ты реально смотришь

Проверка:

- открыть последний пост в целевом канале
- открыть 2-3 ссылки из сообщения
- убедиться, что они ведут на рабочий current site

## 6. Legacy workflow

Если current backend выбран основным продом, нужно руками решить судьбу legacy workflow:

- `RSS Parse`
- `Enrich Articles`
- `Telegram Daily Digest`

Варианты:

- отключить
- оставить только для manual/legacy
- явно пометить как неосновной контур

Иначе снова появится путаница между `articles` и `events`.

## 7. Финальная smoke-проверка

После всех внешних шагов проверить:

```bash
curl -I https://news.malakhovai.ru
curl https://news.malakhovai.ru/health
curl 'https://news.malakhovai.ru/api/issues?limit=5'
curl 'https://news.malakhovai.ru/api/events?limit=5'
```

И руками:

- homepage открывается стабильно
- в `/issues` нет пустых выпусков
- в Telegram пришёл нормальный дайджест

## 8. Что уже сделано локально

Это руками делать не нужно:

- установлен Python `3.12`
- поднят чистый `.venv312`
- полный `pytest -q` прогнан на Python 3.12
- результат: `111 passed`
- anti-stub guard для current issue-builder уже внесён в код
- public issue endpoints уже скрывают пустые stub issues
