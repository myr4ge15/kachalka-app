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

export const DISCIPLINE_UNITS = { weight: 'Вес, кг', reps: 'Повторы', time: 'Время, мин:сек' }
