// ============================================================================
// Тип метрики упражнения (PLAN-metrics) — чистые хелперы БЕЗ Dexie/сети.
//
// metric — атрибут УПРАЖНЕНИЯ (одинаков для всех подходов и зрителей, как
// is_bench_lift), а не подхода. Говорит UI/рекордам, как трактовать подход:
//   weight — вес × повторы (как раньше); ведущая метрика — макс. фактический вес;
//   reps   — свой вес, считаем повторы (weight=0, reps=повторы);
//   time   — на время, считаем секунды (weight=0, reps=секунды);
//   distance — дистанция и время (v6.12.0: бег, ходьба, эллипс, велотренажер):
//            weight=КИЛОМЕТРЫ, reps=СЕКУНДЫ. Ведущий показатель (рекорд) —
//            дистанция; темп (мин:сек на км) считается, а не хранится. В тоннаж
//            такие подходы НЕ идут (км × сек — не килограммы).
//
// Подход в БД остается {weight, reps}: для reps/time weight=0, а reps несет
// повторы или секунды. Семантику задает metric (см. решение №1 в PLAN-metrics).
//
// Легаси-записи без metric читаются как undefined → трактуются как 'weight'.
// ============================================================================

const ALLOWED = ['weight', 'reps', 'time', 'distance']

// Нормализовать произвольное значение в допустимую метрику. Все неизвестное
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
  const m = normMetric(metric)
  return m !== 'weight' && m !== 'distance'
}

export const isDistanceMetric = (metric) => normMetric(metric) === 'distance'

// Время хранится в reps (секунды) у 'time' и 'distance'.
export const hasTimeReps = (metric) => {
  const m = normMetric(metric)
  return m === 'time' || m === 'distance'
}

// Вклад подхода в тоннаж (кг × повт.) — только у весовых упражнений. У
// 'distance' в weight лежат км: без этой проверки бег на 5 км × 1500 с давал
// «7,5 тонн» (v6.12.0).
export function setTonnage(metric, s) {
  if (normMetric(metric) !== 'weight') return 0
  const wt = Number(s?.weight) || 0
  const reps = Number(s?.reps) || 0
  return wt > 0 && reps > 0 ? wt * reps : 0
}

// Ведущий показатель ПОДХОДА — то, по чему считается рекорд (лучший подход):
//   weight/distance → вес подхода (кг или км);
//   reps/time       → reps подхода (повторы или секунды).
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

// 'м:сс', 'ч:мм:сс' или число секунд → секунды. '1:30' → 90, '1:30:00' → 5400,
// '90' → 90, мусор → 0. Три части — часы: раньше '1:30:00' молча давало 90.
export function parseTime(v) {
  if (typeof v === 'number') return Math.max(0, Math.round(v))
  const str = String(v ?? '').trim()
  if (!str) return 0
  if (str.includes(':')) {
    const parts = str.split(':').map((p) => Number(p) || 0)
    const [h, m, s] = parts.length >= 3 ? parts : [0, parts[0], parts[1] ?? 0]
    return Math.max(0, Math.round(h * 3600 + m * 60 + s))
  }
  return Math.max(0, Math.round(Number(str) || 0))
}

// Километры для подписи: до 2 знаков без хвостовых нулей ('5', '5.5', '10.25').
export function fmtKm(v) {
  const n = Math.round((Number(v) || 0) * 100) / 100
  return String(n)
}

// Темп, секунды на км. Нужны дистанция > 0 и время > 0, иначе null.
export function paceSecPerKm(km, sec) {
  const d = Number(km) || 0
  const t = Number(sec) || 0
  if (d <= 0 || t <= 0) return null
  return t / d
}

// '5:12 мин/км' (v6.14.2: было «/км» — одинокая косая читалась как сбой). null/мусор → ''.
export function fmtPace(secPerKm) {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return ''
  return `${fmtTime(secPerKm)} мин/км`
}

// Минимальная дистанция для «лучшего темпа»: 200 м рывком не должны давать рекорд.
export const PACE_MIN_KM = 1

// Лучший (минимальный) темп среди подходов от PACE_MIN_KM. Нет таких → null.
export function bestPace(sets) {
  let best = null
  for (const s of sets ?? []) {
    if ((Number(s?.weight) || 0) < PACE_MIN_KM) continue
    const p = paceSecPerKm(s?.weight, s?.reps)
    if (p != null && (best == null || p < best)) best = p
  }
  return best
}

// Форматирование ведущего значения для UI по метрике:
//   weight → '80 кг'; reps → '12'; time → '1:30'; distance → '5 км'.
export function fmtMetricValue(metric, v) {
  const m = normMetric(metric)
  if (m === 'distance') return `${fmtKm(v)} км`
  if (m === 'time') return fmtTime(v)
  if (m === 'reps') return String(Number(v) || 0)
  return `${Number(v) || 0} кг`
}

// Целевой план упражнения в ШАБЛОНЕ — «подходы × повторы (× вес)». В отличие от
// fmtSet (один фактический подход) описывает план: сколько подходов и по сколько.
//   weight → '3×10' или '3×10×60 кг' (если задан вес);
//   reps   → '3×10';
//   time   → '3×1:30' (повторы трактуются как секунды на подход);
//   distance → '5 км · 25:00' (× подходов, если их больше одного; без км — только время).
// Нет подходов (sets=0) → '' (упражнение без заданного плана).
export function fmtTemplateTarget(metric, t) {
  const sets = Math.max(0, Math.round(Number(t?.sets) || 0))
  if (!sets) return ''
  const reps = Math.max(0, Math.round(Number(t?.reps) || 0))
  const weight = Number(t?.weight) || 0
  const m = normMetric(metric)
  if (m === 'distance') {
    const one = fmtSet('distance', { weight, reps })
    return sets > 1 ? `${sets}×${one}` : one
  }
  const per = m === 'time' ? fmtTime(reps) : String(reps)
  let s = `${sets}×${per}`
  if (m === 'weight' && weight > 0) s += `×${weight} кг`
  return s
}

// Короткая запись ОДНОГО подхода для списков (история/лента/прогресс):
//   weight → '80×8' (или просто '8', если веса нет);
//   reps   → '12'; time → '1:30';
//   distance → '5 км · 25:00' (старые записи бега без км — только время).
export function fmtSet(metric, s) {
  const reps = Number(s?.reps) || 0
  const weight = Number(s?.weight) || 0
  const m = normMetric(metric)
  if (m === 'distance') {
    if (weight > 0 && reps > 0) return `${fmtKm(weight)} км · ${fmtTime(reps)}`
    return weight > 0 ? `${fmtKm(weight)} км` : fmtTime(reps)
  }
  if (m === 'time') return fmtTime(reps)
  if (m === 'reps') return String(reps)
  return weight > 0 ? `${weight}×${reps}` : String(reps)
}
