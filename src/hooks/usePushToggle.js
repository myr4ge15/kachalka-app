// Состояние строки «Пуш-уведомления» в Настройках (v6.6.0): что умеет этот
// браузер, включены ли уведомления, идет ли переключение, текст ошибки.
// Работа с браузером и сервером — в db/push.js; отрисовка — components/PushToggle.jsx.
import { useCallback, useEffect, useRef, useState } from 'react'
import { getPushState, enablePush, disablePush } from '../db/push.js'

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

  const toggle = useCallback(async (next) => {
    setBusy(true)
    setError('')
    try {
      if (next) await enablePush(userId)
      else await disablePush(userId)
    } catch (e) {
      if (aliveRef.current) setError(e?.message || 'Не получилось. Попробуй еще раз.')
    } finally {
      await refresh()
      if (aliveRef.current) setBusy(false)
    }
  }, [userId, refresh])

  return { ...state, busy, error, toggle }
}
