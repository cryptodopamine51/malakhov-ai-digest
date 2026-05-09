# SEO indexation wave — 2026-05-09

> Сессия 2026-05-09. Цель: разобраться, почему Яндекс Вебмастер показывал только 116 страниц в поиске при ~840 indexable в БД, и ускорить индексацию свежих публикаций.
>
> Задача владельца была в две руки: **«Как проверить нормально ли мой сайт проходит индексацию» → «У меня в Вебмастере 116 страниц, как проверить все ли попадают» → «Делай»** (про IndexNow).

---

## Итог одной строкой

Sitemap зависал на состоянии последнего деплоя (76 свежих статей не попадали к поисковикам). Починили двумя независимыми рычагами: **ISR sitemap** (re-generate every 30 min) + **IndexNow protocol** (proactive ping Yandex/Bing на каждой live-публикации). Дополнительно сделан bulk backfill 800 живых URL.

---

## PRs (все в проде)

| # | Title | Merge commit | Что делает |
|---|---|---|---|
| **#15** | `fix(seo): regenerate sitemap every 30 minutes (ISR)` | `7502c2e` | `app/sitemap.ts` теперь имеет `export const revalidate = 1800`. Без этого Next.js собирал sitemap только при билде, и свежие статьи не попадали в `https://news.malakhovai.ru/sitemap.xml` до следующего деплоя. |
| **#16** | `feat(seo): IndexNow ping on every newly verified live article` | `ccea9e9` | `lib/indexnow.ts` + `app/indexnow.txt/route.ts` + интеграция в `pipeline/publish-verify.ts`. После каждого `published_live` перехода RPC `pingIndexNow()` отправляет URL на `https://api.indexnow.org/indexnow` (общий endpoint, propagates к Yandex+Bing). Soft-fail: без `INDEXNOW_KEY` no-op. |
| **#17** | `fix(ci): wire INDEXNOW_KEY secret into publish-verify workflow` | `dc8703c` | `.github/workflows/publish-verify.yml` теперь проксирует `INDEXNOW_KEY` из GH secret в env-блок. Без этого даже после #16 в логах было `IndexNow: skipped (INDEXNOW_KEY not set)`. |

---

## Хронология (можно перепроверить шаг за шагом)

### 1. Диагностика (без правок кода)

**Замер БД vs sitemap:**
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/oziddrpkwzsdtsibauon/database/query" \
  -H "Authorization: Bearer sbp_..." -H "Content-Type: application/json" \
  -d '{"query": "SELECT COUNT(*) FILTER (WHERE publish_status='\''live'\'' AND verified_live=true AND quality_ok=true AND published=true) FROM articles;"}'
# → 840 (на момент старта сессии)

curl -s https://news.malakhovai.ru/sitemap.xml | grep -c '<loc>'
# → 774 (расхождение 66+ статей)
```

**Найден root cause #1:** последний `<lastmod>` в sitemap = `2026-05-07T11:49Z` (день предыдущего деплоя). Свежие статьи post-deploy 2026-05-07 не индексировались никогда.

**Что ещё проверил и подтвердил OK:**
- Canonical URL совпадает с реальным URL на статьях.
- `<meta name="robots" content="index, follow">` присутствует.
- og:type, og:url, twitter:card, JSON-LD (`NewsArticle` + `Organization` + `WebSite` + `ImageObject`) — все на месте.
- Yandex + Google verification meta-теги — оба присутствуют.
- robots.txt: Allow для всех, явные правила для Googlebot/Bingbot/OAI-SearchBot, Host + Sitemap корректные.
- Метрика загружается (`mc.yandex.ru`).
- 5 случайных URL из sitemap → все 200.

### 2. Sitemap fix (PR #15)

`app/sitemap.ts:6` — добавлен `export const revalidate = 1800`. Без модификаций query-логики.

`docs/ARTICLE_SYSTEM.md` — добавлена строка про ISR в раздел «URL policy» (требование docs-guard).

После merge и Vercel-деплоя:
```bash
curl -s https://news.malakhovai.ru/sitemap.xml | grep -c '<loc>'
# → 850 (вместо 774). Свежие статьи (включая moonshot, vpn-servisy, deepseek и др.) попали в sitemap.
```

**Memory сохранена:** `feedback_nextjs_sitemap_isr.md` — правило для будущего: любой `app/sitemap.ts` или `app/*.xml/route.ts`, читающий из БД, должен иметь `revalidate`.

### 3. IndexNow integration (PR #16)

**Сгенерирован публичный ключ:** `62513c39642606cf9c26b732dbc00924` (ключ IndexNow не секрет, это proof of domain control).

**Файлы:**
- `lib/indexnow.ts` — `pingIndexNow(urls): Promise<IndexNowResult>`. POST на `https://api.indexnow.org/indexnow`, soft-fail без env, дедуп URL, кап 100 за пинг, 5s timeout.
- `app/indexnow.txt/route.ts` — отдаёт `INDEXNOW_KEY` как plain text body. `force-static` + 1h revalidate. 404 если env не задан.
- `pipeline/publish-verify.ts` — собирает URL `published_live` переходов в массив, после loop отправляет одним пингом. Логирует `IndexNow: pinged N url(s), status=...` или `skipped (INDEXNOW_KEY not set)`.
- `tests/node/indexnow.test.ts` — 5 кейсов: no-key, empty list, ok-200, non-2xx, network error.

**Env установлен:**
- Vercel Project Settings → Environment Variables → `INDEXNOW_KEY` для Production + Development (Preview не получилось через CLI, можно добавить в UI).
- GitHub Actions → Repository secrets → `INDEXNOW_KEY`.

**После merge и деплоя проверено:**
```bash
curl -s https://news.malakhovai.ru/indexnow.txt
# → 62513c39642606cf9c26b732dbc00924 (200 OK)

curl -s -X POST https://api.indexnow.org/indexnow \
  -H "content-type: application/json" \
  -d '{"host":"news.malakhovai.ru","key":"62513c39...","keyLocation":"https://news.malakhovai.ru/indexnow.txt","urlList":["https://news.malakhovai.ru/categories/ai-research/mit-technology-review-mezhdu-khaypom-ii-i-pribylyu-nedostayu"]}'
# → 202 Accepted
```

### 4. Bulk backfill — 800 живых URL

После того как `/indexnow.txt` подтвердил ключ, отправил 8 батчей по 100 URL (выборка из БД с `publish_status='live' AND verified_live=true AND quality_ok=true`):

```text
offset=0   count=100 status=200
offset=100 count=100 status=200
offset=200 count=100 status=200
offset=300 count=100 status=200
offset=400 count=100 status=200
offset=500 count=100 status=200
offset=600 count=100 status=200
offset=700 count=100 status=200
```

Yandex/Bing получили список из 800 URL. Это разовый backfill — обычные новые статьи будут пинговаться автоматически через `pipeline/publish-verify.ts`.

### 5. CI env fix (PR #17)

После первого ручного запуска `publish-verify.yml` обнаружил в логе:
```
[12:17:13] IndexNow: skipped (INDEXNOW_KEY not set, 2 url(s) would have been pinged)
[12:17:13] Verified live: 2
```

Vercel runtime получает env из Project Settings, но GitHub Actions использует свой набор secrets — нужно прокидывать отдельно. Добавил `INDEXNOW_KEY: ${{ secrets.INDEXNOW_KEY }}` в env-блок шага `Verify published articles are live`.

После merge запустил workflow повторно:
```
INDEXNOW_KEY: ***
[12:23:53] Verified live: 0
```

`Verified live: 0` — нет новых live-переходов в этом окне. Это норма: ping срабатывает только при ненулевом списке. На следующем естественном prod cycle (когда enrich-collect-batch найдёт готовые batch-результаты и переведёт статью в `publish_ready`) `pingIndexNow` отработает с реальной нагрузкой и в логе появится `IndexNow: pinged N url(s), status=200`.

---

## Текущее состояние прода

| Поверхность | Значение |
|---|---|
| `https://news.malakhovai.ru/` | HTTP 200 |
| `https://news.malakhovai.ru/sitemap.xml` | **852 URL** (растёт с каждой публикацией; кеш `revalidate=1800`) |
| `https://news.malakhovai.ru/indexnow.txt` | `62513c39642606cf9c26b732dbc00924`, HTTP 200 |
| Live indexable в БД | **842** |
| MIT TR target article | HTTP 200, cover есть, в sitemap |

Расхождение 852 sitemap vs 842 БД: 852 = 9 системных URL (главная, /russia, 7 категорий, /sources) + 843 articles. Один или два минорных дрейфа из-за гонки публикаций vs revalidate-окна (≤30 мин), это норма.

---

## Что я НЕ сделал и почему

1. **`Vercel env INDEXNOW_KEY` для Preview environment** — CLI вернул JSON-help вместо успеха при попытке `vercel env add INDEXNOW_KEY preview`. Production + Development установлены. Preview не критично для прода, можно дописать вручную через Vercel Dashboard → Project Settings → Environment Variables.

2. **Workflow `vercel/preview` для Preview-деплоев новых PR** не имеет `INDEXNOW_KEY` (см. п.1) — preview-deployments на чужих ветках будут отдавать 404 на `/indexnow.txt`. Это не влияет на прод.

3. **Не дождался реальной log-строки `IndexNow: pinged N`** — для этого нужен живой `published_live` переход, в момент проверки очередь была пустой. Логика проверена unit-тестами и прямым curl-тестом (HTTP 202). Лог-строка появится при первом естественном переходе, обычно в течение часа.

4. **Working tree остался dirty** — там лежат правки от **другой инициативы** (codex-agent: editorial routing, model-pricing, image-style-lab, ai-covers cron). Я не трогал их в этой сессии и не коммитил. Это не моя работа.

---

## Что следить дальше (тебе)

**Первые 24-48 часов:**
- Открыть `https://webmaster.yandex.ru/site/news.malakhovai.ru/indexing/turbo/` (или раздел «Индексирование → Обход страниц»). Искать строки с источником **IndexNow**. Должны появляться через 10-30 минут после каждой новой публикации.
- В Google Search Console → «Sitemaps» → `sitemap.xml` показатель «Indexed» должен расти.

**Через неделю:**
- Сравнить «Страницы в поиске» Яндекса с числом в БД. Цель ≥ 70%.
- Если плато — заглянуть в раздел «Исключённые страницы». Там Яндекс пишет конкретные причины (малоценная, дубль, не индексируется по запросу, ошибка обхода и т.д.).

**Команды для самопроверки:**
```bash
# Sitemap должен расти с каждой публикацией
curl -s https://news.malakhovai.ru/sitemap.xml | grep -c '<loc>'

# Свежий <lastmod> в sitemap (должен быть < 30 минут от now)
curl -s https://news.malakhovai.ru/sitemap.xml | grep -oE '<lastmod>[^<]+</lastmod>' | sort | tail -1

# Посмотреть, прошёл ли ping на последнем publish-verify run
gh run list --workflow publish-verify.yml --limit 1 --json databaseId -q '.[0].databaseId' \
  | xargs -I{} gh run view {} --log 2>&1 | grep -iE "indexnow|verified live"
```

---

## Файлы, изменённые в этой волне

```
app/indexnow.txt/route.ts                    [new]
app/sitemap.ts                                [+revalidate]
.github/workflows/publish-verify.yml          [+INDEXNOW_KEY env]
docs/ARTICLE_SYSTEM.md                        [+ISR + IndexNow notes]
docs/OPERATIONS.md                            [+INDEXNOW_KEY env doc]
docs/wave_seo_indexation_2026-05-09.md       [this file]
lib/indexnow.ts                               [new]
pipeline/publish-verify.ts                    [+pingIndexNow integration]
tests/node/indexnow.test.ts                   [new, 5 cases passing]
```

Memory персонализированной памяти:
```
feedback_nextjs_sitemap_isr.md  [new]
```

---

## Связанные доки

- `docs/ARTICLE_SYSTEM.md` — раздел URL policy: ISR sitemap + IndexNow.
- `docs/OPERATIONS.md` — раздел «Переменные окружения»: `INDEXNOW_KEY`.
- `docs/spec_2026-05-06_site_improvements.md` и `docs/execution_plan_2026-05-06_site_improvements.md` — предыдущая волна (2026-05-06), на которую эта работа опирается.

---

**Ключ для перепроверки:** `62513c39642606cf9c26b732dbc00924` (тот же, что отдаётся `/indexnow.txt`).
