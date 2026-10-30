// @vitest-environment jsdom
// Настройки круга для владельца (покрытие тестами 20.10.2026: было 47 % строк): название,
// автоприем, отзыв живых кодов, дисциплины рейтинга круга, удаление — только со второго шага.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import CircleOwnerSettings from './CircleOwnerSettings.jsx'
import { invalidateRatingCache } from '../../db/disciplines.js'

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => [
    { id: 'bench', name: 'Жим лежа', metric: 'weight' },
    { id: 'squat', name: 'Присед', metric: 'weight' },
    { id: 'run', name: 'Бег', metric: 'distance' },
    { id: 'mine', name: 'Свое', metric: 'weight', is_custom: true },
  ],
}))
vi.mock('../../db/repo.js', () => ({ getExercises: vi.fn() }))
vi.mock('../../db/disciplines.js', () => ({ invalidateRatingCache: vi.fn(async () => {}) }))

const CIRCLE = { circle_id: 'c1', name: 'Зал', auto_approve: true }
let api
beforeEach(() => {
  api = {
    codes: vi.fn(async () => [{ code_id: 'k1', holder_name: 'Маша', uses: 2, max_uses: 10, expires_at: '2026-10-25T12:00:00Z' }]),
    disciplines: vi.fn(async () => [{ id: 'd1', exercise_id: 'bench', name: 'Жим лежа', enabled: true, split_by_sex: false }]),
    rename: vi.fn(async () => 'ok'),
    setAutoApprove: vi.fn(async () => 'ok'),
    revokeCode: vi.fn(async () => 'ok'),
    saveDiscipline: vi.fn(async () => 'ok'),
    remove_circle: vi.fn(async () => 'ok'),
  }
})
afterEach(() => vi.clearAllMocks())

const renderIt = (props = {}) => {
  const view = render(<CircleOwnerSettings api={api} circle={CIRCLE} onChanged={vi.fn()} onDeleted={vi.fn()} {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Настройки круга' }))
  return view
}

describe('CircleOwnerSettings', () => {
  it('переименование: «Сохранить» только при изменении, затем onChanged', async () => {
    const onChanged = vi.fn()
    renderIt({ onChanged })
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Наш зал' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(api.rename).toHaveBeenCalledWith('c1', 'Наш зал'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('автоприем выключается чекбоксом', async () => {
    renderIt()
    fireEvent.click(screen.getByRole('checkbox', { name: /Принимать по коду сразу/ }))
    await waitFor(() => expect(api.setAutoApprove).toHaveBeenCalledWith('c1', false))
  })

  it('живые коды: список, отзыв, после — перечитан; пусто — подпись', async () => {
    renderIt()
    expect(await screen.findByText('Маша')).toBeInTheDocument()
    api.codes.mockResolvedValue([])
    fireEvent.click(screen.getByRole('button', { name: 'Отозвать код Маша' }))
    expect(api.revokeCode).not.toHaveBeenCalled() // со второго тапа (UI-ревью 23.10)
    fireEvent.click(screen.getByRole('button', { name: 'Точно отозвать код Маша?' }))
    await waitFor(() => expect(api.revokeCode).toHaveBeenCalledWith('k1'))
    expect(await screen.findByText('Сейчас ни у кого нет живого кода.')).toBeInTheDocument()
  })

  it('дисциплины: выключить, «по полу», добавить из общего каталога (без своих и дистанции)', async () => {
    renderIt()
    await screen.findByText('Жим лежа')
    const select = screen.getByLabelText('Добавить дисциплину')
    expect([...select.options].map((o) => o.value)).toEqual(['', 'squat']) // жим уже есть, бег и свое — нет
    fireEvent.click(screen.getByRole('checkbox', { name: 'по полу' }))
    await waitFor(() => expect(api.saveDiscipline).toHaveBeenCalledWith('c1', 'bench', true, true))
    expect(invalidateRatingCache).toHaveBeenCalled()
    fireEvent.change(select, { target: { value: 'squat' } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() => expect(api.saveDiscipline).toHaveBeenLastCalledWith('c1', 'squat', true, true))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Жим лежа' }))
    await waitFor(() => expect(api.saveDiscipline).toHaveBeenLastCalledWith('c1', 'bench', false, false))
  })

  it('удаление круга — только со второго шага, отмена ничего не удаляет', async () => {
    const onDeleted = vi.fn()
    renderIt({ onDeleted })
    fireEvent.click(screen.getByRole('button', { name: 'Удалить круг' }))
    expect(screen.getByText(/Удалить круг «Зал»\?/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(api.remove_circle).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Удалить круг' }))
    const confirm = screen.getByText(/Удалить круг «Зал»\?/).parentElement
    fireEvent.click(within(confirm).getByRole('button', { name: 'Удалить круг' }))
    await waitFor(() => expect(api.remove_circle).toHaveBeenCalledWith('c1'))
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
  })

  it('ошибки сервера — текст в alert, не падаем', async () => {
    api.codes.mockRejectedValue(new Error('Нет доступа'))
    api.disciplines.mockRejectedValue(new Error('«Мой круг» пока недоступен'))
    renderIt()
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.map((a) => a.textContent).join(' ')).toMatch(/Нет доступа/)
    api.rename.mockRejectedValue(new Error('Название — от 1 до 40 символов.'))
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/от 1 до 40/))
  })
})

describe('CircleOwnerSettings: аккордеон', () => {
  it('свернут, пока не нажали, и повторное нажатие сворачивает', () => {
    render(<CircleOwnerSettings api={api} circle={CIRCLE} onChanged={vi.fn()} onDeleted={vi.fn()} />)
    const row = screen.getByRole('button', { name: 'Настройки круга' })
    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByLabelText('Название')).not.toBeVisible()
    fireEvent.click(row)
    expect(screen.getByLabelText('Название')).toBeVisible()
    fireEvent.click(row)
    expect(screen.getByLabelText('Название')).not.toBeVisible()
  })
})
