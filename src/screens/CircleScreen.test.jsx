// @vitest-environment jsdom
// «Мой круг»: пусто → создать; вступить по коду (превью → вступить); владелец видит
// заявки и настройки, участник — «Выйти»; ссылка #join=… сразу показывает превью.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CircleScreen from './CircleScreen.jsx'
import { showToast } from '../components/ui/Toast.jsx'

const api = vi.hoisted(() => ({}))
vi.mock('../lib/friendCircles.js', async (orig) => ({ ...(await orig()), circleApi: () => api }))
vi.mock('../db/circles.js', () => ({ refreshMyCircles: vi.fn(), getMyCircles: vi.fn(async () => null) }))
vi.mock('../db/sync.js', () => ({ syncNow: vi.fn(), useSyncStatus: () => ({ online: true }) }))
vi.mock('../db/disciplines.js', () => ({ invalidateRatingCache: vi.fn(async () => {}) }))
vi.mock('../db/repo.js', () => ({ getExercises: async () => [] }))
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (fn, deps, def) => def }))
vi.mock('../components/ui/Toast.jsx', () => ({ showToast: vi.fn() }))

const ME = { id: 'me', name: 'Сега' }
const OWN = { circle_id: 'c1', name: 'Зал', is_owner: true, my_status: 'active', auto_approve: true, owner_name: 'Сега', members: 2, pending: 1 }
const OTHER = { circle_id: 'c2', name: 'Бег', is_owner: false, my_status: 'active', auto_approve: true, owner_name: 'Маша', members: 3, pending: 0 }

beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  Object.assign(api, {
    myCircles: vi.fn(async () => []),
    create: vi.fn(async () => 'c1'),
    preview: vi.fn(async () => ({ status: 'ok', circle_name: 'Бег', inviter_name: 'Маша' })),
    join: vi.fn(async () => ({ status: 'active', circle_id: 'c2' })),
    myCode: vi.fn(async () => ({ code: '7F3Q9XWD', expires_at: '2026-10-14T12:00:00Z', uses: 1, max_uses: 10 })),
    members: vi.fn(async () => [
      { user_id: 'me', name: 'Сега', status: 'active', is_owner: true },
      { user_id: 'u2', name: 'Маша', status: 'active', is_owner: false, invited_by_name: 'Сега' },
      { user_id: 'u3', name: 'Петя', status: 'pending', is_owner: false, invited_by_name: 'Маша' },
    ]),
    decide: vi.fn(async () => 'ok'),
    codes: vi.fn(async () => []),
    disciplines: vi.fn(async () => []),
    leave: vi.fn(async () => 'ok'),
  })
})
afterEach(() => vi.clearAllMocks())

describe('CircleScreen', () => {
  it('пока идет запрос — круги из локального снимка, без пустого экрана (v8.0.1)', async () => {
    const { getMyCircles } = await import('../db/circles.js')
    getMyCircles.mockResolvedValueOnce([OTHER])
    api.myCircles.mockImplementation(() => new Promise(() => {})) // сеть «висит»
    render(<CircleScreen user={ME} onBack={vi.fn()} />)
    expect(await screen.findByText(/Бег/)).toBeInTheDocument()
  })

  it('нет кругов — объяснение, «Создать свой круг», «Вступить по коду»', async () => {
    render(<CircleScreen user={ME} onBack={vi.fn()} />)
    expect(await screen.findByText(/свои люди/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Создать свой круг' }))
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Зал' } })
    api.myCircles.mockResolvedValue([{ ...OWN, members: 1 }])
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }))
    await waitFor(() => expect(api.create).toHaveBeenCalledWith('Зал'))
    expect(await screen.findByTestId('fc-code')).toHaveTextContent('7F3Q-9XWD')
  })

  it('вступить по коду: проверить → превью → вступить', async () => {
    render(<CircleScreen user={ME} onBack={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('Вступить по коду'), { target: { value: '7f3q9xwd' } })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }))
    expect(await screen.findByText(/зовет в круг/)).toHaveTextContent('Маша зовет в круг «Бег»')
    fireEvent.click(screen.getByRole('button', { name: 'Вступить' }))
    expect(await screen.findByText('Ты в круге 🎉')).toBeInTheDocument()
    expect(api.join).toHaveBeenCalledWith('7f3q9xwd')
  })

  it('мусорный код — отказ без запроса', async () => {
    render(<CircleScreen user={ME} onBack={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('Вступить по коду'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }))
    expect(await screen.findByText(/Код не подходит/)).toBeInTheDocument()
    expect(api.preview).not.toHaveBeenCalled()
  })

  it('владелец: заявки (принять), «кто кого привел», настройки; своего круга второй раз не создать', async () => {
    api.myCircles.mockResolvedValue([OWN])
    render(<CircleScreen user={ME} onBack={vi.fn()} />)
    expect(await screen.findByText('Хотят в круг')).toBeInTheDocument()
    expect(screen.queryByText('Пришел(а) по коду Сега')).toBeNull()
    const actions = screen.getByRole('button', { name: 'Действия: Маша' })
    fireEvent.click(actions)
    expect(actions).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Пришел(а) по коду Сега')).toBeInTheDocument()
    fireEvent.click(actions)
    expect(actions).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Пришел(а) по коду Сега')).toBeNull()
    expect(screen.getByText('Настройки круга')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Создать свой круг' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Принять' }))
    await waitFor(() => expect(api.decide).toHaveBeenCalledWith('c1', 'u3', true))
  })

  it('участник чужого круга: «Выйти из круга» в два нажатия; круги переключаются', async () => {
    api.myCircles.mockResolvedValue([OWN, OTHER])
    render(<CircleScreen user={ME} onBack={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Бег' }))
    expect(await screen.findByText('круг Маша · 3 участника')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Выйти из круга' }))
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }))
    await waitFor(() => expect(api.leave).toHaveBeenCalledWith('c2'))
  })

  it('ссылка #join=… — сразу превью', async () => {
    render(<CircleScreen user={ME} onBack={vi.fn()} joinCode="7F3Q9XWD" onJoinCodeConsumed={vi.fn()} />)
    expect(await screen.findByText(/зовет в круг/)).toBeInTheDocument()
    expect(api.preview).toHaveBeenCalledWith('7F3Q9XWD')
  })

  it('ссылка #join=… — после «Вступить» код погашен, итог показан тостом (UI-ревью 23.10)', async () => {
    const onJoinCodeConsumed = vi.fn()
    render(<CircleScreen user={ME} onBack={vi.fn()} joinCode="7F3Q9XWD" onJoinCodeConsumed={onJoinCodeConsumed} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Вступить' }))
    await waitFor(() => expect(onJoinCodeConsumed).toHaveBeenCalled())
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Ты в круге 🎉' }))
  })
})

describe('CircleScreen: потянуть вниз', () => {
  it('колесико на экране, жест перечитывает круги и участников', async () => {
    api.myCircles.mockResolvedValue([OWN])
    const box = document.createElement('div')
    box.className = 'content'
    const host = document.createElement('div')
    box.appendChild(host)
    document.body.appendChild(box)
    const { container } = render(<CircleScreen user={ME} onBack={vi.fn()} />, { container: host })
    await waitFor(() => expect(api.members).toHaveBeenCalled())
    expect(container.querySelector('.ptr')).not.toBeNull()
    const circles = api.myCircles.mock.calls.length
    const members = api.members.mock.calls.length
    fireEvent.touchStart(box, { touches: [{ clientX: 0, clientY: 0 }] })
    fireEvent.touchMove(box, { touches: [{ clientX: 0, clientY: 300 }] })
    fireEvent.touchEnd(box, { changedTouches: [{ clientX: 0, clientY: 300 }] })
    await waitFor(() => expect(api.members.mock.calls.length).toBeGreaterThan(members))
    expect(api.myCircles.mock.calls.length).toBeGreaterThan(circles)
    box.remove()
  })
})
