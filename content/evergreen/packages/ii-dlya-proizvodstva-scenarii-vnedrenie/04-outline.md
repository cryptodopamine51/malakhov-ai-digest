# Outline: ИИ для производства: сценарии, внедрение и окупаемость

## H1

ИИ для производства: сценарии, внедрение и окупаемость

## Promise

In the first 20 seconds, the reader should understand:

- AI in production is worth considering only when it attacks a measurable operational loss.
- The strongest first pilots are visual quality control, predictive maintenance, production planning and shift-log/document processing.
- A good pilot starts with baseline, data, owner and human review; not with model selection.

## Table of Contents

1. Краткое резюме
2. Где ИИ в производстве даёт эффект
3. Матрица сценариев: данные, пилот, метрика, риск
4. Компьютерное зрение для контроля качества
5. Предиктивное обслуживание оборудования
6. Планирование, сменные журналы и база знаний
7. Как выбрать первый пилот
8. Расчёт окупаемости контроля качества: пример
9. Сценарий: средняя линия с ручной проверкой
10. Когда ИИ на производстве не окупится
11. Российский контур: данные, 152-ФЗ, интеграции
3. Вывод Malakhov AI
4. FAQ

## Detailed Outline

## Краткое резюме

- Main answer: start with a production loss: defects, downtime, manual inspection, rework, energy waste or planning delays.
- Practical takeaway: choose one controlled process, collect baseline for 2-4 weeks, then run a narrow pilot with human approval.
- Link to CTA: `/services` for production AI audit.

## Где ИИ в производстве даёт эффект

Purpose:

- Explain that AI is not a magic "digital factory"; it is a pattern recognizer, predictor, assistant and decision-support layer around existing production data.

H3 blocks:

- Контроль качества.
- Предиктивное обслуживание.
- Планирование и диспетчеризация.
- Сменные журналы, инструкции и база знаний.
- Безопасность и комплаенс.

Tables/checklists:

- Short bullet list of measurable losses.

Image slot:

- Filename: `ii-proizvodstvo-scenarii.webp`
- Placement: after scenario overview.
- Purpose: show five AI entry points in a production process without readable text.

## Матрица сценариев: данные, пилот, метрика, риск

Purpose:

- Give the reader a practical selection tool.

Table columns:

- Scenario.
- Required data.
- First pilot.
- Main metric.
- Risk / when to avoid.

Rows:

- Visual quality control.
- Predictive maintenance.
- Production planning.
- Shift-log and incident assistant.
- Energy/process optimization.
- Safety/compliance assistant.

## Компьютерное зрение для контроля качества

Purpose:

- Explain when camera-based inspection is a good first project.

Key points:

- Works best when defects are visually distinguishable and repeated.
- Needs stable lighting, camera angle, labeled examples, defect taxonomy and human review.
- Main metrics: defect escape rate, false reject rate, inspection time, rework.
- Risk: false positives stop good products; false negatives create warranty/quality risk.

## Предиктивное обслуживание оборудования

Purpose:

- Explain predictive maintenance without overpromising.

Key points:

- Needs sensor/log history, failure history, maintenance records, operator notes.
- Early project can be a maintenance copilot or alerting model, not full autonomy.
- Link to McKinsey/Deloitte source notes for context.

## Планирование, сменные журналы и база знаний

Purpose:

- Cover non-camera scenarios that are easier for companies with weak hardware readiness.

Key points:

- Shift-log summarization.
- Incident classification.
- Knowledge assistant for maintenance instructions.
- Production planning assistant with constraints.

## Как выбрать первый пилот

Purpose:

- Turn the article into an action plan.

Checklist:

- Process repeats at least weekly/daily.
- Baseline exists.
- Data source exists.
- Error cost is bounded.
- Owner has authority.
- Human review is feasible.
- Integration can be delayed until pilot proves value.

## Расчёт окупаемости контроля качества: пример

Purpose:

- Static numerical example.

Model:

- 2 inspectors per shift.
- 2 shifts.
- 22 working days.
- Manual inspection time and defect/rework cost baseline.
- Pilot cost framed as "example calculation", not market price.
- Formula: monthly savings = labor time saved + avoided rework - support/model costs.
- Payback = launch cost / monthly net effect.

Image slot:

- Filename: `ii-proizvodstvo-okupaemost.webp`
- Placement: after worked example.
- Purpose: visualize ROI components, no readable text.

## Сценарий: средняя линия с ручной проверкой

Purpose:

- Provide case-like narrative without claiming a real client.

Structure:

- Situation.
- What AI does.
- What is needed for pilot.
- Metrics.
- Result.

Sourcing:

- Editorial scenario based on public scenario families and source notes. Keep rationale in package; final article should read as "Сценарий:" without visible source note.

## Когда ИИ на производстве не окупится

Purpose:

- Counter-strategy H2 required by evergreen standard.

Criteria:

- No measurable baseline.
- Defects/failures are too rare.
- Cameras/sensors/logs are unstable.
- Process changes every month.
- No process owner or inspector buy-in.
- Error cost is unbounded.

## Российский контур: данные, 152-ФЗ, интеграции

Purpose:

- Make the guide locally useful.

Points:

- If cameras capture identifiable workers, treat privacy/legal review as part of pilot design.
- Keep raw video/data retention limited.
- Integrations: 1С, MES, ERP, maintenance systems, spreadsheets.
- Local model/storage boundary if data cannot leave company/Russia.

## Вывод Malakhov AI

- Strong final position: AI in production should start as a controlled engineering pilot around one loss metric, not as a broad transformation slogan.
- What the reader should do next: choose one process, collect baseline and request an audit before buying tools.

## FAQ

1. Что такое ИИ для производства простыми словами?
2. С какого сценария начать внедрение ИИ на производстве?
3. Нужны ли камеры для ИИ на производстве?
4. Сколько данных нужно для пилота?
5. Заменит ли ИИ контролёров качества?
6. Как посчитать окупаемость?
7. Что делать с 152-ФЗ, если камеры снимают сотрудников?
8. Сколько длится пилот?
9. Когда лучше не начинать?

## Internal Links

- Existing:
  - `/services`
  - `/guides/kak-vnedrit-ii-v-biznes-2026`
  - `/guides/skolko-stoit-vnedrenie-ii-v-kompaniyu`
  - `/guides/kak-vybrat-pervyj-ii-proekt-v-biznese`
  - `/guides/oshibki-vnedreniya-ii-v-kompanii`
  - `/guides/kakie-biznes-processy-avtomatizirovat-s-pomoshyu-ii`
- Future planned links:
  - `/guides/ii-dlya-dokumentov-v-biznese`
  - `/guides/kak-sozdat-ii-agenta-dlya-biznesa`
