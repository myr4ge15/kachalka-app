import { useCallback, useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { onOnline, onResume } from '../lib/appEvents.js'
import { shouldReshowUpdate, makeReloadOnce, isRealUpdate, shouldAutoApply, shouldSurfaceWaiting } from '../lib/pwaUpdate.js'
import { pushIntentFromUrl } from '../lib/pushIntent.js'

// Открыли нажатием на пуш «вышла новая версия»? Читаем адрес в момент монтирования:
// App убирает `?push=` из адреса только в эффекте, позже первого рендера.
function openedByUpdatePush() {
  try { return pushIntentFromUrl(window.location.href)?.type === 'update' } catch { return false }
}

// Как часто, пока приложение открыто, форсим проверку нового деплоя. Браузер сам
// опрашивает service worker редко (навигация / ~раз в сутки), поэтому в долго
// живущем PWA без этого новая версия «висела» бы до перезахода.
const UPDATE_CHECK_MS = 30 * 60 * 1000 // 30 минут

// Через сколько после «Позже» снова напомнить, если новая версия все еще ждет.
// «Позже» откладывает баннер, а не прячет навсегда (иначе один тап глушил бы
// обновление до перезахода — registration.update() уже скачанный SW не «переоткроет»).
const SNOOZE_MS = 4 * 60 * 60 * 1000 // 4 часа

// Сколько ждем ответ version.json. Плашку до ответа не показываем, поэтому
// подвисшая сеть не должна прятать настоящее обновление дольше пары секунд.
const VERSION_TIMEOUT_MS = 3000

// Не чаще, чем раз в столько, перепроверяем version.json, пока новый sw.js уже
// ждет, а сверка сказала «та же версия» (РЕВЬЮ-КОДА-2026-10-02): CDN мог
// отдать старый version.json, пока sw.js уже новый. Без повторной сверки плашка
// гасла до следующего запуска; частые возвраты на вкладку не должны долбить сеть.
export const RECHECK_MIN_MS = 2 * 60 * 1000 // 2 минуты

// Пора ли повторно сверить версию ждущего SW. Чистая функция — в компоненте, а не
// в lib/pwaUpdate.js: там правила показа, а это — расписание опроса плашки.
//  hasWaiting — новый SW скачан и ждет;
//  hidden     — плашка сейчас не показана (needRefresh=false);
//  quiet      — ее спрятала сверка «версия та же» (а не «Позже» и не применение);
//  lastAt     — когда сверяли в последний раз (мс), now — текущее время.
export function shouldRecheckWaiting({ hasWaiting, hidden, quiet, lastAt, now, minGap = RECHECK_MIN_MS }) {
  if (!hasWaiting || !hidden || !quiet) return false
  return now - (lastAt || 0) >= minGap
}

// Какая версия лежит на сервере прямо сейчас (файл кладет сборка, см.
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
    // headline (v6.4.0) — главное из новой версии для строки; старые деплои без него.
    return data?.version ? { version: data.version, headline: data.headline ?? null } : null
  } catch {
    return null // офлайн / таймаут / старый деплой без version.json
  } finally {
    clearTimeout(t)
  }
}

// Баннер обновления PWA. При registerType:'prompt' service worker скачивает
// новую версию в фоне, но НЕ применяет ее сам — показываем плашку, и обновление
// происходит в один тап (updateServiceWorker(true) активирует SW и перезагружает).
//
// Дополнительно проактивно проверяем обновление во время работы: по таймеру, при
// возврате на вкладку (onResume) и при появлении сети (onOnline) дергаем
// registration.update(). Если на сервере есть свежий sw.js — SW его подхватит и
// поднимет needRefresh (плашку). Автоперезапуска без тапа пользователя нет.
export default function UpdatePrompt() {
  // Регистрация SW приходит асинхронно через onRegisteredSW — держим ее в ref,
  // чтобы таймер/слушатели всегда видели актуальное значение.
  const regRef = useRef(null)
  // Время нажатия «Позже» (0 — не откладывали). Хранится в ref, чтобы таймер и
  // слушатели видели актуальное значение без перевешивания эффекта.
  const snoozedAtRef = useRef(0)
  // Плашку спрятала сверка «та же версия» при ждущем SW — и когда это было.
  // См. shouldRecheckWaiting: пока так, периодически сверяем заново.
  const quietRef = useRef(false)
  const lastVersionCheckRef = useRef(0)
  const needRefreshRef = useRef(false)
  // Версия, на которую зовем обновиться (null — не узнали, показываем без номера).
  const [nextVersion, setNextVersion] = useState(null)
  const [nextHeadline, setNextHeadline] = useState(null)
  // Сверка с сервером завершена. До нее плашку не рисуем: иначе ложная «Новая
  // версия» успевала мигнуть и только потом гаснуть.
  const [versionChecked, setVersionChecked] = useState(false)
  // Когда нажали пуш «вышла новая версия» (0 — не нажимали). См. shouldAutoApply.
  const [autoAt, setAutoAt] = useState(() => (openedByUpdatePush() ? Date.now() : 0))
  const autoAtRef = useRef(autoAt)
  autoAtRef.current = autoAt

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swScriptUrl, registration) {
      regRef.current = registration ?? null
      // Пришли из пуша о новой версии — сразу спрашиваем сервер, не ждем таймера.
      if (registration && autoAtRef.current) registration.update().catch(() => {})
    },
  })
  needRefreshRef.current = needRefresh

  // Новый SW дошел до «ждет» — поднять плашку (v6.15.0): событие workbox мы могли
  // пропустить (см. shouldSurfaceWaiting), поэтому смотрим на регистрацию сами.
  // force — человек нажал пуш о новой версии: «Позже» и «та же версия» не в счет.
  const surfaceWaiting = useCallback((r, force = false) => {
    if (!r?.waiting) return false
    if (force) { snoozedAtRef.current = 0; quietRef.current = false }
    if (!shouldSurfaceWaiting({
      hasWaiting: true, shown: needRefreshRef.current, snoozedAt: snoozedAtRef.current, quiet: quietRef.current,
    })) return false
    setNeedRefresh(true)
    return true
  }, [setNeedRefresh])
  // Проверить сервер и, если новая версия скачается, показать плашку, не дожидаясь
  // события workbox (оно может не прийти, см. выше).
  const updateAndSurface = useCallback((r, force = false) => {
    if (!r) return
    r.update()
      .then(() => {
        if (surfaceWaiting(r, force)) return
        const inst = r.installing
        if (!inst) return
        const onState = () => {
          if (inst.state === 'installed' || inst.state === 'redundant') inst.removeEventListener('statechange', onState)
          if (inst.state === 'installed') surfaceWaiting(r, force)
        }
        inst.addEventListener('statechange', onState)
      })
      .catch(() => { /* офлайн/сеть — не критично */ })
  }, [surfaceWaiting])

  useEffect(() => {
    const check = () => {
      const r = regRef.current
      if (!r) return
      // Отложенный баннер: если новая версия все еще ждет и прошел TTL — показать снова.
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
      // sw.js уже новый, а version.json с CDN был старый — сверяем еще раз:
      // поднятый needRefresh заново запустит сверку ниже, и плашка появится,
      // как только CDN догонит (или снова молча спрячется).
      if (shouldRecheckWaiting({
        hasWaiting: !!r.waiting,
        hidden: !needRefreshRef.current,
        quiet: quietRef.current,
        lastAt: lastVersionCheckRef.current,
        now: Date.now(),
      })) {
        quietRef.current = false
        setNeedRefresh(true)
        return
      }
      // Новая версия скачалась, пока приложение было свернуто, — плашка сразу.
      if (surfaceWaiting(r)) return
      if (navigator.onLine) updateAndSurface(r)
    }
    const id = setInterval(check, UPDATE_CHECK_MS)
    const offResume = onResume(check)
    const offOnline = onOnline(check)
    return () => { clearInterval(id); offResume(); offOnline() }
  }, [setNeedRefresh, surfaceWaiting, updateAndSurface])

  // Плашка поднялась — прежде чем показывать, убедимся, что на сервере правда
  // другая версия. Событие `waiting` от workbox приходит и без нового деплоя
  // (ждущий SW при каждой загрузке страницы, переустановка воркера), из-за чего
  // «Новая версия» всплывала на ровном месте. Подробности — в lib/pwaUpdate.js.
  useEffect(() => {
    if (!needRefresh) {
      setNextVersion(null)
      setNextHeadline(null)
      setVersionChecked(false)
      return
    }
    let alive = true
    lastVersionCheckRef.current = Date.now()
    fetchServerVersion().then((server) => {
      if (!alive) return
      if (!isRealUpdate(__APP_VERSION__, server?.version)) {
        // Ждущий SW несет ту же версию — обновляться не на что, молча прячем.
        // Применить его сами не пытаемся: активация перезагрузит приложение
        // без спроса, а выигрыша нет. Но запоминаем, что спрятали «по версии»:
        // это может быть отстающий CDN — check() перепроверит позже.
        quietRef.current = true
        setNeedRefresh(false)
        return
      }
      quietRef.current = false
      setNextVersion(server?.version ?? null)
      setNextHeadline(server?.headline ?? null)
      setVersionChecked(true)
    })
    return () => { alive = false }
  }, [needRefresh, setNeedRefresh])

  // Пуш о новой версии нажали, когда приложение уже открыто: SW шлет сообщение
  // (ответ ему дает App). Запоминаем нажатие и сразу проверяем обновление.
  useEffect(() => {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : null
    if (!sw) return undefined
    const onMessage = (e) => {
      if (e.data?.type !== 'push-open' || pushIntentFromUrl(e.data.url)?.type !== 'update') return
      setAutoAt(Date.now())
      // Версию SW мог скачать еще при получении пуша — тогда она уже ждет (v6.15.0).
      if (!surfaceWaiting(regRef.current, true)) updateAndSurface(regRef.current, true)
    }
    sw.addEventListener('message', onMessage)
    return () => sw.removeEventListener('message', onMessage)
  }, [surfaceWaiting, updateAndSurface])

  const snooze = () => {
    snoozedAtRef.current = Date.now()
    setNeedRefresh(false)
  }

  // Применить обновление. updateServiceWorker(true) лишь шлет SKIP_WAITING —
  // саму перезагрузку vite-plugin-pwa делает в обработчике `controlling` под
  // `event.isUpdate`, который на неконтролируемой странице (частый случай на
  // десктопе) = false → reload не срабатывал, приходилось жать Ctrl+Shift+R.
  // Вешаем СВОЙ одноразовый controllerchange→reload: новый SW активируется,
  // захватывает страницу (clientsClaim) и меняет контроллер → перезагружаемся.
  const applyUpdate = useCallback(() => {
    const reloadOnce = makeReloadOnce(() => window.location.reload())
    navigator.serviceWorker?.addEventListener('controllerchange', reloadOnce)
    updateServiceWorker(true)
  }, [updateServiceWorker])

  // Строка висит поверх верха контента — пока она видна, контент сдвигаем вниз
  // (CSS по html[data-update]), иначе она закрывала заголовок экрана.
  const visible = needRefresh && versionChecked

  // Новая версия подтверждена, а человек пришел из пуша о ней — применяем сами.
  useEffect(() => {
    if (!visible || !autoAt) return
    const composerOpen = document.documentElement.dataset.composer === '1'
    if (shouldAutoApply({ requestedAt: autoAt, now: Date.now(), composerOpen })) applyUpdate()
    setAutoAt(0) // одно нажатие — одна попытка; дальше обычная плашка
  }, [visible, autoAt, applyUpdate])
  useEffect(() => {
    const root = document.documentElement
    if (visible) root.dataset.update = '1'
    else delete root.dataset.update
    return () => { delete root.dataset.update }
  }, [visible])

  if (!visible) return null

  return (
    <div className="update-banner" role="alert">
      <span className="update-banner-dot" aria-hidden="true" />
      <div className="update-banner-txt">
        <b>{nextVersion ? <>Обновление <span className="version-number">{nextVersion}</span></> : 'Новая версия'}</b>
        {nextHeadline && <small>{nextHeadline}</small>}
      </div>
      <button className="update-banner-go" onClick={applyUpdate}>
        Обновить
      </button>
      <button className="update-banner-close" onClick={snooze} aria-label="Позже">
        &times;
      </button>
    </div>
  )
}
