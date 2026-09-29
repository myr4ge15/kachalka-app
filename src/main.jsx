import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import UpdatePrompt from './components/UpdatePrompt.jsx'
import { openUserDb } from './db/local.js'
import { readStoredUserId } from './lib/sessionProfile.js'
import { splashDelay, onAppReady, SPLASH_FADE_MS, SPLASH_MAX_MS } from './lib/splash.js'
import './index.css'

// ===== Ранняя инициализация (до рендера React) =====
// Ускоряет холодный старт вошедшего: параллельно с загрузкой React начинаем
// открывать персональную базу и тянуть чанк Главной. App.jsx всё равно откроет
// базу штатно (идемпотентно, тот же инстанс) — это лишь фора по времени.
// ВАЖНО: в localStorage лежит НЕ голый id, а JSON {id} (см. App.SESSION_KEY),
// поэтому парсим тем же readStoredUserId — иначе openUserDb получал бы строку
// '{"id":"…"}' и открывал мусорную базу gym_app_{"id":…}.
const storedUserId = readStoredUserId(localStorage.getItem('gym_app_user'))

if (storedUserId) {
  // 1. Открываем персональную БД параллельно с загрузкой React.
  openUserDb(storedUserId).catch(() => {
    // Ошибку игнорируем: App.jsx подхватит и обработает штатно.
  })

  // 2. Заранее тянем чанк главной страницы (дефолтная вкладка после входа).
  import('./screens/HomeScreen.jsx').catch(() => {})
}
// ===================================================

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <UpdatePrompt />
  </React.StrictMode>
)

// Сплэш холодного старта (#splash в index.html) — убираем, когда App сообщил о
// готовности (восстановил сессию или показал вход, см. markAppReady), но не
// раньше, чем доиграет анимация (lib/splash.js), и не позже страховочного
// потолка. Сначала гасим прозрачностью (.splash--out), затем удаляем узел.
const splash = document.getElementById('splash')
if (splash) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  let gone = false
  const hide = () => {
    if (gone) return
    gone = true
    splash.classList.add('splash--out')
    setTimeout(() => splash.remove(), reduce ? 0 : SPLASH_FADE_MS)
  }
  onAppReady(() => setTimeout(hide, splashDelay(performance.now(), reduce)))
  setTimeout(hide, SPLASH_MAX_MS)
}
