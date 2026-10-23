// @vitest-environment jsdom
// Кнопка дружбы в профиле участника и пункт меню «⋯» в «Моем круге» (покрытие тестами
// 20.10.2026: было 45 % строк). Кнопка — только когда есть действие; остальное — подписью.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import FriendButton from './FriendButton.jsx'
import { refreshFriends } from '../../db/friends.js'
import { showToast } from '../ui/Toast.jsx'

const live = vi.hoisted(() => ({ rows: [] }))
const api = vi.hoisted(() => ({}))
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => live.rows }))
vi.mock('../../db/friends.js', () => ({ getFriends: vi.fn(), refreshFriends: vi.fn(async () => []) }))
vi.mock('../../lib/friends.js', async (orig) => ({ ...(await orig()), friendsApi: () => api }))
vi.mock('../ui/Toast.jsx', () => ({ showToast: vi.fn() }))

const rows = (state) => [{ user_id: 'u2', name: 'Маша', state }]

beforeEach(() => {
  live.rows = []
  Object.assign(api, { request: vi.fn(async () => 'requested'), respond: vi.fn(async () => 'ok') })
})
afterEach(() => vi.clearAllMocks())

describe('FriendButton — кнопка в профиле', () => {
  it('нет связи — «+ В друзья» → заявка, тост, список перечитан', async () => {
    render(<FriendButton me="me" memberId="u2" />)
    fireEvent.click(screen.getByRole('button', { name: '+ В друзья' }))
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('u2'))
    await waitFor(() => expect(refreshFriends).toHaveBeenCalledWith('me'))
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ emoji: '👋' }))
  })

  it('входящая заявка — «Принять заявку в друзья» → ответ «да», тост 🤝', async () => {
    live.rows = rows('incoming')
    render(<FriendButton me="me" memberId="u2" />)
    fireEvent.click(screen.getByRole('button', { name: 'Принять заявку в друзья' }))
    await waitFor(() => expect(api.respond).toHaveBeenCalledWith('u2', true))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ emoji: '🤝' })))
  })

  it('уже друзья / заявка отправлена / заблокирован — кнопки нет', () => {
    for (const s of ['friend', 'outgoing', 'blocked']) {
      live.rows = rows(s)
      const { container, unmount } = render(<FriendButton me="me" memberId="u2" />)
      expect(container).toBeEmptyDOMElement()
      unmount()
    }
  })

  it('свой профиль, нет участника, снимок еще грузится — ничего', () => {
    const cases = [{ memberId: 'me' }, { memberId: null }]
    for (const props of cases) {
      const { container, unmount } = render(<FriendButton me="me" {...props} />)
      expect(container).toBeEmptyDOMElement()
      unmount()
    }
    live.rows = undefined
    const { container } = render(<FriendButton me="me" memberId="u2" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('ошибка сервера — тост с текстом, кнопка снова доступна', async () => {
    api.request.mockRejectedValue(new Error('Слишком часто — попробуй завтра.'))
    render(<FriendButton me="me" memberId="u2" />)
    fireEvent.click(screen.getByRole('button', { name: '+ В друзья' }))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Слишком часто — попробуй завтра.' })))
    expect(screen.getByRole('button', { name: '+ В друзья' })).toBeEnabled()
  })
})

describe('FriendButton — подпись и меню', () => {
  it('label: подпись под именем по состоянию, без связи — ничего', () => {
    live.rows = rows('friend')
    const { rerender, container } = render(<FriendButton me="me" memberId="u2" label />)
    expect(screen.getByText('в друзьях')).toBeInTheDocument()
    live.rows = rows('outgoing')
    rerender(<FriendButton me="me" memberId="u2" label />)
    expect(screen.getByText('заявка в друзья отправлена')).toBeInTheDocument()
    live.rows = []
    rerender(<FriendButton me="me" memberId="u2" label />)
    expect(container).toBeEmptyDOMElement()
  })

  it('compact: пункт меню — «+ В друзья» / «Принять в друзья»; друзья — полная подпись', async () => {
    const { rerender } = render(<FriendButton me="me" memberId="u2" compact />)
    fireEvent.click(screen.getByRole('menuitem', { name: '+ В друзья' }))
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('u2'))
    live.rows = rows('incoming')
    rerender(<FriendButton me="me" memberId="u2" compact />)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Принять в друзья' }))
    await waitFor(() => expect(api.respond).toHaveBeenCalledWith('u2', true))
    live.rows = rows('friend')
    rerender(<FriendButton me="me" memberId="u2" compact />)
    expect(screen.getByText('Уже друзья')).toBeInTheDocument()
    live.rows = rows('blocked')
    rerender(<FriendButton me="me" memberId="u2" compact />)
    expect(screen.queryByRole('menuitem')).toBeNull()
  })
})
