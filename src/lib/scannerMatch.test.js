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
describe('scanner dictionary', () => {
  // Names as in the live global catalog (export 13.10.2026).
  const live = ['Тяга верхнего блока', 'Разгибание ног в тренажере', 'Сгибание ног в тренажере',
    'Разведение ног в тренажере (Hip Abductor)', 'Сведение ног в тренажере (Hip Adductor)',
    'Сведения в тренажере Бабочка', 'Обратное сведение в тренажере', 'Сведения в кроссовере',
    'Подъем на носки сидя', 'Подъем на носки стоя', 'Отжимания на брусьях', 'Подтягивания на тренажере',
    'Приседания в машине Смита', 'Шраги в тренажере Смита', 'Махи ногой назад в тренажере',
    'Ягодичный мостик в тренажере', 'Велотренажер', 'Степпер', 'Жим в тренажере Хаммер']
    .map(name => ({ id: name, name }))
  const ids = text => matchScannedText(text, live).map(m => m.id ?? m.exercise.id)
  it('knows other brands\' names for the same machines', () => {
    expect(ids('PULLDOWN')).toEqual(['Тяга верхнего блока'])
    expect(ids('TECHNOGYM\nLAT MACHINE')).toEqual(['Тяга верхнего блока'])
    expect(ids('PECTORAL')).toEqual(['Сведения в тренажере Бабочка'])
    expect(ids('PEC FLY / REAR DELTOID').sort()).toEqual(['Обратное сведение в тренажере', 'Сведения в тренажере Бабочка'])
    expect(ids('INNER THIGH')).toEqual(['Сведение ног в тренажере (Hip Adductor)'])
    expect(ids('OUTER THIGH')).toEqual(['Разведение ног в тренажере (Hip Abductor)'])
  })
  it('reads Russian plates without mixing up opposite movements', () => {
    expect(ids('РАЗГИБАНИЕ НОГ')).toEqual(['Разгибание ног в тренажере'])
    expect(ids('СГИБАНИЕ НОГ')).toEqual(['Сгибание ног в тренажере'])
    expect(ids('СВЕДЕНИЕ НОГ')).toEqual(['Сведение ног в тренажере (Hip Adductor)'])
    expect(ids('РАЗВЕДЕНИЕ НОГ')).toEqual(['Разведение ног в тренажере (Hip Abductor)'])
    expect(ids('ТЯГА СВЕРХУ')).toEqual(['Тяга верхнего блока'])
    expect(ids('ЖИМ ОТ ГРУДИ')).toEqual(['Жим в тренажере Хаммер'])
  })
  it('covers machines that had no label', () => {
    expect(ids('SMITH MACHINE')).toEqual(['Приседания в машине Смита', 'Шраги в тренажере Смита'])
    expect(ids('CABLE CROSSOVER')).toEqual(['Сведения в кроссовере'])
    expect(ids('ASSISTED DIP / CHIN')).toEqual(['Отжимания на брусьях', 'Подтягивания на тренажере'])
    expect(ids('GLUTE')).toEqual(['Махи ногой назад в тренажере'])
    expect(ids('UPRIGHT BIKE')).toEqual(['Велотренажер'])
    expect(ids('STAIR CLIMBER')).toEqual(['Степпер'])
  })
  it('lets the plate pick the calf raise variant', () => {
    expect(ids('STANDING CALF RAISE')[0]).toBe('Подъем на носки стоя')
    expect(ids('SEATED CALF RAISE')[0]).toBe('Подъем на носки сидя')
  })
})

describe('scanner: machines added to the catalog in 7.5.9', () => {
  const list = ['Жим плечами в тренажере', 'Махи в стороны в тренажере', 'Махи гантелями в стороны', 'Гакк-приседания',
    'Отжимания сидя в тренажере', 'Отжимания на брусьях', 'Повороты корпуса в тренажере', 'Тяга в рычажном тренажере',
    'Горизонтальная тяга блока', 'Тяга верхнего блока'].map(name => ({ id: name, name }))
  const ids = text => matchScannedText(text, list).map(m => m.exercise.id)
  it('finds the new machine for its plate first', () => {
    expect(ids('SHOULDER PRESS')).toEqual(['Жим плечами в тренажере'])
    expect(ids('LATERAL RAISE')).toEqual(['Махи в стороны в тренажере', 'Махи гантелями в стороны'])
    expect(ids('HACK SQUAT')).toEqual(['Гакк-приседания'])
    expect(ids('ГАКК-ПРИСЕДАНИЯ')).toEqual(['Гакк-приседания'])
    expect(ids('SEATED DIP')).toEqual(['Отжимания сидя в тренажере', 'Отжимания на брусьях'])
    expect(ids('ROTARY TORSO')).toEqual(['Повороты корпуса в тренажере'])
    expect(ids('HAMMER STRENGTH\nISO-LATERAL ROW')).toEqual(['Тяга в рычажном тренажере', 'Горизонтальная тяга блока'])
  })
  it('keeps Hammer Strength pulldown and assisted dips where they were', () => {
    expect(ids('ISO-LATERAL FRONT LAT PULLDOWN')).toEqual(['Тяга верхнего блока'])
    expect(ids('ASSISTED DIP')).toEqual(['Отжимания на брусьях'])
  })
})
