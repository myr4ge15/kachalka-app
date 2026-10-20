// @vitest-environment jsdom
// Прогресс (покрытие тестами 20.10.2026: 79 % строк, ветки 54 %): выбор упражнения и его
// метрика (вес, повторы, время, дистанция), периоды и свои даты, переход из Профиля к
// упражнению, цель с повторами, подписи графика и таблицы.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import ProgressScreen from './ProgressScreen.jsx'

const data = vi.hoisted(() => ({ workouts: [], goals: [] }))
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (fn) => (String(fn).includes('getWorkouts') ? data.workouts : data.goals),
}))
vi.mock('../db/repo.js', () => ({ getWorkouts: vi.fn() }))
vi.mock('../db/notifications.js', () => ({ readGoals: vi.fn() }))
// Recharts в jsdom не рисует: подменяем, но зовем переданные функции (точки, подсказка).
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  LineChart: ({ children }) => <svg>{children}</svg>,
  Line: ({ dot, activeDot }) => (
    <g data-testid="line">
      {dot?.({ cx: 1, cy: 2, payload: { isPr: true, dir: 'up' }, index: 0 })}
      {dot?.({ cx: 1, cy: 2, payload: { dir: 'down' }, index: 1 })}
      {dot?.({ cx: 1, cy: 2, payload: { dir: 'flat' }, index: 2 })}
      {activeDot?.({ cx: 1, cy: 2, payload: { isPr: false }, index: 3 })}
    </g>
  ),
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: ({ formatter, labelFormatter }) => (
    <text data-testid="tip">{formatter?.(95).join(' | ')} @ {labelFormatter?.('2026-10-01')}</text>
  ),
  Dot: (p) => <circle data-r={p.r} />,
  ReferenceArea: () => null,
  ReferenceLine: () => null,
}))

const day = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString()
const W = (id, daysAgo, exercise, sets) => ({ id, user_id: 'u1', performed_at: day(daysAgo), entries: [{ exercise_id: exercise.id, exercise, sets }] })
const BENCH = { id: 'bench', name: 'Жим лежа', metric: 'weight', is_bench_lift: true }
const PULL = { id: 'pull', name: 'Подтягивания', metric: 'reps' }
const PLANK = { id: 'plank', name: 'Планка', metric: 'time' }
const RUN = { id: 'run', name: 'Бег', metric: 'distance' }

afterEach(() => { data.workouts = []; data.goals = [] })

function setup(props = {}) {
  data.workouts = [
    W('w1', 2, BENCH, [{ weight: 90, reps: 5 }]),
    W('w2', 40, BENCH, [{ weight: 80, reps: 8 }]),
    W('w3', 3, PULL, [{ weight: 0, reps: 12 }]),
    W('w4', 4, PLANK, [{ weight: 0, reps: 95 }]),
    W('w5', 5, RUN, [{ weight: 5.2, reps: 1800 }]),
  ]
  return render(<ProgressScreen user={{ id: 'u1' }} {...props} />)
}
const select = () => screen.getByRole('combobox')

describe('ProgressScreen — упражнение и метрика', () => {
  it('по умолчанию — жим (🏅): кг, подсказка графика, точки рекорда и динамики', () => {
    setup()
    expect(select()).toHaveValue('bench')
    expect(screen.getByRole('option', { name: 'Жим лежа 🏅' })).toBeInTheDocument()
    expect(screen.getByTestId('tip')).toHaveTextContent('95 кг | Вес')
    expect(screen.getByText('Подходы (кг×повт.)')).toBeInTheDocument()
    expect(screen.getAllByText(/🏆/).length).toBeGreaterThan(0)
  })

  it('повторы, время и дистанция — свои единицы и подписи', () => {
    setup()
    fireEvent.change(select(), { target: { value: 'pull' } })
    expect(screen.getByText('Подходы (повт.)')).toBeInTheDocument()
    expect(screen.getByText(/без веса — динамика по лучшему подходу/)).toBeInTheDocument()
    fireEvent.change(select(), { target: { value: 'plank' } })
    expect(screen.getByText(/на время — динамика по лучшему подходу/)).toBeInTheDocument()
    expect(screen.getByTestId('tip')).toHaveTextContent('1:35 | Время')
    expect(screen.getAllByText(/1:35/).length).toBeGreaterThan(0)
    fireEvent.change(select(), { target: { value: 'run' } })
    expect(screen.getByText(/Дистанция — динамика по самой длинной за день/)).toBeInTheDocument()
    expect(screen.getByText('Подходы (км)')).toBeInTheDocument()
  })

  it('переход из Профиля к упражнению — выбрано и отмечено как использованное', () => {
    const onConsumed = vi.fn()
    setup({ initialExerciseId: 'plank', onConsumed })
    expect(select()).toHaveValue('plank')
    expect(onConsumed).toHaveBeenCalled()
  })
})

describe('ProgressScreen — периоды', () => {
  it('неделя оставляет свежее, месяц — тоже без старого; «Все» возвращает', () => {
    setup()
    const table = () => screen.getByText('По дням').parentElement
    expect(within(table()).getAllByText(/1ПМ/).length).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'Неделя' }))
    expect(within(table()).getAllByText(/1ПМ/).length).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Месяц' }))
    expect(within(table()).getAllByText(/1ПМ/).length).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Все' }))
    expect(within(table()).getAllByText(/1ПМ/).length).toBe(2)
  })

  it('свой период: даты сужают; пусто — «Нет подходов за выбранный период»', () => {
    const { container } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Период' }))
    const [from, to] = container.querySelectorAll('input[type="date"]')
    fireEvent.change(from, { target: { value: '2000-01-01' } })
    fireEvent.change(to, { target: { value: '2000-12-31' } })
    expect(screen.getByText('Нет подходов за выбранный период.')).toBeInTheDocument()
    expect(to).toHaveAttribute('min', '2000-01-01')
    expect(from).toHaveAttribute('max', '2000-12-31')
  })
})

describe('ProgressScreen — цель с повторами', () => {
  it('вес уже есть, повторов не хватает — так и пишем', () => {
    data.goals = [{ exerciseId: 'bench', exerciseName: 'Жим лежа', metric: 'weight', targetWeight: 90, targetReps: 8 }]
    data.workouts = [W('w1', 2, BENCH, [{ weight: 90, reps: 5 }])]
    render(<ProgressScreen user={{ id: 'u1' }} onOpenGoals={vi.fn()} />)
    expect(screen.getByText(/× 8/)).toBeInTheDocument()
    expect(screen.getByText(/вес уже есть · осталось выполнить ≥8 повт\./)).toBeInTheDocument()
  })

  it('цель достигнута — «целевой показатель уже достигнут»', () => {
    data.goals = [{ exerciseId: 'bench', exerciseName: 'Жим лежа', metric: 'weight', targetWeight: 80 }]
    data.workouts = [W('w1', 2, BENCH, [{ weight: 90, reps: 5 }])]
    render(<ProgressScreen user={{ id: 'u1' }} onOpenGoals={vi.fn()} />)
    expect(screen.getByText(/целевой показатель уже достигнут/)).toBeInTheDocument()
  })
})
