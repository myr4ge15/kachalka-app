import { useCallback, useEffect, useState } from 'react'
import { getMyLogin } from '../lib/auth.js'

// Шаг «Придумай логин» (П4 «Мой круг», 07.10.2026). У старых учеток логина нет: вход
// пока работает по имени, но этот путь выключат следующим MINOR. Поэтому при первом
// открытии ОНЛАЙН — обязательный экран (сессия обновляется молча, и экрана входа
// может не быть неделями). Офлайн — пускаем: шаг ждет сети (повторим на 'online').
// Сбой проверки (нет своей сессии, сервер) — не блокируем, спросим в другой раз.
export function useLoginSetup(user) {
  const [needed, setNeeded] = useState(false)
  const userId = user?.id ?? null

  useEffect(() => {
    if (!userId) return undefined
    let alive = true
    const run = async () => {
      if (!navigator.onLine) return
      try {
        const login = await getMyLogin(userId)
        if (alive) setNeeded(login === null)
      } catch { /* нет сети/сессии — проверим при следующем онлайне */ }
    }
    run()
    window.addEventListener('online', run)
    return () => { alive = false; window.removeEventListener('online', run) }
  }, [userId])

  const done = useCallback(() => setNeeded(false), [])
  return { needed: Boolean(userId) && needed, done }
}
