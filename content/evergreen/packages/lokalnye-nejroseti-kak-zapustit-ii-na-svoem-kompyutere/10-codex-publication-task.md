# Codex Publication Task: Локальные нейросети 2026

## Mode

create

## Статус

Пакет готов (`ready_for_codex`), ожидает картинки от владельца (4 PNG в `raw-images/`).

## Шаги публикации (после «картинки положил, продолжай»)

1. `npm run images:prep -- --slug=lokalnye-nejroseti-kak-zapustit-ii-na-svoem-kompyutere`
2. Проверить: cover ≥ 80 KB, 4 WebP в `public/images/guides/lokalnye-nejroseti-kak-zapustit-ii-na-svoem-kompyutere/`.
3. `cp content/evergreen/packages/lokalnye-nejroseti-kak-zapustit-ii-na-svoem-kompyutere/07-final-article.md content/guides/lokalnye-nejroseti-kak-zapustit-ii-na-svoem-kompyutere.md`
4. `cp .../08-metadata.json content/guides/meta/lokalnye-nejroseti-kak-zapustit-ii-na-svoem-kompyutere.json` и снять `"noindex": true`.
5. `content/evergreen/topics.json`: id=34 `planned` → `published`.
6. `npm run evergreen:check -- --slug=lokalnye-nejroseti-kak-zapustit-ii-na-svoem-kompyutere` — 0 errors.
7. `npm run build`, `npm run lint`, `npx tsc --noEmit`, node-тесты.
8. Коммит + push, `vercel --prod --yes`, IndexNow при наличии ключа.

## Контрольные точки качества

- inlineImagesByHeading ключи: `что-понадобится-железо-и-память`, `какую-модель-выбрать`, `когда-локальная-нейросеть-не-нужна`.
- inlineCtas afterHeading: `какую-модель-выбрать` (telegram-digest).
- FAQ markdown = meta (7 шт.).
- В тексте есть code-block с `ollama run llama3.1` — проверить рендер кода на странице гайда (первый гайд с code-block).
