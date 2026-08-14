import { useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { onOnline, onResume } from '../lib/appEvents.js'
import { shouldReshowUpdate, makeReloadOnce, isRealUpdate } from '../lib/pwaUpdate.js'

// Как часто, пока приложение открыто, форсим проверку нового деплоя. Браузер сам
// опрашивает service worker редко (навигация / ~раз в сутки), поэтому в долго
// живущем PWA без этого новая версия «висела» бы до перезахода.
const UPDATE_CHECK_MS = 30 * 60 * 1000 // 30 минут

// Через сколько после «Позже» снова напомнить, если новая версия всё ещё ждёт.
// «Позже» откладывает баннер, а не прячет навсегда (иначе один тап глушил бы
// обновление до перезахода — registration.update() уже скачанный SW не «переоткроет»).
const SNOOZE_MS = 4 * 60 * 60 * 1000 // 4 часа

// Сколько ждём ответ version.json. Плашку до ответа не показываем, поэтому
// подвисшая сеть не должна прятать настоящее обновление дольше пары секунд.
const VERSION_TIMEOUT_MS = 3000

// Какая версия лежит на сервере прямо сейчас (файл кладёт сборка, см.
// vite.config.js). `no-store` обязателен: и HTTP-кэш, и service worker иначе
// отдадут копию установленной сборки, и сверка ничего не покажет. Любая
// осечка — null, вызов трактует это как «обновление реальное» (fail open).
async function fetchServerVersion() {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), VERSION_TIMEOUT_MS)
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json`, {
      cache: 'no-store',
      signal: ctrl.signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.version ?? null
  } catch {
    return null // офлайн / таймаут / старый деплой без version.json
  } finally {
    clearTimeout(t)
  }
}

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
  // Версия, на которую зовём обновиться (null — не узнали, показываем без номера).
  const [nextVersion, setNextVersion] = useState(null)
  // Сверка с сервером завершена. До неё плашку не рисуем: иначе ложная «Новая
  // версия» успевала мигнуть и только потом гаснуть.
  const [versionChecked, setVersionChecked] = useState(false)

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

  // Плашка поднялась — прежде чем показывать, убедимся, что на сервере правда
  // другая версия. Событие `waiting` от workbox приходит и без нового деплоя
  // (ждущий SW при каждой загрузке страницы, переустановка воркера), из-за чего
  // «Новая версия» всплывала на ровном месте. Подробности — в lib/pwaUpdate.js.
  useEffect(() => {
    if (!needRefresh) {
      setNextVersion(null)
      setVersionChecked(false)
      return
    }
    let alive = true
    fetchServerVersion().then((server) => {
      if (!alive) return
      if (!isRealUpdate(__APP_VERSION__, server)) {
        // Ждущий SW несёт ту же версию — обновляться не на что, молча прячем.
        // Применить его сами не пытаемся: активация перезагрузит приложение
        // без спроса, а выигрыша нет.
        setNeedRefresh(false)
        return
      }
      setNextVersion(server)
      setVersionChecked(true)
    })
    return () => { alive = false }
  }, [needRefresh, setNeedRefresh])

  const snooze = () => {
    snoozedAtRef.current = Date.now()
    setNeedRefresh(false)
  }

  // Применить обновление. updateServiceWorker(true) лишь шлёт SKIP_WAITING —
  // саму перезагрузку vite-plugin-pwa делает в обработчике `controlling` под
  // `event.isUpdate`, который на неконтролируемой странице (частый случай на
  // десктопе) = false → reload не срабатывал, приходилось жать Ctrl+Shift+R.
  // Вешаем СВОЙ одноразовый controllerchange→reload: новый SW активируется,
  // захватывает страницу (clientsClaim) и меняет контроллер → перезагружаемся.
  const applyUpdate = () => {
    const reloadOnce = makeReloadOnce(() => window.location.reload())
    navigator.serviceWorker?.addEventListener('controllerchange', reloadOnce)
    updateServiceWorker(true)
  }

  if (!needRefresh || !versionChecked) return null

  return (
    <div className="update-pill" role="alert">
      <span className="update-pill-dot" aria-hidden="true" />
      <span className="update-pill-text">
        Новая версия{nextVersion ? ` ${nextVersion}` : ''}
      </span>
      <button className="update-pill-go" onClick={applyUpdate}>
        Обновить
      </button>
      <button className="update-pill-close" onClick={snooze} aria-label="Позже">
        &times;
      </button>
    </div>
  )
}
