// ============================================================================
// Домашняя сводка — данные персонального главного экрана (виш BACKLOG «✨ Домашняя
// сводка»): «5 секунд после открытия». Чистый агрегатор БЕЗ Dexie/React/сети —
// собирает уже существующие цифры (последняя тренировка, серия, тоннаж, рекорд,
// цель, забытая группа) в один объект для HomeScreen. Тестируется в node.
//
// Ничего не считает заново, если это уже есть в profileStats/insights: серию и
// «за месяц» берём из profileStats, тоннаж-окна и день/группы — из insights.
// ============================================================================
import { currentStreak, workoutsThisMonth, currentBestValue, goalProgress } from './profileStats.js'
import { dayIndex, tonnageInWindow } from './insights.js'
import { mostNeglectedGroup } from './freshness.js'
import { daySubTags } from './dayTags.js'
import { normMetric } from './metric.js'
import { entryExId, entryMetric, sortDesc } from './entries.js'

// Последний зафиксированный личный рекорд (свежайший по дате): идём по истории от
// старых к новым, держим лучший ведущий показатель по упражнению и ловим момент
// превышения. Возвращаем самый недавний. { name, metric, value, at } | null.
function latestPr(sorted) {
  const chron = [...sorted].reverse() // старые → новые
  const best = new Map()
  let last = null
  for (const w of chron) {
    for (const e of w.entries ?? []) {
      const exId = entryExId(e)
      if (!exId) continue
      const m = entryMetric(e)
      const value = (e.sets ?? []).reduce((mx, s) => {
        const v = m === 'weight' ? Number(s.weight) || 0 : Number(s.reps) || 0
        return Math.max(mx, v)
      }, 0)
      if (value <= 0) continue
      const prev = best.get(exId) ?? 0
      if (value > prev) {
        if (prev > 0) last = { name: e.name ?? e.exercise?.name ?? '—', metric: m, value, at: w.performed_at }
        best.set(exId, value)
      }
    }
  }
  return last
}

// «Забытая группа» (самая просроченная) переехала в общий движок свежести —
// mostNeglectedGroup из lib/freshness.js (там же recovery/дисбаланс/heatmap).

// Ближайшая к достижению активная цель. goals — массив (readGoals), workouts —
// свои тренировки (для текущего рекорда). Считаем прогресс, берём с наибольшим %.
function nearestGoal(goals, sorted) {
  const active = (goals ?? []).filter((g) => !g._deleted && !g.achievedAt && g.exerciseId && g.targetWeight)
  let best = null
  for (const g of active) {
    const m = normMetric(g.metric)
    const current = currentBestValue(sorted, g.exerciseId, m)
    const pct = goalProgress(current, g.targetWeight)
    const left = Math.max(0, Number(g.targetWeight) - current)
    const reps = m === 'weight' && Number(g.targetReps) > 0 ? Math.round(Number(g.targetReps)) : 0
    const cand = { name: g.exerciseName ?? '—', metric: m, target: g.targetWeight, current, pct, left, reps }
    if (!best || pct > best.pct) best = cand
  }
  return best
}

// Полная сводка. Пустая история → { hasData:false } + нули (экран покажет empty).
export function buildHomeSummary({ workouts, goals, now = new Date() } = {}) {
  const sorted = sortDesc(workouts)
  if (!sorted.length) {
    return {
      hasData: false,
      lastWorkout: null,
      nextFocus: null,
      streak: 0,
      workoutsThisMonth: 0,
      tonnage: { month: 0, prevMonth: 0, pct: 0 },
      latestPr: null,
      nearestGoal: null,
    }
  }

  const last = sorted[0]
  const today = dayIndex(now)
  const lastWorkout = {
    at: last.performed_at,
    daysAgo: today - dayIndex(new Date(last.performed_at)),
    tags: daySubTags(last.entries),
  }

  const month = tonnageInWindow(sorted, now, 30, 0)
  const prevMonth = tonnageInWindow(sorted, now, 60, 30)
  const pct = prevMonth > 0 ? Math.round(((month - prevMonth) / prevMonth) * 100) : 0

  return {
    hasData: true,
    lastWorkout,
    nextFocus: mostNeglectedGroup(sorted, now),
    streak: currentStreak(sorted, now),
    workoutsThisMonth: workoutsThisMonth(sorted),
    tonnage: { month, prevMonth, pct },
    latestPr: latestPr(sorted),
    nearestGoal: nearestGoal(goals, sorted),
  }
}

// Склонение «день/дня/дней» под число.
function dayWord(n) {
  const a = n % 100
  const b = a % 10
  if (!(a > 10 && a < 20)) {
    if (b === 1) return 'день'
    if (b > 1 && b < 5) return 'дня'
  }
  return 'дней'
}

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
