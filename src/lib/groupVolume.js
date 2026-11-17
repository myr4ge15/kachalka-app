// ============================================================================
// Динамика объема по группам мышц (v6.5.0, экран «Восстановление») — ЧИСТАЯ логика.
//
// BACKLOG «Прогресс вместо тоннажа и динамика по группам», развилка решена так:
// мерим РАБОЧИЕ ПОДХОДЫ, а не тоннаж. Подходы — стандартная мера объема, и она
// работает для упражнений без веса (повторы/время), где тоннаж = 0.
//
// Окно — WEEKS скользящих 7-дневных корзин, считая от `now` (не календарные
// недели: в понедельник утром «эта неделя» была бы пустой и врала бы спадом).
// Дельта — последние HALF недель против HALF предыдущих: одна неделя слишком
// шумная (пропустил день — уже «−40%»).
//
// Подход засчитывается ОСНОВНОЙ группе упражнения (muscle_group); вторичные мышцы
// не считаем — как и таймер восстановления, вторичная нагрузка его не двигает.
// Пустые строки (reps = 0) — не подход.
// ============================================================================
import { mainEntries } from './entries.js'
import { isNonMuscleGroup, majorOf, WARMUP_GROUP } from './muscles.js'

export const WEEKS = 4
const HALF = WEEKS / 2
const DAY_MS = 24 * 60 * 60 * 1000
// Порог «без изменений»: колебания в ±10% — шум, а не тренд.
export const FLAT_PCT = 10

function groupOfEntry(e, submuscle) {
  const ex = e?.exercise ?? {}
  return ex.muscle_group || e?.muscle_group || majorOf(submuscle) || null
}

const isWorkingSet = (s) => Number(s?.reps) > 0

// workouts — свои тренировки (без удаленных), now — Date или ms.
// Возвращает строки по группам, отсортированные по объему последних недель:
//   { group, weeks: [старшая … текущая] (подходы в каждой корзине),
//     recent, prev (суммы половин), perWeek (среднее за последние HALF),
//     muscles: [{ submuscle, perWeek }] за те же HALF недель (null — без разметки),
//     trend: 'up' | 'down' | 'flat' | 'new' | 'gone', pct (целое, null для new/gone) }
export function groupVolumeTrend(workouts, now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  const byGroup = new Map()
  for (const w of workouts ?? []) {
    if (!w || w._deleted) continue
    const t = Date.parse(w.performed_at)
    if (!Number.isFinite(t)) continue
    const age = nowMs - t
    if (age < 0 || age >= WEEKS * 7 * DAY_MS) continue
    const bucket = WEEKS - 1 - Math.floor(age / (7 * DAY_MS)) // 0 — старшая, WEEKS-1 — текущая
    for (const e of mainEntries(w)) {
      const submuscle = e?.submuscle ?? e?.exercise?.submuscle
      const g = groupOfEntry(e, submuscle)
      // Разминка (v8.2.0) — не мышечная работа: ее «подходы» объем групп не растят.
      // Кардио остается строкой, как было.
      if (!g || g === WARMUP_GROUP) continue
      const n = (e.sets ?? []).filter(isWorkingSet).length
      if (!n) continue
      if (!byGroup.has(g)) byGroup.set(g, { weeks: Array(WEEKS).fill(0), byMuscle: new Map() })
      const { weeks, byMuscle } = byGroup.get(g)
      weeks[bucket] += n
      if (bucket >= HALF && !isNonMuscleGroup(g) && majorOf(submuscle) === g) {
        byMuscle.set(submuscle, (byMuscle.get(submuscle) ?? 0) + n)
      }
    }
  }

  const rows = []
  for (const [group, { weeks, byMuscle }] of byGroup) {
    const prev = weeks.slice(0, HALF).reduce((a, b) => a + b, 0)
    const recent = weeks.slice(HALF).reduce((a, b) => a + b, 0)
    let trend
    let pct = null
    if (prev === 0) trend = 'new'
    else if (recent === 0) trend = 'gone'
    else {
      pct = Math.round(((recent - prev) / prev) * 100)
      trend = pct >= FLAT_PCT ? 'up' : pct <= -FLAT_PCT ? 'down' : 'flat'
    }
    const muscles = [...byMuscle]
      .sort(([a, aSets], [b, bSets]) => bSets - aSets || a.localeCompare(b))
      .map(([submuscle, sets]) => ({ submuscle, perWeek: sets / HALF }))
    const unassigned = recent - [...byMuscle.values()].reduce((sum, sets) => sum + sets, 0)
    if (muscles.length && unassigned > 0) muscles.push({ submuscle: null, perWeek: unassigned / HALF })
    rows.push({ group, weeks, recent, prev, perWeek: recent / HALF, muscles, trend, pct })
  }
  return rows.sort((a, b) => b.recent - a.recent || b.prev - a.prev || a.group.localeCompare(b.group, 'ru'))
}

// Подпись тренда для бейджа строки.
export function trendLabel(row) {
  switch (row?.trend) {
    case 'up': return `▲ +${row.pct}%`
    case 'down': return `▼ −${Math.abs(row.pct)}%`
    case 'flat': return '≈ ровно'
    case 'new': return 'новое'
    case 'gone': return 'пауза'
    default: return ''
  }
}
