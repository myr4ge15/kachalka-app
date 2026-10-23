// @vitest-environment jsdom
// Карточка упражнения — степперы подходов и настройки прогрессии (покрытие тестами 20.10.2026:
// было 84 % строк). Степперы — HoldButton: клик с клавиатуры (detail 0) дает один шаг, его и
// жмем. Шаг зависит от метрики: вес ±1,25; доп. вес ±2,5; дистанция ±0,5 км и ±30 с; время ±5 с.
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import ExerciseCard from './ExerciseCard.jsx'

const entry = (metric, sets, prog = null) => ({
  exercise: { id: 'e1', name: 'Упр', metric },
  sets: sets.map((s, i) => ({ ...s, _k: String(i) })),
  ...(prog ? { prog } : {}),
})

function renderCard(e, propOver = {}) {
  const cbs = {
    onActivate: vi.fn(), onReplace: vi.fn(), onRemove: vi.fn(), onRevertProg: vi.fn(), onApplyProg: vi.fn(),
    onToggleProgSettings: vi.fn(), onChangeProgSettings: vi.fn(), onUpdateSet: vi.fn(), onStep: vi.fn(),
    onAddSet: vi.fn(), onRemoveSet: vi.fn(), onSetFeel: vi.fn(),
  }
  render(<ExerciseCard entry={e} ei={0} prog={{ enabled: true, byExercise: {} }} active {...cbs} {...propOver} />)
  return cbs
}
// «−/+» подписаны (UI-ревью 23.10): «Меньше …»/«Больше …» — ищем по началу подписи.
const step = (group, sign) => fireEvent.click(within(screen.getByRole('group', { name: group }))
  .getByRole('button', { name: sign === '+' ? /^Больше/ : /^Меньше/ }))

describe('ExerciseCard — степперы', () => {
  it('вес ±1,25 и повторы ±1; ввод запятой — точкой', () => {
    const cb = renderCard(entry('weight', [{ weight: 60, reps: 8 }]))
    step('Подход 1, вес', '+'); step('Подход 1, вес', '−')
    step('Подход 1, повторения', '+'); step('Подход 1, повторения', '−')
    expect(cb.onStep.mock.calls).toEqual([[0, 0, 'weight', 1.25], [0, 0, 'weight', -1.25], [0, 0, 'reps', 1], [0, 0, 'reps', -1]])
    fireEvent.change(screen.getByLabelText('Вес, подход 1'), { target: { value: '62,5' } })
    expect(cb.onUpdateSet).toHaveBeenLastCalledWith(0, 0, 'weight', '62.5')
    fireEvent.change(screen.getByLabelText('Повторения, подход 1'), { target: { value: '1x2' } })
    expect(cb.onUpdateSet).toHaveBeenLastCalledWith(0, 0, 'reps', '12')
  })

  it('свой вес: «±кг» шагом 2,5, ноль — пустое поле, «−» из ввода — минус', () => {
    const cb = renderCard(entry('reps', [{ weight: 0, reps: 10 }]))
    expect(screen.getByLabelText('Доп. вес, подход 1')).toHaveValue('')
    step('Подход 1, доп. вес или помощь', '−')
    expect(cb.onStep).toHaveBeenLastCalledWith(0, 0, 'weight', -2.5)
    fireEvent.change(screen.getByLabelText('Доп. вес, подход 1'), { target: { value: '−10' } })
    expect(cb.onUpdateSet).toHaveBeenLastCalledWith(0, 0, 'weight', '-10')
  })

  it('время ±5 с; дистанция ±0,5 км и ±30 с, темп или подсказка', () => {
    const cb = renderCard(entry('time', [{ weight: 0, reps: 60 }]))
    step('Подход 1, время', '+')
    expect(cb.onStep).toHaveBeenLastCalledWith(0, 0, 'reps', 5)
    step('Подход 1, время', '−')
    expect(cb.onStep).toHaveBeenLastCalledWith(0, 0, 'reps', -5)
  })

  it('дистанция: шаги и темп', () => {
    const cb = renderCard(entry('distance', [{ weight: 5, reps: 1500 }]))
    step('Подход 1, дистанция', '+')
    step('Подход 1, время', '−')
    expect(cb.onStep.mock.calls).toEqual([[0, 0, 'weight', 0.5], [0, 0, 'reps', -30]])
    expect(screen.getByText(/Темп:/)).toBeInTheDocument()
  })

  it('дистанция без данных — подсказка про темп', () => {
    renderCard(entry('distance', [{ weight: '', reps: '' }]))
    expect(screen.getByText('Укажи км и время — посчитаю темп')).toBeInTheDocument()
  })

  it('слот таймера отдыха — рядом с «+ подход»', () => {
    const cb = renderCard(entry('weight', [{ weight: 60, reps: 8 }]), { restSlot: <button type="button">Отдых</button> })
    expect(screen.getByRole('button', { name: 'Отдых' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+ подход (повтор предыдущего)' }))
    expect(cb.onAddSet).toHaveBeenCalledWith(0)
  })
})

describe('ExerciseCard — настройки прогрессии', () => {
  const prog = { prev: [{ weight: 60, reps: 10 }], recSets: [{ weight: 62.5, reps: 10 }], kind: 'up', reason: 'ok', applied: false, muted: false, settingsOpen: true }

  it('стратегии и шаг', () => {
    const cb = renderCard(entry('weight', [{ weight: 60, reps: 10 }], prog))
    const seg = screen.getByRole('group', { name: 'Стратегия прогрессии' })
    for (const [name, strategy] of [['+повт.', 'reps'], ['ручной', 'manual'], ['выкл', 'off'], ['+вес', 'weight']]) {
      fireEvent.click(within(seg).getByRole('button', { name }))
      expect(cb.onChangeProgSettings).toHaveBeenLastCalledWith(0, { strategy })
    }
    const stepper = screen.getByText('Шаг').parentElement
    fireEvent.click(within(stepper).getByRole('button', { name: 'Шаг прогрессии больше' }))
    fireEvent.click(within(stepper).getByRole('button', { name: 'Шаг прогрессии меньше' }))
    const steps = cb.onChangeProgSettings.mock.calls.slice(-2).map((c) => c[1].step)
    expect(steps[0]).toBeGreaterThan(steps[1])
  })

  it('время: «+сек», без «+вес»', () => {
    renderCard(entry('time', [{ weight: 0, reps: 60 }], prog))
    const seg = screen.getByRole('group', { name: 'Стратегия прогрессии' })
    expect(within(seg).getByRole('button', { name: '+сек' })).toBeInTheDocument()
  })
})
