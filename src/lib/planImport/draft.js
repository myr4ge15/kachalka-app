import { normalizeName } from '../similar.js'
import { exerciseMetric, fmtNum } from '../metric.js'
import { defaultSet } from '../progressionCard.js'

function display(value) {
  return Array.isArray(value) ? value.map(fmtNum).join('–') : fmtNum(value)
}

export function describeTarget(set) {
  if (set.pending) return 'Уточнить цель'
  const parts = []
  if (set.phase === 'warmup') parts.push('разминка')
  if (set.phase === 'cooldown') parts.push('заминка')
  if (set.optional) parts.push('по желанию')
  for (const [key, unit] of [['kg', 'кг'], ['reps', 'повт.'], ['seconds', 'с'], ['km', 'км']]) {
    if (set[key] !== undefined) parts.push(display(set[key]) + ' ' + unit)
  }
  return parts.join(' · ')
}

export function acceptsTargets(ex, item) {
  const metric = exerciseMetric(ex)
  return item.sets.every(s => {
    if (s.pending) return true
    if (s.reps !== undefined && !['weight', 'reps'].includes(metric)) return false
    if (s.seconds !== undefined && !['time', 'distance'].includes(metric)) return false
    if (s.km !== undefined && metric !== 'distance') return false
    if (s.kg === undefined) return true
    const min = Array.isArray(s.kg) ? s.kg[0] : s.kg
    return metric !== 'distance' && (min >= 0 || metric === 'reps')
  })
}

export function matchExercise(item, catalog) {
  const name = normalizeName(item.name)
  const matches = catalog.filter(ex => normalizeName(ex.name) === name && acceptsTargets(ex, item))
  if (item.exercise_id) return matches.find(ex => ex.id === item.exercise_id)?.id ?? ''
  return matches.length === 1 ? matches[0].id : ''
}

export function plannedRestSeconds(entry) {
  if (!entry) return null
  if ('planRestSec' in entry) return entry.planRestSec
  // Уже начатый импорт на старой бете сохранил отдых первой строкой заметки.
  if (!entry.planNote || !entry.sets?.some(s => s.targetLabel)) return null
  const old = /^Отдых (\d+)(?:–\d+)? с(?:\n|$)/u.exec(entry.planNote)
  return old ? Number(old[1]) : null
}

export function planEntry(item) {
  const { planTarget, ...exercise } = item
  if (!planTarget) return { exercise, sets: [defaultSet(exercise)] }
  const metric = exerciseMetric(exercise)
  const sets = planTarget.sets.map(s => {
    const actual = v => !s.optional && typeof v === 'number' ? v : ''
    const load = metric === 'distance' ? s.km : s.kg
    return { weight: actual(load), reps: Array.isArray(load) ? '' : actual(s.reps ?? s.seconds), targetLabel: describeTarget(s) }
  })
  const phase = planTarget.sets[0]?.phase
  const note = [planTarget.rest_sec && 'Отдых ' + display(planTarget.rest_sec) + ' с', planTarget.notes].filter(Boolean).join('\n')
  const rest = planTarget.rest_sec
  return { exercise, sets, planRestSec: Array.isArray(rest) ? rest[0] : rest ?? null, ...(note && { planNote: note }),
    ...(phase && phase !== 'work' && planTarget.sets.every(s => s.phase === phase) && { phase }) }
}
