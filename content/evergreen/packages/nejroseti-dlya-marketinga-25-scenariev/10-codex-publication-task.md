# Codex Publication Task: Нейросети для маркетинга: 25 сценариев

## Mode

create

## Статус

Пакет готов (`ready_for_codex`), ожидает картинки от владельца (4 PNG в `raw-images/`).

## Шаги публикации (после «картинки положил, продолжай»)

1. `npm run images:prep -- --slug=nejroseti-dlya-marketinga-25-scenariev`
2. Проверить: cover ≥ 80 KB, 4 WebP в `public/images/guides/nejroseti-dlya-marketinga-25-scenariev/`.
3. `cp content/evergreen/packages/nejroseti-dlya-marketinga-25-scenariev/07-final-article.md content/guides/nejroseti-dlya-marketinga-25-scenariev.md`
4. `cp content/evergreen/packages/nejroseti-dlya-marketinga-25-scenariev/08-metadata.json content/guides/meta/nejroseti-dlya-marketinga-25-scenariev.json` и снять `"noindex": true`.
5. `content/evergreen/topics.json`: id=13 `planned` → `published`.
6. `npm run evergreen:check -- --slug=nejroseti-dlya-marketinga-25-scenariev` — 0 errors.
7. `npm run build`, `npm run lint`, `npx tsc --noEmit`, node-тесты.
8. Коммит + push, `vercel --prod --yes`, IndexNow при наличии ключа.

## Контрольные точки качества

- inlineImagesByHeading ключи: `25-сценариев-нейросетей-в-маркетинге`, `worked-example-экономика-контента-с-нейросетями`, `когда-нейросети-в-маркетинге-не-дают-эффекта`.
- inlineCtas afterHeading: `25-сценариев-нейросетей-в-маркетинге`, `когда-нейросети-в-маркетинге-не-дают-эффекта`.
- FAQ markdown = meta (7 шт.). Категория «Маркетинг и контент» — первая статья кластера, проверить рендер категории на странице гайда.
