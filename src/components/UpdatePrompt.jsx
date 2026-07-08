import { useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { onOnline, onResume } from '../lib/appEvents.js'
import { shouldReshowUpdate } from '../lib/pwaUpdate.js'

// Как часто, пока приложение открыто, форсим проверку нового деплоя. Браузер сам
// опрашивает service worker редко (навигация / ~раз в сутки), поэтому в долго
// живущем PWA без этого новая версия «висела» бы до перезахода.
const UPDATE_CHECK_MS = 30 * 60 * 1000 // 30 минут

// Через сколько после «Позже» снова напомнить, если новая версия всё ещё ждёт.
// «Позже» откладывает баннер, а не прячет навсегда (иначе один тап глушил бы
// обновление до перезахода — registration.update() уже скачанный SW не «переоткроет»).
const SNOOZE_MS = 4 * 60 * 60 * 1000 // 4 часа

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
  // Время нажатия «Позже» (0 — не откладывали). Хранится в ref, чтобы таймер и
  // слушатели видели актуальное значение без перевешивания эффекта.
  const snoozedAtRef = useRef(0)

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
      if (!r) return
      // Отложенный баннер: если новая версия всё ещё ждёт и прошёл TTL — показать снова.
      if (shouldReshowUpdate({
        hasWaiting: !!r.waiting,
        snoozedAt: snoozedAtRef.current,
        now: Date.now(),
        ttl: SNOOZE_MS,
      })) {
        snoozedAtRef.current = 0
        setNeedRefresh(true)
        return
      }
      if (navigator.onLine) r.update().catch(() => { /* офлайн/сеть — не критично */ })
    }
    const id = setInterval(check, UPDATE_CHECK_MS)
    const offResume = onResume(check)
    const offOnline = onOnline(check)
    return () => { clearInterval(id); offResume(); offOnline() }
  }, [setNeedRefresh])

  const snooze = () => {
    snoozedAtRef.current = Date.now()
    setNeedRefresh(false)
  }

  if (!needRefresh) return null

  return (
    <div className="update-pill" role="alert">
      <span className="update-pill-dot" aria-hidden="true" />
      <span className="update-pill-text">Новая версия</span>
      <button className="update-pill-go" onClick={() => updateServiceWorker(true)}>
        Обновить
      </button>
      <button className="update-pill-close" onClick={snooze} aria-label="Позже">
        &times;
      </button>
    </div>
  )
}
