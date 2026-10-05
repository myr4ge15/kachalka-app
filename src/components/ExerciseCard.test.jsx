// @vitest-environment jsdom
//
// Первый компонентный тест (RTL) — заодно доказательство, что jsdom-слой Vitest
// поднят. ExerciseCard чисто презентационная: весь стейт/апдейтеры живут в
// WorkoutScreen и приходят колбэками, поэтому ее можно рендерить без Dexie/сети.
// Смысл сетки — зафиксировать поведение перед разбивкой WorkoutScreen (техдолг):
// какие клики какой колбэк с каким индексом дергают, что скрывается для метрик
// без веса, как показывается панель автопрогрессии .ap (полная/muted).
//
// Осознанно НЕ проверяем степперы веса/повторов: их кнопки — HoldButton на
// Pointer Events (onPointerDown), а не onClick; их поведение покрыто чистым
// lib/hold. Здесь — только onClick-обработчики (jsdom-стабильно).
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ExerciseCard from './ExerciseCard.jsx'

const weightEntry = () => ({
  exercise: { id: 'e1', name: 'Жим лежа', metric: 'weight' },
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
    onSetFeel: vi.fn(),
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
    expect(screen.getByText('Жим лежа')).toBeInTheDocument()
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
    // Подходы перечисляются целиком: 60×10 и 60×9 — разные, и сводка обязана это
    // показать (прежний «лучший подход» читался как «оба по 60×10»).
    expect(screen.getByText('2 подхода · 60×10 · 60×9')).toBeInTheDocument()
    expect(screen.queryByText(/заполнено|готово/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Открыть Жим лежа/ }))
    expect(cbs.onActivate).toHaveBeenCalledWith('e1')
  })

  it('компактная карточка без подходов прямо говорит, что не сохранится', () => {
    renderCard({ exercise: { id: 'e1', name: 'Жим лежа', metric: 'weight' }, sets: [] }, {}, { active: false })
    expect(screen.getByText('подходов нет — не сохранится')).toBeInTheDocument()
  })

  it('схлопывает одинаковые подходы, чтобы типовая сводка осталась короткой', () => {
    const same = {
      exercise: { id: 'e1', name: 'Жим лежа', metric: 'weight' },
      sets: [
        { weight: 60, reps: 10, _k: 'a' },
        { weight: 60, reps: 10, _k: 'b' },
        { weight: 60, reps: 10, _k: 'c' },
      ],
    }
    renderCard(same, {}, { active: false })
    expect(screen.getByText('3 подхода · 60×10 ×3')).toBeInTheDocument()
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

  // Запрос намеренно точный: с отметками выполнения (Slice 2) в карточке есть еще
  // кнопки «Отметить подход N выполненным», и широкое /подход/ стало неоднозначным.
  it('«+ подход» → onAddSet(ei)', () => {
    const { cbs } = renderCard(weightEntry())
    fireEvent.click(screen.getByRole('button', { name: '+ подход (повтор предыдущего)' }))
    expect(cbs.onAddSet).toHaveBeenCalledWith(0)
  })

  it('«✕» первого подхода → onRemoveSet(ei, si)', () => {
    const { cbs } = renderCard(weightEntry())
    fireEvent.click(screen.getByRole('button', { name: 'Удалить подход 1' }))
    expect(cbs.onRemoveSet).toHaveBeenCalledWith(0, 0)
  })
})

describe('ExerciseCard — строки подходов (v6.1.0, без отметок)', () => {
  it('номер подхода — подпись, не кнопка; бейджа «сейчас» нет', () => {
    renderCard(weightEntry())
    expect(screen.queryByRole('button', { name: /Отметить подход|выполнен/ })).toBeNull()
    expect(screen.queryByText('сейчас')).toBeNull()
    expect(screen.getByLabelText('Вес, подход 2')).toHaveValue('60')
    expect(screen.getByLabelText('Повторения, подход 2')).toHaveValue(9)
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

  it('applied=true → показывает откат и зовет onRevertProg', () => {
    const entry = { ...weightEntry(), prog: prog({ applied: true }) }
    const { cbs } = renderCard(entry)
    fireEvent.click(screen.getByText('вернуть как в прошлый раз'))
    expect(cbs.onRevertProg).toHaveBeenCalledWith(0)
  })

  it('muted (стратегия off): компактная строка + шестеренка зовет onToggleProgSettings', () => {
    const entry = { ...weightEntry(), prog: prog({ muted: true, strategy: 'off' }) }
    const { cbs } = renderCard(entry)
    expect(screen.getByText(/Прогрессия:/)).toBeInTheDocument()
    expect(screen.getByText(/выключена/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Настройки прогрессии'))
    expect(cbs.onToggleProgSettings).toHaveBeenCalledWith(0)
  })
})

describe('ExerciseCard — оценка «Как пошло?» (RPE)', () => {
  it('три кнопки шкалы, ни одна не выбрана по умолчанию', () => {
    renderCard(weightEntry())
    expect(screen.getByText('Как пошло?')).toBeInTheDocument()
    for (const label of ['легко', 'нормально', 'тяжело']) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('тап отдает id упражнения и значение шкалы', () => {
    const { cbs } = renderCard(weightEntry())
    fireEvent.click(screen.getByRole('button', { name: 'тяжело' }))
    expect(cbs.onSetFeel).toHaveBeenCalledWith('e1', 'hard')
  })

  it('выбранная оценка отмечена aria-pressed (снятие решает экран, не карточка)', () => {
    const { cbs } = renderCard(weightEntry(), {}, { feel: 'easy' })
    expect(screen.getByRole('button', { name: 'легко' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'тяжело' })).toHaveAttribute('aria-pressed', 'false')
    // повторный тап по выбранной уходит тем же колбэком — снятие делает WorkoutScreen
    fireEvent.click(screen.getByRole('button', { name: 'легко' }))
    expect(cbs.onSetFeel).toHaveBeenCalledWith('e1', 'easy')
  })

  it('есть и у упражнений без веса', () => {
    renderCard(countEntry())
    expect(screen.getByRole('button', { name: 'нормально' })).toBeInTheDocument()
  })

  it('свернутая карточка оценку не показывает — она часть развернутой работы', () => {
    renderCard(weightEntry(), {}, { active: false })
    expect(screen.queryByText('Как пошло?')).not.toBeInTheDocument()
  })

  it('группа подписана именем упражнения — в тренировке таких строк несколько', () => {
    renderCard(weightEntry())
    expect(screen.getByRole('group', { name: 'Как пошло: Жим лежа' })).toBeInTheDocument()
  })
})

describe('ExerciseCard — дистанция (v6.12.0)', () => {
  const runEntry = (sets) => ({ exercise: { id: 'run', name: 'Бег', metric: 'distance' }, sets })

  it('столбцы «км» и «мин:сек», поле км и время, темп лучшего подхода', () => {
    const { container } = renderCard(runEntry([{ weight: 5, reps: 1500, _k: 'a' }]))
    expect(container.querySelector('.sets-head').textContent).toBe('#кммин:сек')
    expect(screen.getByLabelText('Дистанция, км, подход 1')).toHaveValue('5')
    expect(screen.getByLabelText('Время, подход 1')).toBeInTheDocument()
    expect(screen.getByText('Темп: 5:00 /км')).toBeInTheDocument()
  })

  it('без км — подсказка вместо темпа; короткий отрезок — темп для ориентира', () => {
    const { rerender } = renderCard(runEntry([{ weight: '', reps: 1800, _k: 'a' }]))
    expect(screen.getByText('Укажи км и время — посчитаю темп')).toBeInTheDocument()
    rerender(<ExerciseCard entry={runEntry([{ weight: 0.4, reps: 72, _k: 'a' }])} ei={0} prog={null}
      onReplace={vi.fn()} onRemove={vi.fn()} onRevertProg={vi.fn()} onApplyProg={vi.fn()}
      onToggleProgSettings={vi.fn()} onChangeProgSettings={vi.fn()} onUpdateSet={vi.fn()}
      onStep={vi.fn()} onAddSet={vi.fn()} onRemoveSet={vi.fn()} />)
    expect(screen.getByText('Темп: 3:00 /км')).toBeInTheDocument()
  })

  it('ввод км с запятой уходит точкой', () => {
    const { cbs } = renderCard(runEntry([{ weight: '', reps: 1800, _k: 'a' }]))
    fireEvent.change(screen.getByLabelText('Дистанция, км, подход 1'), { target: { value: '5,5' } })
    expect(cbs.onUpdateSet).toHaveBeenCalledWith(0, 0, 'weight', '5.5')
  })
})
