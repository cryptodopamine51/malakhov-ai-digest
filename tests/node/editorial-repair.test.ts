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

test('repairEditorialOutput restores paragraphs for long single-paragraph body', () => {
  const draft = output()
  draft.editorial_body = Array.from({ length: 12 }, (_, index) =>
    `Предложение ${index + 1} описывает работу ИИ-агента в редакционном pipeline и сохраняет фактический контекст материала.`
  ).join(' ')

  const repaired = repairEditorialOutput(draft)

  assert.ok(repaired.output.editorial_body.split('\n\n').length >= 3)
  assert.ok(repaired.fixes.includes('restore_editorial_body_paragraphs'))
})
