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

// «дд.мм.гггг» — короткая дата тренировки (заголовок деталей + метка в композере).
// Вынесено из WorkoutScreen. Всегда числовой формат, без «сегодня/вчера».
export function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

// ISO-дата (performed_at) → YYYY-MM-DD для <input type=date> в ЛОКАЛЬНОМ поясе
// (сдвигаем на offset, иначе около полуночи UTC день «уезжает»).
export function toDateInput(iso) {
  const d = iso ? new Date(iso) : new Date()
  const off = d.getTimezoneOffset() * 60000
  return new Date(d - off).toISOString().slice(0, 10)
}

// YYYY-MM-DD из <input type=date> → ISO, СОХРАНЯЯ время суток исходной даты
// (или текущее, если её нет): меняем только календарный день.
export function fromDateInput(value, prevIso) {
  const base = prevIso ? new Date(prevIso) : new Date()
  const [y, m, d] = value.split('-').map(Number)
  base.setFullYear(y, m - 1, d)
  return base.toISOString()
}

// «N назад» — относительная свежесть (для метки обновления Ленты). На вход — метка
// времени в мс (Date.now()) и текущее время (инъектируется в тестах). Единицы —
// сокращённые (мин/ч/дн), чтобы обойти русскую плюрализацию. Пустой/невалидный/
// будущий вход → ''.
export function fmtAgo(updatedMs, now = Date.now()) {
  const t = Number(updatedMs)
  if (!Number.isFinite(t) || t <= 0) return ''
  if (t > now) return '' // будущая метка (рассинхрон часов) → пусто, как обещает дока
  const sec = Math.floor((now - t) / 1000)
  if (sec < 45) return 'только что'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} мин назад`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} ч назад`
  return `${Math.round(hr / 24)} дн назад`
}
