# Codex Publication Task: ИИ-агенты в поддержке клиентов

## Mode

create

## Статус

Пакет готов (`ready_for_codex`), ожидает картинки от владельца (4 PNG в `raw-images/`).

## Шаги публикации (после «картинки положил, продолжай»)

1. `npm run images:prep -- --slug=ii-agenty-v-podderzhke-klientov`
2. Проверить: cover ≥ 80 KB, 4 WebP в `public/images/guides/ii-agenty-v-podderzhke-klientov/`.
3. `cp content/evergreen/packages/ii-agenty-v-podderzhke-klientov/07-final-article.md content/guides/ii-agenty-v-podderzhke-klientov.md`
4. `cp content/evergreen/packages/ii-agenty-v-podderzhke-klientov/08-metadata.json content/guides/meta/ii-agenty-v-podderzhke-klientov.json` и снять `"noindex": true`.
5. `content/evergreen/topics.json`: id=10 `planned` → `published`.
6. `npm run evergreen:check -- --slug=ii-agenty-v-podderzhke-klientov` — 0 errors.
7. `npm run build`, `npm run lint`, `npx tsc --noEmit`, node-тесты.
8. Коммит + push в активную ветку, `vercel --prod --yes`.
9. IndexNow при наличии `INDEXNOW_KEY`.

## Контрольные точки качества

- inlineImagesByHeading ключи совпадают со слагами H2 в markdown (`шесть-сценариев-ии-агентов-в-поддержке`, `база-знаний-решает-больше-чем-модель`, `worked-example-расчет-окупаемости-агента-поддержки`).
- inlineCtas afterHeading: `что-ии-агент-реально-делает-в-поддержке`, `когда-ии-агент-в-поддержке-не-окупится`.
- FAQ в markdown и meta идентичны (7 шт.).
