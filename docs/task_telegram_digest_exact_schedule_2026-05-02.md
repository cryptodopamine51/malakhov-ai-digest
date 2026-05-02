---
title: Точное расписание Telegram-дайджеста
date: 2026-05-02
status: proposed
owner: malast
canonical_doc: docs/OPERATIONS.md
---

# Цель

Дайджест в Telegram-канал `malakhov-ai` должен уходить **в точное время**:

- **будни (Пн–Пт):** 09:30 МСК
- **выходные (Сб, Вс):** 11:30 МСК

Допуск — ±1 минута. Текущее «плавание» в 1–2 часа — устранить.

# Текущее состояние (что сломано)

`.github/workflows/tg-digest.yml` использует GitHub Actions cron с 4 окнами подряд (06/07/08/09 UTC). GitHub Actions cron **не имеет SLA** — типичная задержка 1–2 часа в часы пик. Из-за этого пост уходит где-то в окне 09:00–12:00 МСК, без гарантии.

Защита от дублей через `digest_runs (digest_date+channel_id)` UNIQUE-claim работает корректно — но точное время это не решает в принципе, это архитектурное ограничение GH Actions.

# Решение — Vercel Cron + API route

Vercel у проекта уже подключён, Vercel Cron срабатывает с минутной точностью. Это правильный инструмент для требований «точное время».

## Архитектура

```
Vercel Cron (vercel.json) ──HTTP POST──► /api/cron/tg-digest
                                              │
                                              ├─ verify Authorization: Bearer $CRON_SECRET
                                              ├─ verify x-vercel-cron header (доп. защита)
                                              └─ runDailyDigest() из bot/daily-digest.ts
```

Существующая логика в `bot/daily-digest.ts` (claim через `digest_runs`, выбор tg_teaser, UTM, хэштеги, health-отчёт) — переиспользуется без изменений. Меняется только триггер.

# Шаги реализации

## 1. API-роут

**Создать:** `app/api/cron/tg-digest/route.ts`

- `export const runtime = 'nodejs'` (нужен Supabase service key)
- `export const maxDuration = 300` (дайджест может ждать TG rate-limit)
- Принять `POST`, проверить `Authorization: Bearer ${process.env.CRON_SECRET}`
- Дополнительно проверить заголовок `x-vercel-cron === '1'` (защита от внешних вызовов)
- Импортировать и вызвать функцию из `bot/daily-digest.ts` (если она экспортируется как `main()` — переименовать в `runDailyDigest()` и экспортировать; иначе сделать тонкую обёртку)
- Вернуть `{ ok: true, claimed: boolean, message_id?: number }`

## 2. Расписание

**Обновить:** `vercel.json`

```json
{
  "crons": [
    { "path": "/api/cron/tg-digest", "schedule": "30 6 * * 1-5" },
    { "path": "/api/cron/tg-digest", "schedule": "30 8 * * 6,0" }
  ]
}
```

- `30 6 * * 1-5` → 06:30 UTC = 09:30 МСК, Пн–Пт
- `30 8 * * 6,0` → 08:30 UTC = 11:30 МСК, Сб + Вс

**Проверить план Vercel:** Hobby — 2 cron jobs, Pro — 40. Текущий проект должен укладываться даже в Hobby (2 расписания на этом эндпоинте + что-то для других задач — заранее свериться с `vercel.json`).

## 3. Секрет

**Добавить env:**

- `CRON_SECRET` — random 32+ байта, в Vercel Project Settings → Environment Variables (Production + Preview)
- В `.env.local` (локально для smoke-теста) — тот же секрет

## 4. Удалить старый workflow

**Удалить:** `.github/workflows/tg-digest.yml`

Оставить нельзя — тогда дайджест будет улетать дважды (GH Actions + Vercel Cron). UNIQUE-claim в `digest_runs` защитит от дубля в TG, но один из путей будет каждый раз падать с `already_claimed` и шуметь в логах/алёртах.

## 5. Обновить документацию

**Обновить:** `docs/OPERATIONS.md`

- Раздел про tg-digest cron: переписать под Vercel Cron
- Удалить «Cron-избыточность для tg-digest» (4 окна) — больше не актуально
- Добавить, что fallback при сбое Vercel Cron — ручной `workflow_dispatch` через `npm run tg-digest` локально или временный GH workflow с `force=true`

## 6. Smoke-тест

1. Локально: `curl -X POST http://localhost:3000/api/cron/tg-digest -H "Authorization: Bearer $CRON_SECRET"` — должен отработать `runDailyDigest()` без отправки в прод-канал (использовать тестовый `TELEGRAM_CHANNEL_ID`)
2. На Vercel Preview: тот же curl на preview-URL
3. На Vercel Production: дождаться первого срабатывания cron, проверить что пост ушёл ровно в 9:30 ± 1 мин (Пн), затем 11:30 ± 1 мин (Сб)

# Acceptance Criteria

- [ ] Будний дайджест уходит в 09:30 МСК ± 1 минута (проверено минимум 3 рабочих дня подряд)
- [ ] Дайджест по выходным уходит в 11:30 МСК ± 1 минута (проверено Сб + Вс)
- [ ] `digest_runs` UNIQUE-claim сохранён, ручной `force=true` всё ещё работает
- [ ] `.github/workflows/tg-digest.yml` удалён
- [ ] `docs/OPERATIONS.md` обновлён, прогнан `npm run docs:check`

# Риски и open questions

1. **Vercel Cron timeout** — у Hobby plan 10 секунд для Edge / 60 для Node. Дайджест может не уложиться. Если так — Vercel Cron только триггерит фоновую задачу (через `waitUntil` или Inngest/Supabase Queue), а не выполняет её inline. Решить после первого замера.
2. **Дубли при первом запуске** — пока обе системы живы (overlap), `already_claimed` будет шуметь. Окно overlap минимизировать (удаление GH workflow в том же PR, что и активация Vercel Cron).
3. **Что считаем «выходным»** — `* * 6,0` это Сб (6) и Вс (0) по cron-конвенции. Праздники не учитываются. Если нужны — отдельная задача (статичный список или production-календарь).

# Связанные файлы

- `bot/daily-digest.ts` — главная функция, переиспользуется
- `vercel.json` — добавить `crons`
- `app/api/cron/tg-digest/route.ts` — новый файл
- `.github/workflows/tg-digest.yml` — удалить
- `docs/OPERATIONS.md` — обновить раздел cron
