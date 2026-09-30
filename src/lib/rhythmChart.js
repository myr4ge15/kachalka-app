// «Ритм» на Главной (редизайн «Спорт-блоки», этап 3): столбик на неделю, число
// тренировок над ним, дата понедельника под ним, пунктир — среднее. Чистый
// расчёт из недель buildTrainingRhythm (lib/homeSummary.js), без React/Dexie.
//
// Среднее — по ЗАВЕРШЁННЫМ неделям: текущая ещё идёт, и её неполный счёт занижал бы
// среднее каждый понедельник. Если завершённых нет (новичок) — по всем, что есть.
import { plural } from './plural.js'

const fmt1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

export function rhythmChart(weeks) {
  const list = Array.isArray(weeks) ? weeks : []
  const done = list.filter((w) => !w.current)
  const base = done.length > 0 ? done : list
  const total = base.reduce((n, w) => n + (Number(w.count) || 0), 0)
  const avg = base.length > 0 ? Math.round((total / base.length) * 10) / 10 : 0
  const max = Math.max(1, avg, ...list.map((w) => Number(w.count) || 0))
  return { avg, max, avgWeeks: base.length }
}

// «2,4» — с запятой и не больше одного знака.
export const fmtAvg = (avg) => fmt1.format(Number(avg) || 0)

// Дробное число — всегда «тренировки» («2,4 тренировки»), целое — по обычным правилам.
export const avgWord = (avg) => (Number.isInteger(Number(avg))
  ? plural(Number(avg), 'тренировка', 'тренировки', 'тренировок')
  : 'тренировки')

// Подпись под столбиком: «эта» для текущей недели, иначе понедельник как «дд.мм».
export function mondayLabel(week) {
  if (week?.current) return 'эта'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(week?.start ?? '')
  return m ? `${m[3]}.${m[2]}` : ''
}
