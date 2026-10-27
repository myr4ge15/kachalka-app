import { useEffect, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getViewAll, refreshViewAll } from '../db/adminViewAll.js'
import { viewAllActive, viewAllExtra } from '../lib/viewAll.js'

// «Видеть всех» (27.10.2026, PLAN-admin-view-all.md): снимок режима из meta — null, если режима нет.
export function useViewAll() {
  return useLiveQuery(() => getViewAll(), [], null) ?? null
}

// «Чужие» — Set(userId), кого видно только из-за режима (метка, без действий).
export function useViewAllExtra() {
  const state = useViewAll()
  return useMemo(() => viewAllExtra(state), [state])
}

// App ставит один раз на вошедшего админа: сверка с сервером при входе и возврате в
// приложение, конец срока — по таймеру (сервер скажет «нет» → чистка). Возвращает снимок,
// пока режим идет, иначе null.
export function useViewAllWatch(user) {
  const userId = user?.id ?? null
  const isAdmin = user?.role === 'admin'
  const state = useViewAll()

  useEffect(() => {
    if (!isAdmin || !userId) return
    const check = () => { if (!document.hidden) refreshViewAll(userId) }
    check()
    document.addEventListener('visibilitychange', check)
    window.addEventListener('online', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('online', check)
    }
  }, [isAdmin, userId])

  const until = state?.until ?? null
  useEffect(() => {
    if (!isAdmin || !userId || !until) return
    // Секунда сверху: сервер должен уже считать срок вышедшим. Истекший — сразу.
    const ms = Math.max(0, Date.parse(until) - Date.now()) + 1000
    const t = setTimeout(() => refreshViewAll(userId), ms)
    return () => clearTimeout(t)
  }, [isAdmin, userId, until])

  return isAdmin && viewAllActive(state) ? state : null
}
