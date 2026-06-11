# Publication Task — karty-i-servisy-dlya-oplaty-zarubezhnykh-ii-podpisok

После появления PNG в raw-images/:
1. `npm run images:prep -- --slug=karty-i-servisy-dlya-oplaty-zarubezhnykh-ii-podpisok`
2. cp 07 → content/guides/<slug>.md; cp 08 → content/guides/meta/<slug>.json; снять noindex.
3. topics.json id=33: planned → published.
4. evergreen:check / build / тесты; cover ≥ 80 KB.
5. Commit + push + vercel --prod + IndexNow.
ВАЖНО: деплоить одним батчем с гайдом id=32 (chatgpt-v-rossii...) — статьи ссылаются друг на друга.
После одобрения Admitad: заменить упоминание GGSel на deeplink (rel sponsored), после ответа GetPayAll — аналогично.
