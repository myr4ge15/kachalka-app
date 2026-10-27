// @vitest-environment jsdom
// «Скачать все мои данные» / «Восстановить из файла» (покрытие тестами 20.10.2026: было
// 38 % строк). Ошибки — понятным тостом; чужой файл — «Не тот файл»; восстановленное онлайн
// сразу уходит синком; тот же файл можно выбрать повторно.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import BackupActions from './BackupActions.jsx'
import { exportAllMyData, importAllMyData } from '../../db/backup.js'
import { BackupError } from '../../lib/backup.js'
import { syncNow } from '../../db/sync.js'
import { showToast } from '../ui/Toast.jsx'

vi.mock('../../db/backup.js', () => ({ exportAllMyData: vi.fn(), importAllMyData: vi.fn() }))
vi.mock('../../db/sync.js', () => ({ syncNow: vi.fn() }))
vi.mock('../ui/Toast.jsx', () => ({ showToast: vi.fn() }))

const fileInput = (container) => container.querySelector('input[type="file"]')
const pick = (input, text = '{}') => fireEvent.change(input, { target: { files: [{ text: async () => text }] } })

beforeEach(() => { Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }) })
afterEach(() => vi.clearAllMocks())

describe('BackupActions', () => {
  it('выгрузка — тост с числом тренировок', async () => {
    vi.mocked(exportAllMyData).mockResolvedValue(12)
    render(<BackupActions userId="me" />)
    fireEvent.click(screen.getByRole('button', { name: /Скачать все мои данные/ }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Файл сохранен', sub: 'Тренировок в выгрузке: 12' })))
    expect(exportAllMyData).toHaveBeenCalledWith('me', expect.any(String))
  })

  it('закрыли лист «Поделиться», ничего не сохранив — без тоста (fb_6fbbaeac)', async () => {
    vi.mocked(exportAllMyData).mockResolvedValue(null)
    render(<BackupActions userId="me" />)
    const btn = screen.getByRole('button', { name: /Скачать все мои данные/ })
    fireEvent.click(btn)
    await waitFor(() => expect(btn).toBeEnabled())
    expect(showToast).not.toHaveBeenCalled()
  })

  it('выгрузка упала — «Не удалось выгрузить», кнопка снова доступна', async () => {
    vi.mocked(exportAllMyData).mockRejectedValue(new Error('quota'))
    render(<BackupActions userId="me" />)
    const btn = screen.getByRole('button', { name: /Скачать все мои данные/ })
    fireEvent.click(btn)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Не удалось выгрузить', sub: 'quota' })))
    await waitFor(() => expect(btn).toBeEnabled())
  })

  it('восстановление: тост с итогом, онлайн — сразу синк, поле очищено для повтора', async () => {
    vi.mocked(importAllMyData).mockResolvedValue({ workouts: 3, goals: 1, failed: 0 })
    const { container } = render(<BackupActions userId="me" />)
    const input = fileInput(container)
    pick(input, '{"schema":1}')
    await waitFor(() => expect(importAllMyData).toHaveBeenCalledWith('me', '{"schema":1}'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Восстановлено' })))
    expect(syncNow).toHaveBeenCalledWith('me')
    expect(input.value).toBe('')
  })

  it('часть записей не встала — второй тост; офлайн — без синка', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    vi.mocked(importAllMyData).mockResolvedValue({ workouts: 1, failed: 2 })
    const { container } = render(<BackupActions userId="me" />)
    pick(fileInput(container))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Часть записей пропущена', sub: 'Не удалось добавить: 2' })))
    expect(syncNow).not.toHaveBeenCalled()
  })

  it('чужой или битый файл — «Не тот файл»; прочая ошибка — «Не удалось восстановить»', async () => {
    vi.mocked(importAllMyData).mockRejectedValueOnce(new BackupError('Файл принадлежит другому пользователю.'))
    const { container } = render(<BackupActions userId="me" />)
    pick(fileInput(container))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Не тот файл', sub: 'Файл принадлежит другому пользователю.' })))
    vi.mocked(importAllMyData).mockRejectedValueOnce(new Error('DatabaseClosedError'))
    pick(fileInput(container))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Не удалось восстановить' })))
  })

  it('выбор отменили (файла нет) — ничего не делаем', () => {
    const { container } = render(<BackupActions userId="me" />)
    fireEvent.change(fileInput(container), { target: { files: [] } })
    expect(importAllMyData).not.toHaveBeenCalled()
  })
})
