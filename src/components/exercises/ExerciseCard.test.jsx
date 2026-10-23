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
import { act, render, screen, fireEvent } from '@testing-library/react'
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

  it('«на время» — столбец «кг» снаряда, пустой при нуле (изометрия, 23.10); «свой вес» — «±кг» (v7.2.0)', () => {
    const { container, unmount } = renderCard({ exercise: { id: 'e3', name: 'Планка', metric: 'time' }, sets: [{ weight: 0, reps: 60, _k: 'a' }] })
    expect(container.querySelector('.sets-head').textContent).toBe('#кгмин:сек')
    expect(screen.getByLabelText('Вес снаряда, подход 1')).toHaveValue('')
    unmount()
    const r = renderCard(countEntry())
    expect(r.container.querySelector('.sets-head').textContent).toBe('#±кгповт.')
  })

  it('без entry.prog панель автопрогрессии не рендерится', () => {
    const { container } = renderCard(weightEntry())
    expect(container.querySelector('.ap')).toBeNull()
  })

  // Раскрытая — без метки: заголовок блока прямо над ней, а шапка и так тесная (fb_f284d134).
  it('упражнение разминки помечено в свернутой карточке, раскрытая — без метки (23.10)', () => {
    const { container, unmount } = renderCard(weightEntry(), {}, { phase: 'warmup' })
    expect(container.querySelector('.exercise-head .ex-phase-tag')).toBeNull()
    unmount()
    renderCard(weightEntry(), {}, { phase: 'warmup', active: false })
    expect(screen.getByRole('button', { name: /Открыть Жим лежа \(разминка\)/ })).toBeInTheDocument()
    expect(screen.getByText('разминка')).toBeInTheDocument()
  })
  it('основная часть — без пометки', () => {
    const { container } = renderCard(weightEntry())
    expect(container.querySelector('.ex-phase-tag')).toBeNull()
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
    expect(screen.getByLabelText('Повторения, подход 2')).toHaveValue('9')
  })

  // 8.3.2: повторы — текстовое поле с цифровой клавиатурой (у type=number нет API выделения),
  // поэтому лишние символы с аппаратной клавиатуры отсекаем сами.
  it('повторы: только цифры; тап по весу выделяет число целиком', () => {
    const { cbs } = renderCard(weightEntry())
    fireEvent.change(screen.getByLabelText('Повторения, подход 1'), { target: { value: '1a2' } })
    expect(cbs.onUpdateSet).toHaveBeenLastCalledWith(0, 0, 'reps', '12')
    const w = screen.getByLabelText('Вес, подход 2')
    act(() => w.focus())
    expect([w.selectionStart, w.selectionEnd]).toEqual([0, 2])
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
    const entry = { ...weightEntry(), sets: [{ weight: 62.5, reps: 10, _k: 'a' }], prog: prog({ applied: true }) }
    const { cbs } = renderCard(entry)
    fireEvent.click(screen.getByText('вернуть как в прошлый раз'))
    expect(cbs.onRevertProg).toHaveBeenCalledWith(0)
  })

  // Аудит 16.10: после правки примененной рекомендации блок — одна строка, раскрывается тапом.
  it('применена и подходы поправили → одна строка «Прошлая», тап раскрывает, шестеренка на месте', () => {
    const entry = { ...weightEntry(), prog: prog({ applied: true }) } // 60×10, 60×9 ≠ 62,5×10
    const { cbs } = renderCard(entry)
    expect(screen.queryByText('Рекомендуем сегодня', { exact: false })).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Настройки прогрессии'))
    expect(cbs.onToggleProgSettings).toHaveBeenCalledWith(0)
    fireEvent.click(screen.getByRole('button', { name: /^Прошлая тренировка и рекомендация/ }))
    expect(screen.getByText('Рекомендуем сегодня', { exact: false })).toBeInTheDocument()
  })

  it('раскрытую вручную можно свернуть обратно (fb_cc29e75a)', () => {
    renderCard({ ...weightEntry(), prog: prog({ applied: true }) })
    fireEvent.click(screen.getByRole('button', { name: /^Прошлая тренировка и рекомендация/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть прошлую тренировку и рекомендацию' }))
    expect(screen.queryByText('Рекомендуем сегодня', { exact: false })).not.toBeInTheDocument()
  })

  it('вернул подходы ровно к рекомендации — блок сам не разворачивается (fb_420182ea)', () => {
    const entry = { ...weightEntry(), prog: prog({ applied: true }) }
    const { rerender, cbs } = renderCard(entry)
    expect(screen.queryByText('Рекомендуем сегодня', { exact: false })).not.toBeInTheDocument()
    rerender(<ExerciseCard entry={{ ...entry, sets: entry.prog.recSets }} ei={0}
      prog={{ enabled: true, byExercise: {} }} active {...cbs} />)
    expect(screen.queryByText('Рекомендуем сегодня', { exact: false })).not.toBeInTheDocument()
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
    expect(screen.getByText('Темп: 5:00 мин/км')).toBeInTheDocument()
  })

  it('без км — подсказка вместо темпа; короткий отрезок — темп для ориентира', () => {
    const { rerender } = renderCard(runEntry([{ weight: '', reps: 1800, _k: 'a' }]))
    expect(screen.getByText('Укажи км и время — посчитаю темп')).toBeInTheDocument()
    rerender(<ExerciseCard entry={runEntry([{ weight: 0.4, reps: 72, _k: 'a' }])} ei={0} prog={null}
      onReplace={vi.fn()} onRemove={vi.fn()} onRevertProg={vi.fn()} onApplyProg={vi.fn()}
      onToggleProgSettings={vi.fn()} onChangeProgSettings={vi.fn()} onUpdateSet={vi.fn()}
      onStep={vi.fn()} onAddSet={vi.fn()} onRemoveSet={vi.fn()} />)
    expect(screen.getByText('Темп: 3:00 мин/км')).toBeInTheDocument()
  })

  it('ввод км с запятой уходит точкой', () => {
    const { cbs } = renderCard(runEntry([{ weight: '', reps: 1800, _k: 'a' }]))
    fireEvent.change(screen.getByLabelText('Дистанция, км, подход 1'), { target: { value: '5,5' } })
    expect(cbs.onUpdateSet).toHaveBeenCalledWith(0, 0, 'weight', '5.5')
  })
})

describe('ExerciseCard — свой вес: доп. вес и помощь (v7.2.0)', () => {
  const pullups = (sets) => ({ exercise: { id: 'pu', name: 'Подтягивания', metric: 'reps' }, sets })

  it('столбец «±кг»; ноль — пустое поле, помощь видна со знаком', () => {
    const { container } = renderCard(pullups([{ weight: 0, reps: 8, _k: 'a' }, { weight: -20, reps: 8, _k: 'b' }]))
    expect(container.querySelector('.sets-head').textContent).toBe('#±кгповт.')
    expect(screen.getByLabelText('Доп. вес, подход 1')).toHaveValue('')
    expect(screen.getByLabelText('Доп. вес, подход 2')).toHaveValue('-20')
  })

  it('недописанный ввод («-», «0.») не стирается — минус и дробь можно набрать', () => {
    renderCard(pullups([{ weight: '-', reps: 8, _k: 'a' }, { weight: '0.', reps: 8, _k: 'b' }]))
    expect(screen.getByLabelText('Доп. вес, подход 1')).toHaveValue('-')
    expect(screen.getByLabelText('Доп. вес, подход 2')).toHaveValue('0,') // показ — с запятой (аудит 16.10)
  })

  it('типографский минус и запятая уходят как «-» и «.»', () => {
    const { cbs } = renderCard(pullups([{ weight: 0, reps: 8, _k: 'a' }]))
    fireEvent.change(screen.getByLabelText('Доп. вес, подход 1'), { target: { value: '−12,5' } })
    expect(cbs.onUpdateSet).toHaveBeenCalledWith(0, 0, 'weight', '-12.5')
  })
})

describe('ExerciseCard — подсказка «Как выполнять» (v8.0.0)', () => {
  it('без onTechnique кнопки нет', () => {
    renderCard(weightEntry())
    expect(screen.queryByRole('button', { name: /Как выполнять/ })).toBeNull()
  })

  it('кнопка «i» зовет onTechnique и ничего не меняет в подходах', () => {
    const onTechnique = vi.fn()
    const { cbs } = renderCard(weightEntry(), {}, { onTechnique })
    fireEvent.click(screen.getByRole('button', { name: 'Как выполнять: Жим лежа' }))
    expect(onTechnique).toHaveBeenCalledTimes(1)
    // «i» — сразу за названием, внутри ручки перестановки, но удержание на ней строку не берет.
    const btn = screen.getByRole('button', { name: 'Как выполнять: Жим лежа' })
    expect(btn.closest('.exercise-title')).not.toBeNull()
    expect(btn).toHaveAttribute('data-no-sort')
    for (const k of ['onReplace', 'onRemove', 'onAddSet', 'onRemoveSet', 'onUpdateSet', 'onStep']) {
      expect(cbs[k]).not.toHaveBeenCalled()
    }
  })

  it('у свернутой карточки кнопки нет — сначала раскрыть', () => {
    renderCard(weightEntry(), {}, { active: false, onTechnique: vi.fn() })
    expect(screen.queryByRole('button', { name: /Как выполнять/ })).toBeNull()
  })
})
