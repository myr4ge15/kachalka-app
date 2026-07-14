// ============================================================================
// Достижения / бейджи (🎮 система мотивации) — чистые функции БЕЗ Dexie/сети.
//
// Вехи (пороги) по четырём категориям, посчитанные из уже имеющихся данных
// профиля. Даты получения хранит слой БД (db/badges.js) в персональной `meta`;
// здесь — только «какие вехи закрыты сейчас» и прогресс до следующей. Никакого
// IndexedDB → всё тестируется в node.
//
// Опираемся на готовые агрегаты (формулы не дублируем):
//   profileStats.currentStreak / totalTonnage / fmtTonnage, records.minePrs.
// Серии засчитываем по МАКСИМАЛЬНОЙ за историю (прерванная серия не закрывает
// высокие вехи навсегда) — для этого локальный maxStreakWeeks.
// ============================================================================
import { currentStreak, totalTonnage, fmtTonnage } from './profileStats.js'
import { minePrs } from './records.js'

// Индекс НЕДЕЛИ (Monday-based, ЛОКАЛЬНО) — паритетная копия из profileStats
// (как freshness.js держит свои копии, чтобы не плодить связность/цикл). День
// тренировки везде трактуется как локальный; +3 сдвигает начало недели на пн.
function weekIndexOf(date) {
  const days = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000
  )
  return Math.floor((days + 3) / 7)
}

// Максимальная серия недель подряд за всю историю (число КАЛЕНДАРНЫХ недель с
// хотя бы одной тренировкой, идущих без пропуска). Пусто → 0.
export function maxStreakWeeks(workouts) {
  const weeks = new Set()
  for (const w of workouts ?? []) {
    if (!w.performed_at) continue
    weeks.add(weekIndexOf(new Date(w.performed_at)))
  }
  if (weeks.size === 0) return 0
  const sorted = [...weeks].sort((a, b) => a - b)
  let best = 1
  let run = 1
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1
    if (run > best) best = run
  }
  return best
}

// Определения вех — единый источник правды для экрана и детекта. `valueKey` —
// какое поле из currentValues сравнивать с `threshold`. Для объёма threshold в
// КГ (сравнивается с тоннажем в кг), в UI показывается тоннами через fmtTonnage.
export const BADGES = [
  // Регулярность (число тренировок)
  { id: 'reg_1', cat: 'regularity', valueKey: 'count', threshold: 1, icon: '🌱', name: 'Первый шаг', desc: 'Первая тренировка в журнале' },
  { id: 'reg_10', cat: 'regularity', valueKey: 'count', threshold: 10, icon: '💪', name: '10 тренировок', desc: 'Десять тренировок позади' },
  { id: 'reg_50', cat: 'regularity', valueKey: 'count', threshold: 50, icon: '🏋️', name: '50 тренировок', desc: 'Полсотни тренировок — втянулся' },
  { id: 'reg_100', cat: 'regularity', valueKey: 'count', threshold: 100, icon: '🎖️', name: 'Железная сотня', desc: 'Сто тренировок за плечами' },
  // Серии недель подряд (по макс. за историю)
  { id: 'streak_3', cat: 'streak', valueKey: 'maxStreakWeeks', threshold: 3, icon: '🔥', name: '3 недели подряд', desc: 'Три недели без пропусков' },
  { id: 'streak_7', cat: 'streak', valueKey: 'maxStreakWeeks', threshold: 7, icon: '⚡', name: 'Consistency', desc: 'Семь недель подряд — режим' },
  { id: 'streak_30', cat: 'streak', valueKey: 'maxStreakWeeks', threshold: 30, icon: '🌟', name: 'Несокрушимый', desc: 'Тридцать недель без срывов' },
  // Объём (суммарный тоннаж, порог в кг)
  { id: 'vol_10', cat: 'volume', valueKey: 'tonnage', threshold: 10_000, icon: '🪨', name: '10 тонн', desc: 'Суммарно поднято 10 тонн' },
  { id: 'vol_100', cat: 'volume', valueKey: 'tonnage', threshold: 100_000, icon: '🏗️', name: '100 тонн', desc: 'Суммарно поднято 100 тонн' },
  { id: 'vol_1000', cat: 'volume', valueKey: 'tonnage', threshold: 1_000_000, icon: '🦍', name: 'Король объёма', desc: 'Суммарно поднята тысяча тонн' },
  // Рекорды (число личных рекордов)
  { id: 'pr_1', cat: 'records', valueKey: 'prCount', threshold: 1, icon: '🥉', name: 'Первый рекорд', desc: 'Побит первый личный рекорд' },
  { id: 'pr_10', cat: 'records', valueKey: 'prCount', threshold: 10, icon: '🥈', name: '10 рекордов', desc: 'Десять личных рекордов' },
  { id: 'pr_50', cat: 'records', valueKey: 'prCount', threshold: 50, icon: '👑', name: 'Bench Monster', desc: 'Полсотни личных рекордов' },
]

// Порядок категорий для экрана + подписи.
export const BADGE_CATS = [
  { cat: 'regularity', label: 'Регулярность', icon: '⚡' },
  { cat: 'streak', label: 'Серии подряд', icon: '🔥' },
  { cat: 'volume', label: 'Объём', icon: '🦍' },
  { cat: 'records', label: 'Рекорды', icon: '🏆' },
]

// Один проход по истории → значения всех метрик, на которых стоят вехи.
// Переиспользуем готовые функции, серию берём максимальную за историю.
export function currentValues(workouts, now = new Date()) {
  const list = workouts ?? []
  return {
    count: list.length,
    streakWeeks: currentStreak(list, now), // текущая — для справки/подписи
    maxStreakWeeks: maxStreakWeeks(list), // драйвер бейджей серий
    tonnage: totalTonnage(list),
    prCount: minePrs(list).length,
  }
}

// Прогресс до конкретной вехи. { done, value, target, pct }.
export function badgeProgress(def, values) {
  const value = Number(values?.[def.valueKey]) || 0
  const target = Number(def.threshold) || 0
  const done = target > 0 && value >= target
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0
  return { done, value, target, pct }
}

// Оценка всех вех против текущих значений и уже выданных дат.
//   earned      — id вех, считающихся полученными (закрыты СЕЙЧАС ИЛИ уже
//                 отмечены в earnedMap — необратимость: упавший показатель бейдж
//                 не снимает);
//   newlyEarned — закрыты сейчас, но ещё НЕ отмечены (кандидаты на выдачу/тост).
export function evaluateBadges(values, earnedMap, now = new Date()) {
  void now
  const earned = []
  const newlyEarned = []
  const map = earnedMap ?? {}
  for (const def of BADGES) {
    const already = !!map[def.id]
    const { done } = badgeProgress(def, values)
    if (done || already) earned.push(def.id)
    if (done && !already) newlyEarned.push(def.id)
  }
  return { earned, newlyEarned }
}

// Ближайшая незакрытая веха (по проценту готовности) — для шапки экрана
// «до <бейдж> — ещё N». null, если всё получено.
export function nextBadge(values) {
  let best = null
  for (const def of BADGES) {
    const p = badgeProgress(def, values)
    if (p.done) continue
    if (!best || p.pct > best.pct) {
      best = { def, value: p.value, target: p.target, pct: p.pct, remaining: p.target - p.value }
    }
  }
  return best
}

// Форматирование значения/порога в единицах категории (объём → тонны через
// fmtTonnage, остальное — целое число). Возвращает строку для подписи.
export function fmtBadgeValue(def, value) {
  if (def?.cat === 'volume') {
    const t = fmtTonnage(Number(value) || 0)
    return `${t.value} ${t.unit}`
  }
  return String(Math.round(Number(value) || 0))
}
