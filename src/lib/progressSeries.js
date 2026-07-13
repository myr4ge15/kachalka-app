// ============================================================================
// Чистая логика экрана «Прогресс» — без React/Dexie/DOM, тестируется в node.
//
// Раньше жила инлайн в ProgressScreen.jsx (нарушение архитектурного правила «нетри-
// виальная бизнес-логика — в src/lib/ под Vitest», РЕВЬЮ-КОДА-2026-07-13). Здесь:
//   - collectExercises — список упражнений из истории (для пикера), жим сверху;
//   - buildSeries — ряд «по дням» для выбранного упражнения: ведущее значение за
//     день (лучший единичный подход), детект бегущего рекорда (isPr), направление
//     up/down/flat к прошлой сессии и расчётный 1ПМ (Эпли, только для весовых).
// ============================================================================
import { bestOneRepMax } from './oneRepMax.js'
import { cmpIsoAsc } from './cmp.js'

// Собрать упражнения, встречавшиеся в истории (только с непустыми подходами).
// Возвращает отсортированный массив { id, name, is_bench_lift, hasWeight, metric }:
// жим лёжа — первым, дальше по имени (ru). hasWeight — фолбэк для легаси-записей
// без явного metric (есть ли хоть один подход с весом > 0).
export function collectExercises(workouts) {
  const map = new Map()
  for (const w of workouts ?? []) {
    for (const e of w.entries ?? []) {
      const id = e.exercise?.id ?? e.exercise_id
      if (!id) continue
      const sets = e.sets ?? []
      if (sets.length === 0) continue
      const rec = map.get(id) ?? {
        id,
        name: e.exercise?.name ?? 'Упражнение',
        is_bench_lift: false,
        hasWeight: false,
        metric: undefined, // явный тип упражнения (если задан в денормализ. снимке)
      }
      if (e.exercise?.name) rec.name = e.exercise.name
      if (e.exercise?.is_bench_lift) rec.is_bench_lift = true
      if (e.exercise?.metric) rec.metric = e.exercise.metric
      if (sets.some((s) => Number(s.weight) > 0)) rec.hasWeight = true
      map.set(id, rec)
    }
  }
  return Array.from(map.values()).sort(
    (a, b) =>
      Number(b.is_bench_lift) - Number(a.is_bench_lift) ||
      String(a.name).localeCompare(String(b.name), 'ru')
  )
}

// Построить ряд «по дням» для упражнения exerciseId. weighted — считать ли ведущим
// показателем вес (true) или повторы/секунды (false). Каждая точка:
//   { day, sets, value, orm, isPr, dir }.
export function buildSeries(workouts, exerciseId, weighted) {
  const byDay = new Map()
  for (const w of workouts ?? []) {
    const day = String(w.performed_at ?? '').slice(0, 10)
    if (!day) continue
    for (const e of w.entries ?? []) {
      const id = e.exercise?.id ?? e.exercise_id
      if (id !== exerciseId) continue
      const sets = e.sets ?? []
      if (sets.length === 0) continue
      const rec = byDay.get(day) ?? { day, sets: [] }
      rec.sets.push(...sets)
      byDay.set(day, rec)
    }
  }
  const series = Array.from(byDay.values())
    .map((rec) => ({
      ...rec,
      // Ведущий показатель за день = лучший единичный подход (как и рекорд):
      // для весовых — макс. вес, для своего веса/времени — макс. повторов/секунд.
      // 1ПМ (orm) считаем отдельно — вторичное число, на рекорды не влияет.
      value: weighted
        ? rec.sets.reduce((m, x) => Math.max(m, Number(x.weight) || 0), 0)
        : rec.sets.reduce((m, x) => Math.max(m, Number(x.reps) || 0), 0),
      orm: weighted ? bestOneRepMax(rec.sets) : 0,
    }))
    .sort((a, b) => cmpIsoAsc(a.day, b.day))

  let running = 0
  let prev = null
  for (const p of series) {
    p.isPr = p.value > running
    if (p.isPr) running = p.value
    // Направление относительно предыдущей сессии: для подсветки прогресса/
    // регресса (ТЗ 4.2). Первая точка — старт, считаем «рост».
    p.dir = prev == null ? 'up' : p.value > prev ? 'up' : p.value < prev ? 'down' : 'flat'
    prev = p.value
  }
  return series
}
