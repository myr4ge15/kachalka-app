// @vitest-environment jsdom
// Опасные блоки Профиля (покрытие тестами 20.10.2026): «Застрявшие изменения» (dead-letter)
// и «Удалить мои данные». Потеря правок — только со второго нажатия; ошибка — тостом;
// после действия онлайн — синк, офлайн — без него.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import DeadLetterAlert from './DeadLetterAlert.jsx'
import DeleteMyData from './DeleteMyData.jsx'
import { retryDeadLetter, discardDeadLetter, softDeleteMyWorkouts } from '../../db/repo.js'
import { syncNow } from '../../db/sync.js'
import { showToast } from '../ui/Toast.jsx'

const live = vi.hoisted(() => ({ dead: 2 }))
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => live.dead }))
vi.mock('../../db/repo.js', () => ({
  deadLetterCount: vi.fn(), retryDeadLetter: vi.fn(), discardDeadLetter: vi.fn(), softDeleteMyWorkouts: vi.fn(),
}))
vi.mock('../../db/sync.js', () => ({ syncNow: vi.fn() }))
vi.mock('../ui/Toast.jsx', () => ({ showToast: vi.fn() }))

const online = (v) => Object.defineProperty(navigator, 'onLine', { value: v, configurable: true })
beforeEach(() => { live.dead = 2; online(true) })
afterEach(() => vi.clearAllMocks())

describe('DeadLetterAlert', () => {
  it('нет застрявших — блока нет', () => {
    live.dead = 0
    const { container } = render(<DeadLetterAlert userId="me" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('повторить: операции вернулись в очередь, тост, синк', async () => {
    vi.mocked(retryDeadLetter).mockResolvedValue(2)
    render(<DeadLetterAlert userId="me" />)
    expect(screen.getByText(/Не удалось отправить изменений: 2/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить отправку' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Повторная отправка', sub: 'Операций в очереди: 2' })))
    expect(syncNow).toHaveBeenCalledWith('me')
  })

  it('отклонить — только со второго нажатия; «Отмена» ничего не теряет', async () => {
    vi.mocked(discardDeadLetter).mockResolvedValue(2)
    render(<DeadLetterAlert userId="me" />)
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(discardDeadLetter).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, отклонить (потерять правки)' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Изменения отклонены', sub: 'Удалено операций: 2' })))
  })

  it('ошибка — тост «Не удалось»; офлайн — без синка', async () => {
    online(false)
    vi.mocked(retryDeadLetter).mockRejectedValueOnce(new Error('DatabaseClosed'))
    vi.mocked(discardDeadLetter).mockResolvedValue(1)
    render(<DeadLetterAlert userId="me" />)
    fireEvent.click(screen.getByRole('button', { name: 'Повторить отправку' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Не удалось', sub: 'DatabaseClosed' })))
    fireEvent.click(await screen.findByRole('button', { name: 'Отклонить' }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, отклонить (потерять правки)' }))
    await waitFor(() => expect(discardDeadLetter).toHaveBeenCalled())
    expect(syncNow).not.toHaveBeenCalled()
    vi.mocked(discardDeadLetter).mockRejectedValueOnce(new Error('x'))
    fireEvent.click(await screen.findByRole('button', { name: 'Отклонить' }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, отклонить (потерять правки)' }))
    await waitFor(() => expect(showToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Не удалось', sub: 'x' })))
  })
})

describe('DeleteMyData', () => {
  it('удаление — только после подтверждения, тост с числом, синк удалений', async () => {
    vi.mocked(softDeleteMyWorkouts).mockResolvedValue(7)
    render(<DeleteMyData userId="me" />)
    fireEvent.click(screen.getByRole('button', { name: 'Удалить мои данные' }))
    expect(screen.getByText(/Отменить это нельзя/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(softDeleteMyWorkouts).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Удалить мои данные' }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, удалить' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Данные удалены', sub: 'Помечено тренировок: 7' })))
    expect(syncNow).toHaveBeenCalledWith('me')
  })

  it('удалять нечего / ошибка — свои тексты; офлайн — без синка', async () => {
    online(false)
    vi.mocked(softDeleteMyWorkouts).mockResolvedValueOnce(0).mockRejectedValueOnce(new Error('boom'))
    render(<DeleteMyData userId="me" />)
    fireEvent.click(screen.getByRole('button', { name: 'Удалить мои данные' }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, удалить' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ sub: 'Удалять было нечего.' })))
    fireEvent.click(await screen.findByRole('button', { name: 'Удалить мои данные' }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, удалить' }))
    await waitFor(() => expect(showToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Не удалось удалить', sub: 'boom' })))
    expect(syncNow).not.toHaveBeenCalled()
  })
})
