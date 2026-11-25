import { localYmd } from '../calendar.js'
import { validDate } from './format.js'

const key = name => name.normalize('NFKC').toLowerCase().replaceAll('ё', 'е').replace(/\s+/gu, ' ').trim()
const months = 'января февраля марта апреля мая июня июля августа сентября октября ноября декабря'.split(' ')
const claim = /последняя\s+(?:зафиксированная\s+)?(?:тренировка|сессия)\s+(?:(?:прошла|состоялась|была)\s+)?(?:—\s*)?(\d{1,2})(?:\.(\d{1,2})\.(\d{4})|\s+([а-я]+)\s+(\d{4}))(?!\d)/iu

export function checkLastWorkout(result, source, workouts, label = 'в переданной выгрузке') {
  let latest = ''
  for (const workout of workouts) {
    if (typeof workout.performed_at !== 'string') continue
    const day = localYmd(workout.performed_at)
    if (day > latest) latest = day
  }
  if (!latest || !source) return
  for (const [i, line] of source.split(/\r\n?|\n/u).entries()) {
    const match = claim.exec(line.replace(/[\\*_]/gu, ''))
    if (!match) continue
    const [, day, month, year, name, longYear] = match
    const monthNumber = month ?? String(months.indexOf(name?.toLowerCase()) + 1)
    const iso = [year ?? longYear, monthNumber.padStart(2, '0'), day.padStart(2, '0')].join('-')
    if (validDate(iso) && iso !== latest) {
      const display = value => value.split('-').reverse().join('.')
      result.review.push({ line: i + 1, text: line, reason: 'Последняя тренировка: в ответе ' + display(iso) + ', ' + label + ' ' + display(latest) })
    }
  }
}

export function matchExport(result, history, source = '') {
  if (history?.schema !== 'workouts-export/v1' || !Array.isArray(history.workouts)) throw Error('Для --catalog нужна выгрузка workouts-export/v1')
  const names = new Map()
  for (const workout of history.workouts) {
    for (const { exercise } of workout.entries ?? []) {
      if (!exercise?.name || !exercise.id) continue
      const name = key(exercise.name)
      if (!names.has(name)) names.set(name, new Set())
      names.get(name).add(exercise.id)
    }
  }
  for (const ex of result.plan.exercises) {
    const ids = names.get(key(ex.name))
    if (ids && (ex.exercise_id ? ids.has(ex.exercise_id) : ids.size === 1)) {
      ex.exercise_id ??= [...ids][0]
    } else {
      result.review.push({ text: ex.name, reason: 'Проверь соответствие с выгрузкой по названию и ID' })
    }
  }
  checkLastWorkout(result, source, history.workouts)
  return result
}
