import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import UpdatePrompt from './components/UpdatePrompt.jsx'
import { openUserDb } from './db/local.js'
import { readStoredUserId } from './lib/sessionProfile.js'
import { splashDelay, onAppReady, SPLASH_FADE_MS, SPLASH_MAX_MS } from './lib/splash.js'
import { runLaunchUpdate, WAIT_MS } from './lib/launchUpdate.js'
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
//
// Обновление при запуске (v6.13.0, lib/launchUpdate.js): пока на сервере новая
// версия качается и применяется, сплэш держим — человек попадает сразу в новую
// версию. Сплэш уходит, когда И приложение готово, И проверка обновления
// закончилась (у нее свой потолок ожидания); страховочный потолок отсчитывается
// от конца проверки.
const splash = document.getElementById('splash')
if (splash) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  let gone = false
  let appReady = false
  let updateDone = false
  const hide = () => {
    if (gone) return
    gone = true
    splash.classList.add('splash--out')
    setTimeout(() => splash.remove(), reduce ? 0 : SPLASH_FADE_MS)
  }
  const maybeHide = () => { if (appReady && updateDone) setTimeout(hide, splashDelay(performance.now(), reduce)) }
  onAppReady(() => { appReady = true; maybeHide() })
  runLaunchUpdate({
    versionUrl: `${import.meta.env.BASE_URL}version.json`,
    currentVersion: __APP_VERSION__,
    ui: splashUpdateUi(splash),
  })
    .catch(() => 'skip')
    .then((result) => {
      if (result === 'applied') return // страница перезагружается
      updateDone = true
      maybeHide()
      setTimeout(hide, SPLASH_MAX_MS)
    })
  // Последняя страховка: что бы ни случилось с проверкой, сплэш не вечный.
  setTimeout(hide, SPLASH_MAX_MS + WAIT_MS + 10000)
}

// Блок «Обновляем до v…» на сплэше (разметка — index.html #splash-upd).
function splashUpdateUi(root) {
  const box = document.getElementById('splash-upd')
  const title = document.getElementById('splash-upd-title')
  const bar = document.getElementById('splash-upd-bar')
  const fill = document.getElementById('splash-upd-fill')
  const cap = document.getElementById('splash-upd-cap')
  if (!box || !title || !bar || !fill || !cap) return {}
  return {
    start(version) {
      root.removeAttribute('aria-hidden') // статус должен услышать и скринридер
      title.textContent = `Обновляем до v${version}`
      cap.textContent = 'Загружаем…'
      bar.classList.add('splash-upd-bar--busy')
      box.hidden = false
    },
    progress(p) {
      if (!p) return
      bar.classList.remove('splash-upd-bar--busy')
      fill.style.width = `${p.pct}%`
      bar.setAttribute('aria-valuenow', String(p.pct))
      cap.textContent = `Загружено ${p.done} из ${p.total} · ${p.pct}%`
    },
    installing() {
      bar.classList.remove('splash-upd-bar--busy')
      fill.style.width = '100%'
      bar.setAttribute('aria-valuenow', '100')
      cap.textContent = 'Устанавливаем…'
    },
    fallback() {
      box.classList.add('splash-upd--note')
      title.textContent = 'Связь слабая'
      cap.textContent = 'Открываем текущую версию — обновление докачается само.'
    },
  }
}
