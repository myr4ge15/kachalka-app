import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/app/ErrorBoundary.jsx'
import UpdatePrompt from './components/app/UpdatePrompt.jsx'
import { openUserDb } from './db/local.js'
import { readStoredUserId } from './lib/sessionProfile.js'
import { onAppReady } from './lib/splash.js'
import { runLaunchUpdate } from './lib/launchUpdate.js'
import { startSplash } from './lib/splashBoot.js'
import { startPushListener } from './lib/pushIntent.js'
import './index.css'

// ===== Ранняя инициализация (до рендера React) =====
// Ускоряет холодный старт вошедшего: параллельно с загрузкой React начинаем
// открывать персональную базу и тянуть чанк Главной. App.jsx все равно откроет
// базу штатно (идемпотентно, тот же инстанс) — это лишь фора по времени.
// ВАЖНО: в localStorage лежит НЕ голый id, а JSON {id} (см. App.SESSION_KEY),
// поэтому парсим тем же readStoredUserId — иначе openUserDb получал бы строку
// '{"id":"…"}' и открывал мусорную базу gym_app_{"id":…}.
// Чтение — через try/catch (РЕВЬЮ-КОДА-2026-10-02): в Safari с блокировкой cookie
// само обращение к localStorage бросает SecurityError, и исключение на верхнем
// уровне модуля обрывало старт — React не монтировался, заставка висела.
function readLocal(key) {
  try { return window.localStorage?.getItem(key) ?? null } catch { return null }
}
const storedUserId = readStoredUserId(readLocal('gym_app_user'))

if (storedUserId) {
  // 1. Открываем персональную БД параллельно с загрузкой React.
  openUserDb(storedUserId).catch(() => {
    // Ошибку игнорируем: App.jsx подхватит и обработает штатно.
  })

  // 2. Заранее тянем чанк главной страницы (дефолтная вкладка после входа).
  import('./screens/HomeScreen.jsx').catch(() => {})
}
// Нажатие на пуш (v8.9.3): слушаем service worker ДО рендера React — при запуске нажатием
// сообщение приходит рано, и без этого терялось (lib/pushIntent.js).
startPushListener()
// ===================================================

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <UpdatePrompt />
  </React.StrictMode>
)

// Сплэш холодного старта и обновление при запуске (lib/splashBoot.js, lib/launchUpdate.js).
const splash = document.getElementById('splash')
startSplash({
  splash,
  reduce: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  onReady: onAppReady,
  runUpdate: (ui) => runLaunchUpdate({
    versionUrl: `${import.meta.env.BASE_URL}version.json`,
    currentVersion: __APP_VERSION__,
    ui,
  }),
})
