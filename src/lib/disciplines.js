import { normMetric, fmtMetricValue } from './metric.js'
import { cmpIsoAsc } from './cmp.js'

export function disciplineSignature(d) {
  return JSON.stringify([d?.id, d?.exercise_id, normMetric(d?.metric), Boolean(d?.split_by_sex), d?.updated_at])
}

export function disciplineGroup(sex) {
  return sex === 'm' || sex === 'f' ? sex : 'u'
}

export function compareDisciplineRows(a, b) {
  const metric = normMetric(a.metric)
  return Number(b.value) - Number(a.value)
    || (metric === 'weight' ? Number(b.reps) - Number(a.reps) : 0)
    || cmpIsoAsc(a.performed_at, b.performed_at)
    || String(a.user_id).localeCompare(String(b.user_id))
}

export function disciplineResult(metric, value) {
  return normMetric(metric) === 'reps' ? `${value} повт.` : fmtMetricValue(metric, value)
}

// Подпись единицы рядом с названием — со строчной (26.10.2026, fb_c6b5ce77).
export const DISCIPLINE_UNITS = { weight: 'вес, кг', reps: 'повторы', time: 'время, мин:сек', distance: 'дистанция, км' }

// Строка «Рейтинг» в Ленте скрыта только там, где это тупик: человек состоит в кругах, ни одним не владеет
// (добавить дисциплины не может), и у всех каталог уже загружен и пуст. Без круга строка остается — она зовет
// создать круг, владельцу — подсказывает, что делать; неизвестный каталог (офлайн, первая загрузка) — не повод прятать.
export function ratingRailEmpty(circles, catalogs) {
  const active = (circles ?? []).filter((c) => c.my_status === 'active')
  if (!active.length) return false
  return active.every((c) => !c.is_owner && catalogs?.[c.circle_id]?.items?.length === 0)
}
