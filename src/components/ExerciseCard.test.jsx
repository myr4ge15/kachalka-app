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
function renderCard(entry, cbOver = {}, propOver = {}) {
  const cbs = {
    onActivate: vi.fn(),
    onReplace: vi.fn(), onRemove: vi.fn(),
    onRevertProg: vi.fn(), onApplyProg: vi.fn(),
    onToggleProgSettings: vi.fn(), onChangeProgSettings: vi.fn(),
    onUpdateSet: vi.fn(), onStep: vi.fn(), onAddSet: vi.fn(), onRemoveSet: vi.fn(),
    onToggleSetDone: vi.fn(),
    ...cbOver,
  }
  const utils = render(
    <ExerciseCard
      entry={entry}
      ei={0}
      prog={{ enabled: true, byExercise: {} }}
      active
      {...cbs}
      {...propOver}
    />
  )
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

  it('неактивная карточка показывает компактный итог и раскрывается одним тапом', () => {
    const { container, cbs } = renderCard(weightEntry(), {}, { active: false })

    expect(container.querySelectorAll('.set-row')).toHaveLength(0)
    expect(screen.queryByText('заменить')).not.toBeInTheDocument()
    expect(screen.getByText('2 подхода · 60×10')).toBeInTheDocument()
    expect(screen.queryByText(/заполнено|готово/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Открыть Жим лёжа/ }))
    expect(cbs.onActivate).toHaveBeenCalledWith('e1')
  })

  it('компактная карточка показывает прогресс и полную готовность по отметкам', () => {
    const { container, rerender } = renderCard(weightEntry(), {}, {
      active: false,
      doneKeys: new Set(['e1::a']),
    })
    expect(screen.getByText('выполнено 1 из 2 · 60×10')).toBeInTheDocument()
    expect(container.querySelector('[data-exercise-id="e1"]')).toHaveAttribute('data-done', 'false')

    rerender(
      <ExerciseCard
        entry={weightEntry()}
        ei={0}
        prog={{ enabled: true, byExercise: {} }}
        active={false}
        doneKeys={new Set(['e1::a', 'e1::b'])}
      />
    )
    expect(screen.getByText('✓ выполнено · 2 подхода · 60×10')).toBeInTheDocument()
    expect(container.querySelector('[data-exercise-id="e1"]')).toHaveAttribute('data-done', 'true')
  })

  it('нейтрально показывает отсутствие значений без ложного статуса', () => {
    const incomplete = { ...weightEntry(), sets: [{ weight: 0, reps: 0, _k: 'a' }] }
    renderCard(incomplete, {}, { active: false })

    expect(screen.getByText('1 подход · значения не указаны')).toBeInTheDocument()
    expect(screen.queryByText(/заполнено|готово/i)).not.toBeInTheDocument()
  })
})

describe('ExerciseCard — колбэки шапки/подходов передают индекс записи', () => {
  it('сообщает стабильный exercise.id при касании и входе фокуса', () => {
    const { container, cbs } = renderCard(weightEntry())
    const card = container.querySelector('[data-exercise-id="e1"]')
    expect(card).toHaveAttribute('data-active', 'true')

    fireEvent.pointerDown(card)
    fireEvent.focus(screen.getAllByDisplayValue('60')[0])

    expect(cbs.onActivate).toHaveBeenCalledWith('e1')
    expect(cbs.onActivate).toHaveBeenCalledTimes(2)
  })

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

  // Запрос намеренно точный: с отметками выполнения (Slice 2) в карточке есть ещё
  // кнопки «Отметить подход N выполненным», и широкое /подход/ стало неоднозначным.
  it('«+ подход» → onAddSet(ei)', () => {
    const { cbs } = renderCard(weightEntry())
    fireEvent.click(screen.getByRole('button', { name: '+ подход (повтор предыдущего)' }))
    expect(cbs.onAddSet).toHaveBeenCalledWith(0)
  })

  it('«✕» первого подхода → onRemoveSet(ei, si)', () => {
    const { cbs } = renderCard(weightEntry())
    fireEvent.click(screen.getAllByText('✕')[0])
    expect(cbs.onRemoveSet).toHaveBeenCalledWith(0, 0)
  })
})

describe('ExerciseCard — отметка выполнения подхода (Slice 2)', () => {
  it('номер подхода переключает готовность и отдаёт упражнение с подходом', () => {
    const entry = weightEntry()
    const { cbs } = renderCard(entry)

    fireEvent.click(screen.getByRole('button', { name: 'Отметить подход 2 выполненным' }))

    expect(cbs.onToggleSetDone).toHaveBeenCalledWith('e1', entry.sets[1], 1)
  })

  it('отмеченный подход показывает ✓, нажатое состояние и не теряет значения', () => {
    const { container } = renderCard(weightEntry(), {}, { doneKeys: new Set(['e1::a']) })
    const toggle = screen.getByRole('button', { name: 'Подход 1 выполнен' })

    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).toHaveTextContent('✓')
    expect(container.querySelectorAll('.set-row--done')).toHaveLength(1)
    // Значения подхода остаются доступными для правки — отмена не удаляет ввод.
    expect(screen.getAllByDisplayValue('60')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Отметить подход 2 выполненным' }))
      .toHaveAttribute('aria-pressed', 'false')
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
