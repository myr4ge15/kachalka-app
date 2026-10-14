import { TECHNIQUE_INDEX } from '../content/techniqueIndex.js'
import { VOICE_ALIASES } from './voiceAliases.js'
import { describe, expect, it } from 'vitest'
import { voiceCandidates } from './voiceExercises.js'

const catalog = [
  { id: 'a', name: 'Жим лежа со штангой' },
  { id: 'b', name: 'Жим гантелей сидя' },
  { id: 'c', name: 'Тяга верхнего блока' },
]
describe('voiceCandidates', () => {
  it('matches barbell word forms and preserves equipment ambiguity', () => {
    const barbell = { id: 'd', name: 'Приседания со штангой' }
    const matches = voiceCandidates('штанга', [...catalog, barbell])
    expect(matches).toContainEqual(catalog[0])
    expect(matches).toContainEqual(barbell)
    expect(matches).not.toContainEqual(catalog[1])
  })
  it.each(['жим лежа на скамейке', 'Добавь жим лёжа на скамье'])('understands %s', (phrase) => {
    expect(voiceCandidates(phrase, catalog)).toEqual([catalog[0]])
  })
  it('keeps explicit incline and equipment qualifiers', () => {
    const incline = { id: 'i', name: 'Жим лежа на наклонной скамье' }
    expect(voiceCandidates(incline.name, [...catalog, incline])).toEqual([incline])
    expect(voiceCandidates('жим гантелей сидя', catalog)).toEqual([catalog[1]])
  })
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
    expect(voiceCandidates('на', catalog)).toEqual([])
    expect(voiceCandidates('абракадабра', catalog)).toEqual([])
  })
})

const fullCatalog = TECHNIQUE_INDEX.flatMap((entry) => entry.names.map((name) => ({ id: name, name })))
describe('curated voice vocabulary', () => {
  it('covers all local technique entries', () => {
    expect(VOICE_ALIASES.map((entry) => entry.slug).sort()).toEqual(TECHNIQUE_INDEX.map((entry) => entry.slug).sort())
  })
  it.each(VOICE_ALIASES.flatMap((entry) => entry.aliases.map((alias) => [alias, entry.names])))('%s resolves only to its available variants', (alias, names) => {
    const matches = voiceCandidates(alias, fullCatalog)
    expect(matches.some((ex) => names.includes(ex.name))).toBe(true)
    expect(voiceCandidates(alias, [])).toEqual([])
  })
  it.each(fullCatalog.map((ex) => [ex.name, ex]))('keeps canonical name %s first', (name, ex) => {
    expect(voiceCandidates(name, fullCatalog)[0]).toEqual(ex)
  })
  it('retains ambiguity and rejects unsupported qualifiers', () => {
    expect(voiceCandidates('махи', fullCatalog).length).toBeGreaterThan(1)
    expect(voiceCandidates('гантели', fullCatalog).length).toBeGreaterThan(1)
    expect(voiceCandidates('молотки на наклонной скамье', fullCatalog)).toEqual([])
    expect(voiceCandidates('румынка', [{ id: 'd', name: 'Становая тяга' }])).toEqual([])
  })
  it('normalizes equipment and prepositions for custom names too', () => {
    const ex = { id: 'custom', name: 'Жим с гантелями сидя' }
    expect(voiceCandidates('жим гантелей сидя', [ex])).toEqual([ex])
  })
})
