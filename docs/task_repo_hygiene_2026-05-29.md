# Task — вычистить замороженный Python-стек и мусор в корне (P1)

> Рабочий, не канонический. Источник: `docs/senior_review_2026-05-29.md` (P1.5 + P1.6).
> Статус: DONE 2026-05-29 (локально, staged, не закоммичено).
> Сделано: удалены `legacy/` (176 файлов) + 27 Python-тестов (`git rm`, staged). `tests/` = только `tests/node`.
> Safety: создан локальный тег `legacy-python-freeze` (не запушен). Восстановление: `git checkout legacy-python-freeze -- legacy`.
> Проверено: `tsc --noEmit` ✅, `npm test` 239/239 ✅.
> **Оставлено намеренно** (не трогал):
> - `local_dev.db` (4 МБ, gitignored, untracked) — удаление необратимо, оставил для ручного `rm` владельцем.
> - `design new/`, `articles ever green/` — рабочие материалы; `articles ever green/` явно прописан в `CLAUDE.md`
>   (ChatGPT-промпты «Проект 1/2»), перенос сломал бы документированные пути. Решение о переносе — за владельцем.

## Проблема
Проект явно TS-only (`docs/PROJECT.md`: Python/FastAPI не поддерживается, `legacy/` заморожен),
но working tree это не отражает и путает контекст-загрузку + агента.

Конкретно:
- 19 трекаемых Python-тестов в `tests/` (`tests/api/*`, `tests/services/*`, `tests/digest/*`,
  `tests/pipeline/*`, `tests/scripts/*`) тестируют несуществующие FastAPI-эндпоинты
  (`test_internal_ingestion_endpoints`, `test_event_preview_endpoints`, `test_site_leads_endpoint`…).
- `legacy/` — 176 трекаемых файлов, включая `legacy/node-duplicates/` (7 файлов, зеркалят текущий
  `app/`: `page.tsx`, `layout.tsx`, `sitemap.ts`, `russia/page.tsx`, `topics/[topic]/page.tsx`).
- `local_dev.db` (4 МБ SQLite от Python-стека) на диске (в `.gitignore`, не трекается, но лежит).
- Трекаются `design new/` (14 файлов) и `articles ever green/` (8 файлов) в корне.

## Риски, которые это снимает
- Неоднозначность «прогони тесты» (смешанное Python/TS дерево).
- Правка уедет в `legacy/node-duplicates/app/*` вместо живого `app/*`.
- Контекст-доки и агент тратят бюджет на мёртвый код.

## Цель / Definition of Done
- [ ] `tests/` содержит только `tests/node` (TS).
- [ ] `legacy/` вынесен из рабочей ветки (история сохранена тегом).
- [ ] Корень без `local_dev.db` и без рабочих материалов вперемешку с кодом.
- [ ] `npm run build` + `npm test` зелёные после уборки.

## Шаги
1. **Сохранить историю legacy перед удалением:**
   ```bash
   git tag legacy-python-freeze   # фиксируем точку, где legacy ещё в дереве
   git push origin legacy-python-freeze   # только с разрешения владельца
   ```
2. **Удалить из ветки:**
   - `legacy/` целиком (минимум — `legacy/node-duplicates/`, как самый опасный дубликат `app/`);
   - 19 Python-тестов (`tests/api`, `tests/services`, `tests/digest`, `tests/pipeline`,
     `tests/scripts`, `tests/*.py`, `tests/conftest.py`, `tests/helpers.py`, `tests/__pycache__`).
   Альтернатива удалению — карантин: `tests/_legacy_python/` + README «не запускать», но чище удалить.
3. **Корень:** удалить `local_dev.db`; `design new/` и `articles ever green/` перенести в
   non-tracked рабочий каталог или под `docs/_workspace/` (и добавить в `.gitignore`, если не нужны в истории).
4. **Проверить ссылки:** `grep -rn "legacy/" --include="*.ts" --include="*.tsx" .` — убедиться, что
   живой код нигде не импортирует `legacy/` (ESLint-правило уже запрещает import из `pipeline` в `app`,
   но прямые пути проверить вручную). `tsconfig.json` уже исключает `legacy` и `tmp`.
5. `npm run build && npm test`.

## Внимание
- Это операции с историей/удалением. `git tag` + согласование с владельцем перед `git rm`/push.
- Секреты (`.env`, `keys.env`, `malakhov-ai-keys.env`) НЕ трогать — они корректно в `.gitignore`,
  не трекаются. Это только про порядок в корне, не про утечку.

## Усилие
~1–2 часа.

## Doc impact
`docs/INDEX.md` / `docs/ARCHITECTURE.md` — если меняется структура `tests/` и статус `legacy/`.
