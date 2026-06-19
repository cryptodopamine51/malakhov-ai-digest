# SEO Brief: ИИ для производства: сценарии, внедрение и окупаемость

## Topic

- Topic ID: `34`
- Cluster: ИИ для бизнеса
- Status: planned
- Publication mode: create
- Target URL: `/guides/ii-dlya-proizvodstva-scenarii-vnedrenie`
- Primary keyword: ИИ для производства
- Supporting keywords: ИИ в производстве, искусственный интеллект в производстве, внедрение ИИ в производство, компьютерное зрение на производстве, ИИ для контроля качества, предиктивное обслуживание оборудования
- Intent: practical
- Audience: собственник производства, COO, директор производства, руководитель качества, технический директор
- CTA: `production_ai_audit`

## Anti-Cannibalization Decision

- Decision: `create`
- Existing guide/article conflicts:
  - `/guides/kak-vnedrit-ii-v-biznes-2026` is the broad implementation hub. This new guide narrows the intent to production lines, cameras/sensors, quality control, downtime and operational metrics.
  - `/guides/kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii` covers business processes across departments. This guide should not repeat the generic process matrix; it must turn the matrix into industrial scenarios.
  - `/guides/skolko-stoit-vnedrenie-ii-v-kompaniyu` covers budget principles. This guide should link to it, but include a production-specific worked example.
  - `/guides/kak-vybrat-pervyj-ii-proekt-v-biznese` covers project selection. This guide should provide a production-ready diagnostic.
- Future topic conflicts from `content/evergreen/topics.json`:
  - No existing planned guide targets `ии для производства`.
  - Future documents and agent guides should link here only when they mention industrial document flows or maintenance agents.
- Internal links needed:
  - `/services`
  - `/guides/kak-vnedrit-ii-v-biznes-2026`
  - `/guides/skolko-stoit-vnedrenie-ii-v-kompaniyu`
  - `/guides/kak-vybrat-pervyj-ii-proekt-v-biznese`
  - `/guides/oshibki-vnedreniya-ii-v-kompanii`
  - `/guides/kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii`

## Search Intent

What the reader wants to solve:

- Understand whether AI can improve a real production process, not just read about Industry 4.0.
- Compare production scenarios: visual quality control, predictive maintenance, planning, shift logs, safety/compliance.
- Estimate what data is needed before calling an integrator or consultant.
- Decide which first pilot is realistic and how to measure payback.
- Avoid a costly pilot where cameras, logs, labels, process ownership or integration readiness are missing.

What the article must answer in the first screen:

- AI in production pays back when it is tied to a measurable operational loss: defects, downtime, manual inspection time, rework, energy waste or planning delays.
- The first project should be one controlled process with clear baseline, data source, owner and human review.
- Computer vision and predictive maintenance are usually the strongest entry points, but only when data quality is sufficient.

What the article must not duplicate:

- Generic "what is AI" explanations.
- Abstract Industry 4.0 trend overview.
- Broad guide to implementing AI in any business.
- Vendor-style promises about fully autonomous factories.

## SEO Package Draft

- SEO title: `ИИ для производства: сценарии, внедрение и окупаемость`
- Meta description: `Как внедрять ИИ на производстве: контроль качества, предиктивное обслуживание, планирование, данные для пилота и расчёт окупаемости.`
- H1: `ИИ для производства: сценарии, внедрение и окупаемость`
- Slug: `ii-dlya-proizvodstva-scenarii-vnedrenie`
- Canonical: `https://news.malakhovai.ru/guides/ii-dlya-proizvodstva-scenarii-vnedrenie`

## Unique Malakhov AI Angle

- Practical business mechanism: translate AI scenarios into a pilot map with process, input data, decision boundary, human review and metric.
- Cost/risk/process angle: focus on downtime, defect rate, manual inspection time, false rejects, rework, integration cost and owner capacity.
- Local Russia/CIS context where useful: 152-ФЗ for video/worker data, local storage/model boundary, 1С/MES/ERP integration, Russian industrial reporting culture.
- What competitors usually miss: hard "do not start" criteria, baseline measurement, data-labeling effort, false-positive cost and who owns the model after launch.

## Planned Structure

- Required tables:
  - Scenario matrix: use case / required data / first pilot / metric / risk.
  - Data readiness checklist: cameras, sensors, logs, labels, integration, owner.
- Required checklists:
  - First pilot checklist.
  - When not to start.
- Required examples:
  - Worked example: visual quality control on a line with manual inspection.
  - Scenario/case: mid-size production line reduces manual inspection load and catches defects earlier.
- Required FAQ:
  - What can AI do in production?
  - Where to start?
  - How much data is needed?
  - Is computer vision required?
  - Can AI replace quality inspectors?
  - How to calculate payback?
  - What about 152-ФЗ and cameras?
  - How long does a pilot take?
- Required images:
  - Cover: production line with inspection station.
  - Scenario matrix.
  - ROI worked example.
  - Pilot roadmap.

## Fact Boundaries

Claims that need source verification:

- Production market statistics and AI adoption numbers.
- Any percentage impact claims for downtime, maintenance, defect detection or labor savings.
- Legal claims around video, worker data, biometrics and 152-ФЗ.
- Integration claims about 1С/MES/ERP should be framed as project requirements, not universal facts.
- Case figures in the worked example must be explicitly labeled as a calculation model unless backed by public case data.
