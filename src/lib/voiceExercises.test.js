import { describe, expect, it } from 'vitest'
import { voiceCandidates } from './voiceExercises.js'

const catalog = [
  { id: 'a', name: 'Жим лежа со штангой' },
  { id: 'b', name: 'Жим гантелей сидя' },
  { id: 'c', name: 'Тяга верхнего блока' },
]
describe('voiceCandidates', () => {
  it('prioritizes bench for жим but preserves ambiguity without duplicates', () => {
    expect(voiceCandidates('Добавь упражнение жим!', catalog)).toEqual(catalog.slice(0, 2))
  })
  it('normalizes speech and resolves synonyms only in the supplied catalog', () => {
    expect(voiceCandidates('Жим лёжа', catalog)).toEqual([catalog[0]])
    expect(voiceCandidates('верхний блок', catalog)).toEqual([catalog[2]])
    expect(voiceCandidates('верхний блок', catalog.slice(0, 2))).toEqual([])
  })
  it('does not invent results for empty or unknown speech', () => {
    expect(voiceCandidates('', catalog)).toEqual([])
    expect(voiceCandidates('абракадабра', catalog)).toEqual([])
  })
})
