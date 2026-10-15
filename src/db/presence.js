// ============================================================================
// «В сети» (v8.6.0): отметка «я открыл приложение» и отметки тех, кого я вижу.
// Сервер — supabase/presence.sql (touch_my_presence / presence_visible, права в SQL:
// видно ровно тех, кого видно в Ленте). Чистая логика статуса — lib/presence.js.
//
// Не через очереди sync.js: отметка — сигнал устройства «сейчас», а не данные
// человека; офлайн ее незачем копить (как подписка на пуши). Чтение — витрина без
// кэша на диске: устаревшее «в сети» хуже, чем никакого.
// ============================================================================
import { supabase, hasSession } from './supabase.js'
import { withTimeout } from '../lib/withTimeout.js'

// Устройство отмечается не чаще раза в 2 минуты (сервер и так пишет не чаще раза в
// минуту): «в сети» — отметка за последние 5 минут (lib/presence.js ONLINE_MS).
export const TOUCH_EVERY_MS = 2 * 60 * 1000
// Чужие отметки перечитываем раз в минуту, пока экран с ними открыт.
export const FETCH_EVERY_MS = 60 * 1000

let lastTouch = -Infinity
// Никогда не бросает: «в сети» не стоит ни одной ошибки на экране.
export async function touchPresence(userId, now = Date.now()) {
  if (!userId || (typeof navigator !== 'undefined' && navigator.onLine === false)) return
  if (now - lastTouch < TOUCH_EVERY_MS - 5000) return
  try {
    if (!(await hasSession(userId))) return
    lastTouch = now
    await withTimeout(supabase.rpc('touch_my_presence'), 8000)
  } catch { /* не критично: отметимся в следующий раз */ }
}

// Общий для всех экранов снимок: Map(userId → last_seen_at ISO).
let snapshot = new Map()
let fetchedAt = -Infinity
let inflight = null
const listeners = new Set()

export function getPresence() {
  return snapshot
}

export function subscribePresence(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Перечитать отметки (не чаще FETCH_EVERY_MS, параллельные вызовы — один запрос).
// Нет функции на сервере, сети или сессии — снимок не трогаем.
export async function refreshPresence(userId, { force = false, now = Date.now() } = {}) {
  if (!userId || (typeof navigator !== 'undefined' && navigator.onLine === false)) return snapshot
  if (!force && now - fetchedAt < FETCH_EVERY_MS - 5000) return snapshot
  if (inflight) return inflight
  inflight = (async () => {
    try {
      if (!(await hasSession(userId))) return snapshot
      const { data, error } = await withTimeout(supabase.rpc('presence_visible'), 8000)
      if (error || !Array.isArray(data)) return snapshot
      fetchedAt = now
      snapshot = new Map(data.filter((r) => r?.user_id).map((r) => [r.user_id, r.last_seen_at]))
      for (const fn of listeners) fn()
      return snapshot
    } catch {
      return snapshot
    } finally {
      inflight = null
    }
  })()
  return inflight
}

// Для тестов и выхода из учетки: чужие отметки другому человеку не показываем.
export function resetPresence() {
  snapshot = new Map()
  fetchedAt = -Infinity
  lastTouch = -Infinity
  inflight = null
  for (const fn of listeners) fn()
}
