import { totalTonnage } from './profileStats.js'
import { fmtMetricValue, normMetric } from './metric.js'

function explicitDurationSeconds(workout) {
  const raw = workout?.duration_seconds ?? workout?.durationSeconds
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null
}

// Локальный документ тренировки → спокойная сводка для экрана завершения.
// Учитываем только реально сохраненные подходы. Длительность не выводим из
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

// Порядок метрик для фолбэка выбора «главного» (вес — основной лифт).
const METRIC_RANK = { weight: 0, reps: 1, time: 2 }

// Выбрать «главный» рекорд/цель среди событий в РАЗНЫХ метриках. Раньше брали
// максимум сырого value, и единицы смешивались: планка +5 с (120 с) побеждала
// жим +20 кг (100 кг) — РЕВЬЮ-КОДА-2026-10-02, «Тексты и расчеты». Теперь, как в
// insights.rNewPr, сравниваем ОТНОСИТЕЛЬНЫЙ прирост (value − prev) / prev.
// Фолбэк без prev (у целей его нет, prev=0 у «первого замера»): событие с
// приростом выше события без него; дальше — весовые раньше count-метрик, внутри
// одной метрики — больший value; при полном равенстве — порядок списка.
function pickTop(list) {
  const scored = list.map((x, i) => {
    const value = Number(x?.value) || 0
    const prev = Number(x?.prev) || 0
    return {
      x,
      i,
      value,
      gain: prev > 0 ? (value - prev) / prev : null,
      rank: METRIC_RANK[normMetric(x?.metric)] ?? 0,
    }
  })
  scored.sort(
    (a, b) =>
      Number(b.gain != null) - Number(a.gain != null) ||
      (a.gain != null && b.gain != null ? b.gain - a.gain : 0) ||
      a.rank - b.rank ||
      b.value - a.value ||
      a.i - b.i
  )
  return scored[0].x
}

// Из результатов уже выполненных локальных детекторов собираем до трех событий
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
    const top = pickTop(reached)
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
    const top = pickTop(prs)
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
