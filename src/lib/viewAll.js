// «Видеть всех» — временный режим админа (27.10.2026, docs/plans/PLAN-admin-view-all.md).
// Чистая логика: срок, остаток, кого видно только из-за режима. Состояние режима лежит в
// персональной meta под VIEW_ALL_KEY (db/adminViewAll.js) — { until: ISO, extra: [userId] }.
// Не синкается: режим живет на сервере (admin_view_all), meta — его снимок на устройстве.

export const VIEW_ALL_KEY = 'view_all'

// Кнопки раздела Админки. Сервер принимает 5..240 минут.
export const VIEW_ALL_CHOICES = [
  { minutes: 30, label: 'На 30 минут' },
  { minutes: 120, label: 'На 2 часа' },
]

export function viewAllActive(state, now = Date.now()) {
  const t = Date.parse(state?.until ?? '')
  return Number.isFinite(t) && t > now
}

// «Чужие» — те, кого видно только из-за режима. Берем из снимка и после срока: пока не
// прошла чистка (db/adminViewAll.js endViewAll), их тренировки еще лежат в кэше Ленты.
export function viewAllExtra(state) {
  return new Set(Array.isArray(state?.extra) ? state.extra : [])
}

// Элементы Ленты без «чужих»: уведомления и офлайн-рейтинг по ним не строим.
export function withoutExtra(items, extra) {
  if (!extra?.size) return items ?? []
  return (items ?? []).filter((w) => !extra.has(w?.user_id))
}

// Остаток в минутах, округляя вверх: «1 мин» до последней секунды.
export function minutesLeft(until, now = Date.now()) {
  const t = Date.parse(until ?? '')
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.ceil((t - now) / 60000))
}

export function leftLabel(until, now = Date.now()) {
  const m = minutesLeft(until, now)
  if (m < 60) return `${m} мин`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} ч ${rest} мин` : `${h} ч`
}
