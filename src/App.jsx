import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { isConfigured, warmup } from './db/supabase.js'
import { startSync, useSyncStatus } from './db/sync.js'
import { countUnread } from './db/notifications.js'
import LoginScreen from './screens/LoginScreen.jsx'
import Toast from './components/Toast.jsx'

// Экраны-вкладки грузим лениво: код активной вкладки подтягивается по требованию.
// Главный выигрыш — «Прогресс» тянет тяжёлый recharts, который теперь не попадает
// в стартовый бандл, а грузится отдельным чанком при открытии вкладки.
const HistoryScreen = lazy(() => import('./screens/HistoryScreen.jsx'))
const ProgressScreen = lazy(() => import('./screens/ProgressScreen.jsx'))
const FeedScreen = lazy(() => import('./screens/FeedScreen.jsx'))
const NotificationsScreen = lazy(() => import('./screens/NotificationsScreen.jsx'))
const ProfileScreen = lazy(() => import('./screens/ProfileScreen.jsx'))

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

const SESSION_KEY = 'gym_app_user'
const TAB_KEY = 'gym_app_tab'

export default function App() {
  const [user, setUser] = useState(null)
  // Активная вкладка переживает F5 (sessionStorage). Старое значение 'workout'
  // (вкладки больше нет) мигрируем в 'history' (хаб «Мои тренировки»).
  const [tab, setTab] = useState(() => {
    const saved = sessionStorage.getItem(TAB_KEY)
    return saved && saved !== 'workout' ? saved : 'history'
  }) // 'history' | 'feed' | 'progress' | 'notif' | 'profile'

  // Упражнение, с которым открыть «Прогресс» (проброс из ЛК по тапу на рекорд).
  const [progressExId, setProgressExId] = useState(null)

  // Счётчик непрочитанных рекордов-уведомлений (для бейджа на колокольчике).
  // Живо пересчитывается при изменении своих тренировок, ленты и метки просмотра.
  const unread = useLiveQuery(
    () => (user?.id ? countUnread(user.id) : 0),
    [user?.id],
    0
  )

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

  // Восстановление сессии после перезагрузки
  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY)
    if (saved) {
      try { setUser(JSON.parse(saved)) } catch { /* ignore */ }
    }
  }, [])

  function handleLogin(u) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(u))
    setUser(u)
    setTab('history')
  }

  function handleLogout() {
    sessionStorage.removeItem(SESSION_KEY)
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
            />
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
