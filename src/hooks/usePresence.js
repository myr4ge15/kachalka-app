import { useEffect, useSyncExternalStore } from 'react'
import { getPresence, refreshPresence, subscribePresence, touchPresence, FETCH_EVERY_MS, TOUCH_EVERY_MS } from '../db/presence.js'

// Пока приложение на экране — раз в period зовем fn; при возврате в приложение и
// появлении сети — сразу. Скрытую вкладку не дергаем.
function useWhileVisible(fn, period, deps) {
  useEffect(() => {
    let timer = null
    const tick = () => { if (!document.hidden) fn() }
    const start = () => { clearInterval(timer); timer = setInterval(tick, period) }
    const onVisible = () => { if (!document.hidden) { fn(); start() } else clearInterval(timer) }
    tick()
    start()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

// «Я тут» (v8.6.0): App ставит один раз на вошедшего.
export function usePresenceHeartbeat(userId) {
  useWhileVisible(() => { touchPresence(userId) }, TOUCH_EVERY_MS, [userId])
}

// Отметки видимых участников — Map(userId → last_seen_at). Экраны с аватарками друзей.
export function usePresence(userId) {
  const presence = useSyncExternalStore(subscribePresence, getPresence, getPresence)
  useWhileVisible(() => { refreshPresence(userId) }, FETCH_EVERY_MS, [userId])
  return presence
}
