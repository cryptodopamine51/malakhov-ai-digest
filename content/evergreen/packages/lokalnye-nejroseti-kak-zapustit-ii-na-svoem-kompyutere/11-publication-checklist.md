# Publication Checklist: Локальные нейросети 2026

## Editorial

- [x] Lead anchor (Hugging Face 1 млн моделей, осень 2024)
- [x] Worked example «потянет ли ваш компьютер» (формула памяти, расчёт, скорости)
- [x] Кейс «Редакционный пример» (юрфирма, договоры) + `caseSourcing: editorial`
- [x] Counter-strategy H2 «Когда локальная нейросеть не нужна» (5 критериев)
- [x] Российский контекст: 152-ФЗ, GigaChat/YandexGPT, аренда GPU, российские открытые модели
- [x] ≥ 2 inline-ссылок в теле (5, включая money-гайды)
- [x] CTA cap: 1 inline (digest) + 1 final-блок
- [x] FAQ 7, visible + mirrored
- [x] Нет инфобиз-клише, ссылок на будущие гайды, markdown TOC

## Metadata

- [x] `verifiedAt: 2026-06-12`
- [x] seoTitle ≤ 60, description 140–160, ogDescription
- [x] tags 6, category «Доступ к ИИ из России»
- [x] SEO-имена картинок в meta (cover на slug-short из-за лимита)
- [x] `noindex: true` до готовности cover

## Blocked on owner

- [ ] 4 PNG в `raw-images/` (промпты: `12-chatgpt-image-prompts.md`)

## Post-images (агент)

- [ ] `images:prep` → cover ≥ 80 KB
- [ ] Перенос в production, снять noindex
- [ ] topics.json id=34 → published
- [ ] `evergreen:check` 0 errors; build/lint/tsc/тесты зелёные
- [ ] Коммит, push, `vercel --prod`, IndexNow
