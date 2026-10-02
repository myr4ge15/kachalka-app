// Автоподстановка прошлого подхода (виш из BACKLOG). Чистая логика без Dexie.
//
// При добавлении в тренировку упражнения, которое уже делал, форма предзаполняется
// весом/повторами из ПОСЛЕДНЕЙ тренировки по этому упражнению — экономит ручной
// ввод в самой частой операции. Данные берем из локальных `workouts` (сеть не
// нужна). Здесь — только выбор нужных подходов; Dexie-обертка в db/repo.js.
import { cmpIsoDesc } from './cmp.js'
import { entryUnitMetric } from './entries.js'
import { normMetric } from './metric.js'

// Найти подходы последнего выполнения упражнения exerciseId у пользователя.
//
//   workouts   — документы тренировок (денормализованные, с entries);
//   exerciseId — id искомого упражнения.
//
// Возвращает массив `[{weight, reps}]` из самой свежей НЕудаленной тренировки,
// где встречается это упражнение (свежесть — по performed_at, тай-брейк
// created_at, как в repo.getWorkouts), либо null, если упражнения еще не делали
// (или подходов не осталось). Значения копируются числами — вызывающий
// достраивает ключи React-строк сам.
//
// metric (необязательный) — текущий тип упражнения из справочника. Если задан,
// записи в другой единице пропускаем: после смены типа старый снимок «10 кг × 8»
// иначе предзаполнял бы форму упражнения на повторы (РЕВЬЮ-КОДА-2026-10-02, п. 17).
export function pickLastSets(workouts, exerciseId, metric) {
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
    if (metric != null && entryUnitMetric(entry, metric) !== normMetric(metric)) continue
    const sets = (entry.sets ?? [])
      .map((s) => ({ weight: Number(s.weight), reps: Number(s.reps) }))
      .filter((s) => Number.isFinite(s.weight) && Number.isFinite(s.reps))
    if (sets.length > 0) return sets
    // Упражнение в этой тренировке есть, но без валидных подходов — идем к более
    // старой тренировке (не прекращаем на первой же встрече).
  }
  return null
}
