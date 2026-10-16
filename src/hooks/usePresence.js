import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getUsers } from '../db/repo.js'
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

// Пол из ростера — Map(userId → 'm'|'f'): «был»/«была» вместо «был(а)» в списках друзей
// и участников круга (обращение fb_242bb1bb; MemberScreen берет пол так же — из ростера).
export function useRosterSex() {
  const roster = useLiveQuery(() => getUsers(), [], [])
  return useMemo(() => new Map((roster ?? []).filter((u) => u.sex).map((u) => [u.id, u.sex])), [roster])
}
