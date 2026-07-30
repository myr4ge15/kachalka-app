import { totalTonnage } from './profileStats.js'
import { fmtMetricValue } from './metric.js'

function explicitDurationSeconds(workout) {
  const raw = workout?.duration_seconds ?? workout?.durationSeconds
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null
}

// Локальный документ тренировки → спокойная сводка для экрана завершения.
// Учитываем только реально сохранённые подходы. Длительность не выводим из
// created_at/updated_at: это часы документа, а не время самой тренировки.
export function workoutFinishSummary(workout) {
  const entries = (workout?.entries ?? []).filter((entry) => (entry.sets?.length ?? 0) > 0)
  return {
    exerciseCount: entries.length,
    setCount: entries.reduce((sum, entry) => sum + entry.sets.length, 0),
    tonnage: totalTonnage([{ entries }]),
    durationSeconds: explicitDurationSeconds(workout),
  }
}

export function formatWorkoutDuration(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value <= 0) return null
  const minutes = Math.max(1, Math.round(value / 60))
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`
}

// Из результатов уже выполненных локальных детекторов собираем до трёх событий
// итогового экрана. Первое — крупный акцент, остальные — компактные строки.
// Побочные эффекты (цель achievedAt, даты бейджей, уведомления) остаются в
// DB-слое; здесь только приоритет и презентационная модель.
export function workoutFinishEvents({
  prs = [],
  reached = [],
  newBadges = [],
  insights = [],
} = {}) {
  const events = []

  if (reached.length) {
    const top = reached.reduce((a, b) => (Number(b.value) > Number(a.value) ? b : a), reached[0])
    const extra = reached.length > 1 ? ` +${reached.length - 1}` : ''
    const reps = top.metric === 'weight' && Number(top.reps) > 0
      ? ` × ${Math.round(Number(top.reps))}`
      : ''
    events.push({
      kind: 'goal',
      emoji: '🎯',
      title: reached.length > 1 ? 'Цели достигнуты!' : 'Цель достигнута!',
      text: `${top.name} — ${fmtMetricValue(top.metric, top.value)}${reps}${extra}`,
      exerciseId: top.exerciseId ?? null,
      celebrated: true,
    })
  }

  if (prs.length) {
    const top = prs.reduce((a, b) => (Number(b.value) > Number(a.value) ? b : a), prs[0])
    const extra = prs.length > 1 ? ` +${prs.length - 1}` : ''
    events.push({
      kind: 'pr',
      emoji: '🏆',
      title: 'Новый рекорд!',
      text: `${top.name} — ${fmtMetricValue(top.metric, top.value)} (было ${fmtMetricValue(top.metric, top.prev)})${extra}`,
      exerciseId: top.exerciseId ?? null,
      celebrated: true,
    })
  }

  if (newBadges.length) {
    const top = newBadges[0]
    const extra = newBadges.length > 1 ? ` +${newBadges.length - 1}` : ''
    events.push({
      kind: 'badge',
      emoji: '🏆',
      title: newBadges.length > 1 ? 'Новые достижения!' : 'Новое достижение!',
      text: `${top.icon} ${top.name}${extra}`,
      exerciseId: null,
      celebrated: true,
    })
  }

  if (insights.length) {
    const top = insights[0]
    events.push({
      kind: 'insight',
      emoji: top.emoji ?? '💡',
      title: 'Вывод после тренировки',
      text: top.text,
      exerciseId: top.exerciseId ?? null,
      celebrated: false,
    })
  }

  return events.slice(0, 3)
}

// Совместимый короткий путь для мест, которым нужен только главный акцент.
export function pickWorkoutFinishEvent(input = {}) {
  return workoutFinishEvents(input)[0] ?? null
}
