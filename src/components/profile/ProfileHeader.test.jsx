// @vitest-environment jsdom
// Шапка Профиля (покрытие тестами 20.10.2026: было 50 % строк): смена имени (проверки,
// сохранение, ошибка сервера) и смена аватара (офлайн — объяснение, HEIC → обрезка →
// загрузка, сбои — тостом).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ProfileHeader from './ProfileHeader.jsx'
import { setCachedAvatar, setCachedName } from '../../db/repo.js'
import { syncNow } from '../../db/sync.js'
import { setName, LoginError } from '../../lib/auth.js'
import { cropToJpeg, toDecodableFile, uploadAvatarBlob } from '../../lib/avatar.js'
import { showToast } from '../ui/Toast.jsx'

vi.mock('../../db/repo.js', () => ({ setCachedAvatar: vi.fn(async () => {}), setCachedName: vi.fn(async () => {}) }))
vi.mock('../../db/sync.js', () => ({ syncNow: vi.fn() }))
vi.mock('../../lib/auth.js', async (orig) => ({ ...(await orig()), setName: vi.fn() }))
vi.mock('../../lib/avatar.js', () => ({ cropToJpeg: vi.fn(async () => 'jpeg'), toDecodableFile: vi.fn(), uploadAvatarBlob: vi.fn() }))
vi.mock('../ui/Toast.jsx', () => ({ showToast: vi.fn() }))
// Обрезку держит свой тест; здесь — только «Готово» и «Отмена».
vi.mock('./AvatarCropper.jsx', () => ({
  default: ({ onDone, onCancel }) => (
    <div role="dialog" aria-label="Аватар">
      <button type="button" onClick={() => onDone('img', { x: 0, y: 0, size: 10 })}>Готово</button>
      <button type="button" onClick={onCancel}>Отмена</button>
    </div>
  ),
}))

const USER = { id: 'me', name: 'Сега', role: 'member' }
const fileInput = (c) => c.querySelector('input[type="file"]')

beforeEach(() => { Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }) })
afterEach(() => vi.clearAllMocks())

describe('ProfileHeader — имя', () => {
  it('новое имя сохраняется: сервер, кэш, наверх, синк', async () => {
    vi.mocked(setName).mockResolvedValue('Серега')
    const onRenamed = vi.fn()
    render(<ProfileHeader user={USER} onRenamed={onRenamed} />)
    fireEvent.click(screen.getByRole('button', { name: 'Изменить имя' }))
    fireEvent.change(screen.getByLabelText('Новое имя'), { target: { value: '  Серега ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(onRenamed).toHaveBeenCalledWith('Серега'))
    expect(setName).toHaveBeenCalledWith('me', 'Серега')
    expect(setCachedName).toHaveBeenCalledWith('me', 'Серега')
    expect(syncNow).toHaveBeenCalledWith('me')
    expect(screen.queryByLabelText('Новое имя')).toBeNull()
  })

  it('пустое имя — подсказка без запроса; то же имя — просто закрыть', () => {
    render(<ProfileHeader user={USER} />)
    fireEvent.click(screen.getByRole('button', { name: 'Изменить имя' }))
    fireEvent.change(screen.getByLabelText('Новое имя'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Имя — от 1 до 30 символов.')
    fireEvent.change(screen.getByLabelText('Новое имя'), { target: { value: 'Сега' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(setName).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Новое имя')).toBeNull()
  })

  it('ошибка сервера — текст LoginError или общий, редактор остается', async () => {
    vi.mocked(setName).mockRejectedValueOnce(new LoginError('network', 'Нет сети — попробуй позже.'))
    render(<ProfileHeader user={USER} />)
    fireEvent.click(screen.getByRole('button', { name: 'Изменить имя' }))
    fireEvent.change(screen.getByLabelText('Новое имя'), { target: { value: 'Серега' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Нет сети — попробуй позже.')
    vi.mocked(setName).mockRejectedValueOnce(new Error('boom'))
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Не удалось сменить имя.'))
  })

  it('админ — метка «админ»', () => {
    render(<ProfileHeader user={{ ...USER, role: 'admin' }} />)
    expect(screen.getByText('админ')).toBeInTheDocument()
  })
})

describe('ProfileHeader — аватар', () => {
  it('офлайн — «Нужна сеть», фото не открываем', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    const { container } = render(<ProfileHeader user={USER} />)
    fireEvent.change(fileInput(container), { target: { files: [{ name: 'a.jpg' }] } })
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Нужна сеть' }))
    expect(toDecodableFile).not.toHaveBeenCalled()
  })

  it('фото → обрезка → «Готово» → загрузка и кэш, лист закрыт', async () => {
    vi.mocked(toDecodableFile).mockResolvedValue('decoded')
    vi.mocked(uploadAvatarBlob).mockResolvedValue('https://x/avatars/me/1.jpg')
    const { container } = render(<ProfileHeader user={USER} />)
    fireEvent.change(fileInput(container), { target: { files: [{ name: 'a.heic' }] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Готово' }))
    await waitFor(() => expect(setCachedAvatar).toHaveBeenCalledWith('me', 'https://x/avatars/me/1.jpg'))
    expect(cropToJpeg).toHaveBeenCalledWith('img', { x: 0, y: 0, size: 10 })
    expect(uploadAvatarBlob).toHaveBeenCalledWith('me', 'jpeg')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Аватар' })).toBeNull())
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Аватар обновлен' }))
  })

  it('фото не открылось / не загрузилось — тостом; «Отмена» закрывает обрезку', async () => {
    vi.mocked(toDecodableFile).mockRejectedValueOnce(new Error('HEIC'))
    const { container } = render(<ProfileHeader user={USER} />)
    fireEvent.change(fileInput(container), { target: { files: [{ name: 'a.heic' }] } })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Не удалось открыть фото' })))

    vi.mocked(toDecodableFile).mockResolvedValue('decoded')
    vi.mocked(uploadAvatarBlob).mockRejectedValueOnce(new Error('413'))
    fireEvent.change(fileInput(container), { target: { files: [{ name: 'b.jpg' }] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Готово' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Не удалось загрузить', sub: '413' })))
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(screen.queryByRole('dialog', { name: 'Аватар' })).toBeNull()
  })
})
