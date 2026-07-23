// @vitest-environment jsdom
//
// Первый компонентный тест (RTL) — заодно доказательство, что jsdom-слой Vitest
// поднят. ExerciseCard чисто презентационная: весь стейт/апдейтеры живут в
// WorkoutScreen и приходят колбэками, поэтому её можно рендерить без Dexie/сети.
// Смысл сетки — зафиксировать поведение перед разбивкой WorkoutScreen (техдолг):
// какие клики какой колбэк с каким индексом дёргают, что скрывается для метрик
// без веса, как показывается панель автопрогрессии .ap (полная/muted).
//
// Осознанно НЕ проверяем степперы веса/повторов: их кнопки — HoldButton на
// Pointer Events (onPointerDown), а не onClick; их поведение покрыто чистым
// lib/hold. Здесь — только onClick-обработчики (jsdom-стабильно).
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ExerciseCard from './ExerciseCard.jsx'

const weightEntry = () => ({
  exercise: { id: 'e1', name: 'Жим лёжа', metric: 'weight' },
  sets: [
    { weight: 60, reps: 10, _k: 'a' },
    { weight: 60, reps: 9, _k: 'b' },
  ],
})

const countEntry = () => ({
  exercise: { id: 'e2', name: 'Подтягивания', metric: 'reps' },
  sets: [{ weight: 0, reps: 12, _k: 'a' }],
})

const prog = (over = {}) => ({
  prev: [{ weight: 60, reps: 10 }],
  recSets: [{ weight: 62.5, reps: 10 }],
  kind: 'up',
  reason: 'Все повторы выполнены',
  whenIso: '2026-01-01T10:00:00.000Z',
  applied: false,
  muted: false,
  settingsOpen: false,
  ...over,
})

// Рендер с дефолтными no-op колбэками; возвращаем шпионы + container для
// проверок по классам (set-row/ap — у них нет ARIA-роли).
function renderCard(entry, cbOver = {}) {
  const cbs = {
    onReplace: vi.fn(), onRemove: vi.fn(),
    onRevertProg: vi.fn(), onApplyProg: vi.fn(),
    onToggleProgSettings: vi.fn(), onChangeProgSettings: vi.fn(),
    onUpdateSet: vi.fn(), onStep: vi.fn(), onAddSet: vi.fn(), onRemoveSet: vi.fn(),
    ...cbOver,
  }
  const utils = render(<ExerciseCard entry={entry} ei={0} prog={{ enabled: true, byExercise: {} }} {...cbs} />)
  return { ...utils, cbs }
}

describe('ExerciseCard — рендер', () => {
  it('показывает имя упражнения и по строке на каждый подход', () => {
    const { container } = renderCard(weightEntry())
    expect(screen.getByText('Жим лёжа')).toBeInTheDocument()
    expect(container.querySelectorAll('.set-row')).toHaveLength(2)
  })

  it('для метрики без веса прячет столбец «кг»', () => {
    renderCard(countEntry())
    expect(screen.queryByText('кг')).toBeNull()
    expect(screen.getByText('повт.')).toBeInTheDocument()
  })

  it('без entry.prog панель автопрогрессии не рендерится', () => {
    const { container } = renderCard(weightEntry())
    expect(container.querySelector('.ap')).toBeNull()
  })
})

describe('ExerciseCard — колбэки шапки/подходов передают индекс записи', () => {
  it('«заменить» → onReplace(ei)', () => {
    const { cbs } = renderCard(weightEntry())
    fireEvent.click(screen.getByText('заменить'))
    expect(cbs.onReplace).toHaveBeenCalledWith(0)
  })

  it('«убрать» → onRemove(ei)', () => {
    const { cbs } = renderCard(weightEntry())
    fireEvent.click(screen.getByText('убрать'))
    expect(cbs.onRemove).toHaveBeenCalledWith(0)
  })

  it('«+ подход» → onAddSet(ei)', () => {
    const { cbs } = renderCard(weightEntry())
    fireEvent.click(screen.getByRole('button', { name: /подход/ }))
    expect(cbs.onAddSet).toHaveBeenCalledWith(0)
  })

  it('«✕» первого подхода → onRemoveSet(ei, si)', () => {
    const { cbs } = renderCard(weightEntry())
    fireEvent.click(screen.getAllByText('✕')[0])
    expect(cbs.onRemoveSet).toHaveBeenCalledWith(0, 0)
  })
})

describe('ExerciseCard — панель автопрогрессии', () => {
  it('полная панель: показывает причину и применяет рекомендацию', () => {
    const entry = { ...weightEntry(), prog: prog({ applied: false }) }
    const { cbs } = renderCard(entry)
    expect(screen.getByText('Все повторы выполнены')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Применить рекомендацию'))
    expect(cbs.onApplyProg).toHaveBeenCalledWith(0)
  })

  it('applied=true → показывает откат и зовёт onRevertProg', () => {
    const entry = { ...weightEntry(), prog: prog({ applied: true }) }
    const { cbs } = renderCard(entry)
    fireEvent.click(screen.getByText('вернуть как в прошлый раз'))
    expect(cbs.onRevertProg).toHaveBeenCalledWith(0)
  })

  it('muted (стратегия off): компактная строка + шестерёнка зовёт onToggleProgSettings', () => {
    const entry = { ...weightEntry(), prog: prog({ muted: true, strategy: 'off' }) }
    const { cbs } = renderCard(entry)
    expect(screen.getByText(/Прогрессия:/)).toBeInTheDocument()
    expect(screen.getByText(/выключена/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Настройки прогрессии'))
    expect(cbs.onToggleProgSettings).toHaveBeenCalledWith(0)
  })
})
