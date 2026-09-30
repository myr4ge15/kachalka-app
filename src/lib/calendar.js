// ============================================================================
// Календарь тренировок (v6.3.0, «Мои тренировки» → иконка календаря). Чистая
// логика без React/Dexie: сетка месяца (неделя с понедельника) и раскладка
// тренировок по локальным дням. День — строка 'YYYY-MM-DD' в ЛОКАЛЬНОМ поясе
// (как в Ритме Главной), поэтому поздняя тренировка не «уезжает» на соседний день.
// ============================================================================

// 'YYYY-MM-DD' — день без времени: берём местный полдень, иначе new Date() читает
// строку как UTC-полночь и к западу от Гринвича день «уезжает» назад.
export function toDate(value) {
  if (value instanceof Date) return value
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T12:00:00`)
  return new Date(value)
}

export function localYmd(value) {
  const d = toDate(value)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// { year, month } (month 0–11) ± n месяцев.
export function shiftMonth({ year, month }, n) {
  const d = new Date(year, month + n, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

export function monthOf(value) {
  const d = toDate(value)
  return { year: d.getFullYear(), month: d.getMonth() }
}

// Сетка месяца: 4–6 недель × 7 дней, понедельник первым. Дни соседних месяцев
// присутствуют (inMonth:false), чтобы сетка была ровной.
export function monthGrid({ year, month }, { today = new Date() } = {}) {
  const first = new Date(year, month, 1, 12)
  const shift = (first.getDay() + 6) % 7 // Пн = 0
  const start = new Date(year, month, 1 - shift, 12)
  const todayYmd = localYmd(today)
  const weeks = []
  const cur = new Date(start)
  do {
    const week = []
    for (let i = 0; i < 7; i++) {
      const ymd = localYmd(cur)
      week.push({ ymd, day: cur.getDate(), inMonth: cur.getMonth() === month, today: ymd === todayYmd, future: ymd > todayYmd })
      cur.setDate(cur.getDate() + 1)
    }
    weeks.push(week)
  } while (cur.getMonth() === month && weeks.length < 6)
  return weeks
}

// Тренировки по дням: Map ymd → [workout] (свежие первыми, как пришли).
export function workoutsByDay(workouts) {
  const map = new Map()
  for (const w of workouts ?? []) {
    const ymd = localYmd(w?.performed_at)
    if (!ymd) continue
    if (!map.has(ymd)) map.set(ymd, [])
    map.get(ymd).push(w)
  }
  return map
}

// Сколько тренировок в месяце (по уже разложенной карте).
export function countInMonth(byDay, { year, month }) {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`
  let n = 0
  for (const [ymd, list] of byDay) if (ymd.startsWith(prefix)) n += list.length
  return n
}

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
export const monthTitle = ({ year, month }) => `${MONTHS[month]} ${year}`
export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
