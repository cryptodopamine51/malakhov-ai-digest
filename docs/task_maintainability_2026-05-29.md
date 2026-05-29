# Task — поддерживаемость: god-модули, demo-роуты, дрейф докуменации (P2)

> Рабочий, не канонический. Источник: `docs/senior_review_2026-05-29.md` (P2.7 + P2.8 + P2.9).
> Статус: **2.8 DONE, 2.9 DONE (2026-05-29); 2.7 DEFERRED.**

## 2.7 — God-модули — DEFERRED
**Проблема:** крупные модули растут в god-объекты.
- `lib/ops-summary.ts` — 1000 строк (compute + format + telegram-форматтеры в одном файле).
- `lib/articles.ts` — 909 строк.
- `app/guides/[slug]/page.tsx` — 910 строк.
- `app/categories/[category]/[slug]/page.tsx` — 760 строк.

**Решение:** отложено. Код чистый, поведение корректное, срочности нет. Делать инкрементально
при следующем содержательном касании этих файлов (split compute/format в `ops-summary`, вынос
секций article-страниц в `src/components/`, цель ~400–500 строк/модуль). Рефактор ради рефактора
сейчас только добавил бы риск без выгоды для целей продукта.

## 2.8 — Demo-роуты в прод-бандле — DONE
**Проблема:** `app/demo/vector-covers/page.tsx` и `app/demo/image-lab/page.tsx` ездили в прод-сборку.
Корректно `noindex` + `disallow /demo/` (не утечка), но раздувают surface поддержки.

**Сделано:**
- `lib/demo-gate.ts` (новый) — `isDemoEnabled()`: доступны везде, кроме production
  (`VERCEL_ENV !== 'production'`), в production — только при `ENABLE_DEMO=on` (escape hatch).
- Обе demo-страницы: `if (!isDemoEnabled()) notFound()` в начале серверного компонента
  (`import { notFound } from 'next/navigation'`). Страницы `force-dynamic`, поэтому гейт
  вычисляется на каждый запрос по runtime-env.
- `.env.example` (если нужно) / поведение: локально и в preview demo открыты; в prod — 404.

**DoD:** [x] в прод-сборке `/demo/*` отдаёт 404 (кроме `ENABLE_DEMO=on`); локально/в preview доступны.

## 2.9 — Дрейф докуменации про модель — DONE
**Проблема:** `CLAUDE.md` «Текущее production-ядро» утверждал
`Enrichment | pipeline/enricher.ts + Claude Sonnet 4.6`, а живой enrich-путь
(`.github/workflows/enrich.yml`, каждые 30 мин) — `editorial:routing --mode=cheap`:
DeepSeek-first writer (`deepseek-v4-flash`) + Claude Sonnet 4.6 как selective reviewer и
premium/Anthropic-Batch fallback.

**Проверка реального routing'а:** `scripts/run-editorial-routing.ts` (writer DeepSeek, reviewer
`claude-sonnet-4-6`, fallback в `anthropic_batch_items`), `pipeline/editorial-routing.ts`
(`getEditorialRoutingConfig`, дефолт `premium`+`anthropic`, но прод гоняет `cheap`),
`pipeline/claude.ts` (`MODEL = 'claude-sonnet-4-6'`). `docs/ARTICLE_SYSTEM.md` (раздел routing)
уже описывал это корректно — дрейф был только в CLAUDE.md и в pipeline-описании ARCHITECTURE.md.

**Сделано:**
- `CLAUDE.md` — строка таблицы Enrichment переписана на cheap-routing (DeepSeek-first + Claude
  reviewer/Batch fallback) со ссылкой на `docs/ARTICLE_SYSTEM.md`.
- `docs/ARCHITECTURE.md` — в pipeline-списке добавлена строка про основной enrich-путь
  (`enrich.yml` → `run-editorial-routing` cheap), `enrich-submit-batch` переописан как
  premium/fallback, `enricher.ts` помечен как retry-путь.
- `docs/PROJECT.md` — `docs/ARTICLE_SYSTEM.md` остаётся каноном по routing (без изменений).

**DoD:** [x] канонические доки описывают фактический routing (cheap-first + Anthropic fallback).

## Проверки
- `tsc --noEmit` чисто.
- `next lint` (app/src/lib) — No ESLint warnings or errors.
- Полный прогон тестов: 250/250 pass.
- `npm run docs:check` green.

## Файлы
- `lib/demo-gate.ts` (новый)
- `app/demo/vector-covers/page.tsx`, `app/demo/image-lab/page.tsx` (гейт)
- `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/PROJECT.md` (доки)

Docs updated: docs/PROJECT.md, docs/ARCHITECTURE.md, CLAUDE.md
