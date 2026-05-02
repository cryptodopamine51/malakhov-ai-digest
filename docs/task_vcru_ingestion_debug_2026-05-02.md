---
title: vc.ru — фид настроен, статьи не доходят
date: 2026-05-02
status: proposed
owner: malast
canonical_doc: docs/ARTICLE_SYSTEM.md
---

# Цель

Релевантные AI-материалы с vc.ru должны реально попадать в `articles` с `quality_ok=true`. Сейчас за 14 дней — **0 статей**.

# Текущее состояние

`pipeline/feeds.config.ts:266-273`:

```ts
{
  name: 'vc.ru AI/стартапы',
  url: 'https://vc.ru/rss/all',
  lang: 'ru',
  topics: ['ai-startups', 'ai-russia', 'ai-industry'],
  needsKeywordFilter: true,
  keywordGroups: [RU_AI_CORE_KEYWORDS],
  keywordSearchFields: 'title',
}
```

Замер на 2026-05-02:

```sql
SELECT COUNT(*) FROM articles
 WHERE source_name ILIKE '%vc.ru%'
   AND published_at >= NOW() - INTERVAL '14 days';
-- 0
```

Фиды `vc.ru/finance/rss` и `vc.ru/startups/rss` ранее были закомментированы — отвечают 404.

# Гипотезы

| # | Гипотеза | Как проверить |
|---|---|---|
| H1 | `vc.ru/rss/all` не отдаёт AI-контент в title (общая лента, AI-материалы редки) | `curl -s https://vc.ru/rss/all \| head -200` — посчитать долю AI-заголовков среди последних 50 |
| H2 | `RU_AI_CORE_KEYWORDS` слишком узкие для лексики vc.ru (там «нейронка», «ИИ», «бот», «ассистент» вместо «нейросеть», «искусственный интеллект») | Сверить заголовки vc.ru со списком ключей в `pipeline/keyword-filters.ts` |
| H3 | `keywordSearchFields: 'title'` пропускает релевантные статьи, у которых AI-термин только в описании/тегах | Прогнать ingest с временным `'titleAndSnippet'` и сравнить yield |
| H4 | rss-parser падает на формате vc.ru или фид reject-ится по `requireDateInUrl` / другому валидатору | Логи `pipeline/ingest.ts` за последние сутки, искать по `source: 'vc.ru'` |
| H5 | Статьи приходят, но scorer (`pipeline/scorer.ts`, требует ≥ 2) или Claude (валидация по 8 полям) их режут — то есть проблема не в ingest, а дальше | Запросить `articles` без фильтра `quality_ok`, посмотреть `quality_reason` для vc.ru |
| H6 | `vc.ru/rss/all` редиректит / отдаёт неполный фид без AI-секций | Сравнить кол-во `<item>` в фиде с числом записей в БД за тот же период |

# Шаги

## Этап 1 — Discovery (без изменений в коде)

1. `curl -s https://vc.ru/rss/all -o /tmp/vcru.xml && wc -l /tmp/vcru.xml` — убедиться, что фид жив и не 404
2. Из `/tmp/vcru.xml` выбрать заголовки последних 50 материалов, глазами оценить долю AI/стартап-релевантных
3. Прогнать SQL:
   ```sql
   SELECT id, title, quality_ok, quality_reason, score
     FROM articles
    WHERE source_name ILIKE '%vc.ru%'
    ORDER BY created_at DESC LIMIT 30;
   ```
   Если строки есть — проблема **дальше** ingest (H5). Если 0 — проблема **в** ingest (H1–H4, H6).
4. Прогнать локально `npx tsx pipeline/ingest.ts --source 'vc.ru AI/стартапы' --verbose` (или эквивалент — уточнить флаги по коду), снять метрики: всего items, прошло keyword-filter, прошло scorer, дошло до Claude.

**Артефакт этапа:** короткая таблица — сколько отсеяно на каком шаге.

## Этап 2 — Точечный фикс (зависит от discovery)

В зависимости от того, где режет, делается **одно** из:

- **A. Расширить `RU_AI_CORE_KEYWORDS`** под лексику vc.ru (если H2 подтвердилась). Добавить варианты: `«ИИ»`, `«нейронк»`, `«ИИ-ассистент»`, `«ИИ-агент»`, `«языковая модель»`. Проверить, что не ломает другие фиды (Habr AI, CNews) — прогнать ingest на 1 сутки и сравнить yield до/после.
- **B. Сменить `keywordSearchFields` на `'titleAndSnippet'`** для vc.ru (если H3 подтвердилась). Только для этого фида, чтобы не зашумить остальные.
- **C. Найти рабочий тематический фид vc.ru** (если H1/H6). Проверить кандидатов: `https://vc.ru/tag/искусственный-интеллект/rss`, `https://vc.ru/tag/нейросети/rss`, `https://vc.ru/ml/rss`. Заменить `/rss/all`.
- **D. Снизить порог scorer-а или ослабить Claude-валидацию** для ru-фидов (если H5). Делать осторожно — можно сломать качество в среднем.

## Этап 3 — Верификация

- Прогнать ingest 7 дней
- SQL-замер:
  ```sql
  SELECT DATE(published_at AT TIME ZONE 'Europe/Moscow') AS day,
         COUNT(*) FILTER (WHERE source_name ILIKE '%vc.ru%') AS total,
         COUNT(*) FILTER (WHERE source_name ILIKE '%vc.ru%' AND quality_ok) AS ok
    FROM articles
   WHERE published_at >= NOW() - INTERVAL '7 days'
   GROUP BY day ORDER BY day DESC;
  ```
- Открыть `news.malakhovai.ru/sources` — убедиться, что блок vc.ru появился с реальными заголовками

# Acceptance Criteria

- [ ] За 7 дней после фикса в `articles` минимум **5 строк** с `source_name ILIKE '%vc.ru%'` и `quality_ok=true`
- [ ] На `/sources` появляется блок vc.ru с реальными `latest_titles`
- [ ] Не ухудшен yield других ru-фидов (Habr AI, CNews) — сравнение «до/после» с допуском −10%
- [ ] Если меняли `RU_AI_CORE_KEYWORDS` или `keywordSearchFields` — обновлён `docs/ARTICLE_SYSTEM.md`

# Связанная задача — `/sources` маппинги

При закрытии этой задачи (если vc.ru начал давать статьи) дополнительно поправить `app/sources/page.tsx`:

- В `SOURCE_DOMAINS` имя должно быть `'vc.ru AI/стартапы'`, не `'vc.ru'` (сейчас не совпадает с `source_name` в БД, favicon не подгрузится)
- Удалить мёртвые ключи: `'vc.ru Финансы'`, `'vc.ru Стартапы'`, `'a16z Blog'`, `'Axios Pro Rata'` (нет соответствующих фидов)
- Добавить отсутствующие: `'The Decoder'`, `'Google DeepMind Blog'`, `'TechCrunch Startups'`, `'RB.ru'`, `'Habr Startups'`

Это можно делать отдельной мини-задачей или одним PR с этой.

# Риски

- vc.ru — общий tech-журнал. Без аккуратного фильтра попадёт крипта, недвижка, маркетинг. Расширять `RU_AI_CORE_KEYWORDS` — только под AI-словарь, не под общие тех-термины.
- При смене на `titleAndSnippet` зашумит больше — описание у vc.ru длинное и часто содержит общие слова. Если идём в B — обязательно мерить ложноположительные через `quality_reason` после Claude.

# Связанные файлы

- `pipeline/feeds.config.ts` — конфиг фида
- `pipeline/keyword-filters.ts` — `RU_AI_CORE_KEYWORDS`
- `pipeline/ingest.ts`, `pipeline/rss-parser.ts` — ingest pipeline
- `pipeline/scorer.ts` — порог 2
- `pipeline/claude.ts` — Claude-валидация
- `app/sources/page.tsx` — публичная страница
- `docs/ARTICLE_SYSTEM.md` — обновить, если меняем фильтры
