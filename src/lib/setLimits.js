// ============================================================================
// Границы значений подхода (клампинг ввода) — чистые хелперы БЕЗ Dexie/сети.
//
// Зачем: инпуты формы отдают СТРОКИ, и без нормализации в базу попадали
// отрицательные, NaN и абсурдно большие вес/повторы. Кривые значения ломают
// производные — рекорды, лидерборд, достижение целей — и вдобавок бьются о
// серверные CHECK (`sets.weight >= 0`, верхние границы), из-за чего push тихо
// падает и синхронизация встаёт. Единый источник границ для клиента и сервера
// (server: supabase/set-limits.sql — те же числа в CHECK).
//
// Модель БД: подход всегда {weight, reps}. У не-весовых упражнений (reps/time)
// weight не хранится (инвариант 0), а reps несёт повторы или СЕКУНДЫ (time),
// поэтому верхняя граница reps зависит от метрики (см. repsMax).
// ============================================================================

import { normMetric, isCountMetric } from './metric.js'

// Верхние границы. Подобраны с большим запасом над человеческими рекордами,
// чтобы не резать реальные данные, но отсекать явный мусор/переполнение.
export const WEIGHT_MAX = 1000 // кг (мировые рекорды тяг < 500 кг)
export const REPS_MAX = 1000 // повторов на подход
export const TIME_MAX = 86400 // секунд = 24 ч (планка/кардио на время)

// Верхняя граница «повторного» поля с учётом метрики: у time-упражнений reps
// хранит секунды (граница TIME_MAX), у остальных — повторы (REPS_MAX).
export function repsMax(metric) {
  return normMetric(metric) === 'time' ? TIME_MAX : REPS_MAX
}

// Клампинг веса. У не-весовых метрик вес не хранится → всегда 0 (инвариант).
// Возвращает число в [0, WEIGHT_MAX] (2 знака — шаг 1.25 кг) либо null, если
// значение нечисловое (подход невалиден, отбрасываем).
export function clampWeight(weight, metric = 'weight') {
  if (isCountMetric(metric)) return 0
  const n = Number(weight)
  if (!Number.isFinite(n)) return null
  const c = Math.min(WEIGHT_MAX, Math.max(0, n))
  return Math.round(c * 100) / 100
}

// Клампинг повторов/секунд. Округляем до целого; < 1 → null (пустой/нулевой
// подход отбрасываем, как и раньше). Верхняя граница — по метрике (repsMax).
export function clampReps(reps, metric = 'weight') {
  const n = Number(reps)
  if (!Number.isFinite(n)) return null
  const r = Math.round(n)
  if (r < 1) return null
  return Math.min(repsMax(metric), r)
}

// Клампинг одного подхода. Возвращает { weight, reps } с числами в допустимых
// границах либо null, если подход невалиден (нечисловой вес/повторы или reps<1).
export function clampSet(weight, reps, metric = 'weight') {
  const w = clampWeight(weight, metric)
  const r = clampReps(reps, metric)
  if (w == null || r == null) return null
  return { weight: w, reps: r }
}
