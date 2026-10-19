// @vitest-environment jsdom
// «Друзья» (v8.9.0+): с v9.0.0 видимость держится только на друзьях и кругах — экран и его
// блоки (components/friends/*) раньше не рендерил ни один тест (покрытие тестами 19.10.2026).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import FriendsScreen from './FriendsScreen.jsx'

const api = vi.hoisted(() => ({}))
const live = vi.hoisted(() => ({ rows: [] }))
const sync = vi.hoisted(() => ({ online: true }))
vi.mock('../lib/friends.js', async (orig) => ({ ...(await orig()), friendsApi: () => api }))
vi.mock('../db/friends.js', () => ({ getFriends: vi.fn(), refreshFriends: vi.fn(async () => live.rows) }))
vi.mock('../db/sync.js', () => ({ syncNow: vi.fn(), useSyncStatus: () => ({ online: sync.online }) }))
vi.mock('../db/disciplines.js', () => ({ invalidateRatingCache: vi.fn(async () => {}) }))
vi.mock('../hooks/usePresence.js', () => ({ usePresence: () => new Map(), useRosterSex: () => new Map() }))
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => live.rows }))
vi.mock('../components/ui/Toast.jsx', () => ({ showToast: vi.fn() }))

const ME = { id: 'me', name: 'Сега' }
const ROWS = [
  { user_id: 'u1', name: 'Маша', state: 'friend' },
  { user_id: 'u2', name: 'Петя', state: 'incoming' },
  { user_id: 'u3', name: 'Оля', state: 'outgoing' },
  { user_id: 'u4', name: 'Вася', state: 'blocked' },
]

function setOnline(v) {
  sync.online = v
  Object.defineProperty(navigator, 'onLine', { value: v, configurable: true })
}

beforeEach(() => {
  setOnline(true)
  live.rows = ROWS
  Object.assign(api, {
    respond: vi.fn(async () => 'ok'),
    cancel: vi.fn(async () => 'ok'),
    remove: vi.fn(async () => 'ok'),
    block: vi.fn(async () => 'ok'),
    unblock: vi.fn(async () => 'ok'),
    myCode: vi.fn(async () => ({ code: '7F3Q9XWD' })),
    preview: vi.fn(async () => ({ status: 'ok', inviter_name: 'Маша' })),
    acceptCode: vi.fn(async () => ({ status: 'ok' })),
  })
})
afterEach(() => vi.clearAllMocks())

const renderScreen = (props = {}) =>
  render(<FriendsScreen user={ME} onBack={vi.fn()} onOpenMember={vi.fn()} {...props} />)

describe('FriendsScreen — списки', () => {
  it('входящие сверху, друзья, мои заявки, заблокированные', async () => {
    renderScreen()
    expect(screen.getByText('Хотят дружить · 1')).toBeInTheDocument()
    expect(screen.getByText('Друзья · 1')).toBeInTheDocument()
    expect(screen.getByText('Мои заявки')).toBeInTheDocument()
    expect(screen.getByText('ждет ответа')).toBeInTheDocument()
    expect(screen.getByText('Заблокированные')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Разблокировать' })).toBeInTheDocument()
    // при входе список перечитывается с сервера
    const { refreshFriends } = await import('../db/friends.js')
    await waitFor(() => expect(refreshFriends).toHaveBeenCalledWith('me'))
  })

  it('пусто — подсказка про «Добавить друга», без подписи «Друзья · 0»', () => {
    live.rows = []
    renderScreen()
    expect(screen.getByText(/Пока никого/)).toBeInTheDocument()
    expect(screen.queryByText(/Друзья ·/)).toBeNull()
  })

  it('снимка еще нет — «Загружаю…»', () => {
    live.rows = undefined
    renderScreen()
    expect(screen.getByRole('status')).toHaveTextContent('Загружаю…')
  })

  it('принять и отклонить заявку → fr_respond, затем синк и сброс кэша рейтингов', async () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Принять' }))
    await waitFor(() => expect(api.respond).toHaveBeenCalledWith('u2', true))
    const { syncNow } = await import('../db/sync.js')
    const { invalidateRatingCache } = await import('../db/disciplines.js')
    await waitFor(() => expect(syncNow).toHaveBeenCalledWith('me'))
    expect(invalidateRatingCache).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Нет' }))
    await waitFor(() => expect(api.respond).toHaveBeenCalledWith('u2', false))
  })

  it('отозвать свою заявку и разблокировать', async () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Отозвать' }))
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('u3'))
    fireEvent.click(screen.getByRole('button', { name: 'Разблокировать' }))
    await waitFor(() => expect(api.unblock).toHaveBeenCalledWith('u4'))
  })

  it('«⋯» друга: удалить и заблокировать — только со второго нажатия', async () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Действия: Маша' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить из друзей' }))
    expect(api.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Точно удалить из друзей?' }))
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('u1'))

    fireEvent.click(screen.getByRole('button', { name: 'Действия: Маша' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Заблокировать' }))
    expect(api.block).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Точно заблокировать?' }))
    await waitFor(() => expect(api.block).toHaveBeenCalledWith('u1'))
  })

  it('тап по другу и «Открыть профиль» ведут в профиль участника', () => {
    const onOpenMember = vi.fn()
    renderScreen({ onOpenMember })
    fireEvent.click(screen.getByRole('button', { name: /^Маша/ }))
    expect(onOpenMember).toHaveBeenCalledWith('u1')
    fireEvent.click(screen.getByRole('button', { name: 'Действия: Маша' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Открыть профиль' }))
    expect(onOpenMember).toHaveBeenCalledTimes(2)
  })

  it('ошибка сервера — баннер с текстом, список на месте', async () => {
    api.respond.mockRejectedValueOnce(new Error('Слишком часто — попробуй завтра.'))
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Принять' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Слишком часто')
    expect(screen.getByText('Друзья · 1')).toBeInTheDocument()
  })

  it('офлайн — плашка, без «Добавить друга», список из снимка виден', () => {
    setOnline(false)
    renderScreen()
    expect(screen.getByText('Изменить друзей можно только с интернетом.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Добавить друга' })).toBeNull()
    expect(screen.getByText('Друзья · 1')).toBeInTheDocument()
  })
})

describe('FriendsScreen — коды дружбы', () => {
  it('«Добавить друга»: мой код крупно, «Новый код» — с подтверждением', async () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить друга' }))
    const dialog = await screen.findByRole('dialog', { name: 'Добавить друга' })
    expect(await within(dialog).findByTestId('fr-code')).toHaveTextContent('7F3Q-9XWD')
    expect(api.myCode).toHaveBeenCalledWith(false)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Новый код' }))
    expect(within(dialog).getByText(/Старый код сразу перестанет работать/)).toBeInTheDocument()
    api.myCode.mockResolvedValueOnce({ code: 'ABCD2345' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Да, новый код' }))
    await waitFor(() => expect(within(dialog).getByTestId('fr-code')).toHaveTextContent('ABCD-2345'))
    expect(api.myCode).toHaveBeenLastCalledWith(true)
  })

  it('ввод кода друга: проверить → «Маша зовет тебя в друзья» → Принять → «Теперь вы друзья»', async () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить друга' }))
    const dialog = await screen.findByRole('dialog', { name: 'Добавить друга' })
    fireEvent.change(within(dialog).getByLabelText('Код друга'), { target: { value: 'k7m2-p9qx' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Проверить' }))
    expect(await within(dialog).findByText(/зовет тебя в друзья/)).toHaveTextContent('Маша зовет тебя в друзья')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Принять' }))
    expect(await within(dialog).findByText('Теперь вы друзья 🎉')).toBeInTheDocument()
    expect(api.acceptCode).toHaveBeenCalledWith('k7m2-p9qx')
  })

  it('неверный код — один понятный ответ, без превью', async () => {
    api.preview.mockResolvedValueOnce({ status: 'invalid' })
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить друга' }))
    const dialog = await screen.findByRole('dialog', { name: 'Добавить друга' })
    fireEvent.change(within(dialog).getByLabelText('Код друга'), { target: { value: 'ZZZZ-ZZZZ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Проверить' }))
    expect(await within(dialog).findByText(/Код не подходит/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Принять' })).toBeNull()
  })

  it('ссылка #friend=… — превью сразу, после «Принять» код из ссылки погашен', async () => {
    const onFriendCodeConsumed = vi.fn()
    renderScreen({ friendCode: '7F3Q9XWD', onFriendCodeConsumed })
    const invite = await screen.findByText(/зовет тебя в друзья/)
    expect(api.preview).toHaveBeenCalledWith('7F3Q9XWD')
    // «Принять» есть и у входящей заявки Пети — берем кнопку из самого превью.
    fireEvent.click(within(invite.parentElement).getByRole('button', { name: 'Принять' }))
    await waitFor(() => expect(api.acceptCode).toHaveBeenCalledWith('7F3Q-9XWD'))
    await waitFor(() => expect(onFriendCodeConsumed).toHaveBeenCalled())
  })
})
