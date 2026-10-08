import { describe, it, expect } from 'vitest'
import { reorderExercises } from './reorderExercises.js'

describe('reorderExercises', () => {
  const a = { exercise: { id: 'a' }, sets: [{ weight: 60, reps: 8 }], prog: { applied: true } }
  const b = { exercise: { id: 'b' }, sets: [{ reps: 12 }] }
  const c = { exercise: { id: 'c' }, sets: [] }
  it('moves intact entries in both directions without changing the source', () => {
    const original = [a, b, c]
    expect(reorderExercises(original, 'c', 'a')).toEqual([c, a, b])
    expect(reorderExercises(original, 'a', null)).toEqual([b, c, a])
    expect(reorderExercises(original, 'a', 'c')).toEqual([b, a, c])
    expect(reorderExercises(original, 'a', null)[2]).toBe(a)
    expect(original).toEqual([a, b, c])
  })
  it('ignores stale IDs and unchanged positions', () => {
    const original = [a, b]
    for (const [id, before] of [['missing', 'b'], ['a', 'missing'], ['a', 'a'], ['a', 'b'], ['b', null]]) {
      expect(reorderExercises(original, id, before)).toBe(original)
    }
  })
})
