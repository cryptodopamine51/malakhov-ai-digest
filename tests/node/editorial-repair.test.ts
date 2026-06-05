import test from 'node:test'
import assert from 'node:assert/strict'

import { repairEditorialOutput } from '../../pipeline/editorial-repair'
import type { EditorialOutput } from '../../pipeline/claude'

function output(): EditorialOutput {
  return {
    ru_title: 'Два месяца с локальным AI-агентом: что сработало',
    lead: 'Автор 2 месяца использовал AI-агента локально и описал ограничения автономной разработки.',
    summary: [
      'AI-агент помогает ускорить часть рутины, но требует контроля со стороны разработчика.',
      'Локальный запуск снижает зависимость от облака, но не отменяет проверки результатов.',
      'Главный риск связан с автономными действиями без явного подтверждения пользователя.',
    ],
    card_teaser: 'Локальный AI-агент ускоряет рутину, но требует контроля разработчика',
    tg_teaser: 'Автор два месяца использовал AI-агента локально и разобрал, почему автономность остаётся рискованной для рабочих проектов.',
    editorial_body:
      'Автор 2 месяца использовал AI-агента локально и описал ограничения автономной разработки.\n\n' +
      'ИИ-агент помогает в рутинных задачах, но требует явного контроля.\n\n' +
      'Поддержка SSH позволяет управлять удалёнными машинами, но не превращает инструмент в полностью автономного разработчика.',
    glossary: [{ term: 'AI-agent tooling', definition: 'Инструменты для настройки AI-агентов в разработке.' }],
    link_anchors: ['SSH-ноды', 'ИИ-агент'],
    quality_ok: true,
    quality_reason: '',
  }
}

test('repairEditorialOutput replaces standalone AI and drops invalid anchors', () => {
  const repaired = repairEditorialOutput(output())

  assert.match(repaired.output.ru_title, /ИИ-агентом/)
  assert.match(repaired.output.lead, /ИИ-агента/)
  assert.equal(repaired.output.link_anchors.includes('SSH-ноды'), false)
  assert.equal(repaired.output.link_anchors.includes('ИИ-агент'), true)
  assert.ok(repaired.fixes.includes('drop_invalid_link_anchors'))
})

test('repairEditorialOutput removes banned phrases and shortens long titles', () => {
  const draft = output()
  draft.ru_title = 'Два месяца с локальным ИИ-агентом: что сработало, что нет и почему автономность опасна для рабочих проектов'
  draft.editorial_body = draft.editorial_body.replace('Автор 2 месяца', 'Действительно, автор 2 месяца')

  const repaired = repairEditorialOutput(draft)

  assert.equal(repaired.output.ru_title, 'Два месяца с локальным ИИ-агентом')
  assert.doesNotMatch(repaired.output.editorial_body.toLowerCase(), /действительно/)
  assert.ok(repaired.fixes.includes('shorten_ru_title'))
})

test('repairEditorialOutput shortens overlong lead without cutting mid-word', () => {
  const draft = output()
  draft.lead =
    'Соло-разработчик, поддерживающий четыре продукта одновременно — мессенджер, ИИ-платформу, marketing-автоматизацию и desktop-приложение на Rust — провёл год с Claude Code в агентском режиме и зафиксировал, что около 70% кода в его репозиториях теперь написано с участием ИИ. ' +
    'Это не означает делегирование задач машине: роль разработчика сместилась от написания кода к формулированию задач и архитектурным решениям.'

  const repaired = repairEditorialOutput(draft)

  assert.ok(repaired.output.lead.length <= 400)
  assert.match(repaired.output.lead, /70% кода/)
  assert.ok(repaired.fixes.includes('shorten_lead'))
})

test('repairEditorialOutput preserves dot-ai handles while repairing standalone AI', () => {
  const draft = output()
  draft.lead = 'Threads тестирует Meta AI через упоминание @meta.ai в публичных обсуждениях.'

  const repaired = repairEditorialOutput(draft)

  assert.match(repaired.output.lead, /@meta\.ai/)
  assert.match(repaired.output.lead, /Meta ИИ/)
})

test('repairEditorialOutput promotes anchored sentence to front of lead', () => {
  const draft = output()
  // First sentence has no concrete anchor; the anchor lives in the second one.
  draft.lead =
    'Разработчики поделились опытом автономной разработки и описали ключевые ограничения подхода. ' +
    'За два месяца Claude Code сгенерировал около 70% кода в их репозиториях, но потребовал постоянного контроля.'

  const repaired = repairEditorialOutput(draft)

  assert.ok(repaired.fixes.includes('reorder_lead_anchor'))
  assert.match(repaired.output.lead.split(/(?<=[.!?])\s/)[0], /Claude Code|70%/)
  // No content is lost — both sentences survive the reorder.
  assert.match(repaired.output.lead, /Разработчики поделились опытом/)
  assert.ok(repaired.output.lead.length >= 100 && repaired.output.lead.length <= 400)
})

test('repairEditorialOutput does not reorder when first sentence already anchored', () => {
  const draft = output()
  // First sentence already carries the "2 месяца" anchor, so the reorder must
  // not fire (other repairs like AI→ИИ may still touch the lead text).
  const repaired = repairEditorialOutput(draft)

  assert.equal(repaired.fixes.includes('reorder_lead_anchor'), false)
  assert.match(repaired.output.lead.split(/(?<=[.!?])\s/)[0], /2 месяца/)
})

test('repairEditorialOutput does not invent an anchor when none exists in the lead', () => {
  const draft = output()
  draft.lead =
    'Авторы рассказали о подходе к автономной разработке и поделились наблюдениями. ' +
    'Они подчеркнули, что итоговый результат всё ещё требует внимательной проверки человеком.'
  const before = draft.lead

  const repaired = repairEditorialOutput(draft)

  assert.equal(repaired.fixes.includes('reorder_lead_anchor'), false)
  assert.equal(repaired.output.lead, before)
})

test('repairEditorialOutput restores paragraphs for long single-paragraph body', () => {
  const draft = output()
  draft.editorial_body = Array.from({ length: 12 }, (_, index) =>
    `Предложение ${index + 1} описывает работу ИИ-агента в редакционном pipeline и сохраняет фактический контекст материала.`
  ).join(' ')

  const repaired = repairEditorialOutput(draft)

  assert.ok(repaired.output.editorial_body.split('\n\n').length >= 3)
  assert.ok(repaired.fixes.includes('restore_editorial_body_paragraphs'))
})
