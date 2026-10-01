// Состояние строки «Пуш-уведомления» в Настройках (v6.6.0): что умеет этот
// браузер, включены ли уведомления, идет ли переключение, текст ошибки.
// v6.7.0: плюс настройки по типам (prefs) — грузим, когда пуши включены.
// Работа с браузером и сервером — в db/push.js; отрисовка — components/PushToggle.jsx
// и components/PushTypes.jsx.
import { useCallback, useEffect, useRef, useState } from 'react'
import { getPushState, enablePush, disablePush, getPushPrefs, setPushPref } from '../db/push.js'

export function usePushToggle(userId) {
  const [state, setState] = useState({ availability: null, enabled: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const aliveRef = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const s = await getPushState(userId)
      if (aliveRef.current) setState(s)
    } catch {
      if (aliveRef.current) setState({ availability: 'unsupported', enabled: false })
    }
  }, [userId])

  useEffect(() => {
    aliveRef.current = true
    refresh()
    // Вернулись из настроек телефона (разрешили/запретили уведомления) — перечитать.
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      aliveRef.current = false
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  // v6.7.1: тумблер переключается СРАЗУ (оптимистично), при ошибке — откат и
  // перечитывание реального состояния. После успеха браузер заново НЕ спрашиваем:
  // свежая подписка видна getSubscription() не мгновенно (iPhone), и перечитывание
  // откатывало тумблер в «выкл» — включалось только со второго тапа.
  const busyRef = useRef(false)
  const toggle = useCallback(async (next) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    setState((s) => ({ ...s, enabled: next }))
    try {
      if (next) await enablePush(userId)
      else await disablePush(userId, { background: true })
    } catch (e) {
      if (aliveRef.current) {
        setState((s) => ({ ...s, enabled: !next }))
        setError(e?.message || 'Не получилось. Попробуй еще раз.')
      }
      await refresh()
    } finally {
      busyRef.current = false
      if (aliveRef.current) setBusy(false)
    }
  }, [userId, refresh])

  // Настройки по типам: null — еще не загрузили; prefsError — почему не загрузили.
  const [prefs, setPrefs] = useState(null)
  const [prefsError, setPrefsError] = useState('')
  const [prefsBusy, setPrefsBusy] = useState(null) // тип, который сейчас сохраняется
  const enabled = state.enabled
  useEffect(() => {
    if (!enabled) return
    let alive = true
    getPushPrefs(userId)
      .then((p) => { if (alive) { setPrefs(p); setPrefsError('') } })
      .catch((e) => { if (alive) setPrefsError(e?.message || 'Не удалось загрузить настройки.') })
    return () => { alive = false }
  }, [enabled, userId])

  // Оптимистично: тумблер переключается сразу, при ошибке — откат и текст ошибки.
  const setType = useCallback(async (type, on) => {
    const before = prefs
    setPrefs((p) => ({ ...(p ?? {}), [type]: on }))
    setPrefsBusy(type)
    setPrefsError('')
    try {
      const saved = await setPushPref(userId, type, on)
      if (aliveRef.current) setPrefs(saved)
    } catch (e) {
      if (aliveRef.current) {
        setPrefs(before)
        setPrefsError(e?.message || 'Не удалось сохранить.')
      }
    } finally {
      if (aliveRef.current) setPrefsBusy(null)
    }
  }, [prefs, userId])

  return { ...state, busy, error, toggle, prefs, prefsError, prefsBusy, setType }
}
