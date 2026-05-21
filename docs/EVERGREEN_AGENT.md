# Evergreen Agent — единая инструкция выпуска статьи

> **Цель этого файла:** владелец говорит «сделай следующую evergreen-статью по `docs/EVERGREEN_AGENT.md`» — агент делает всё сам. Владелец только подкидывает 1–5 PNG-картинок из ChatGPT, когда агент его об этом попросит, и в конце получает рабочую URL.
>
> Последнее обновление: 2026-05-22

---

## Что умеет агент по этому файлу

| Шаг | Кто делает | Команда / действие |
|---|---|---|
| 1. Найти следующую тему | агент | `npm run evergreen:next` |
| 2. Подготовить редакционный пакет (12 файлов) | агент | `npm run evergreen:new -- --topic-id=<N>` |
| 3. Написать статью по Evergreen Quality Bar | агент | заполняет файлы пакета 01–08 |
| 4. Подготовить промпты для картинок | агент | пишет `09-image-brief.md` + явно даёт владельцу промпты в чат |
| 5. **🖼 Сгенерировать PNG в ChatGPT и положить в `raw-images/`** | **владелец** | вручную через подписку ChatGPT Plus / Pro / Codex |
| 6. Конвертировать PNG → WebP по правильным размерам | агент | `npm run images:prep -- --slug=<slug>` |
| 7. Перенести в production: `content/guides/`, `content/guides/meta/`, снять `noindex` | агент | автоматически после p.6 |
| 8. Прогнать локальные проверки | агент | `evergreen:check`, `build`, `lint`, `tsc`, тесты |
| 9. Коммит + push в активную ветку | агент | git commit + git push |
| 10. Деплой в production через Vercel | агент | `vercel --prod` (alias автоматом ставится на `news.malakhovai.ru`) |
| 11. Пинг IndexNow (Yandex / Bing) | агент | `npx tsx scripts/indexnow-batch.ts` |
| 12. Дать владельцу URL готовой статьи | агент | `https://news.malakhovai.ru/guides/<slug>` |

Владелец касается процесса **только на шаге 5**. Всё остальное — агент.

---

## Архитектурное решение (зафиксировано 2026-05-22)

Активная ветка для выпуска evergreen-статей: **`codex/evergreen-quality-standard-2026-05-21`** (file-based registry в `lib/guides.ts` + meta JSON в `content/guides/meta/<slug>.json`). Все новые статьи добавляются туда. Production deploy выполняется через `vercel --prod` напрямую из этой ветки — alias на `news.malakhovai.ru` автоматически обновляется.

Мерж в `main` происходит **только по явному запросу владельца** и требует ручного rebase + resolve конфликтов с `EVERGREEN_ARTICLE_PLAYBOOK.md` / `GuideScrollTools.tsx`, которые на main эволюционировали отдельно.

---

## Команда владельца

Когда владелец говорит:

> «Сделай следующую evergreen-статью по `docs/EVERGREEN_AGENT.md`»

— агент исполняет всю последовательность ниже. Если есть конкретный topic-id («сделай статью id=14 по `docs/EVERGREEN_AGENT.md`») — пропускает шаг «Найти следующую тему» и берёт указанный id.

Когда владелец говорит:

> «Картинки положил, продолжай»

— агент исполняет с шага 6 (images:prep) до конца, без вопросов.

Когда владелец говорит:

> «Опубликуй статью `<slug>`» (если процесс прерывался) —

агент проверяет состояние пакета и доводит до prod.

---

## Workflow целиком (пошагово, для агента)

### Шаг 0. Прочитать обязательное

В каждой новой сессии перед стартом агент **обязан** перечитать:

1. `CLAUDE.md` — контрольный план проекта.
2. Этот файл (`docs/EVERGREEN_AGENT.md`).
3. `docs/spec_2026-05-21_evergreen-quality-standard.md` — все обязательные элементы (lead anchor, кейс, counter-strategy и т.д.).
4. `docs/editorial/seo-article-publication-standard.md` §7, §11, §14, §15, §17.
5. `docs/editorial_style_guide.md` — общий тон + раздел «Evergreen quality bar».
6. `articles ever green/Проект 1/Промпт-для-создания-одной-статьи.txt` — базовый промпт.
7. `articles ever green/Проект 2/Промпт-для-финальной-редактуры.txt` — чек-лист редактора.
8. Эталон уровня: `content/guides/kak-vnedrit-ii-v-biznes-2026.md` и `content/guides/skolko-stoit-vnedrenie-ii-v-kompaniyu.md`.

Если какой-то из этих файлов отсутствует — остановиться и сообщить владельцу.

### Шаг 1. Найти следующую тему

```bash
npm run evergreen:next
```

Скрипт выводит первую тему со `status: planned`, отсортированную по приоритету (high → medium → low) и `id`. Печатает id, slug, кластер, intent, primary keyword, audience, cta и редакционные notes. Подсказывает следующую команду.

Если владелец указал конкретный id — пропустить, использовать его.

### Шаг 2. Создать редакционный пакет

```bash
npm run evergreen:new -- --topic-id=<N>
```

Создаст `content/evergreen/packages/<slug>/` с 12 файлами-шаблонами (`00-topic.json` … `11-publication-checklist.md`).

### Шаг 3. Написать статью по Evergreen Quality Bar

Заполнить файлы пакета по порядку. Финальная статья (`07-final-article.md`) должна соответствовать всем 10 правилам:

1. **Lead anchor.** Первое предложение лида содержит число / дату / имя собственное / источник.
2. **`verifiedAt`** в `08-metadata.json` (ISO-date — сегодняшняя дата). Сайт автоматически отрендерит «Актуальность проверена: …» в шапке.
3. **Numerical worked example** для числовых intents — развёрнутый расчёт «Ситуация → данные → формула → результат → выводы», не таблица категорий.
4. **Один развёрнутый кейс** по структуре *Ситуация → Что делает ИИ → Что нужно для пилота → Метрики → Итог*. Источник: реальный публичный → анонимизированный → редакционный (помечать «Редакционный пример»). Заголовок H3 начинается с «Кейс:» или «Сценарий:» или «Ситуация:» или «Мини-кейс:».
5. **Counter-strategy H2** «Когда не стоит / не окупится / Ошибки внедрения» — 3–5 конкретных критериев.
6. **Российский контекст**: 152-ФЗ для данных/клиентов/HR; GigaChat / YandexGPT для тарифов; Яндекс.Директ / ВКонтакте / OK для маркетинга.
7. **≥ 2 inline-ссылок** в теле на `/guides/<slug>`, `/categories/<cat>` или `/russia` (не считая related). Запрещено линковать на ещё не опубликованные гайды.
8. **CTA cap**: ≤ 2 inline-CTA в теле + 1 final-CTA блок с 3 карточками.
9. **`08-metadata.json`** обязательные поля: `slug`, `path`, `title`, `seoTitle`, `description`, `ogDescription`, `category`, `tags` (4–6), `publishedAt`, `updatedAt`, **`verifiedAt`** (ISO-date), опционально `caseSourcing` (`public`/`anonymized`/`editorial`), `readingMinutes`, `heroLead`, `cover`, `inlineImagesByHeading`, `relatedLinks` (2–4), `faq` (6–10), `inlineCtas` (≤ 2), `ctaCards` (1 final-блок с ≤ 3 элементами). По умолчанию ставить `"noindex": true`.
10. **Запрещено**: придумывать цифры / тарифы / имена компаний / кейсы клиентов / цитаты; ссылки на будущие гайды; FAQPage без visible FAQ; инфобиз-клише («секрет», «прорыв», «3 шага к ИИ-трансформации»); дублирующее markdown `## Оглавление` (сайт стрипает автоматически — лучше вообще не писать); английские термины внутри editorial body (`proof of concept`, `production`, `workflow`, `dashboard`, `fallback`, `no-code`, `helpdesk`, `GenAI`); конструкции «не X, а Y» и «не просто X, а Y» (евергрин-стайл — без штампов).

Финальный объём:
- главные хабы (id 3, 7, 13, 14, 19, 24, 25, 28, 30) — 10 000–18 000 знаков;
- статьи про конкретные инструменты — 6 000–12 000;
- узкие / explainer — 2 000–5 000.

### Шаг 4. Подготовить image brief + промпты владельцу

В `09-image-brief.md` для cover и каждой inline-картинки заполнить:

- `filename_png`, `filename_webp` (имена должны совпадать с теми, что в `08-metadata.json::cover.src` и `inlineImagesByHeading.*.src`, но с расширениями `.png` / `.webp`);
- `prompt` (4–8 строк для ChatGPT, концепция + стиль + ограничения);
- `negative_prompt` (no robots, no neon, no glowing brain, no handshake, no readable text inside image, no generic office stock);
- `alt` (для слепых + SEO, описательный);
- `caption` (раскрывает, что изображено и зачем);
- `aspect` (`16:9` для cover, `3:2` для inline rect, `1:1` для inline square).

Cover **обязателен** (1200×675 WebP, ≥ 80 KB финал). Inline — обычно 2–4 шт. для матриц, схем, диаграмм (1200×800 или 1200×1200).

После заполнения brief — агент **обязан** в чате выдать владельцу следующее сообщение (без markdown-блокировки, чтобы было читабельно):

```
🖼 Картинки для статьи <slug> готовы к генерации.

Я заполнил image brief в content/evergreen/packages/<slug>/09-image-brief.md.

Что нужно от тебя:
1. Открой ChatGPT (Plus / Pro / Codex).
2. Для каждой картинки скопируй prompt из списка ниже, сгенерируй PNG в указанном aspect (можно использовать "make this image 16:9" / "1024x1024" / etc.).
3. Сохрани каждый PNG как content/evergreen/packages/<slug>/raw-images/<filename>.png (имя файла важно).
4. Скажи мне: «картинки положил, продолжай» — я доделаю всё сам (resize → WebP → деплой → ссылка).

Список картинок:

[1/N] cover.png — aspect 16:9
─────────────────────────────────────────
prompt:
[вставить prompt из 09-image-brief.md]

negative prompt:
[вставить negative_prompt]

[2/N] <filename>.png — aspect 3:2 (или 1:1)
─────────────────────────────────────────
prompt:
[…]

negative prompt:
[…]

[… повторить для каждой inline-картинки …]
```

После этого сообщения — **остановиться и ждать**, пока владелец не скажет «картинки положил». Не делать никаких других шагов.

### Шаг 5. (выполняет владелец) Сгенерировать PNG в ChatGPT

Не входит в обязанности агента.

### Шаг 6. Конвертация PNG → WebP

Когда владелец говорит «картинки положил, продолжай»:

```bash
npm run images:prep -- --slug=<slug>
```

Скрипт:
- читает `content/evergreen/packages/<slug>/raw-images/*.png`;
- мэтчит каждый файл с `08-metadata.json` (cover или одна из `inlineImagesByHeading`);
- ресайзит до правильного размера (cover 1200×675, inline 1200×800 / 1200×1200) через `sharp`;
- конвертирует в WebP quality 82;
- пишет в `public/images/guides/<slug>/<filename>.webp`;
- предупреждает, если PNG больше 5 МБ (это нормально — ChatGPT иногда отдаёт большие файлы).

Если какой-то PNG отсутствует или имя не совпадает с brief — агент сообщает владельцу конкретно какой файл не найден и просит исправить (не идёт дальше).

### Шаг 7. Перенос в production paths

После успешного `images:prep`:

```bash
cp content/evergreen/packages/<slug>/07-final-article.md  content/guides/<slug>.md
cp content/evergreen/packages/<slug>/08-metadata.json     content/guides/meta/<slug>.json
```

В `content/guides/meta/<slug>.json` снять флаг `"noindex": true` (поменять на `false` или удалить ключ — обе формы валидны). Если владелец хочет дополнительную ревизию перед индексацией — спросить в чате до снятия флага. По умолчанию: снимаем сразу (раз пользователь сказал «сразу готовая и индексируемая»).

Обновить `status` в `content/evergreen/topics.json` для этого id с `planned` → `published`.

### Шаг 8. Локальные проверки

```bash
npm run evergreen:check -- --slug=<slug>      # 0 errors обязательно
npm run build                                   # exit 0 обязательно
npm run lint                                    # 0 warnings
npx tsc --noEmit                                # 0 errors
find tests/node -name '*.test.ts' -maxdepth 1 | xargs npx tsx --test
```

Если `evergreen:check` падает с error — починить и повторить. Если build не собирается — починить.

Допустимы только warnings, никаких errors. `cover_min_size` warning **не должен** оставаться (мы только что положили cover из ChatGPT — он обязан быть ≥ 80 KB; если меньше — попросить владельца перегенерить).

### Шаг 9. Коммит + push

```bash
git add -A                                                   # все новые файлы
git commit -m "feat(guides): publish <slug>

Topic id=<N>: <Заголовок темы>.

- content/guides/<slug>.md
- content/guides/meta/<slug>.json (noindex removed)
- public/images/guides/<slug>/cover.webp + N inline WebP
- content/evergreen/packages/<slug>/* — publication package
- content/evergreen/topics.json — status: planned → published

Verified locally: evergreen:check ok, build exit 0, 217/217 tests pass.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push origin codex/evergreen-quality-standard-2026-05-21
```

### Шаг 10. Деплой в production

```bash
vercel --prod --yes
```

После завершения `vercel` выведет URL deployment'а. Этот deployment автоматически получит alias `news.malakhovai.ru`. Подождать `● Ready` (обычно 2–5 минут).

### Шаг 11. IndexNow ping

Если в окружении установлен `INDEXNOW_KEY`:

```bash
INDEXNOW_KEY="$INDEXNOW_KEY" npx tsx scripts/indexnow-batch.ts
```

Если `INDEXNOW_KEY` не выставлен в окружении агента — напомнить владельцу выполнить эту команду самому или пропустить (Yandex и Bing найдут страницу через sitemap, просто медленнее).

### Шаг 12. Финальный отчёт владельцу

В чате выдать сообщение вида:

```
✅ Статья опубликована.

URL:           https://news.malakhovai.ru/guides/<slug>
Заголовок:     <title>
Категория:     <category>
verifiedAt:    <дата>
Word count:    <число>
Внутр. ссылки: <число>
Кейс:          <название кейса>
Counter-H2:    <заголовок>

Картинки:
- cover.webp (1200×675, <размер KB>)
- <filename>.webp (1200×800, <размер KB>)
- […]

Vercel deployment: <vercel URL>
IndexNow: <ok / пропущен — нужен INDEXNOW_KEY>
Коммит: <git short SHA> в codex/evergreen-quality-standard-2026-05-21

Следующая тема (по `npm run evergreen:next`): id=<N>, "<title>".
```

---

## Если что-то пошло не так

| Проблема | Что делает агент |
|---|---|
| `evergreen:next` не находит planned-тему | Сообщить владельцу, что все темы выпущены / нужно расширить `topics.json` |
| Владелец положил PNG с неправильным именем | Сообщить конкретно какой файл не найден, попросить переименовать |
| Cover < 80 KB после конвертации | Попросить владельца перегенерить cover в ChatGPT с более насыщенной композицией; не публиковать |
| `evergreen:check` errors после переноса | Откатить копирование (`git checkout -- content/guides/<slug>.md content/guides/meta/<slug>.json`), починить в пакете, повторить |
| `npm run build` падает | Не пушить и не деплоить. Починить и повторить |
| `vercel --prod` упал | Прочитать output, починить (часто `next.config.mjs` / env vars), повторить. Не коммитить новых правок, пока не починится prod-build |
| Пользователь сказал «отмени» | `git reset --hard HEAD~1` (только локально, до push) или дополнительный revert-коммит (после push) — спросить у владельца |

---

## Что агент НЕ делает без явного разрешения

- Не мержит в `main` (там другая архитектура — `EVERGREEN_ARTICLE_PLAYBOOK.md` + hardcoded `lib/guides.ts`).
- Не использует image API (политика проекта, см. `docs/spec_2026-05-21_evergreen-quality-standard.md` §4).
- Не публикует с `noindex: true`, кроме случаев когда владелец явно попросил «опубликуй скрытно для ревизии».
- Не правит чужие статьи без явного запроса.
- Не удаляет существующие гайды или их картинки.
- Не трогает settings.json, hooks, GitHub Actions без явного запроса.

---

## Эталонный «один-командный» жизненный цикл

```
владелец:  «сделай следующую evergreen-статью по docs/EVERGREEN_AGENT.md»
                  ↓
агент:     [читает все файлы шага 0]
агент:     npm run evergreen:next → id=3, ii-dlya-malogo-biznesa-s-chego-nachat
агент:     npm run evergreen:new -- --topic-id=3
агент:     [пишет статью по 10 правилам Quality Bar]
агент:     [заполняет 09-image-brief.md]
агент:     [выдаёт в чат «🖼 Картинки готовы к генерации …» с промптами]
                  ↓
владелец:  [генерит N PNG в ChatGPT, кладёт в raw-images/]
владелец:  «картинки положил, продолжай»
                  ↓
агент:     npm run images:prep -- --slug=ii-dlya-malogo-biznesa-s-chego-nachat
агент:     cp 07-final-article.md → content/guides/<slug>.md
агент:     cp 08-metadata.json → content/guides/meta/<slug>.json (noindex: false)
агент:     [обновляет topics.json: planned → published]
агент:     npm run evergreen:check / build / lint / tests   → всё green
агент:     git commit + git push
агент:     vercel --prod --yes  → deployment Ready
агент:     npx tsx scripts/indexnow-batch.ts  (если есть key)
                  ↓
агент:     «✅ Статья опубликована: https://news.malakhovai.ru/guides/ii-dlya-malogo-biznesa-s-chego-nachat»
```

С точки зрения владельца — две его реплики: «сделай следующую» и «картинки положил». Всё остальное — агент.
