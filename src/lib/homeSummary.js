// ============================================================================
// Домашняя сводка — данные персонального главного экрана (виш BACKLOG «✨ Домашняя
// сводка»): «5 секунд после открытия». Чистый агрегатор БЕЗ Dexie/React/сети —
// собирает уже существующие цифры (последняя тренировка, серия, тоннаж, рекорд,
// цель, забытая группа) в один объект для HomeScreen. Тестируется в node.
//
// Ничего не считает заново, если это уже есть в profileStats/insights: серию и
// «за месяц» берем из profileStats, тоннаж-окна и день/группы — из insights.
// ============================================================================
import { currentStreak, currentBestValue, goalProgress } from './profileStats.js'
import { dayIndex, tonnageInWindow } from './insights.js'
import { mostNeglectedGroup } from './freshness.js'
import { daySubTags } from './dayTags.js'
import { normMetric, leadingValue } from './metric.js'
import { entryExId, sortDesc, currentExerciseShapes, entryUnitMetric, mainEntries } from './entries.js'
import { plural } from './plural.js'
import { toDate } from './calendar.js'

function localDayKey(value) {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function mondayOf(value) {
  const d = new Date(value)
  d.setHours(12, 0, 0, 0)
  const shift = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - shift)
  return d
}

// Восемь понятных календарных недель для Главной (Пн–Вс), включая текущую.
// Несколько тренировок одного дня объединяются; будущие дни текущей недели
// явно помечены, чтобы не выглядеть как пропуски. Никакого отдельного
// хранилища/календаря не нужно.
export function buildTrainingRhythm(workouts, { now = new Date(), weeks = 8 } = {}) {
  const size = Math.max(1, Math.round(Number(weeks) || 8))
  const byDay = new Map()
  for (const w of sortDesc(workouts)) {
    const day = localDayKey(w.performed_at)
    if (!day) continue
    const rec = byDay.get(day) ?? { workouts: [], entries: [] }
    rec.workouts.push(w)
    rec.entries.push(...mainEntries(w))
    byDay.set(day, rec)
  }

  // Первый день с тренировкой вообще: недели, закончившиеся ДО него, помечаются
  // beforeFirst — это «еще не пользовался приложением», а не пропуски (Ритм не должен
  // считать их в среднее: новичок с одной тренировкой видел «0,1 в неделю»).
  const firstDay = [...byDay.keys()].sort()[0] ?? null

  const today = new Date(now)
  today.setHours(12, 0, 0, 0)
  const currentMonday = mondayOf(today)
  const out = []
  for (let weekOffset = size - 1; weekOffset >= 0; weekOffset--) {
    const start = new Date(currentMonday)
    start.setDate(currentMonday.getDate() - weekOffset * 7)
    const days = []
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const d = new Date(start)
      d.setDate(start.getDate() + dayOffset)
      const day = localDayKey(d)
      const rec = byDay.get(day)
      days.push({
        day,
        count: rec?.workouts.length ?? 0,
        tags: rec ? daySubTags(rec.entries) : [],
        today: day === localDayKey(today),
        future: d > today,
      })
    }
    out.push({
      key: localDayKey(start),
      start: days[0].day,
      end: days[6].day,
      current: weekOffset === 0,
      beforeFirst: firstDay === null || days[6].day < firstDay,
      count: days.reduce((sum, d) => sum + d.count, 0),
      days,
    })
  }
  return out
}

// Последний зафиксированный личный рекорд (свежайший по дате): идем по истории от
// старых к новым, держим лучший ведущий показатель по упражнению и ловим момент
// превышения. Возвращаем самый недавний. { name, metric, value, at } | null.
// Максимум — отдельно по каждой единице (exId + метрика записи), имя — из свежего
// снимка: после смены типа/переименования упражнения старые снимки в тренировках
// не обновляются, и 12 повторов иначе «били» старые 10 кг (РЕВЬЮ-КОДА-2026-10-02,
// п. 17). Та же семантика, что у records.minePrs.
function latestPr(sorted, shapes) {
  const chron = [...sorted].reverse() // старые → новые
  const best = new Map()
  let last = null
  for (const w of chron) {
    for (const e of mainEntries(w)) {
      const exId = entryExId(e)
      if (!exId) continue
      const shape = shapes.get(exId)
      const m = entryUnitMetric(e, shape?.metric)
      // Ведущее значение подхода (макс. вес / повторов / секунд) — общий leadingValue
      // из metric.js вместо инлайнового `weight?:reps` (иначе 4-я метрика тихо разъедется).
      const value = leadingValue(m, e.sets ?? [])
      if (value <= 0) continue
      const key = `${exId}:${m}`
      const prev = best.get(key) ?? 0
      if (value > prev) {
        if (prev > 0) last = { name: shape?.name ?? e.name ?? e.exercise?.name ?? '—', metric: m, value, at: w.performed_at }
        best.set(key, value)
      }
    }
  }
  return last
}

// «Забытая группа» (самая просроченная) переехала в общий движок свежести —
// mostNeglectedGroup из lib/freshness.js (там же recovery/дисбаланс/heatmap).

// Ближайшая к достижению активная цель. goals — массив (readGoals), workouts —
// свои тренировки (для текущего рекорда). Считаем прогресс, берем с наибольшим %.
function nearestGoal(goals, sorted) {
  const active = (goals ?? []).filter((g) => !g._deleted && !g.achievedAt && g.exerciseId && g.targetWeight)
  let best = null
  for (const g of active) {
    const m = normMetric(g.metric)
    const current = currentBestValue(sorted, g.exerciseId, m)
    const pct = goalProgress(current, g.targetWeight)
    const left = Math.max(0, Number(g.targetWeight) - current)
    const reps = m === 'weight' && Number(g.targetReps) > 0 ? Math.round(Number(g.targetReps)) : 0
    // Цель «вес × повторы»: вес взят, а нужного числа повторов еще не было (иначе
    // цель была бы достигнута и сюда не попала). Главная говорит, чего не хватает
    // (как список целей в Профиле), а не «осталось: 0 кг».
    const waitingForReps = reps > 0 && pct >= 100
    const cand = { name: g.exerciseName ?? '—', metric: m, target: g.targetWeight, current, pct, left, reps, waitingForReps }
    if (!best || pct > best.pct) best = cand
  }
  return best
}

// Полная сводка. Пустая история → { hasData:false } + нули (экран покажет empty).
// Предел осмысленного роста тоннажа к прошлым 30 дням, %.
export const TONNAGE_PCT_MAX = 300

const PROGRESS_DAYS = 30
const progressDate = (day) => new Date(day * 86400000).toISOString().slice(0, 10)

function exerciseProgress(sorted, today, shapes) {
  const recent = new Map()
  for (const w of sorted) {
    if (!w.performed_at) continue
    const age = today - dayIndex(toDate(w.performed_at))
    if (!(age >= 0 && age < PROGRESS_DAYS * 2)) continue
    for (const entry of mainEntries(w)) {
      const id = entryExId(entry)
      if (!id) continue
      const shape = shapes.get(id)
      const metric = entryUnitMetric(entry, shape?.metric)
      const value = leadingValue(metric, entry.sets ?? [])
      if (!(value > 0)) continue
      if (age < PROGRESS_DAYS && !recent.has(id)) {
        recent.set(id, { id, name: shape?.name ?? entry.exercise?.name ?? '—', metric, before: 0, after: 0 })
      }
      const result = recent.get(id)
      if (result?.metric !== metric) continue
      const period = age < PROGRESS_DAYS ? 'after' : 'before'
      result[period] = Math.max(result[period], value)
    }
  }
  const compared = [...recent.values()].filter((e) => e.before > 0)
  return {
    total: compared.length,
    improved: compared.filter((e) => e.after > e.before),
    previous: [progressDate(today - PROGRESS_DAYS * 2 + 1), progressDate(today - PROGRESS_DAYS)],
    latest: [progressDate(today - PROGRESS_DAYS + 1), progressDate(today)],
  }
}

export function buildHomeSummary({ workouts, goals, now = new Date() } = {}) {
  const sorted = sortDesc(workouts)
  if (!sorted.length) {
    return {
      hasData: false,
      lastWorkout: null,
      nextFocus: null,
      streak: 0,
      workouts30: 0,
      tonnage: { month: 0, prevMonth: 0, pct: 0 },
      latestPr: null,
      nearestGoal: null,
      rhythm: [],
      progress: { total: 0, improved: [] },
    }
  }

  const last = sorted[0]
  const today = dayIndex(now)
  const shapes = currentExerciseShapes(sorted)
  const lastWorkout = {
    at: last.performed_at,
    daysAgo: today - dayIndex(new Date(last.performed_at)),
    tags: daySubTags(mainEntries(last)),
  }

  const month = tonnageInWindow(sorted, now, 30, 0)
  // Тренировок в ТОМ ЖЕ окне 30 дней, что и тоннаж (v6.5.1). Было «в этом месяце»:
  // 1-го числа плитка писала «0 трен.» рядом с тоннажем за 30 дней — читалось как ошибка.
  const workouts30 = sorted.filter((w) => w.performed_at && today - dayIndex(new Date(w.performed_at)) < 30).length
  const prevMonth = tonnageInWindow(sorted, now, 60, 30)
  // Рост больше чем вчетверо — не прогресс, а почти пустой прошлый период (только начал записывать):
  // «+1698%» ничего не сообщает (обращение fb_571f6d88). 0 = плитка дельту не показывает.
  const raw = prevMonth > 0 ? Math.round(((month - prevMonth) / prevMonth) * 100) : 0
  const pct = raw > TONNAGE_PCT_MAX ? 0 : raw

  return {
    hasData: true,
    lastWorkout,
    nextFocus: mostNeglectedGroup(sorted, now),
    streak: currentStreak(sorted, now),
    workouts30,
    tonnage: { month, prevMonth, pct },
    latestPr: latestPr(sorted, shapes),
    nearestGoal: nearestGoal(goals, sorted),
    rhythm: buildTrainingRhythm(sorted, { now }),
    progress: exerciseProgress(sorted, today, shapes),
  }
}

// Склонение «день/дня/дней» под число — общий lib/plural.js.
const dayWord = (n) => plural(n, 'день', 'дня', 'дней')

// «сегодня / вчера / N дней назад» — для строки последней тренировки.
export function fmtDaysAgo(days) {
  const n = Math.max(0, Math.round(Number(days) || 0))
  if (n === 0) return 'сегодня'
  if (n === 1) return 'вчера'
  return `${n} ${dayWord(n)} назад`
}

// «N дней» без «назад» — для длительности («не тренировал 18 дней»).
export function fmtDays(days) {
  const n = Math.max(0, Math.round(Number(days) || 0))
  return `${n} ${dayWord(n)}`
}
