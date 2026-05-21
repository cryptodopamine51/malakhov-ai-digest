# Evergreen Package: {{title}}

Topic ID: `{{id}}`
Slug: `{{slug}}`
Cluster: `{{cluster}}`
Status: `{{status}}`
Mode: `{{mode}}`

This folder is the editorial audit trail for one evergreen guide. Keep research, source notes, draft decisions, metadata, image brief, and Codex publication instructions here.

Production files are separate:

- Markdown: `content/guides/{{slug}}.md`
- Metadata: `content/guides/meta/{{slug}}.json`
- Images: `public/images/guides/{{slug}}/`
- Public URL: `/guides/{{slug}}`

Rules:

- Do not generate images through paid image APIs from this workflow.
- Prepare prompts, alt text, captions, filenames, and local SVG/diagram ideas in `09-image-brief.md`.
- If this package updates an existing guide, do not create a duplicate guide URL.
- Keep factual claims tied to `03-source-notes.md`.
- Do not add `FAQPage` metadata unless FAQ is visible in the final Markdown.

