// @vitest-environment jsdom
// «Мои цели» — степперы и поля (покрытие тестами 20.10.2026: ветки 67 %): вес шагом 1,5 и не
// ниже 1,5, пустое поле после blur — 2,5; повторы не ниже 1; время шагом 5 с и ввод мм:сс;
// повторы при весе — не ниже 0; «Отмена» без записи; правка цели с повторами.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import GoalsSection from './GoalsSection.jsx'
import { readGoals, writeGoals } from '../../db/notifications.js'

vi.mock('../../db/notifications.js', () => ({ readGoals: vi.fn(async () => []), writeGoals: vi.fn(async () => {}) }))
vi.mock('../../db/sync.js', () => ({ syncNow: vi.fn() }))
vi.mock('../ui/Toast.jsx', () => ({ showToast: vi.fn() }))

const RECORDS = [
  { exId: 'bench', name: 'Жим лежа', metric: 'weight', value: 80, isBench: true },
  { exId: 'pull', name: 'Подтягивания', metric: 'reps', value: 3 },
  { exId: 'plank', name: 'Планка', metric: 'time', value: 10 },
]
beforeEach(() => { Object.defineProperty(navigator, 'onLine', { value: false, configurable: true }); Element.prototype.scrollIntoView = vi.fn() })
afterEach(() => vi.clearAllMocks())

const open = (goals = []) => {
  render(<GoalsSection userId="me" goals={goals} records={RECORDS} workouts={[]} />)
  fireEvent.click(screen.getByRole('button', { name: goals.length ? /Изменить цель/ : '+ Поставить цель' }))
}
const minus = () => screen.getAllByRole('button', { name: '−' })
const plus = () => screen.getAllByRole('button', { name: '+' })

describe('GoalsSection — степперы', () => {
  it('тап по подписи поля не жмет «−» (раньше label цеплялся к первой кнопке степпера)', () => {
    open()
    const w = screen.getByLabelText('Целевой вес в килограммах')
    fireEvent.click(screen.getByText('Целевой вес'))
    fireEvent.click(screen.getByText(/Повторения при этом весе/))
    expect(w).toHaveValue('85')
    expect(screen.getAllByRole('button', { name: '−' })).toHaveLength(2) // у кнопок свое имя, не подпись поля
  })

  it('вес: ±1,5; пустое поле после ухода — 2,5; повторы при весе не ниже 0', () => {
    open()
    const w = screen.getByLabelText('Целевой вес в килограммах')
    expect(w).toHaveValue('85')
    fireEvent.click(plus()[0])
    expect(w).toHaveValue('86.5')
    fireEvent.click(minus()[0]); fireEvent.click(minus()[0])
    expect(w).toHaveValue('83.5')
    fireEvent.change(w, { target: { value: 'abc' } })
    fireEvent.blur(w)
    expect(w).toHaveValue('2.5')
    const reps = screen.getByLabelText('Повторения при целевом весе (необязательно)')
    fireEvent.click(minus()[1])
    expect(reps).toHaveValue('')
    fireEvent.click(plus()[1]); fireEvent.click(plus()[1])
    expect(reps).toHaveValue('2')
    fireEvent.change(reps, { target: { value: '-4x' } })
    fireEvent.blur(reps)
    expect(reps).toHaveValue('4')
  })

  it('повторы: не ниже 1, цифры только', () => {
    open()
    fireEvent.change(screen.getByLabelText('Упражнение'), { target: { value: 'pull' } })
    const r = screen.getByLabelText('Целевое число повторений')
    expect(r).toHaveValue('5') // минимум 5 при рекорде 3
    for (let i = 0; i < 6; i++) fireEvent.click(minus()[0])
    expect(r).toHaveValue('1')
    fireEvent.click(plus()[0])
    expect(r).toHaveValue('2')
    fireEvent.change(r, { target: { value: '1a2' } })
    expect(r).toHaveValue('12')
    fireEvent.change(r, { target: { value: '' } })
    fireEvent.blur(r)
    expect(r).toHaveValue('1')
  })

  it('время: шаг 5 с, не ниже 5 с; ввод мм:сс нормализуется после ухода', async () => {
    open()
    fireEvent.change(screen.getByLabelText('Упражнение'), { target: { value: 'plank' } })
    const t = screen.getByLabelText('Целевое время в формате минуты:секунды')
    expect(t).toHaveValue('0:30')
    fireEvent.click(plus()[0])
    expect(t).toHaveValue('0:35')
    for (let i = 0; i < 10; i++) fireEvent.click(minus()[0])
    expect(t).toHaveValue('0:05')
    fireEvent.change(t, { target: { value: '1:5' } })
    fireEvent.blur(t)
    expect(t).toHaveValue('1:05')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(writeGoals).toHaveBeenCalled())
    expect(writeGoals.mock.calls[0][1][0]).toMatchObject({ exerciseId: 'plank', targetWeight: 65 })
  })

  it('«Отмена» — без записи', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(writeGoals).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '+ Поставить цель' })).toBeInTheDocument()
  })

  it('правка цели с повторами: повторы подставлены; сменили — достижение сброшено', async () => {
    const goal = { exerciseId: 'bench', exerciseName: 'Жим лежа', metric: 'weight', targetWeight: 90, targetReps: 3, achievedAt: '2026-10-01' }
    vi.mocked(readGoals).mockResolvedValue([goal])
    open([goal])
    expect(screen.getByLabelText('Повторения при целевом весе (необязательно)')).toHaveValue('3')
    fireEvent.click(plus()[1])
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(writeGoals).toHaveBeenCalled())
    expect(writeGoals.mock.calls[0][1][0]).toMatchObject({ targetReps: 4, achievedAt: null })
  })
})
