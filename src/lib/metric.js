// ============================================================================
// Тип метрики упражнения (PLAN-metrics) — чистые хелперы БЕЗ Dexie/сети.
//
// metric — атрибут УПРАЖНЕНИЯ (одинаков для всех подходов и зрителей, как
// is_bench_lift), а не подхода. Говорит UI/рекордам, как трактовать подход:
//   weight — вес × повторы (как раньше); ведущая метрика — макс. фактический вес;
//   reps   — свой вес, считаем повторы (weight=0, reps=повторы);
//   time   — на время, считаем секунды (weight=0, reps=секунды).
//
// Подход в БД остаётся {weight, reps}: для reps/time weight=0, а reps несёт
// повторы или секунды. Семантику задаёт metric (см. решение №1 в PLAN-metrics).
//
// Легаси-записи без metric читаются как undefined → трактуются как 'weight'.
// ============================================================================

const ALLOWED = ['weight', 'reps', 'time']

// Нормализовать произвольное значение в допустимую метрику. Всё неизвестное
// (undefined/null/мусор) → 'weight' (обратная совместимость).
export function normMetric(v) {
  return ALLOWED.includes(v) ? v : 'weight'
}

// Метрика упражнения по его объекту (денормализованный exercise или запись
// справочника). Дефолт 'weight'.
export function exerciseMetric(ex) {
  return normMetric(ex?.metric)
}

// «Одно число на подход» — у reps/time нет отдельного веса, ведущий показатель
// один (повторы/секунды). У weight ведущий — вес. Используется, чтобы решить,
// прятать ли в UI колонку веса и считать ли тоннаж.
export function isCountMetric(metric) {
  return normMetric(metric) !== 'weight'
}

// Ведущий показатель ПОДХОДА — то, по чему считается рекорд (лучший подход):
//   weight     → вес подхода;
//   reps/time  → reps подхода (повторы или секунды).
function setLeading(metric, s) {
  if (isCountMetric(metric)) return Number(s?.reps) || 0
  return Number(s?.weight) || 0
}

// Ведущее значение упражнения за набор подходов — максимум по подходам (лучший
// единичный подход, как и для веса). Пусто/нет подходов → 0.
export function leadingValue(metric, sets) {
  return (sets ?? []).reduce((m, s) => Math.max(m, setLeading(metric, s)), 0)
}

// секунды → 'м:сс' ('1:30', '0:45', '12:05'). Отрицательное/мусор → '0:00'.
export function fmtTime(totalSec) {
  let s = Math.max(0, Math.round(Number(totalSec) || 0))
  const m = Math.floor(s / 60)
  s = s % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// 'м:сс' или число секунд → секунды. '1:30' → 90, '90' → 90, мусор → 0.
export function parseTime(v) {
  if (typeof v === 'number') return Math.max(0, Math.round(v))
  const str = String(v ?? '').trim()
  if (!str) return 0
  if (str.includes(':')) {
    const [mm, ss] = str.split(':')
    const m = Number(mm) || 0
    const s = Number(ss) || 0
    return Math.max(0, Math.round(m * 60 + s))
  }
  return Math.max(0, Math.round(Number(str) || 0))
}

// Форматирование ведущего значения для UI по метрике:
//   weight → '80 кг'; reps → '12'; time → '1:30'.
export function fmtMetricValue(metric, v) {
  const m = normMetric(metric)
  if (m === 'time') return fmtTime(v)
  if (m === 'reps') return String(Number(v) || 0)
  return `${Number(v) || 0} кг`
}

// Целевой план упражнения в ШАБЛОНЕ — «подходы × повторы (× вес)». В отличие от
// fmtSet (один фактический подход) описывает план: сколько подходов и по сколько.
//   weight → '3×10' или '3×10×60 кг' (если задан вес);
//   reps   → '3×10';
//   time   → '3×1:30' (повторы трактуются как секунды на подход).
// Нет подходов (sets=0) → '' (упражнение без заданного плана).
export function fmtTemplateTarget(metric, t) {
  const sets = Math.max(0, Math.round(Number(t?.sets) || 0))
  if (!sets) return ''
  const reps = Math.max(0, Math.round(Number(t?.reps) || 0))
  const weight = Number(t?.weight) || 0
  const m = normMetric(metric)
  const per = m === 'time' ? fmtTime(reps) : String(reps)
  let s = `${sets}×${per}`
  if (m === 'weight' && weight > 0) s += `×${weight} кг`
  return s
}

// Короткая запись ОДНОГО подхода для списков (история/лента/прогресс):
//   weight → '80×8' (или просто '8', если веса нет);
//   reps   → '12'; time → '1:30'.
export function fmtSet(metric, s) {
  const reps = Number(s?.reps) || 0
  const weight = Number(s?.weight) || 0
  const m = normMetric(metric)
  if (m === 'time') return fmtTime(reps)
  if (m === 'reps') return String(reps)
  return weight > 0 ? `${weight}×${reps}` : String(reps)
}
