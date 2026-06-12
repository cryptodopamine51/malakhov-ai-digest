# Publication Checklist: ИИ-агенты в поддержке клиентов

## Editorial

- [x] Lead anchor (Gartner март 2025, 80% / 2029, ~30% затрат; McKinsey 30–45%)
- [x] Worked example окупаемости (формула, результат, порог в минус)
- [x] Кейс с маркировкой «Редакционный пример» + `caseSourcing: editorial`
- [x] Counter-strategy H2 «Когда ИИ-агент в поддержке не окупится» (5 критериев)
- [x] Российский контекст: 152-ФЗ, GigaChat/YandexGPT, каналы, хелпдески
- [x] ≥ 2 inline-ссылок в теле (6: 4 гайда + /russia + /categories/ai-industry)
- [x] CTA cap: 2 inline + 1 final-блок (3 карточки), только реальные поверхности
- [x] FAQ 7 вопросов, visible + mirrored в meta
- [x] Нет инфобиз-клише, ссылок на будущие гайды, markdown TOC

## Metadata

- [x] `verifiedAt: 2026-06-12`, `publishedAt`, `updatedAt`
- [x] seoTitle ≤ 60 знаков, description 140–160, ogDescription
- [x] tags 5 шт., category «ИИ-агенты»
- [x] SEO-имена картинок в cover.src и inlineImagesByHeading
- [x] `noindex: true` до готовности cover

## Blocked on owner

- [ ] 4 PNG в `raw-images/` (промпты: `12-chatgpt-image-prompts.md`)

## Post-images (агент)

- [ ] `images:prep` → cover ≥ 80 KB
- [ ] Перенос в `content/guides/` + meta, снять noindex
- [ ] topics.json id=10 → published
- [ ] `evergreen:check` 0 errors; build/lint/tsc/тесты зелёные
- [ ] Коммит, push, `vercel --prod`, IndexNow
