import { useState, useEffect } from 'react'
import { isConfigured, warmup } from './db/supabase.js'
import { startSync, useSyncStatus } from './db/sync.js'
import LoginScreen from './screens/LoginScreen.jsx'
import WorkoutScreen from './screens/WorkoutScreen.jsx'
import HistoryScreen from './screens/HistoryScreen.jsx'
import ProgressScreen from './screens/ProgressScreen.jsx'

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
  // Активная вкладка переживает F5 (sessionStorage)
  const [tab, setTab] = useState(
    () => sessionStorage.getItem(TAB_KEY) || 'workout'
  ) // 'workout' | 'history' | 'progress'

  // Будим базу заранее, как только приложение открылось
  useEffect(() => { warmup() }, [])

  // Фоновая синхронизация очереди и подтяжка свежих данных, пока есть вход.
  useEffect(() => {
    if (!user?.id) return
    return startSync(() => user.id)
  }, [user?.id])

  // Запоминаем активную вкладку
  useEffect(() => { sessionStorage.setItem(TAB_KEY, tab) }, [tab])

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
    setTab('workout')
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
        <span className="topbar-user">{user.name}</span>
        <SyncBadge />
        <button className="link-btn" onClick={handleLogout}>Выйти</button>
      </header>

      <main className="content">
        {tab === 'workout' && <WorkoutScreen user={user} />}
        {tab === 'history' && <HistoryScreen user={user} />}
        {tab === 'progress' && <ProgressScreen user={user} />}
      </main>

      <nav className="tabbar">
        <button
          className={tab === 'workout' ? 'tab active' : 'tab'}
          onClick={() => setTab('workout')}
        >
          Тренировка
        </button>
        <button
          className={tab === 'history' ? 'tab active' : 'tab'}
          onClick={() => setTab('history')}
        >
          История
        </button>
        <button
          className={tab === 'progress' ? 'tab active' : 'tab'}
          onClick={() => setTab('progress')}
        >
          Прогресс
        </button>
      </nav>
    </div>
  )
}
