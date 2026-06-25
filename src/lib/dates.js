// ============================================================================
// Форматирование дат для UI. Чистые функции (без Dexie/сети) — тестируются в node.
// Вынесено из FeedScreen/NotificationsScreen, где fmtWhen дублировался один-в-один.
// ============================================================================

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

// «сегодня / вчера · ЧЧ:ММ» для свежих дат, иначе «дд.мм.гггг» (как в ленте и
// уведомлениях). Пустой/невалидный вход → ''.
export function fmtWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (sameDay(d, today)) return `сегодня · ${time}`
  if (sameDay(d, yesterday)) return `вчера · ${time}`
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
