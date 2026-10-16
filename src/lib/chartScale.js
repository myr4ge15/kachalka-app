// Круглая шкала оси Y графика Прогресса (аудит 16.10). Раньше границы были «мин − 5 … макс + 5»,
// и recharts ставил деления 98 / 107 / 115. Здесь — шаг из ряда 1-2-5 × 10ⁿ (для времени —
// привычные секунды/минуты), границы кратны шагу, делений не больше maxTicks. Чистая функция.
const DECIMAL_STEPS = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]
const TIME_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]

export function niceScale(values, { pad = 0, maxTicks = 5, time = false } = {}) {
  const list = (values ?? []).filter(Number.isFinite)
  if (!list.length) return { domain: [0, 1], ticks: [0, 1] }
  let lo = Math.max(0, Math.min(...list) - pad)
  let hi = Math.max(...list) + pad
  if (hi <= lo) hi = lo + 1
  const steps = time ? TIME_STEPS : DECIMAL_STEPS
  const fits = (s) => Math.ceil(hi / s) - Math.floor(lo / s) + 1 <= maxTicks
  const step = steps.find(fits) ?? steps.at(-1)
  lo = Math.max(0, Math.floor(lo / step) * step)
  hi = Math.ceil(hi / step) * step
  const ticks = []
  for (let v = lo; v <= hi + step / 1000; v += step) ticks.push(Math.round(v * 100) / 100)
  return { domain: [lo, hi], ticks }
}
