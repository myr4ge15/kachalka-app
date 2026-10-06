// @vitest-environment jsdom
// Навигация App (v6.14.1): вкладки, вложенные экраны и их «назад», одноразовые
// интенты экранов (новая тренировка, календарь, прогресс упражнения, возврат к
// Настройкам/Ритму), профиль участника, пуш при холодном старте. Записан ДО выноса
// навигации из App.jsx в хук и проверяет, что перенос ничего не поменял.
//
// Экраны — заглушки: показывают себя (data-testid) и отдают пропсы в реестр `seen`,
// тест зовет их колбэки так же, как это сделал бы настоящий экран.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'

const seen = {}
vi.mock('./components/lazyScreen.jsx', () => ({
  lazyScreen: (factory) => {
    let Loaded = null
    const p = factory().then((m) => { Loaded = m.default })
    function Screen(props) {
      if (!Loaded) throw p
      return <Loaded {...props} />
    }
    Screen.preload = () => p
    return Screen
  },
}))
function stub(name) {
  return {
    default: (props) => {
      seen[name] = props
      return <div data-testid={`screen-${name}`} />
    },
  }
}
vi.mock('./screens/HomeScreen.jsx', () => stub('home'))
vi.mock('./screens/HistoryScreen.jsx', () => stub('history'))
vi.mock('./screens/ProgressScreen.jsx', () => stub('progress'))
vi.mock('./screens/FeedScreen.jsx', () => stub('feed'))
vi.mock('./screens/NotificationsScreen.jsx', () => stub('notif'))
vi.mock('./screens/ProfileScreen.jsx', () => stub('profile'))
vi.mock('./screens/AdminScreen.jsx', () => stub('admin'))
vi.mock('./screens/FreshnessScreen.jsx', () => stub('freshness'))
vi.mock('./screens/MyExercisesScreen.jsx', () => stub('myex'))
vi.mock('./screens/AchievementsScreen.jsx', () => stub('achievements'))
vi.mock('./screens/AppearanceScreen.jsx', () => stub('appearance'))
vi.mock('./screens/WhatsNewScreen.jsx', () => stub('whatsnew'))
vi.mock('./screens/FeedbackScreen.jsx', () => stub('feedback'))
vi.mock('./screens/MemberScreen.jsx', () => stub('member'))
vi.mock('./screens/LoginScreen.jsx', () => stub('login'))
vi.mock('./screens/InviteScreen.jsx', () => stub('invite'))

let mockUser = { id: 'me', name: 'Саня', role: 'admin' }
vi.mock('./hooks/useSession.js', () => ({
  SESSION_KEY: 'gym_app_user',
  useSession: () => ({ user: mockUser, handleLogin: vi.fn(), handleRenamed: vi.fn(), handleLogout: vi.fn() }),
}))
vi.mock('./hooks/useLaunchSheets.js', () => ({
  useLaunchSheets: () => ({ whatsNew: null, closeWhatsNew: vi.fn(), pushAsk: false, closePushAsk: vi.fn() }),
}))
vi.mock('./hooks/useAccentSync.js', () => ({ useAccentSync: () => {} }))
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (_f, _d, fallback) => fallback }))
vi.mock('./db/supabase.js', () => ({ isConfigured: true, warmup: vi.fn() }))
vi.mock('./db/sync.js', () => ({
  startSync: vi.fn(() => () => {}),
  useSyncStatus: () => ({ online: true, syncing: false, pending: 0, dead: 0, netError: false }),
}))
vi.mock('./db/notifications.js', () => ({ countUnread: vi.fn(async () => 0) }))
vi.mock('./db/repo.js', () => ({ getCachedUser: vi.fn(async () => null) }))
vi.mock('./db/push.js', () => ({ enablePush: vi.fn() }))
vi.mock('./lib/feedbackApi.js', () => ({ myUnreadReplies: vi.fn() }))
vi.mock('./lib/appEvents.js', () => ({ emitReselect: vi.fn(), onResume: () => () => {} }))

import App from './App.jsx'
import { emitReselect } from './lib/appEvents.js'

const REACTION = 'reaction-11111111-2222-4333-8444-555555555555-u2'

async function boot() {
  render(<App />)
  await screen.findByTestId(/^screen-/)
}
const current = () => document.querySelector('.nav-current [data-testid^="screen-"]')?.dataset.testid.slice(7)
const tab = (name) => fireEvent.click(within(document.querySelector('.tabbar')).getByText(name).closest('button'))
async function settle() { await act(async () => { await Promise.resolve() }) }

beforeEach(() => {
  for (const k of Object.keys(seen)) delete seen[k]
  sessionStorage.clear()
  mockUser = { id: 'me', name: 'Саня', role: 'admin' }
  window.history.replaceState(null, '', '/kachalka-app/')
  Element.prototype.scrollTo = vi.fn()
})
afterEach(() => vi.clearAllMocks())

describe('App: вкладки', () => {
  it('по умолчанию — Главная; вкладки переключают экран и запоминаются', async () => {
    await boot()
    expect(current()).toBe('home')
    tab('Лента'); await settle()
    expect(current()).toBe('feed')
    expect(sessionStorage.getItem('gym_app_tab')).toBe('feed')
    tab('Прогресс'); await settle()
    expect(current()).toBe('progress')
  })

  it('сохраненная вкладка переживает перезапуск; «member» и старая «workout» — нет', async () => {
    sessionStorage.setItem('gym_app_tab', 'progress')
    const { unmount } = render(<App />)
    await screen.findByTestId('screen-progress')
    unmount()
    sessionStorage.setItem('gym_app_tab', 'member')
    const r2 = render(<App />)
    await screen.findByTestId('screen-feed')
    r2.unmount()
    sessionStorage.setItem('gym_app_tab', 'workout')
    render(<App />)
    await screen.findByTestId('screen-home')
  })

  it('повторный тап по активной вкладке — наверх и сигнал «обнови меня», экран тот же', async () => {
    await boot()
    tab('Главная'); await settle()
    expect(current()).toBe('home')
    expect(emitReselect).toHaveBeenCalledWith('home')
  })
})

describe('App: вложенные экраны и «назад»', () => {
  it('колокольчик → уведомления → «назад» туда, откуда пришли', async () => {
    await boot()
    tab('Лента'); await settle()
    fireEvent.click(screen.getAllByRole('button', { name: /Уведомления/ })[0]); await settle()
    expect(current()).toBe('notif')
    act(() => seen.notif.onBack()); await settle()
    expect(current()).toBe('feed')
  })

  it('уведомление с ответом разработчика → экран обращений с фокусом', async () => {
    await boot()
    fireEvent.click(screen.getAllByRole('button', { name: /Уведомления/ })[0]); await settle()
    act(() => seen.notif.onOpenFeedback('fb1')); await settle()
    expect(current()).toBe('feedback')
    expect(seen.feedback.focusId).toBe('fb1')
  })

  it('Профиль → Админка/Достижения → назад в Профиль', async () => {
    await boot()
    fireEvent.click(screen.getAllByRole('button', { name: 'Открыть профиль' })[0]); await settle()
    expect(current()).toBe('profile')
    act(() => seen.profile.onOpenAdmin()); await settle()
    expect(current()).toBe('admin')
    act(() => seen.admin.onBack()); await settle()
    expect(current()).toBe('profile')
    act(() => seen.profile.onOpenAchievements()); await settle()
    act(() => seen.achievements.onBack()); await settle()
    expect(current()).toBe('profile')
  })

  it('под-экраны Настроек возвращают в Настройки (одноразовый интент)', async () => {
    await boot()
    fireEvent.click(screen.getAllByRole('button', { name: 'Открыть профиль' })[0]); await settle()
    for (const [open, name] of [['onOpenAppearance', 'appearance'], ['onOpenMyExercises', 'myex'], ['onOpenWhatsNew', 'whatsnew']]) {
      act(() => seen.profile[open]()); await settle()
      expect(current()).toBe(name)
      act(() => seen[name].onBack()); await settle()
      expect(current()).toBe('profile')
      expect(seen.profile.startInSettings).toBe(true)
      act(() => seen.profile.onStartInSettingsConsumed()); await settle()
      expect(seen.profile.startInSettings).toBe(false)
    }
  })

  it('Главная → Восстановление → назад на Главную; Профиль → рекорд → Прогресс с упражнением', async () => {
    await boot()
    act(() => seen.home.onNavigate('freshness')); await settle()
    expect(current()).toBe('freshness')
    act(() => seen.freshness.onBack()); await settle()
    expect(current()).toBe('home')
    act(() => seen.home.onOpenProgress('ex1')); await settle()
    expect(current()).toBe('progress')
    expect(seen.progress.initialExerciseId).toBe('ex1')
    act(() => seen.progress.onConsumed()); await settle()
    expect(seen.progress.initialExerciseId).toBe(null)
    act(() => seen.progress.onOpenGoals()); await settle()
    expect(current()).toBe('profile')
  })

  it('профиль участника из Ленты и назад; свой — обычный Профиль', async () => {
    await boot()
    tab('Лента'); await settle()
    act(() => seen.feed.onOpenMember('u2', null)); await settle()
    expect(current()).toBe('member')
    expect(seen.member.memberId).toBe('u2')
    // вкладка «Лента» подсвечена и на профиле участника
    expect(within(document.querySelector('.tabbar')).getByText('Лента').closest('button')).toHaveClass('active')
    act(() => seen.member.onBack()); await settle()
    expect(current()).toBe('feed')
    act(() => seen.feed.onOpenMember('me', null)); await settle()
    expect(current()).toBe('profile')
  })

  it('вложенный экран держит предка смонтированным под собой (стек)', async () => {
    await boot()
    fireEvent.click(screen.getAllByRole('button', { name: 'Открыть профиль' })[0]); await settle()
    act(() => seen.profile.onOpenAdmin()); await settle()
    const routes = [...document.querySelectorAll('.nav-stack > [data-route]')].map((n) => n.dataset.route)
    expect(routes).toEqual(['profile', 'admin'])
    expect(document.querySelector('[data-route="profile"]')).toHaveClass('nav-underlay')
  })
})

describe('App: интенты «Тренировок»', () => {
  it('«+» — новая тренировка с любой вкладки; на «Тренировках» — без смены вкладки', async () => {
    await boot()
    fireEvent.click(document.querySelector('.side-new')); await settle()
    expect(current()).toBe('history')
    expect(seen.history.openNew).toBe(true)
    act(() => seen.history.onOpenNewConsumed()); await settle()
    expect(seen.history.openNew).toBe(false)
    fireEvent.click(document.querySelector('.side-new')); await settle()
    expect(current()).toBe('history')
    expect(seen.history.openNew).toBe(true)
  })

  it('Ритм → календарь на день → «вернуться» к Ритму Главной', async () => {
    await boot()
    act(() => seen.home.onOpenCalendar('2026-10-01')); await settle()
    expect(current()).toBe('history')
    expect(seen.history.openCalendar).toBe('2026-10-01')
    act(() => seen.history.onOpenCalendarConsumed()); await settle()
    expect(seen.history.openCalendar).toBe(false)
    act(() => seen.history.onReturn()); await settle()
    expect(current()).toBe('home')
    expect(seen.home.focusRhythm).toBe(true)
    act(() => seen.home.onFocusRhythmConsumed()); await settle()
    expect(seen.home.focusRhythm).toBe(false)
  })

  it('пока хаб занят (композер), «+» утоплена', async () => {
    await boot()
    tab('Тренировки'); await settle()
    act(() => seen.history.onBusyChange(true)); await settle()
    expect(document.querySelector('.side-new')).toBeDisabled()
    expect(document.documentElement.dataset.composer).toBe('1')
    act(() => seen.history.onBusyChange(false)); await settle()
    expect(document.querySelector('.side-new')).not.toBeDisabled()
  })
})

describe('App: пуш при холодном старте', () => {
  it('пуш о реакции — сразу Лента с подсветкой карточки, параметр из адреса стерт', async () => {
    window.history.replaceState(null, '', `/kachalka-app/?push=${REACTION}`)
    await boot()
    expect(current()).toBe('feed')
    await settle()
    expect(seen.feed.flashId).toBe('11111111-2222-4333-8444-555555555555')
    expect(window.location.search).toBe('')
  })
})
