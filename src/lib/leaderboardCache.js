// TTL-троттлинг обновления лидерборда с сервера. Чистая функция — покрыта тестами.
// Потребитель — src/db/leaderboard.js (fetchLeaderboard).
//
// Зачем: серверный RPC leaderboard_bench() пересчитывает рейтинг по ВСЕЙ истории
// (полный скан sets × workout_exercises × workouts) на КАЖДЫЙ вызов, а
// fetchLeaderboard дёргается при каждом входе на экран рейтинга и на каждый
// resume/online. Для закрытого круга данные крошечные, но частый полный пересчёт —
// лишняя нагрузка на бэкенд. Кэшируем снимок в Dexie и не ходим на сервер чаще,
// чем раз в LEADERBOARD_TTL_MS (экран всё равно читает из локального кэша мгновенно).

export const LEADERBOARD_TTL_MS = 60 * 1000 // не обновляем с сервера чаще раза в минуту

// Нужно ли идти на сервер: да, если снимок ещё ни разу не брали или он старше TTL.
// lastAtIso — ISO-время последнего УСПЕШНОГО обращения к RPC (из Dexie meta).
export function shouldRefetchLeaderboard(lastAtIso, nowMs, ttlMs = LEADERBOARD_TTL_MS) {
  if (!lastAtIso) return true
  const last = Date.parse(lastAtIso)
  if (!Number.isFinite(last)) return true
  return nowMs - last >= ttlMs
}
