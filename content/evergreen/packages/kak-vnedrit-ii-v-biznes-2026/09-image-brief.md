# Image Brief: Как внедрить ИИ в бизнес в 2026 году

## Current Production Images

| Slot | Path | Source | Status |
|---|---|---|---|
| Cover | `public/images/guides/kak-vnedrit-ii-v-biznes-2026/ii-vnedrenie-biznes-cover.webp` | local SVG composition rendered via `sharp`, no image API | active, >50 KB |
| Process layer | `public/images/guides/kak-vnedrit-ii-v-biznes-2026/ai-process-layer.webp` | existing local WebP | active |
| Project matrix | `public/images/guides/kak-vnedrit-ii-v-biznes-2026/ai-project-matrix.webp` | existing local WebP | active |
| Economics | `public/images/guides/kak-vnedrit-ii-v-biznes-2026/ai-economics.webp` | existing local WebP | active |
| Roadmap | `public/images/guides/kak-vnedrit-ii-v-biznes-2026/ai-implementation-roadmap.webp` | existing local WebP | active |

## Cover Direction

- Theme: implementation as a sequence of business process cards connected by metric/data/control curves.
- Style: quiet editorial, light background, clear abstract business map.
- No readable text inside image.
- No robots, glowing brain, neon, handshake, generic office stock or fake dashboards.
- Palette: off-white base, teal/blue/magenta/amber accents, graphite strokes.
- Purpose: replace weak `cover.webp` placeholder and satisfy `evergreen:check` cover density.

## Metadata

- `cover.src`: `/images/guides/kak-vnedrit-ii-v-biznes-2026/ii-vnedrenie-biznes-cover.webp`
- `cover.alt`: `Руководитель изучает карту бизнес-процессов и слой ИИ на экране`
- `cover.caption`: `Внедрение ИИ начинается с процесса, метрики и зоны ответственности, а не с выбора модели.`

## Workflow Note

This update used a local deterministic SVG-to-WebP workflow with `sharp` because the task explicitly prohibited image API usage and the prior cover warning blocked quality. Future full art refresh can still use the standard ChatGPT subscription + `npm run images:prep -- --slug=kak-vnedrit-ii-v-biznes-2026` path.
