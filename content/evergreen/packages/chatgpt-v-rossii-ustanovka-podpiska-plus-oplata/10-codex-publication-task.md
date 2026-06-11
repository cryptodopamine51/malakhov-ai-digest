# Publication Task — chatgpt-v-rossii-ustanovka-podpiska-plus-oplata

После появления PNG в raw-images/:
1. `npm run images:prep -- --slug=chatgpt-v-rossii-ustanovka-podpiska-plus-oplata`
2. cp 07-final-article.md → content/guides/<slug>.md; cp 08-metadata.json → content/guides/meta/<slug>.json; снять `"noindex": true`.
3. topics.json id=32: planned → published.
4. evergreen:check / build / lint / tsc / tests — всё зелёное, cover ≥ 80 KB.
5. Commit + push + `vercel --prod --yes` + IndexNow.
Особенности: партнёрские ссылки Syntx уже в теле (паттерн id=31, дисклеймер на месте). CTA-поверхности: telegram-digest / contacts / telegram-personal (@iddopamine).
