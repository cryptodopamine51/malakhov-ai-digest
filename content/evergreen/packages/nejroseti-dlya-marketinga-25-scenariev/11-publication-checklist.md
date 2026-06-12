# Publication Checklist: Нейросети для маркетинга: 25 сценариев

## Editorial

- [x] Lead anchor (McKinsey 71%, март 2025)
- [x] Worked example экономики контента (формула, −55%, условие минуса)
- [x] Кейс «Редакционный пример» + `caseSourcing: editorial`
- [x] Counter-strategy H2 «Когда нейросети в маркетинге не дают эффекта» (5 критериев)
- [x] Российский контекст: маркировка рекламы, 152-ФЗ, локальные модели и площадки
- [x] ≥ 2 inline-ссылок в теле (6, включая money-гайды ChatGPT/карты)
- [x] CTA cap: 2 inline + 1 final-блок, только реальные поверхности
- [x] FAQ 7, visible + mirrored
- [x] 25 сценариев: 4+3+6+4+4+4, нет ссылок на будущие гайды id=14/15/16

## Metadata

- [x] `verifiedAt: 2026-06-12`
- [x] seoTitle ≤ 60, description 140–160, ogDescription
- [x] tags 5, category «Маркетинг и контент»
- [x] SEO-имена картинок в meta
- [x] `noindex: true` до готовности cover

## Blocked on owner

- [ ] 4 PNG в `raw-images/` (промпты: `12-chatgpt-image-prompts.md`)

## Post-images (агент)

- [ ] `images:prep` → cover ≥ 80 KB
- [ ] Перенос в production, снять noindex
- [ ] topics.json id=13 → published
- [ ] `evergreen:check` 0 errors; build/lint/tsc/тесты зелёные
- [ ] Коммит, push, `vercel --prod`, IndexNow
