// «Ритм» на Главной (редизайн «Спорт-блоки», этап 3): столбик на неделю, число
// тренировок над ним, дата понедельника под ним, пунктир — среднее. Чистый
// расчет из недель buildTrainingRhythm (lib/homeSummary.js), без React/Dexie.
//
// Среднее — по ЗАВЕРШЕННЫМ неделям, начиная с недели первой тренировки:
//  • текущая еще идет, и ее неполный счет занижал бы среднее каждый понедельник;
//  • недели ДО первой тренировки (beforeFirst) — не пропуски, а «еще не пользовался»
//    (иначе новичок с одной тренировкой видел «0,1 тренировки в неделю за 7 недель»).
// Если среднее меньше одной тренировки в неделю, дробь не показываем — вместо нее
// честный итог «N тренировок за M недель» (mode: 'total'). Итог — по ВСЕМ столбикам
// графика, включая текущую неделю: «за 7 недель» при 8 столбиках читалось как ошибка
// (отзыв, v6.3.0). Если завершенных недель с начала еще нет (первая тренировка —
// на этой неделе), итог — «на этой неделе».
import { plural } from './plural.js'

const fmt1 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
const num = (w) => Number(w?.count) || 0

export function rhythmChart(weeks) {
  const list = Array.isArray(weeks) ? weeks : []
  const done = list.filter((w) => !w.current && !w.beforeFirst)
  const onlyCurrent = done.length === 0
  const base = onlyCurrent ? list.filter((w) => w.current) : done
  const baseTotal = base.reduce((n, w) => n + num(w), 0)
  const avg = base.length > 0 ? Math.round((baseTotal / base.length) * 10) / 10 : 0
  const mode = !onlyCurrent && avg >= 1 ? 'avg' : 'total'
  const max = Math.max(1, mode === 'avg' ? avg : 0, ...list.map(num))
  // avg: total/weeks — база среднего (завершенные недели); total: весь график.
  const whole = mode === 'total' && !onlyCurrent
  const total = whole ? list.reduce((n, w) => n + num(w), 0) : baseTotal
  return { mode, avg, total, max, weeks: whole ? list.length : base.length, onlyCurrent }
}

// «2,4» — с запятой и не больше одного знака.
export const fmtAvg = (avg) => fmt1.format(Number(avg) || 0)

// Дробное число — всегда «тренировки» («2,4 тренировки»), целое — по обычным правилам.
export const avgWord = (avg) => (Number.isInteger(Number(avg))
  ? plural(Number(avg), 'тренировка', 'тренировки', 'тренировок')
  : 'тренировки')

// Подпись под столбиком — понедельник недели «дд.мм» (у текущей тоже: ее выделяет
// цвет, а не слово — «эта» читалось плохо, v6.0.4).
export function mondayLabel(week) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(week?.start ?? '')
  return m ? `${m[3]}.${m[2]}` : ''
}
