# Editorial Pass: {{title}}

## Chief Editor Review

- Clear thesis:
- Search intent closed:
- Practical value:
- Malakhov AI angle:
- Repetitions/water removed:
- Missing examples/tables/checklists:

## SEO Review

- SEO title (≤ 60 знаков, primary keyword + год/дифференциатор):
- Description (140–160 знаков, без clickbait):
- ogDescription (140–200 знаков, продающая, но фактическая):
- H1:
- H2/H3:
- FAQ (6–10 вопросов, ответы 2–4 предложения):
- URL:
- Internal links (≥2 inline в теле + 2–4 в related):
- Featured snippet opportunities:
- Anti-cannibalization:
- Update cadence (`verifiedAt` дата):

## Fact Review

| Claim | Status | Action |
|---|---|---|
| TBD | needs_check | TBD |

## Evergreen Quality Bar Checklist

Финальная редактура обязана подтвердить:

- [ ] **Lead anchor.** Первое предложение лида содержит число / имя собственное / дату / источник.
- [ ] **verifiedAt.** В шапке статьи render видимая «Актуальность проверена: <дата>».
- [ ] **Numerical worked example.** Для статей с числовым intent — минимум один развёрнутый расчёт (ситуация → данные → формула → результат → выводы), не таблица категорий.
- [ ] **Кейс с конкретикой.** Минимум один развёрнутый кейс по структуре *Ситуация → Что делает ИИ → Что нужно для пилота → Метрики → Итог*. Источник реальный/публичный → анонимизированный → редакционный сценарий. В опубликованном тексте не ставить служебные пометки вроде `Редакционный пример` и не называть кейс нашим/клиентским без основания.
- [ ] **Counter-strategy блок.** H2 «Когда не стоит / не окупится / когда лучше не начинать» с 3–5 практическими критериями.
- [ ] **Российский контекст.** 152-ФЗ упомянут для статей о данных/клиентах/HR; локальные альтернативы (GigaChat, YandexGPT) и поверхности (Яндекс.Директ, ВКонтакте) для статей про тарифы/маркетинг.
- [ ] **Внутренние ссылки.** ≥ 2 контекстуальных `/guides`, `/categories`, `/russia` ссылки в теле, не считая related. Не ссылаемся на ещё не опубликованные гайды.
- [ ] **CTA cap.** ≤ 2 inline-CTA + 1 final-CTA блок с 3 карточками. CTA указывают только на реальные поверхности: Telegram-дайджест (`@malakhovaidigest`), форма заявки (`malakhovai.ru/contacts`), личный Telegram (`@iddopamine`). Запрещено обещать чеклисты, PDF, гайды на почту и другие lead-magnet, которых нет.
- [ ] **JSON-LD.** `author = Person` (`/about#person`), есть `wordCount`, `articleSection`, `keywords`, `inLanguage: 'ru-RU'`. FAQPage эмитируется только при visible FAQ.
- [ ] **Картинки.** Cover ≥ 50 KB, готовится через подписку ChatGPT или approved local workflow (не через image API). Inline могут быть локальными SVG для матриц/roadmap. Quality: cover q=90, inline q=88, effort=6, smartSubsample=false. Все alt описательные, captions раскрывают зачем.
- [ ] **SEO filename convention.** Cover = `<slug>-cover.webp`; inline = `<slug-short>-<section-keyword>.webp` (ASCII, lowercase, hyphens, ≤ 60 символов). Generic `cover.webp`/`image1.webp` запрещены. Random ChatGPT-имена в `raw-images/` авто-переименовываются `npm run images:prep`.
- [ ] **Запрещённые приёмы убраны.** Нет ссылок на будущие гайды, выдуманных цифр/тарифов/кейсов, инфобиз-клише, FAQPage без visible FAQ, дублирующего markdown TOC при наличии sticky aside.

## Final Editing Decisions

- Keep:
- Cut:
- Rewrite:
- Add:

## Ready for Final Article

- [ ] Final Markdown can move to `07-final-article.md`
- [ ] Metadata can move to `08-metadata.json` (включая `verifiedAt`, `caseSourcing` если применимо)
- [ ] Image brief complete + cover prompt готов для ChatGPT
- [ ] Codex publication task complete
