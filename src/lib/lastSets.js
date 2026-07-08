// Автоподстановка прошлого подхода (виш из BACKLOG). Чистая логика без Dexie.
//
// При добавлении в тренировку упражнения, которое уже делал, форма предзаполняется
// весом/повторами из ПОСЛЕДНЕЙ тренировки по этому упражнению — экономит ручной
// ввод в самой частой операции. Данные берём из локальных `workouts` (сеть не
// нужна). Здесь — только выбор нужных подходов; Dexie-обёртка в db/repo.js.
import { cmpIsoDesc } from './cmp.js'

// Найти подходы последнего выполнения упражнения exerciseId у пользователя.
//
//   workouts   — документы тренировок (денормализованные, с entries);
//   exerciseId — id искомого упражнения.
//
// Возвращает массив `[{weight, reps}]` из самой свежей НЕудалённой тренировки,
// где встречается это упражнение (свежесть — по performed_at, тай-брейк
// created_at, как в repo.getWorkouts), либо null, если упражнения ещё не делали
// (или подходов не осталось). Значения копируются числами — вызывающий
// достраивает ключи React-строк сам.
export function pickLastSets(workouts, exerciseId) {
  if (!exerciseId || !Array.isArray(workouts)) return null
  const sorted = [...workouts]
    .filter((w) => w && !w._deleted)
    .sort(
      (a, b) =>
        cmpIsoDesc(a.performed_at, b.performed_at) ||
        cmpIsoDesc(a.created_at, b.created_at)
    )
  for (const w of sorted) {
    const entry = (w.entries ?? []).find(
      (e) => (e.exercise_id ?? e.exercise?.id) === exerciseId
    )
    if (!entry) continue
    const sets = (entry.sets ?? [])
      .map((s) => ({ weight: Number(s.weight), reps: Number(s.reps) }))
      .filter((s) => Number.isFinite(s.weight) && Number.isFinite(s.reps))
    if (sets.length > 0) return sets
    // Упражнение в этой тренировке есть, но без валидных подходов — идём к более
    // старой тренировке (не прекращаем на первой же встрече).
  }
  return null
}
