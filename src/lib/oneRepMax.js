// Расчёт предполагаемого максимума «на раз» (1ПМ).

// Формула Эпли: 1ПМ = вес * (1 + повторы / 30)
export function epley(weight, reps) {
  if (reps <= 0 || weight <= 0) return 0
  if (reps === 1) return weight
  return weight * (1 + reps / 30)
}

// 1ПМ подхода, округлённый до 0.5 кг
export function setOneRepMax(weight, reps) {
  return Math.round(epley(weight, reps) * 2) / 2
}

// Лучший 1ПМ среди списка подходов [{weight, reps}].
// ВНИМАНИЕ: 1ПМ осмыслен только для ВЕСОВЫХ упражнений (metric==='weight') —
// у reps/time-упражнений weight=0 (вернёт 0) либо может быть фиктивным (напр.
// подтягивания с весом), поэтому звать имеет смысл лишь когда metric==='weight'
// (так и сделано в ProgressScreen: orm = weighted ? bestOneRepMax(...) : 0).
// guard (sets ?? []) — как у прочих хелперов: запись без sets не должна падать.
export function bestOneRepMax(sets) {
  return (sets ?? []).reduce((max, s) => Math.max(max, setOneRepMax(s.weight, s.reps)), 0)
}
