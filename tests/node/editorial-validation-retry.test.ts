import test from 'node:test'
import assert from 'node:assert/strict'

import { parseRepairValidateEditorial } from '../../pipeline/editorial-apply'
import { isRetryable, PERMANENT_ERRORS, RETRYABLE_ERRORS } from '../../pipeline/types'
import type { EditorialOutput } from '../../pipeline/claude'

function validEditorial(overrides: Partial<EditorialOutput> = {}): EditorialOutput {
  return {
    ru_title: 'Claude Code сгенерировал 70% кода за два месяца автономной работы',
    lead:
      'Разработчики поделились опытом автономной разработки и описали ключевые ограничения подхода. ' +
      'За два месяца Claude Code сгенерировал около 70% кода в их репозиториях, но потребовал постоянного контроля.',
    summary: [
      'Команда два месяца использовала агентский режим и фиксировала долю автогенерации кода.',
      'Локальный контроль остаётся обязательным: автономные действия требуют подтверждения.',
      'Главный риск связан с молчаливыми изменениями, которые сложно отследить ревьюеру.',
    ],
    card_teaser: 'Claude Code за два месяца сгенерировал 70% кода, но потребовал контроля разработчиков',
    tg_teaser:
      'За два месяца Claude Code сгенерировал около 70% кода в репозиториях команды, однако автономность по-прежнему требует внимательной проверки человеком.',
    editorial_body: [
      'Разработчики поделились опытом автономной разработки и описали ключевые ограничения подхода, с которыми столкнулись за время эксперимента с агентским режимом в реальных рабочих репозиториях, где цена ошибки заметно выше, чем в учебных примерах и демонстрациях.',
      'За два месяца Claude Code сгенерировал около 70% кода в их репозиториях, но потребовал постоянного контроля разработчиков: каждое автономное изменение приходилось перепроверять вручную, чтобы не пропустить тихую регрессию в логике приложения и не сломать смежные модули, которые внешне выглядели нетронутыми.',
      'Команда подчеркнула, что автономные действия без подтверждения остаются главным источником риска для рабочих проектов, поэтому в пайплайне сохраняется обязательный шаг ревью и явного подтверждения перед применением правок к продакшен-коду, а критичные участки дополнительно закрываются автоматическими тестами.',
      'Отдельно авторы отметили, что эффективность агентского режима сильно зависит от качества постановки задач и наличия тестов: без них модель быстро уводит проект в сторону, а стоимость исправления ошибок растёт по мере накопления изменений в репозитории и становится трудно отслеживаемой к концу спринта.',
      'В выводах команда советует начинать с небольших изолированных задач, постепенно расширяя зону ответственности агента только после того, как накоплена статистика по качеству его правок и выстроены надёжные процессы ревью, иначе автономность превращается из ускорителя в источник скрытого технического долга.',
    ].join('\n\n'),
    glossary: [{ term: 'agentic mode', definition: 'Режим, в котором модель самостоятельно планирует и выполняет шаги.' }],
    link_anchors: ['автономной разработки', 'постоянного контроля'],
    quality_ok: true,
    quality_reason: '',
    ...overrides,
  }
}

test('editorial_validation_failed is retryable, claude_parse_failed stays permanent', () => {
  assert.equal(isRetryable('editorial_validation_failed'), true)
  assert.ok(RETRYABLE_ERRORS.includes('editorial_validation_failed'))
  assert.equal(isRetryable('claude_parse_failed'), false)
  assert.ok(PERMANENT_ERRORS.includes('claude_parse_failed'))
})

test('lead with anchor only in second sentence now passes after repair', () => {
  const draft = validEditorial()
  const raw = JSON.stringify(draft)

  const result = parseRepairValidateEditorial(raw)

  assert.ok(result.output, 'expected parsed output')
  assert.ok(result.repairs.includes('reorder_lead_anchor'))
  assert.equal(result.validation.ok, true, `unexpected errors: ${result.validation.errors.join('; ')}`)
  assert.equal(
    result.validation.errors.includes('lead без конкретного якоря в первом предложении'),
    false,
  )
})

test('lead with no anchor anywhere still fails validation (becomes retryable downstream)', () => {
  const draft = validEditorial({
    lead:
      'Авторы рассказали о подходе к автономной разработке и поделились наблюдениями. ' +
      'Они подчеркнули, что итоговый результат всё ещё требует внимательной проверки человеком.',
  })
  const raw = JSON.stringify(draft)

  const result = parseRepairValidateEditorial(raw)

  assert.equal(result.validation.ok, false)
  assert.ok(result.validation.errors.includes('lead без конкретного якоря в первом предложении'))
})
