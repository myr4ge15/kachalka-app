// Перестановка по id (шаблоны, порядок участников в Админке, упражнения в тренировке).
// Аудит 14.10: своего теста не было, покрывалась только через reorderExercises.
import { describe, expect, it } from 'vitest'
import { reorderById } from './reorderById.js'

const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
const key = (x) => x.id
const ids = (l) => l.map(key).join('')

describe('reorderById', () => {
  it('встает перед beforeId', () => {
    expect(ids(reorderById(list, 'd', 'b', key))).toBe('adbc')
    expect(ids(reorderById(list, 'a', 'c', key))).toBe('bacd')
  })

  it('beforeId = null — в конец', () => {
    expect(ids(reorderById(list, 'b', null, key))).toBe('acdb')
  })

  it('порядок не изменился — тот же массив (React не перерисует)', () => {
    expect(reorderById(list, 'b', 'c', key)).toBe(list) // b и так перед c
    expect(reorderById(list, 'd', null, key)).toBe(list) // d и так последний
    expect(reorderById(list, 'b', 'b', key)).toBe(list)
  })

  it('нет такого id или beforeId — список без изменений', () => {
    expect(reorderById(list, 'x', 'a', key)).toBe(list)
    expect(reorderById(list, 'a', 'x', key)).toBe(list)
  })

  it('исходный массив не меняется, элементы — те же объекты', () => {
    const before = [...list]
    const out = reorderById(list, 'c', 'a', key)
    expect(list).toEqual(before)
    expect(out[0]).toBe(list[2])
  })

  it('ключ — любая функция (упражнение в записи)', () => {
    const entries = [{ exercise: { id: 1 } }, { exercise: { id: 2 } }]
    const out = reorderById(entries, 2, 1, (e) => e.exercise.id)
    expect(out.map((e) => e.exercise.id)).toEqual([2, 1])
  })
})
