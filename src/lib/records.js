// ============================================================================
// Чистая логика рекордов и уведомлений (без Dexie/сети) — ТЗ §4.5, MVP.
//
// Здесь только вычисления над уже денормализованными `entries`. Слой БД
// (src/db/notifications.js) читает данные и кормит их сюда. Так алгоритмы
// тестируются в node без IndexedDB, а схему/синк трогать не нужно.
//
// Рекорд = максимальный ФАКТИЧЕСКИЙ вес подхода (как в ленте и лидерборде),
// а не расчётный 1ПМ. Первый замер по упражнению рекордом не считаем — нечего
// бить (согласовано с computePrs в db/feed.js).
// ============================================================================
import { cmpIsoAsc } from './cmp.js'

// Максимальный фактический вес среди подходов [{weight, reps}].
export function bestWeight(sets) {
  return (sets ?? []).reduce((m, s) => Math.max(m, Number(s.weight) || 0), 0)
}

const entryExId = (e) => e.exercise_id ?? e.exercise?.id ?? null
const entryName = (e) => e.name ?? e.exercise?.name ?? null

// Лучший фактический вес по каждому упражнению за переданную историю.
// Возвращает Map(exercise_id → { weight, name }).
export function myBestByExercise(workouts) {
  const best = new Map()
  for (const w of workouts ?? []) {
    for (const e of w.entries ?? []) {
      const exId = entryExId(e)
      if (!exId) continue
      const weight = bestWeight(e.sets)
      if (weight <= 0) continue
      const prev = best.get(exId)
      if (!prev || weight > prev.weight) {
        best.set(exId, { weight, name: entryName(e) ?? prev?.name ?? '—' })
      }
    }
  }
  return best
}

// «У тебя новый рекорд»: идём по своим тренировкам в хронологическом порядке и
// для каждого упражнения ловим момент, когда фактический вес превысил прежний
// максимум. Возвращает [{ id, type:'mine', exId, name, weight, prev, at }].
export function minePrs(workouts) {
  const best = new Map() // exId → weight
  const out = []
  const chron = [...(workouts ?? [])].sort((a, b) =>
    cmpIsoAsc(a.performed_at, b.performed_at)
  )
  for (const w of chron) {
    for (const e of w.entries ?? []) {
      const exId = entryExId(e)
      if (!exId) continue
      const weight = bestWeight(e.sets)
      if (weight <= 0) continue
      const prev = best.get(exId) ?? 0
      if (weight > prev) {
        if (prev > 0) {
          out.push({
            id: `mine:${w.id}:${exId}`,
            type: 'mine',
            exId,
            name: entryName(e) ?? '—',
            weight,
            prev,
            at: w.performed_at,
          })
        }
        best.set(exId, weight)
      }
    }
  }
  return out
}

// «Друг побил твой рекорд»: по элементам ленты (тренировки всех) в хронологии.
// Для каждой пары (друг, упражнение) держим планку, которую надо побить (старт —
// мой личный максимум по этому упражнению). Если фактический вес друга её
// превысил — событие; планку поднимаем, чтобы не плодить дубли. Свои тренировки
// исключаем по userId. myBest — Map(exId → { weight, name }) из myBestByExercise.
// Возвращает [{ id, type:'beaten', exId, name, who, weight, myWeight, at }].
export function computeBeaten(feedItems, userId, myBest) {
  const chron = [...(feedItems ?? [])]
    .filter((it) => it.user_id !== userId)
    .sort((a, b) => cmpIsoAsc(a.performed_at, b.performed_at))
  const bar = new Map() // `${friend}:${exId}` → текущая планка
  const out = []
  for (const it of chron) {
    for (const e of it.entries ?? []) {
      const exId = entryExId(e)
      if (!exId) continue
      const mine = myBest.get(exId)
      if (!mine || mine.weight <= 0) continue // нет своего рекорда — нечего бить
      const weight = bestWeight(e.sets)
      if (weight <= 0) continue
      const key = `${it.user_id}:${exId}`
      const threshold = bar.get(key) ?? mine.weight
      if (weight > threshold) {
        out.push({
          id: `beaten:${it.id}:${exId}`,
          type: 'beaten',
          exId,
          name: entryName(e) ?? mine.name ?? '—',
          who: it.user_name ?? 'Друг',
          weight,
          myWeight: mine.weight,
          at: it.performed_at,
        })
        bar.set(key, weight)
      }
    }
  }
  return out
}

// Новые личные рекорды ИМЕННО этой тренировки (для тоста после сохранения).
// savedEntries — entries сохранённой тренировки; othersBest — лучшее по ВСЕМ
// ОСТАЛЬНЫМ моим тренировкам (Map exId → { weight }). Считаем рекордом только
// превышение прежнего максимума (prev > 0), как и в minePrs. Возвращает
// [{ name, weight, prev }].
export function computeNewPrs(savedEntries, othersBest) {
  const out = []
  for (const e of savedEntries ?? []) {
    const exId = entryExId(e)
    if (!exId) continue
    const weight = bestWeight(e.sets)
    if (weight <= 0) continue
    const prev = othersBest.get(exId)?.weight ?? 0
    if (prev > 0 && weight > prev) {
      out.push({ name: entryName(e) ?? '—', weight, prev })
    }
  }
  return out
}
