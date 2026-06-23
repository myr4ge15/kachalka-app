import { useState, useEffect } from 'react'
import { isConfigured } from './db/supabase.js'
import LoginScreen from './screens/LoginScreen.jsx'
import WorkoutScreen from './screens/WorkoutScreen.jsx'
import ProgressScreen from './screens/ProgressScreen.jsx'

const SESSION_KEY = 'gym_app_user'

export default function App() {
  const [user, setUser] = useState(null)
  const [tab, setTab] = useState('workout') // 'workout' | 'progress'

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
        <button className="link-btn" onClick={handleLogout}>Выйти</button>
      </header>

      <main className="content">
        {tab === 'workout'
          ? <WorkoutScreen user={user} />
          : <ProgressScreen user={user} />}
      </main>

      <nav className="tabbar">
        <button
          className={tab === 'workout' ? 'tab active' : 'tab'}
          onClick={() => setTab('workout')}
        >
          Тренировка
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
