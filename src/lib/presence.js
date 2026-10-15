// «В сети» и «был(а) …» (v8.6.0, обращения fb_34573163 и fb_d3fe3a5c). Чистая логика:
// отметка «открыл приложение» → статус для профиля друга и точка на аватарке.
// Отметку шлет каждое устройство при запуске, возврате в приложение и раз в пару
// минут, пока оно на экране (db/presence.js); сервер пишет ее не чаще раза в минуту
// (supabase/presence.sql). Поэтому «в сети» — была отметка за последние 5 минут.

export const ONLINE_MS = 5 * 60 * 1000

export function isOnline(lastSeen, now = Date.now()) {
  if (!lastSeen) return false
  const t = new Date(lastSeen).getTime()
  return Number.isFinite(t) && now - t < ONLINE_MS
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const pad = (n) => String(n).padStart(2, '0')
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

// Глагол по полу из ростера: m → «был», f → «была», не задан → «был(а)».
export function wasVerb(sex) {
  return sex === 'f' ? 'была' : sex === 'm' ? 'был' : 'был(а)'
}

// Строка под именем в профиле друга. null — отметки нет (еще не заходил с новой версии
// или сервер без presence.sql): лучше промолчать, чем написать «давно».
export function presenceLabel(lastSeen, { sex = null, now = Date.now() } = {}) {
  if (!lastSeen) return null
  const seen = new Date(lastSeen)
  const t = seen.getTime()
  if (!Number.isFinite(t)) return null
  if (now - t < ONLINE_MS) return 'в сети'
  const verb = wasVerb(sex)
  const mins = Math.floor((now - t) / 60000)
  if (mins < 60) return `${verb} ${mins} мин назад`
  const nowD = new Date(now)
  const day = startOfDay(nowD)
  if (t >= day) return `${verb} сегодня в ${hm(seen)}`
  if (t >= day - 24 * 3600 * 1000) return `${verb} вчера в ${hm(seen)}`
  const date = `${seen.getDate()} ${MONTHS[seen.getMonth()]}`
  return seen.getFullYear() === nowD.getFullYear() ? `${verb} ${date}` : `${verb} ${date} ${seen.getFullYear()}`
}
