import { describe, it, expect } from 'vitest'
import { matchScannedText } from './scannerMatch.js'
const catalog = ['Тяга верхнего блока', 'Жим ногами', 'Подъем на носки сидя', 'Подъем на носки стоя', 'Приведение руки к груди'].map((name, id) => ({ name, id }))
const hips = [
  { id: 'in', name: 'Сведение ног в тренажере (Hip Adductor)' },
  { id: 'out', name: 'Разведение ног в тренажере (Hip Abductor)' },
]
it('does not confuse opposing movements, but supports a combined machine', () => {
  expect(matchScannedText('HIP ADDUCTOR', hips).map(m => m.exercise.id)).toEqual(['in'])
  expect(matchScannedText('HIP ABDUCTOR', hips).map(m => m.exercise.id)).toEqual(['out'])
  expect(matchScannedText('HIP ABDUCTOR &\nADDUCTOR MACHINE', hips)).toHaveLength(2)
})
describe('scanner matching', () => {
  it('reads a bilingual equipment label amid brand text', () => {
    expect(matchScannedText('TECHNOGYM\nLAT PULLDOWN\n25 KG', catalog).map(x => x.exercise.id)).toEqual([0])
    expect(matchScannedText('ЖИМ НОГАМИ', catalog)[0].exercise.id).toBe(1)
  })
  it('tolerates a single OCR typo, retains ambiguity', () => {
    expect(matchScannedText('LAT PULLD0WN', catalog)).toHaveLength(1)
    expect(matchScannedText('CALF RAISE', catalog)).toHaveLength(2)
  })
  it('ignores noise, unknown and hidden exercises', () => {
    for (const text of ['PRESS', '25 KG', 'HAMMER STRENGTH', 'Приведение руки к груди']) expect(matchScannedText(text, catalog)).toEqual([])
    expect(matchScannedText('LAT PULLDOWN', [{ ...catalog[0], is_hidden: true }])).toEqual([])
    expect(matchScannedText('LEG EXTENSION', catalog)).toEqual([])
  })
})
describe('scanner ranking', () => {
  it('puts the name printed on the plate before other label targets', () => {
    const named = [{ id: 'a', name: 'Сгибание рук на изолированном тренажере' }, { id: 'b', name: 'Сгибание рук на нижнем блоке' }]
    expect(matchScannedText('ARM CURL\nСгибание рук на нижнем блоке', named).map(m => m.exercise.id)).toEqual(['b', 'a'])
  })
  it('keeps the curated order of label targets regardless of catalog order', () => {
    const list = [{ id: 'stand', name: 'Подъем на носки стоя' }, { id: 'sit', name: 'Подъем на носки сидя' }]
    expect(matchScannedText('CALF RAISE', list).map(m => m.exercise.id)).toEqual(['sit', 'stand'])
  })
  it('returns only exercise and label', () => {
    expect(Object.keys(matchScannedText('LEG PRESS', [{ id: 1, name: 'Жим ногами' }])[0]).sort()).toEqual(['exercise', 'label'])
  })
})
