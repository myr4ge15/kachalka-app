// ============================================================================
// Чистая логика рекордов и уведомлений (без Dexie/сети) — ТЗ §4.5, MVP.
//
// Здесь только вычисления над уже денормализованными `entries`. Слой БД
// (src/db/notifications.js) читает данные и кормит их сюда. Так алгоритмы
// тестируются в node без IndexedDB, а схему/синк трогать не нужно.
//
// Рекорд = лучший ВЕДУЩИЙ показатель упражнения (PLAN-metrics): для весовых —
// максимальный фактический вес подхода (как в ленте/лидерборде), для упражнений
// своего веса/на время — максимум повторов/секунд за подход. НЕ расчётный 1ПМ.
// Первый замер по упражнению рекордом не считаем — нечего бить (согласовано с
// computePrs в db/feed.js).
// ============================================================================
import { cmpIsoAsc } from './cmp.js'
import { leadingValue } from './metric.js'
import { entryExId, entryMetric } from './entries.js'

// Максимальный фактический вес среди подходов [{weight, reps}]. Оставлен для
// весо-специфичных мест (цели в кг — profileStats.currentBest).
export function bestWeight(sets) {
  return (sets ?? []).reduce((m, s) => Math.max(m, Number(s.weight) || 0), 0)
}

// Имя записи оставлено по месту: у records дефолт null (у ленты/insights — '—').
const entryName = (e) => e.name ?? e.exercise?.name ?? null

// Лучший ведущий показатель по каждому упражнению за переданную историю.
// Возвращает Map(exercise_id → { value, metric, name }).
export function myBestByExercise(workouts) {
  const best = new Map()
  for (const w of workouts ?? []) {
    for (const e of w.entries ?? []) {
      const exId = entryExId(e)
      if (!exId) continue
      const metric = entryMetric(e)
      const value = leadingValue(metric, e.sets)
      if (value <= 0) continue
      const prev = best.get(exId)
      if (!prev || value > prev.value) {
        best.set(exId, { value, metric, name: entryName(e) ?? prev?.name ?? '—' })
      }
    }
  }
  return best
}

// «У тебя новый рекорд»: идём по своим тренировкам в хронологическом порядке и
// для каждого упражнения ловим момент, когда ведущий показатель превысил прежний
// максимум. Возвращает [{ id, type:'mine', exId, name, metric, value, prev, at }].
export function minePrs(workouts) {
  const best = new Map() // exId → value
  const out = []
  // Тай-брейк: при равных performed_at (импорт, два сохранения в одну секунду)
  // порядок массива недетерминирован → PR/prev мог приписаться не той тренировке.
  // Дотягиваем хронологию по created_at, затем по id (стабильно и без локали).
  const chron = [...(workouts ?? [])].sort(
    (a, b) =>
      cmpIsoAsc(a.performed_at, b.performed_at) ||
      cmpIsoAsc(a.created_at, b.created_at) ||
      cmpIsoAsc(String(a.id), String(b.id))
  )
  for (const w of chron) {
    for (const e of w.entries ?? []) {
      const exId = entryExId(e)
      if (!exId) continue
      const metric = entryMetric(e)
      const value = leadingValue(metric, e.sets)
      if (value <= 0) continue
      const prev = best.get(exId) ?? 0
      if (value > prev) {
        if (prev > 0) {
          out.push({
            id: `mine:${w.id}:${exId}`,
            type: 'mine',
            exId,
            name: entryName(e) ?? '—',
            metric,
            value,
            prev,
            at: w.performed_at,
          })
        }
        best.set(exId, value)
      }
    }
  }
  return out
}

// «Друг побил твой рекорд»: по элементам ленты (тренировки всех) в хронологии.
// Для каждой пары (друг, упражнение) держим планку, которую надо побить (старт —
// мой личный максимум по этому упражнению). Если ведущий показатель друга её
// превысил — событие; планку поднимаем, чтобы не плодить дубли. Свои тренировки
// исключаем по userId. myBest — Map(exId → { value, metric, name }) из
// myBestByExercise. Возвращает
// [{ id, type:'beaten', exId, name, who, metric, value, myValue, at }].
export function computeBeaten(feedItems, userId, myBest) {
  const chron = [...(feedItems ?? [])]
    .filter((it) => it.user_id !== userId)
    .sort(
      (a, b) =>
        cmpIsoAsc(a.performed_at, b.performed_at) ||
        cmpIsoAsc(a.created_at, b.created_at) ||
        cmpIsoAsc(String(a.id), String(b.id))
    )
  const bar = new Map() // `${friend}:${exId}` → текущая планка
  const out = []
  for (const it of chron) {
    for (const e of it.entries ?? []) {
      const exId = entryExId(e)
      if (!exId) continue
      const mine = myBest.get(exId)
      if (!mine || mine.value <= 0) continue // нет своего рекорда — нечего бить
      const metric = mine.metric // сравниваем по метрике упражнения (одна на всех)
      const value = leadingValue(metric, e.sets)
      if (value <= 0) continue
      const key = `${it.user_id}:${exId}`
      const threshold = bar.get(key) ?? mine.value
      if (value > threshold) {
        out.push({
          id: `beaten:${it.id}:${exId}`,
          type: 'beaten',
          exId,
          name: entryName(e) ?? mine.name ?? '—',
          who: it.user_name ?? 'Друг',
          metric,
          value,
          myValue: mine.value,
          at: it.performed_at,
        })
        bar.set(key, value)
      }
    }
  }
  return out
}

// Пересекла ли цель порог именно сейчас: прежний лучший вес был НИЖЕ цели, а
// текущий стал ≥ цели. Момент достижения ловим один раз (как рекорд). target ≤ 0
// или отсутствие цели → не событие. Цели — только весовые (кг), см. PLAN-metrics.
export function crossedGoal(prevBest, curBest, target) {
  const t = Number(target) || 0
  if (t <= 0) return false
  return (Number(prevBest) || 0) < t && (Number(curBest) || 0) >= t
}

// Цель «вес × повторы» (PLAN-goal-reps): есть ли среди подходов ХОТЯ БЫ ОДИН, где
// weight ≥ targetWeight И reps ≥ targetReps. Нужен ОДИН подход на оба условия —
// повторы из разных подходов не «склеиваются». targetReps пуст/0 → требование по
// повторам снимается (только вес, старое поведение). Только для весовых целей.
export function hasSetMeetingGoal(sets, targetWeight, targetReps) {
  const w = Number(targetWeight) || 0
  if (w <= 0) return false
  const r = Number(targetReps) || 0
  return (sets ?? []).some(
    (s) => (Number(s.weight) || 0) >= w && (r <= 0 || (Number(s.reps) || 0) >= r)
  )
}

// Достигнута ли весовая цель «вес × повторы» хотя бы одним подходом за всю
// переданную историю по упражнению exerciseId. Перебираем подходы (а не агрегат
// по весу), потому что условие двойное и должно выполняться в одном подходе.
export function goalMetByExercise(workouts, exerciseId, targetWeight, targetReps) {
  for (const w of workouts ?? []) {
    for (const e of w.entries ?? []) {
      if (entryExId(e) !== exerciseId) continue
      if (hasSetMeetingGoal(e.sets, targetWeight, targetReps)) return true
    }
  }
  return false
}

// Новые личные рекорды ИМЕННО этой тренировки (для тоста после сохранения).
// savedEntries — entries сохранённой тренировки; othersBest — лучшее по ВСЕМ
// ОСТАЛЬНЫМ моим тренировкам (Map exId → { value, metric }). Считаем рекордом
// только превышение прежнего максимума (prev > 0), как и в minePrs. Возвращает
// [{ name, metric, value, prev }].
export function computeNewPrs(savedEntries, othersBest) {
  const out = []
  for (const e of savedEntries ?? []) {
    const exId = entryExId(e)
    if (!exId) continue
    const metric = entryMetric(e)
    const value = leadingValue(metric, e.sets)
    if (value <= 0) continue
    const prev = othersBest.get(exId)?.value ?? 0
    if (prev > 0 && value > prev) {
      out.push({ name: entryName(e) ?? '—', metric, value, prev })
    }
  }
  return out
}
