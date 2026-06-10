# ChatGPT Image Prompts — Как внедрить ИИ в бизнес в 2026 году

## Current Status

No pending ChatGPT generation is required for the 2026-06-10 SEO refresh.

The weak generic cover was replaced locally because this task explicitly required avoiding image API usage. The active cover is:

```text
public/images/guides/kak-vnedrit-ii-v-biznes-2026/ii-vnedrenie-biznes-cover.webp
```

## Future Full Refresh Prompt

If the owner later wants a ChatGPT-generated editorial cover, use this direction:

```text
Generate a 16:9 editorial illustration for a Russian business guide titled "Как внедрить ИИ в бизнес в 2026 году".

Show AI implementation as a calm business process map: several abstract process cards connected by data, metric and control paths. Use a light editorial background, teal/blue/magenta/amber accents, graphite strokes, subtle paper texture, soft shadows.

No robots, no glowing brain, no neon, no handshake, no readable text, no fake dashboards with labels, no generic office stock.

Save as: ii-vnedrenie-biznes-cover.png
```

After generation, place the PNG in:

```text
content/evergreen/packages/kak-vnedrit-ii-v-biznes-2026/raw-images/
```

Then run:

```bash
npm run images:prep -- --slug=kak-vnedrit-ii-v-biznes-2026
```
