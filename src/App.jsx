import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { isConfigured, warmup, supabase } from './db/supabase.js'
import { logout as authLogout } from './lib/auth.js'
import { startSync, useSyncStatus } from './db/sync.js'
import { countUnread } from './db/notifications.js'
import { getCachedUser } from './db/repo.js'
import { clearSessionData } from './db/local.js'
import LoginScreen from './screens/LoginScreen.jsx'
import Toast from './components/Toast.jsx'
import Avatar from './components/Avatar.jsx'

// Экраны-вкладки грузим лениво: код активной вкладки подтягивается по требованию.
// Главный выигрыш — «Прогресс» тянет тяжёлый recharts, который теперь не попадает
// в стартовый бандл, а грузится отдельным чанком при открытии вкладки.
const HistoryScreen = lazy(() => import('./screens/HistoryScreen.jsx'))
const ProgressScreen = lazy(() => import('./screens/ProgressScreen.jsx'))
const FeedScreen = lazy(() => import('./screens/FeedScreen.jsx'))
const NotificationsScreen = lazy(() => import('./screens/NotificationsScreen.jsx'))
const ProfileScreen = lazy(() => import('./screens/ProfileScreen.jsx'))
const AdminScreen = lazy(() => import('./screens/AdminScreen.jsx'))

// Индикатор состояния синхронизации в шапке.
function SyncBadge() {
  const { online, syncing, pending } = useSyncStatus()
  let cls = 'sync-badge'
  let text
  if (!online) {
    cls += ' offline'
    text = pending > 0 ? `офлайн · ${pending} в очереди` : 'офлайн'
  } else if (syncing) {
    cls += ' busy'
    text = 'синхронизация…'
  } else if (pending > 0) {
    cls += ' busy'
    text = `${pending} не синхр.`
  } else {
    cls += ' ok'
    text = 'синхронизировано'
  }
  return <span className={cls}>{text}</span>
}

// Профиль вошедшего (id,name,role) храним в localStorage — переживает
// перезапуск приложения, как и сессия Supabase Auth (persistSession). PIN
// спрашивается заново лишь когда refresh-токен умрёт (~7 дней) или после logout.
const SESSION_KEY = 'gym_app_user'
const TAB_KEY = 'gym_app_tab'

export default function App() {
  const [user, setUser] = useState(null)
  // Активная вкладка переживает F5 (sessionStorage). Старое значение 'workout'
  // (вкладки больше нет) мигрируем в 'history' (хаб «Мои тренировки»).
  const [tab, setTab] = useState(() => {
    const saved = sessionStorage.getItem(TAB_KEY)
    return saved && saved !== 'workout' ? saved : 'history'
  }) // 'history' | 'feed' | 'progress' | 'notif' | 'profile' | 'admin'

  // Упражнение, с которым открыть «Прогресс» (проброс из ЛК по тапу на рекорд).
  const [progressExId, setProgressExId] = useState(null)

  // Счётчик непрочитанных рекордов-уведомлений (для бейджа на колокольчике).
  // Живо пересчитывается при изменении своих тренировок, ленты и метки просмотра.
  const unread = useLiveQuery(
    () => (user?.id ? countUnread(user.id) : 0),
    [user?.id],
    0
  )

  // Свой аватар для шапки — из кэша пользователей (пополняется pull'ом login_users
  // и мгновенно после загрузки своего аватара в ЛК). Нет картинки → инициал.
  const myCached = useLiveQuery(
    () => (user?.id ? getCachedUser(user.id) : null),
    [user?.id]
  )

  // Имя сменили извне (админка/другое устройство) — pull обновил кэш login_users
  // (getCachedUser), но локальная сессия (localStorage) держит старое имя, из-за
  // чего профиль и шапка отстают от лидерборда. Сверяем и подтягиваем из кэша.
  useEffect(() => {
    const fresh = myCached?.name
    if (fresh && user?.id && fresh !== user.name) handleRenamed(fresh)
  }, [myCached?.name, user?.id, user?.name])

  // Будим базу заранее, как только приложение открылось
  useEffect(() => { warmup() }, [])

  // Фоновая синхронизация очереди и подтяжка свежих данных, пока есть вход.
  useEffect(() => {
    if (!user?.id) return
    return startSync(() => user.id)
  }, [user?.id])

  // Запоминаем активную вкладку
  useEffect(() => { sessionStorage.setItem(TAB_KEY, tab) }, [tab])

  // Скроллится не окно, а внутренняя .content (overflow-y:auto, см. index.css).
  // Тап по кнопке вкладки всегда возвращает её контент в самый верх — в т.ч.
  // повторный тап по уже активной вкладке (как «прокрутка наверх» в iOS).
  const contentRef = useRef(null)
  function goTab(next) {
    contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    setTab(next)
  }

  // Связка ЛК → «Прогресс»: открыть вкладку с заранее выбранным упражнением.
  function openProgressFor(exerciseId) {
    setProgressExId(exerciseId)
    goTab('progress')
  }

  // Восстановление профиля после перезапуска (из localStorage — работает и
  // офлайн, когда сервер недоступен и сессию не проверить).
  useEffect(() => {
    const saved = localStorage.getItem(SESSION_KEY)
    if (saved) {
      try { setUser(JSON.parse(saved)) } catch { /* ignore */ }
    }
  }, [])

  // Если сессия Supabase завершилась (refresh-токен истёк через ~7 дней или
  // logout) — возвращаем на экран входа. Офлайн событие не приходит, поэтому
  // UI остаётся доступным до появления сети (тогда либо тихий перевыпуск, либо
  // SIGNED_OUT → PIN заново).
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        localStorage.removeItem(SESSION_KEY)
        setUser(null)
      }
    })
    return () => data?.subscription?.unsubscribe?.()
  }, [])

  async function handleLogin(u) {
    // Чистим кросс-пользовательские кэши ДО показа экранов: на общем устройстве
    // иначе новый вошедший видит ленту/лидерборд/уведомления предыдущего, пока не
    // отработает первый fetch. Покрывает и путь авто-SIGNED_OUT (там чистки нет).
    await clearSessionData()
    localStorage.setItem(SESSION_KEY, JSON.stringify(u))
    setUser(u)
    setTab('history')
  }

  // Имя сменили в ЛК — обновляем профиль в стейте и localStorage, чтобы шапка
  // и инициал-аватар сразу показали новое имя и оно пережило перезапуск.
  function handleRenamed(name) {
    setUser((u) => {
      if (!u) return u
      const next = { ...u, name }
      localStorage.setItem(SESSION_KEY, JSON.stringify(next))
      return next
    })
  }

  async function handleLogout() {
    await authLogout()
    await clearSessionData() // не оставляем ленту/лидерборд прошлой учётки «на покое»
    localStorage.removeItem(SESSION_KEY)
    setUser(null)
  }

  if (!isConfigured) {
    return (
      <div className="screen center">
        <div className="card warn">
          <h2>Нужна настройка</h2>
          <p>
            Не заданы ключи Supabase. Скопируй <code>.env.example</code> в{' '}
            <code>.env</code>, подставь <code>VITE_SUPABASE_URL</code> и{' '}
            <code>VITE_SUPABASE_KEY</code>, перезапусти <code>npm run dev</code>.
          </p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />
  }

  return (
    <div className="app">
      <header className="topbar">
        <button
          className={'topbar-user' + (tab === 'profile' ? ' active' : '')}
          onClick={() => goTab('profile')}
          aria-label="Открыть профиль"
        >
          <Avatar name={user.name} url={myCached?.avatar_url} className="avatar-sm" />
          {user.name} <span className="chev" aria-hidden="true">▾</span>
        </button>
        <SyncBadge />
        <button
          className={'bell' + (unread > 0 ? ' has' : '')}
          onClick={() => goTab('notif')}
          aria-label={unread > 0 ? `Уведомления: ${unread} новых` : 'Уведомления'}
        >
          🔔
          {unread > 0 && (
            <span className="bell-count">{unread > 9 ? '9+' : unread}</span>
          )}
        </button>
      </header>

      <main className="content" ref={contentRef}>
        <Suspense fallback={<div className="screen"><p className="muted">Загрузка…</p></div>}>
          {tab === 'history' && <HistoryScreen user={user} />}
          {tab === 'feed' && <FeedScreen user={user} />}
          {tab === 'progress' && <ProgressScreen user={user} initialExerciseId={progressExId} />}
          {tab === 'notif' && <NotificationsScreen user={user} />}
          {tab === 'profile' && (
            <ProfileScreen
              user={user}
              onLogout={handleLogout}
              onOpenProgress={openProgressFor}
              onOpenFeed={() => goTab('feed')}
              onRenamed={handleRenamed}
              onOpenAdmin={() => goTab('admin')}
            />
          )}
          {tab === 'admin' && user.role === 'admin' && (
            <AdminScreen user={user} onBack={() => goTab('profile')} />
          )}
        </Suspense>
      </main>

      <nav className="tabbar">
        <button
          className={tab === 'history' ? 'tab active' : 'tab'}
          onClick={() => goTab('history')}
        >
          Мои тренировки
        </button>
        <button
          className={tab === 'feed' ? 'tab active' : 'tab'}
          onClick={() => goTab('feed')}
        >
          Лента
        </button>
        <button
          className={tab === 'progress' ? 'tab active' : 'tab'}
          onClick={() => goTab('progress')}
        >
          Прогресс
        </button>
      </nav>

      <Toast />
    </div>
  )
}
