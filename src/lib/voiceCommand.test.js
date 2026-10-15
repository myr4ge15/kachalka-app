import { describe, expect, it } from 'vitest'
import { bestSetPhrase, mergeVoiceSet, parseVoiceCommand, voiceSetTarget } from './voiceCommand.js'

const set = (text) => parseVoiceCommand(text).set

describe('parseVoiceCommand — подход', () => {
  it.each([
    ['60 на 12', { weight: 60, reps: 12 }],
    ['шестьдесят на двенадцать', { weight: 60, reps: 12 }],
    ['60 12', { weight: 60, reps: 12 }],
    ['60x12', { weight: 60, reps: 12 }],
    ['60 × 12.', { weight: 60, reps: 12 }],
    ['60кг 12 раз', { weight: 60, reps: 12 }],
    ['12 раз по 60 кг', { weight: 60, reps: 12 }],
    ['12 по 60', { weight: 60, reps: 12 }],
    ['шестьдесят два с половиной на восемь', { weight: 62.5, reps: 8 }],
    ['62,5 на 8', { weight: 62.5, reps: 8 }],
    ['сто двенадцать на пять', { weight: 112, reps: 5 }],
    ['двадцать двенадцать', { weight: 20, reps: 12 }],
    ['полтинник на десять', { weight: 50, reps: 10 }],
    ['минус двадцать на 8', { weight: -20, reps: 8 }],
    ['запиши 80 на 5', { weight: 80, reps: 5 }],
  ])('%s', (text, expected) => {
    expect(parseVoiceCommand(text)).toEqual({ action: 'add_set', query: '', set: expected })
  })
  it('одно голое число — повторы, вес называют с «кг»', () => {
    expect(set('12')).toEqual({ reps: 12 })
    expect(set('двенадцать раз')).toEqual({ reps: 12 })
    expect(set('60 кг')).toEqual({ weight: 60 })
  })
  it('номер подхода и новая строка', () => {
    expect(set('второй подход 60 на 10')).toEqual({ weight: 60, reps: 10, setNo: 2 })
    expect(set('2-й подход 60 на 10')).toEqual({ weight: 60, reps: 10, setNo: 2 })
    expect(set('подход номер три 12 раз')).toEqual({ reps: 12, setNo: 3 })
    expect(set('подход 2 шестьдесят на восемь')).toEqual({ weight: 60, reps: 8, setNo: 2 })
    expect(set('еще 60 на 12')).toEqual({ weight: 60, reps: 12, newSet: true })
    expect(set('новый подход')).toEqual({ newSet: true })
  })
  it('больше двух чисел — ошибка, а не догадка', () => {
    expect(set('60 на 12 на 3')).toEqual({ error: 'too-many' })
  })
})

describe('parseVoiceCommand — упражнение', () => {
  it('отделяет название от команды и хвоста с подходом', () => {
    expect(parseVoiceCommand('Добавь жим лёжа 60 на 12')).toEqual({
      action: 'add_exercise', query: 'жим лежа', set: { weight: 60, reps: 12 },
    })
    expect(parseVoiceCommand('Добавь упражнение жим!')).toEqual({ action: 'add_exercise', query: 'жим', set: null })
    expect(parseVoiceCommand('добавь еще жим').query).toBe('жим')
  })
  it('предлоги и порядковые слова в названии не режет', () => {
    expect(parseVoiceCommand('жим лежа на наклонной скамье').query).toBe('жим лежа на наклонной скамье')
    expect(parseVoiceCommand('тяга одной рукой').query).toBe('тяга одной рукой')
  })
  it('пусто — пусто', () => {
    expect(parseVoiceCommand('')).toEqual({ action: 'add_exercise', query: '', set: null })
  })
})

describe('voiceSetTarget', () => {
  it('курсор, номер, новая строка, несуществующий подход', () => {
    expect(voiceSetTarget({ reps: 12 }, 3, 1)).toBe(1)
    expect(voiceSetTarget({ reps: 12 }, 3, 7)).toBe(3)
    expect(voiceSetTarget({ reps: 12, setNo: 2 }, 3, 0)).toBe(1)
    expect(voiceSetTarget({ reps: 12, setNo: 4 }, 3, 0)).toBe(3)
    expect(voiceSetTarget({ reps: 12, setNo: 5 }, 3, 0)).toBe(-1)
    expect(voiceSetTarget({ reps: 12, newSet: true }, 3, 0)).toBe(3)
  })
})

describe('mergeVoiceSet', () => {
  const base = { weight: 60, reps: 10 }
  it('недостающее берет из строки', () => {
    expect(mergeVoiceSet({ reps: 12 }, base, 'weight')).toEqual({ weight: 60, reps: 12 })
    expect(mergeVoiceSet({ weight: 62.5 }, base, 'weight')).toEqual({ weight: 62.5, reps: 10 })
    expect(mergeVoiceSet({ weight: 70, reps: 5 }, base, 'weight')).toEqual({ weight: 70, reps: 5 })
  })
  it('свой вес: доп. вес и помощь гравитрона', () => {
    expect(mergeVoiceSet({ reps: 12 }, { weight: 0, reps: 8 }, 'reps')).toEqual({ weight: 0, reps: 12 })
    expect(mergeVoiceSet({ weight: -20, reps: 8 }, { weight: 0, reps: 8 }, 'reps')).toEqual({ weight: -20, reps: 8 })
  })
  it('вне границ и непонятное — null, без тихой подрезки', () => {
    expect(mergeVoiceSet({ weight: -20, reps: 8 }, base, 'weight')).toBeNull()
    expect(mergeVoiceSet({ weight: 2000, reps: 1 }, base, 'weight')).toBeNull()
    expect(mergeVoiceSet({ reps: 12.5 }, base, 'weight')).toBeNull()
    expect(mergeVoiceSet({ reps: 0 }, base, 'weight')).toBeNull()
    expect(mergeVoiceSet({ error: 'too-many' }, base, 'weight')).toBeNull()
    expect(mergeVoiceSet(null, base, 'weight')).toBeNull()
    expect(mergeVoiceSet({ reps: 60 }, { weight: 0, reps: 30 }, 'time')).toBeNull()
    expect(mergeVoiceSet({ newSet: true }, {}, 'weight')).toBeNull()
  })
})

describe('bestSetPhrase', () => {
  it('берет первый вариант с понятными числами', () => {
    expect(bestSetPhrase(['жим', '60 на 12'])).toEqual({ phrase: '60 на 12', set: { weight: 60, reps: 12 } })
  })
  it('нет понятных — первый как есть', () => {
    expect(bestSetPhrase(['жим'])).toEqual({ phrase: 'жим', set: null })
    expect(bestSetPhrase([])).toEqual({ phrase: '', set: null })
  })
})
