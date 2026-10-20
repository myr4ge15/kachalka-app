// @vitest-environment jsdom
// Профиль (покрытие тестами 20.10.2026: было 72 % строк): переходы из Профиля и Настроек,
// свой пол (оптимистично, откат с текстом ошибки), место в рейтинге своего борда, метки
// «заявки в друзья» и «ответ разработчика», тумблер рекомендаций прогрессии.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useRef, useState } from 'react'
import ProfileScreen from './ProfileScreen.jsx'
import * as repo from '../db/repo.js'
import * as auth from '../lib/auth.js'
import { getCachedLeaderboard } from '../db/leaderboard.js'
import { myUnreadReplies } from '../lib/feedbackApi.js'
import { getFriends } from '../db/friends.js'

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (fn, deps = [], fallback) => {
    const [v, setV] = useState(fallback)
    useEffect(() => {
      let alive = true
      Promise.resolve(fn()).then((x) => { if (alive) setV(x) }, () => {})
      return () => { alive = false }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps)
    return v
  },
}))
vi.mock('../hooks/usePushToggle.js', () => ({ usePushToggle: () => ({ availability: 'ok', enabled: true }) }))
vi.mock('../db/sync.js', () => ({ syncNow: vi.fn() }))
vi.mock('../components/ui/Toast.jsx', () => ({ showToast: vi.fn() }))
vi.mock('../components/social/MemberInvites.jsx', () => ({ default: () => null }))
vi.mock('../lib/feedbackApi.js', () => ({ myUnreadReplies: vi.fn(async () => 0) }))
vi.mock('../db/leaderboard.js', () => ({ getCachedLeaderboard: vi.fn(async () => ({})) }))
vi.mock('../db/friends.js', () => ({ getFriends: vi.fn(async () => []) }))
vi.mock('../lib/avatar.js', () => ({ uploadMyAvatar: vi.fn() }))
vi.mock('../db/backup.js', () => ({ exportAllMyData: vi.fn(), importAllMyData: vi.fn() }))
vi.mock('../db/notifications.js', () => ({ readGoals: vi.fn(async () => []), writeGoals: vi.fn(async () => {}) }))
vi.mock('../db/repo.js', () => ({
  getWorkouts: vi.fn(async () => []),
  getCachedUser: vi.fn(async () => ({ id: 'me', name: 'Тест', sex: null })),
  setCachedAvatar: vi.fn(), setCachedName: vi.fn(async () => {}), setCachedSex: vi.fn(async () => {}),
  softDeleteMyWorkouts: vi.fn(async () => 0),
  deadLetterCount: vi.fn(async () => 0), retryDeadLetter: vi.fn(), discardDeadLetter: vi.fn(),
  getProgSettings: vi.fn(async () => ({ enabled: true })),
  setProgEnabled: vi.fn(),
  getPrivacyFlag: vi.fn(async () => false),
}))
vi.mock('../lib/auth.js', async (orig) => ({
  ...(await orig()), setSex: vi.fn(), getMyLogin: vi.fn(async () => 'me'), setPin: vi.fn(), setName: vi.fn(),
}))

const BENCH = { id: 'ex1', name: 'Жим лежа', muscle_group: 'грудь', metric: 'weight', is_bench_lift: true }
const WORKOUT = { id: 'w1', user_id: 'me', performed_at: '2026-10-01T10:00:00Z', entries: [{ exercise_id: 'ex1', exercise: BENCH, sets: [{ weight: 80, reps: 5 }] }] }

function Harness(props) {
  const contentRef = useRef(null)
  return <main className="content" ref={contentRef}><ProfileScreen user={{ id: 'me', name: 'Тест', role: 'member' }} contentRef={contentRef} {...props} /></main>
}
const openSettings = async () => fireEvent.click(await screen.findByRole('button', { name: 'Настройки' }))

beforeEach(() => { Element.prototype.scrollTo = vi.fn(); Element.prototype.scrollIntoView = vi.fn() })
afterEach(() => vi.clearAllMocks())

describe('Профиль — переходы и метки', () => {
  it('Друзья (с числом заявок), Мой круг, «Написать разработчику» (метка «ответ»)', async () => {
    vi.mocked(getFriends).mockResolvedValue([{ user_id: 'u2', state: 'incoming' }, { user_id: 'u3', state: 'incoming' }])
    vi.mocked(myUnreadReplies).mockResolvedValue(1)
    const on = { onOpenFriends: vi.fn(), onOpenCircle: vi.fn(), onOpenFeedback: vi.fn() }
    render(<Harness {...on} />)
    const friends = await screen.findByRole('button', { name: /Друзья/ })
    await waitFor(() => expect(friends).toHaveTextContent('2'))
    fireEvent.click(friends)
    fireEvent.click(screen.getByRole('button', { name: /Мой круг/ }))
    const fb = screen.getByRole('button', { name: /Написать разработчику/ })
    await waitFor(() => expect(fb).toHaveTextContent('ответ'))
    fireEvent.click(fb)
    expect(on.onOpenFriends).toHaveBeenCalled()
    expect(on.onOpenCircle).toHaveBeenCalled()
    expect(on.onOpenFeedback).toHaveBeenCalled()
  })

  it('с тренировками: Достижения и место в своем борде ведут дальше', async () => {
    vi.mocked(repo.getWorkouts).mockResolvedValue([WORKOUT])
    vi.mocked(getCachedLeaderboard).mockResolvedValue({ male: [{ user_id: 'x' }, { user_id: 'me' }], female: [] })
    const on = { onOpenAchievements: vi.fn(), onOpenFeed: vi.fn() }
    render(<Harness {...on} />)
    fireEvent.click(await screen.findByRole('button', { name: /Достижения/ }))
    expect(on.onOpenAchievements).toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: /2-е место по жиму/ }))
    expect(on.onOpenFeed).toHaveBeenCalled()
  })

  it('женский борд — место «по ягодичному мостику»; рейтинг недоступен — без строки', async () => {
    vi.mocked(repo.getWorkouts).mockResolvedValue([WORKOUT])
    vi.mocked(getCachedLeaderboard).mockResolvedValueOnce({ female: [{ user_id: 'me' }], male: [] })
    const { unmount } = render(<Harness />)
    expect(await screen.findByText('1-е место по ягодичному мостику')).toBeInTheDocument()
    unmount()
    vi.mocked(getCachedLeaderboard).mockRejectedValueOnce(new Error('db'))
    render(<Harness />)
    await screen.findByRole('button', { name: /Достижения/ })
    expect(screen.queryByText(/-е место/)).toBeNull()
  })
})

describe('Настройки — переходы, пол, прогрессия', () => {
  it('Что нового, Оформление, Пуш-уведомления, Каталог упражнений', async () => {
    const on = { onOpenWhatsNew: vi.fn(), onOpenAppearance: vi.fn(), onOpenPushSettings: vi.fn(), onOpenMyExercises: vi.fn() }
    render(<Harness {...on} />)
    await openSettings()
    fireEvent.click(screen.getByRole('button', { name: /Что нового/ }))
    fireEvent.click(screen.getByRole('button', { name: /Оформление/ }))
    fireEvent.click(screen.getByRole('button', { name: /Пуш-уведомления/ }))
    fireEvent.click(screen.getByRole('button', { name: /Каталог упражнений/ }))
    for (const fn of Object.values(on)) expect(fn).toHaveBeenCalled()
  })

  it('пол: выбор сохраняется и кэшируется; ошибка — откат и текст', async () => {
    vi.mocked(auth.setSex).mockResolvedValueOnce('f')
    render(<Harness />)
    await openSettings()
    fireEvent.click(screen.getByRole('radio', { name: 'Женский' }))
    await waitFor(() => expect(repo.setCachedSex).toHaveBeenCalledWith('me', 'f'))
    vi.mocked(auth.setSex).mockRejectedValueOnce(new auth.LoginError('network', 'Нет сети — попробуй позже.'))
    fireEvent.click(screen.getByRole('radio', { name: 'Мужской' }))
    expect(await screen.findByText('Нет сети — попробуй позже.')).toBeInTheDocument()
    vi.mocked(auth.setSex).mockRejectedValueOnce(new Error('boom'))
    fireEvent.click(screen.getByRole('radio', { name: 'Мужской' }))
    expect(await screen.findByText('Не удалось сохранить.')).toBeInTheDocument()
  })

  it('рекомендации прогрессии — тумблер', async () => {
    render(<Harness />)
    await openSettings()
    const sw = screen.getByRole('switch', { name: /Рекомендации прогрессии/ })
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'))
    fireEvent.click(sw)
    expect(repo.setProgEnabled).toHaveBeenCalledWith('me', false)
  })

  it('вход сразу в Настройки (возврат из «Оформления») — интент гасится', async () => {
    const onStartInSettingsConsumed = vi.fn()
    render(<Harness startInSettings onStartInSettingsConsumed={onStartInSettingsConsumed} />)
    expect(await screen.findByRole('heading', { name: 'Настройки' })).toBeInTheDocument()
    expect(onStartInSettingsConsumed).toHaveBeenCalled()
  })
})
