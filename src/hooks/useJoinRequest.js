import { useCallback, useEffect, useRef, useState } from 'react'
import { loadPending, savePending, clearPending, pollJoin, joinPollDelay } from '../lib/joinRequest.js'

// Заявка «Запросить доступ» на экране входа (вынесено из LoginScreen, аудит 14.10):
// ожидающая заявка живет в localStorage (lib/joinRequest.js), экран спрашивает ее
// статус при открытии, а пока она ждет — переспрашивает сам (v6.14.3): часто первые
// минуты, потом реже (joinPollDelay); при возврате во вкладку, фокусе и появлении
// сети — сразу. Скрытую вкладку не дергаем. Одобрили — onInvite(token).
export function useJoinRequest(onInvite) {
  const [pending, setPending] = useState(() => loadPending())
  const [joinNote, setJoinNote] = useState(null) // 'declined' | null
  const alive = useRef(true)
  // Свежие pending/onInvite для таймера и слушателей, не пересоздавая их.
  const latest = useRef({ pending, onInvite })
  useEffect(() => { latest.current = { pending, onInvite } })
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  // Один запрос за раз: таймер, возврат во вкладку и «Проверить» могут совпасть.
  const polling = useRef(false)
  const checkJoin = useCallback(async () => {
    const p = latest.current.pending
    if (!p || p.token || !navigator.onLine || polling.current) return
    polling.current = true
    try {
      const res = await pollJoin(p)
      if (!alive.current) return
      if (res.token) {
        const next = { ...p, token: res.token }
        savePending(next)
        setPending(next)
        latest.current.onInvite?.(res.token)
      } else if (res.status === 'declined') {
        clearPending(); setPending(null); setJoinNote('declined')
      } else if (res.status !== 'new' && res.status !== 'approved') {
        clearPending(); setPending(null) // claimed без токена / invalid — забыть молча
      }
    } catch { /* нет сети — проверим в следующий раз */ } finally {
      polling.current = false
    }
  }, [])

  useEffect(() => { checkJoin() }, [checkJoin])

  const waitingJoinId = pending && !pending.token ? pending.id : null
  useEffect(() => {
    if (!waitingJoinId) return undefined
    const started = Date.now()
    let timer = null
    let stopped = false
    const schedule = () => {
      timer = setTimeout(async () => {
        if (!document.hidden) await checkJoin()
        if (!stopped) schedule()
      }, joinPollDelay(Date.now() - started))
    }
    const checkNow = () => { if (!document.hidden) checkJoin() }
    schedule()
    document.addEventListener('visibilitychange', checkNow)
    window.addEventListener('focus', checkNow)
    window.addEventListener('online', checkNow)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', checkNow)
      window.removeEventListener('focus', checkNow)
      window.removeEventListener('online', checkNow)
    }
  }, [waitingJoinId, checkJoin])

  return {
    pending,
    joinNote,
    checkJoin,
    // Форма отправила заявку — ждем ответа, прежняя отметка «отклонили» больше не нужна.
    submitted: (p) => { setPending(p); setJoinNote(null) },
    // «Убрать» принятую или «Отменить» ожидающую.
    forget: () => { clearPending(); setPending(null) },
    clearNote: () => setJoinNote(null),
  }
}
