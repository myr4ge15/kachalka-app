// @vitest-environment jsdom
// «Мои цели» в Профиле (components/profile/GoalsSection.jsx) — своим тестом (покрытие
// тестами 19.10.2026; раньше только один кейс через ProfileScreen.blocks.test.jsx).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import GoalsSection from './GoalsSection.jsx'
import { readGoals, writeGoals } from '../../db/notifications.js'
import { syncNow } from '../../db/sync.js'
import { showToast } from '../ui/Toast.jsx'

vi.mock('../../db/notifications.js', () => ({ readGoals: vi.fn(), writeGoals: vi.fn(async () => {}) }))
vi.mock('../../db/sync.js', () => ({ syncNow: vi.fn() }))
vi.mock('../ui/Toast.jsx', () => ({ showToast: vi.fn() }))

const RECORDS = [
  { exId: 'pull', name: 'Подтягивания', metric: 'reps', value: 12 },
  { exId: 'bench', name: 'Жим лежа', metric: 'weight', value: 80, isBench: true },
  { exId: 'plank', name: 'Планка', metric: 'time', value: 95 },
  { exId: 'run', name: 'Бег', metric: 'distance', value: 5 },
]
const BENCH_GOAL = {
  exerciseId: 'bench', exerciseName: 'Жим лежа', metric: 'weight', targetWeight: 90, targetReps: null,
  achievedAt: '2026-10-01T10:00:00Z',
}

let stored = []
beforeEach(() => {
  stored = []
  vi.mocked(readGoals).mockImplementation(async () => stored)
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => vi.clearAllMocks())

const renderGoals = (goals = []) =>
  render(<GoalsSection userId="me" goals={goals} records={RECORDS} workouts={[]} />)
const lastWrite = () => vi.mocked(writeGoals).mock.calls.at(-1)[1]

describe('GoalsSection', () => {
  it('новая цель: первым — жим (🏅), дистанции в списке нет; сохранение пушит синк', async () => {
    renderGoals()
    fireEvent.click(screen.getByRole('button', { name: '+ Поставить цель' }))
    const select = screen.getByLabelText('Упражнение')
    expect(select).toHaveValue('bench')
    expect([...select.options].map((o) => o.value)).toEqual(['pull', 'bench', 'plank'])
    expect(screen.getByLabelText('Целевой вес в килограммах')).toHaveValue('85')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(writeGoals).toHaveBeenCalled())
    expect(lastWrite()).toEqual([expect.objectContaining({ exerciseId: 'bench', targetWeight: 85, targetReps: null, _dirty: 1 })])
    expect(syncNow).toHaveBeenCalledWith('me')
  })

  it('смена упражнения подхватывает его метрику и дефолт: повторы +2, время +15 с', async () => {
    renderGoals()
    fireEvent.click(screen.getByRole('button', { name: '+ Поставить цель' }))
    fireEvent.change(screen.getByLabelText('Упражнение'), { target: { value: 'pull' } })
    expect(screen.getByLabelText('Целевое число повторений')).toHaveValue('14')
    expect(screen.queryByLabelText(/Повторения при целевом весе/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Упражнение'), { target: { value: 'plank' } })
    const time = screen.getByLabelText('Целевое время в формате минуты:секунды')
    expect(time).toHaveValue('1:50')
    fireEvent.change(time, { target: { value: '2:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(writeGoals).toHaveBeenCalled())
    expect(lastWrite()[0]).toMatchObject({ exerciseId: 'plank', metric: 'time', targetWeight: 150, targetReps: null })
  })

  it('весовая цель с повторами при этом весе', async () => {
    renderGoals()
    fireEvent.click(screen.getByRole('button', { name: '+ Поставить цель' }))
    fireEvent.change(screen.getByLabelText('Целевой вес в килограммах'), { target: { value: '92,5' } })
    fireEvent.change(screen.getByLabelText('Повторения при целевом весе (необязательно)'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(writeGoals).toHaveBeenCalled())
    expect(lastWrite()[0]).toMatchObject({ targetWeight: 92.5, targetReps: 3 })
  })

  it('пустое значение (тап по «Сохранить» без blur) — цель в 0 не пишется, редактор остается', async () => {
    renderGoals()
    fireEvent.click(screen.getByRole('button', { name: '+ Поставить цель' }))
    fireEvent.change(screen.getByLabelText('Целевой вес в килограммах'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await Promise.resolve()
    expect(writeGoals).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeInTheDocument()
  })

  it('правка: новое значение снимает «достигнута», то же значение — оставляет', async () => {
    stored = [BENCH_GOAL]
    const { unmount } = renderGoals([BENCH_GOAL])
    fireEvent.click(screen.getByRole('button', { name: /Изменить цель/ }))
    expect(screen.getByText('Жим лежа', { selector: '.goal-editor-ex' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(writeGoals).toHaveBeenCalledTimes(1))
    expect(lastWrite()[0].achievedAt).toBe(BENCH_GOAL.achievedAt)
    unmount()

    renderGoals([BENCH_GOAL])
    fireEvent.click(screen.getByRole('button', { name: /Изменить цель/ }))
    fireEvent.change(screen.getByLabelText('Целевой вес в килограммах'), { target: { value: '95' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(writeGoals).toHaveBeenCalledTimes(2))
    expect(lastWrite()[0]).toMatchObject({ targetWeight: 95, achievedAt: null, _dirty: 1 })
  })

  it('удаление — tombstone (_deleted + _dirty), а не вырезание из массива', async () => {
    stored = [BENCH_GOAL]
    renderGoals([BENCH_GOAL])
    fireEvent.click(screen.getByRole('button', { name: /Изменить цель/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(writeGoals).toHaveBeenCalled())
    expect(lastWrite()).toEqual([expect.objectContaining({ exerciseId: 'bench', _deleted: 1, _dirty: 1 })])
  })

  it('офлайн — цель пишется локально, синк не зовется', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    renderGoals()
    fireEvent.click(screen.getByRole('button', { name: '+ Поставить цель' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(writeGoals).toHaveBeenCalled())
    expect(syncNow).not.toHaveBeenCalled()
  })

  it('цели уже на всех упражнениях — тост вместо пустого редактора; удаленные цели не в счет', () => {
    const goals = ['pull', 'bench', 'plank'].map((id) => ({ exerciseId: id, exerciseName: id, metric: 'weight', targetWeight: 1 }))
    goals.push({ exerciseId: 'gone', exerciseName: 'Старое', targetWeight: 1, _deleted: 1 })
    renderGoals(goals)
    expect(screen.queryByText('Старое')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить цель' }))
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Цели уже на всех упражнениях' }))
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull()
  })
})
