# Task — CI-гейт качества + единый test-runner (P0)

> Рабочий, не канонический. Источник: `docs/senior_review_2026-05-29.md` (P0.1 + P0.2).
> Статус: DONE 2026-05-29 (локально, не закоммичено). Required-check на ветке `main` — owner step (GitHub UI).

## Проблема
- Единственный CI на `pull_request`/`push` — `docs-guard.yml` (`npm run docs:check`).
- Нет `tsc --noEmit`, `next lint`, node-тестов, `npm run build` в CI.
- 36 файлов `tests/node/*.test.ts`, в `package.json` заскриптовано только 2
  (`test:pipeline-reliability`, `test:batch-enrich`). Единого `npm test` нет.
- Эффект: регрессия уходит в прод молча; pipeline (RSS→enrich→publish→digest) не защищён.

## Цель / Definition of Done
- [x] `npm test` запускает весь pure-unit сьют одной командой.
- [x] CI-workflow на PR и push в `main` гоняет typecheck + lint + test + build.
- [ ] Workflow — required check на ветку `main` (owner step, GitHub UI).
- [x] Зелёный прогон локально: `tsc --noEmit` ✅, `npm run lint` ✅, `npm test` 239/239 ✅. CI-прогон на `main` — после merge.

## Шаги

### 1. Триаж тестов: unit vs integration
Прогнать каждый файл и разметить, какие требуют env/секретов (`SUPABASE_*`, `ANTHROPIC_*`,
`DEEPSEEK_*`, `TELEGRAM_*`), а какие чистые.
```bash
for f in tests/node/*.test.ts; do echo "== $f =="; npx tsx --test "$f" 2>&1 | tail -3; done
```
Известно зелёными без env (проверено 2026-05-29): `scorer`, `media-sanitizer`, `pagination`,
`scene-matcher`, `interest-ranking`. Остальные 31 — протриажить.

### 2. Скрипты в package.json
```jsonc
"test": "tsx --test tests/node/*.test.ts",          // если все проходят без env
"test:unit": "tsx --test <список pure-файлов>",       // если часть требует секретов
```
Решение по форме — после шага 1. Цель: `npm test` в CI не должен падать из-за отсутствия секретов.
Integration-тесты (если есть) — отдельный job со GitHub secrets или `continue-on-error` сначала.

### 3. `.github/workflows/ci.yml`
```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  quality:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run lint
      - run: npm test
      - run: npm run build
        env:
          # build читает Supabase на этапе static/ISR — нужны read-доступы.
          # Уточнить минимальный набор env для `next build` (возможно NEXT_PUBLIC_* + anon).
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          # ...добавить по факту того, что требует build
```
> Открытый вопрос: `next build` может требовать доступ к Supabase для ISR-страниц. Проверить,
> что минимально нужно, и либо прокинуть secrets, либо замокать на этапе build.

### 4. Защита ветки
Settings → Branches → `main` → Require status checks → выбрать `CI / quality`.

## Файлы
- `package.json` (scripts)
- `.github/workflows/ci.yml` (новый)
- возможно `tests/node/` — пометить integration-тесты

## Усилие
~1.5 часа (без учёта триажа env для build).

## Doc impact
`docs/OPERATIONS.md` — добавить секцию про CI-гейт (workflow, required check). `package.json`
попадает в Doc Impact Matrix → `docs/OPERATIONS.md`.
