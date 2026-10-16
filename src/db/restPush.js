// ============================================================================
// Пуш «Отдых закончился» (v8.8.0, таймер отдыха; сервер — supabase/rest-push.sql,
// Edge push-rest). Свернутое приложение на iPhone заморожено, поэтому позвать по
// окончании отдыха может только сервер: при старте отдыха ставим пуш на ЭТО
// устройство, при «Пропустить», сохранении и конце отдыха в открытом приложении —
// снимаем (сигнал дает само приложение, пуш был бы дублем).
//
// Онлайн-операция вне очередей синка (как db/push.js): это сигнал устройства, а не
// данные тренировки; без сети ставить его бессмысленно, копить — тем более.
// Все сбои тихие: таймер в приложении работает и без пуша.
// ============================================================================
import { supabase, hasSession } from './supabase.js'
import { withTimeout } from '../lib/withTimeout.js'
import { deviceSubscriptionEndpoint } from './push.js'
import { createSerialQueue } from '../lib/serialQueue.js'

const RPC_MS = 8000

// Поставить и снять — строго по очереди (аудит 16.10, 🟢-4): у «поставить» перед RPC два
// await, у «снять» — один, и при быстром «старт → Стоп» снятие обгоняло постановку —
// пуш приходил после остановки. Так же частые ±15 с больше не путают порядок.
const queue = createSerialQueue()

async function ready(userId) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  return hasSession(userId)
}

// true — пуш поставлен; false — нечего ставить (нет подписки/сети/сессии) или сбой.
export function scheduleRestPush(userId, args) {
  return queue(() => setNow(userId, args))
}

async function setNow(userId, { inSec, title, body }) {
  try {
    if (!(await ready(userId))) return false
    const endpoint = await deviceSubscriptionEndpoint(userId)
    if (!endpoint) return false
    const sec = Math.max(1, Math.min(900, Math.round(Number(inSec) || 0)))
    const res = await withTimeout(supabase.rpc('rest_push_set', {
      p_endpoint: endpoint, p_in_sec: sec, p_title: title, p_body: body,
    }), RPC_MS)
    return !res.error && res.data === true
  } catch {
    return false
  }
}

export function cancelRestPush(userId) {
  return queue(() => clearNow(userId))
}

async function clearNow(userId) {
  try {
    if (!(await ready(userId))) return false
    const res = await withTimeout(supabase.rpc('rest_push_clear'), RPC_MS)
    return !res.error
  } catch {
    return false
  }
}
