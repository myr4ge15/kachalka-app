import { useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { onOnline, onResume } from '../lib/appEvents.js'

// Как часто, пока приложение открыто, форсим проверку нового деплоя. Браузер сам
// опрашивает service worker редко (навигация / ~раз в сутки), поэтому в долго
// живущем PWA без этого новая версия «висела» бы до перезахода.
const UPDATE_CHECK_MS = 30 * 60 * 1000 // 30 минут

// Баннер обновления PWA. При registerType:'prompt' service worker скачивает
// новую версию в фоне, но НЕ применяет её сам — показываем плашку, и обновление
// происходит в один тап (updateServiceWorker(true) активирует SW и перезагружает).
//
// Дополнительно проактивно проверяем обновление во время работы: по таймеру, при
// возврате на вкладку (onResume) и при появлении сети (onOnline) дёргаем
// registration.update(). Если на сервере есть свежий sw.js — SW его подхватит и
// поднимет needRefresh (плашку). Автоперезапуска без тапа пользователя нет.
export default function UpdatePrompt() {
  // Регистрация SW приходит асинхронно через onRegisteredSW — держим её в ref,
  // чтобы таймер/слушатели всегда видели актуальное значение.
  const regRef = useRef(null)

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swScriptUrl, registration) {
      regRef.current = registration ?? null
    },
  })

  useEffect(() => {
    const check = () => {
      const r = regRef.current
      if (r && navigator.onLine) r.update().catch(() => { /* офлайн/сеть — не критично */ })
    }
    const id = setInterval(check, UPDATE_CHECK_MS)
    const offResume = onResume(check)
    const offOnline = onOnline(check)
    return () => { clearInterval(id); offResume(); offOnline() }
  }, [])

  if (!needRefresh) return null

  return (
    <div className="update-banner" role="alert">
      <span className="update-banner-text">Доступна новая версия</span>
      <div className="update-banner-actions">
        <button className="btn primary" onClick={() => updateServiceWorker(true)}>
          Обновить
        </button>
        <button className="link-btn" onClick={() => setNeedRefresh(false)}>
          Позже
        </button>
      </div>
    </div>
  )
}
