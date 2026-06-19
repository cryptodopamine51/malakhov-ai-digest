# Implementation plan: SEO traffic to services — 2026-06-18

> Goal: bring qualified organic traffic to `/services` and personal consultation requests.
> Source: `docs/seo_services_traffic_plan_2026-06-17.md`, fresh Wordstat run `docs/wordstat_services_priority_2026-06-18.md`, existing guide cluster.
> Rule: each content wave ends with production deploy, post-deploy smoke check and IndexNow ping.

## Strategy

The services page is the commercial destination. Evergreen guides are acquisition pages that qualify intent before sending the reader to `/services`.

Priority order:

1. **ИИ для производства** — strongest B2B fit, matches owner hypothesis, lower consumer noise.
2. **ИИ для документов в бизнесе** — largest uncovered demand, but must be filtered away from free consumer tools.
3. **Как создать ИИ-агента для бизнеса** — direct commercial intent for audit, architecture and pilot implementation.

Existing pages already cover broad business implementation and sales:

- `/services` now targets `ИИ-консалтинг`, `ИИ-аудит`, `внедрение ИИ под ключ`, `разработка ИИ-решений`.
- `/guides/ii-agenty-v-prodazhah` now targets broader `ИИ для продаж`.

## Wordstat validation — 2026-06-18

Data source: Yandex Cloud Search API v2 Wordstat, `topRequests`, РФ, broad clusters.

| Cluster | Core phrases | Broad impressions/month | SEO decision |
|---|---|---:|---|
| Documents | `ии для документов`, `ии для создания документов`, `ии для работы с документами` | 7,389 / 1,299 / 1,137 | Biggest demand, but noisy. Publish as business document automation, not free tools. |
| AI agents | `создание ии агента`, `разработка ии агента`, `ии агенты для бизнеса` | 2,505 / 893 / 904 | Strong commercial bridge to architecture/audit services. |
| Manufacturing | `ии в производстве`, `искусственный интеллект в производстве`, `ии для производства` | 2,147 / 1,355 / 934 | Best B2B-fit cluster for qualified service traffic; owner hypothesis confirmed. |
| Manufacturing long tail | `предиктивное обслуживание оборудования`, `внедрение ии в производство`, `ии для контроля качества`, `компьютерное зрение на производстве` | 304 / 192 / 182 / 121 | Use as H2/FAQ/supporting sections, not standalone pages yet. |
| Services page | `разработка ии решений`, `консультация по ии`, `ии консалтинг`, `внедрение ии под ключ` | 710 / 303 / 273 / 88 | Keep on `/services`; use guide CTAs to pass qualified readers into this intent. |

Important limitation: Wordstat API v2 does not support exact-match operators in this flow, so numbers are broad clusters, not exact demand.

## Wave 1: production guide

### Target page

- URL: `/guides/ii-dlya-proizvodstva-scenarii-vnedrenie`
- Primary keyword: `ии для производства`
- Supporting: `ии в производстве`, `искусственный интеллект в производстве`, `внедрение ии в производство`, `компьютерное зрение на производстве`, `ии для контроля качества`, `предиктивное обслуживание оборудования`.
- Reader: owner, COO, production director, quality director, industrial integrator.
- CTA: `Разобрать производственный процесс и выбрать первый ИИ-пилот`.

### Article angle

Not a trend overview. The guide must help a business reader decide:

- which production processes are suitable for AI;
- what data and cameras/sensors/logs are required;
- what the first pilot should look like;
- how to calculate effect from defect rate, downtime or manual inspection time;
- when AI is premature.

### Required structure

- Lead with factual anchor and business framing.
- Quick diagnostic: 5 production scenarios where AI can pay back.
- Table: scenario / data required / first pilot / metric / risk.
- Deep sections:
  - computer vision for quality control;
  - predictive maintenance;
  - planning and dispatching;
  - document and shift-log processing;
  - safety/compliance assistant.
- Worked example: quality-control pilot ROI.
- Case/scenario block: mid-size manufacturing line with manual visual inspection.
- Counter-strategy H2: when AI in production does not pay back.
- Russian context: 152-ФЗ where people/video are involved, local model/storage boundary, integration with 1С/MES/ERP.
- FAQ: 7-9 questions.
- Inline links to `/services`, implementation guide, cost guide, first-project guide, mistakes guide.

### Assets

Use 1 cover + 3 inline images:

- cover: factory line / inspection station, realistic editorial photo, no robots, no text;
- matrix: production scenarios and data readiness;
- worked example: quality-control ROI dashboard as physical board without readable text;
- rollout: pilot roadmap from process audit to controlled deployment.

## Wave 2: documents guide

### Target page

- URL: `/guides/ii-dlya-dokumentov-v-biznese`
- Primary keyword: `ии для документов`
- Supporting: `ии для создания документов`, `ии для работы с документами`, `ии для анализа документов`, `ии для обработки документов`, `ии для составления документов`, `ии для юридических документов`.

### Positioning

Write for business document workflows, not for "free AI for documents".

Core scenarios:

- invoices, acts, applications, contracts, internal policies, support knowledge base;
- extraction, validation, comparison, draft generation;
- human approval and audit log;
- rights, PII, retention and 152-ФЗ.

## Wave 3: create an AI agent guide

### Target page

- URL: `/guides/kak-sozdat-ii-agenta-dlya-biznesa`
- Primary keyword: `создание ии агента`
- Supporting: `разработка ии агента`, `ии агенты для бизнеса`, `создание ии агентов для бизнеса`, `разработка ии агентов для бизнеса`.

### Positioning

This is the closest bridge to consulting. It should explain architecture and implementation decisions without pretending that every company needs an agent.

Core blocks:

- when an agent is justified;
- architecture: LLM, tools, knowledge base, permissions, logs, evals, human approval;
- budget and timeline;
- risks and failure modes;
- when a workflow automation or chatbot is enough.

## Cross-linking work

After each guide is published:

- add it to `/services` popular guides if the page is live and cover is ready;
- add related links from relevant existing guides;
- ensure each P0 page has:
  - one inline CTA to contacts/services;
  - final CTA cards;
  - AuthorCard consultation link;
  - related links to cost, first-project and implementation pages.

## Measurement plan

Yandex Metrika goals to verify or create:

- visit `/services`;
- contacts click;
- personal Telegram click;
- guide-to-services click with `utm_campaign=services_seo_cluster`;
- guide CTA click.

Search Console / Yandex Webmaster:

- after 2 weeks: check impressions for target and long-tail queries;
- after 4-6 weeks: update title/H2/FAQ by real queries, not assumptions;
- track whether `/services` receives assisted traffic from guide pages.

## Execution checklist per guide

1. Add or update `content/evergreen/topics.json`.
2. Run `npm run evergreen:new -- --topic-id=<id>`.
3. Fill package files:
   - `01-seo-brief.md`
   - `02-serp-research.md`
   - `03-source-notes.md`
   - `04-outline.md`
   - `05-draft.md`
   - `06-editorial-pass.md`
   - `07-final-article.md`
   - `08-metadata.json`
   - `09-image-brief.md`
   - `12-chatgpt-image-prompts.md`
4. Ask owner to generate PNGs in ChatGPT and put them into `raw-images/`.
5. Run `npm run images:prep -- --slug=<slug>`.
6. Move final article and metadata to production `content/guides/` and `content/guides/meta/`.
7. Remove `noindex` only after cover and variants are present.
8. Run:
   - `npm run evergreen:check -- --slug=<slug>`
   - `npm run docs:check`
   - `npm test`
   - `npm run build`
9. Deploy with `vercel deploy --prod --yes`.
10. Smoke check:
    - guide returns 200;
    - canonical is `https://news.malakhovai.ru/guides/<slug>`;
    - no `noindex`;
    - FAQPage appears only with visible FAQ;
    - guide appears in sitemap;
    - `/services` links are present.
11. Ping IndexNow.

## Definition of done for this initiative

- Three P0 guides are live, indexed and linked to `/services`.
- `/services` links back to the P0 guides as proof/education pages.
- All three guides pass evergreen checks and build.
- IndexNow ping sent after each deploy.
- Post-deploy smoke passes on `news.malakhovai.ru`.
- A follow-up Webmaster review is scheduled for 2-4 weeks after publication.
