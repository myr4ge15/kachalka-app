import { describe, it, expect } from 'vitest'
import {
  appendExerciseIn, removeExerciseIn, insertExerciseIn, replaceExerciseIn,
  updateSetIn, stepSetIn, addSetIn, removeSetIn, insertSetIn,
  revertProgIn, applyProgIn, toggleProgSettingsIn, setsFromTemplate,
} from './workoutEntries.js'
import { WEIGHT_MAX, TIME_MAX } from './setLimits.js'

const wEx = (id = 'e1', over = {}) => ({ id, name: 'Жим', metric: 'weight', ...over })
const rEx = (id = 'e2') => ({ id, name: 'Подтягивания', metric: 'reps' })
const tEx = (id = 'e3') => ({ id, name: 'Планка', metric: 'time' })
const s = (weight, reps, _k = 'k') => ({ weight, reps, _k })
const entry = (ex, sets, prog) => ({ exercise: ex, sets, ...(prog !== undefined ? { prog } : {}) })

describe('appendExerciseIn', () => {
  it('добавляет новое упражнение с панелью прогрессии', () => {
    const meta = { kind: 'up' }
    const out = appendExerciseIn([], wEx(), [s(60, 10)], meta)
    expect(out).toHaveLength(1)
    expect(out[0].exercise.id).toBe('e1')
    expect(out[0].prog).toBe(meta)
  })
  it('анти-дубль по id → возвращает ТОТ ЖЕ массив (по ссылке)', () => {
    const cur = [entry(wEx(), [s(60, 10)])]
    expect(appendExerciseIn(cur, wEx(), [s(1, 1)], null)).toBe(cur)
  })
})

describe('removeExerciseIn / insertExerciseIn', () => {
  it('убирает по индексу', () => {
    const cur = [entry(wEx('a'), []), entry(wEx('b'), [])]
    expect(removeExerciseIn(cur, 0).map((e) => e.exercise.id)).toEqual(['b'])
  })
  it('undo вставляет на прежнее место', () => {
    const cur = [entry(wEx('b'), [])]
    const out = insertExerciseIn(cur, 0, entry(wEx('a'), []))
    expect(out.map((e) => e.exercise.id)).toEqual(['a', 'b'])
  })
  it('undo с индексом больше длины кладёт в конец', () => {
    const cur = [entry(wEx('a'), [])]
    const out = insertExerciseIn(cur, 9, entry(wEx('b'), []))
    expect(out.map((e) => e.exercise.id)).toEqual(['a', 'b'])
  })
  it('undo с уже вернувшимся упражнением → массив без изменений', () => {
    const cur = [entry(wEx('a'), [])]
    expect(insertExerciseIn(cur, 0, entry(wEx('a'), []))).toBe(cur)
  })
})

describe('replaceExerciseIn', () => {
  it('весовое → подходы сохраняются как есть', () => {
    const cur = [entry(wEx('a'), [s(60, 10), s(60, 8)])]
    const out = replaceExerciseIn(cur, 0, wEx('b'))
    expect(out[0].exercise.id).toBe('b')
    expect(out[0].sets.map((x) => [x.weight, x.reps])).toEqual([[60, 10], [60, 8]])
  })
  it('не-весовое новое → вес подходов обнуляется, повторы сохраняются', () => {
    const cur = [entry(wEx('a'), [s(60, 10)])]
    const out = replaceExerciseIn(cur, 0, rEx('b'))
    expect(out[0].sets[0]).toMatchObject({ weight: 0, reps: 10 })
  })
})

describe('updateSetIn', () => {
  it('меняет поле подхода, строку сохраняет как есть', () => {
    const cur = [entry(wEx(), [s(60, 10)])]
    const out = updateSetIn(cur, 0, 0, 'weight', '62.5')
    expect(out[0].sets[0].weight).toBe('62.5')
  })
  it('иммутабельность: исходный массив не мутируется', () => {
    const cur = [entry(wEx(), [s(60, 10)])]
    updateSetIn(cur, 0, 0, 'reps', '9')
    expect(cur[0].sets[0].reps).toBe(10)
  })
})

describe('stepSetIn — клампинг границ', () => {
  it('вес +1.25', () => {
    const out = stepSetIn([entry(wEx(), [s(60, 10)])], 0, 0, 'weight', 1.25)
    expect(out[0].sets[0].weight).toBe(61.25)
  })
  it('вес не превышает WEIGHT_MAX', () => {
    const out = stepSetIn([entry(wEx(), [s(WEIGHT_MAX, 10)])], 0, 0, 'weight', 1.25)
    expect(out[0].sets[0].weight).toBe(WEIGHT_MAX)
  })
  it('вес не уходит ниже 0', () => {
    const out = stepSetIn([entry(wEx(), [s(0, 10)])], 0, 0, 'weight', -1.25)
    expect(out[0].sets[0].weight).toBe(0)
  })
  it('повторы не ниже 1', () => {
    const out = stepSetIn([entry(wEx(), [s(60, 1)])], 0, 0, 'reps', -1)
    expect(out[0].sets[0].reps).toBe(1)
  })
  it('нечисловое значение стартует от минимума (reps → 1, затем +1 = 2)', () => {
    const out = stepSetIn([entry(wEx(), [s(60, '')])], 0, 0, 'reps', 1)
    expect(out[0].sets[0].reps).toBe(2)
  })
  it('нечисловой вес стартует от 0 (+1.25 = 1.25)', () => {
    const out = stepSetIn([entry(wEx(), [s('.', 10)])], 0, 0, 'weight', 1.25)
    expect(out[0].sets[0].weight).toBe(1.25)
  })
  it('time: секунды кламп по TIME_MAX', () => {
    const out = stepSetIn([entry(tEx(), [s(0, TIME_MAX - 5)])], 0, 0, 'reps', 15)
    expect(out[0].sets[0].reps).toBe(TIME_MAX)
  })
})

describe('addSetIn / removeSetIn / insertSetIn', () => {
  it('добавляет копию последнего подхода со свежим ключом', () => {
    const cur = [entry(wEx(), [s(60, 10, 'k1')])]
    const out = addSetIn(cur, 0)
    expect(out[0].sets).toHaveLength(2)
    expect(out[0].sets[1]).toMatchObject({ weight: 60, reps: 10 })
    expect(out[0].sets[1]._k).toBeTruthy()
    expect(out[0].sets[1]._k).not.toBe('k1')
  })
  it('пустой список подходов → дефолт метрики (весовое: 20×10)', () => {
    const out = addSetIn([entry(wEx(), [])], 0)
    expect(out[0].sets[0]).toMatchObject({ weight: 20, reps: 10 })
  })
  it('убирает подход по индексу', () => {
    const cur = [entry(wEx(), [s(60, 10), s(65, 8)])]
    expect(removeSetIn(cur, 0, 0)[0].sets.map((x) => x.weight)).toEqual([65])
  })
  it('undo подхода: ищет упражнение по id, вставляет на позицию', () => {
    const cur = [entry(wEx('x'), [s(65, 8)])]
    const out = insertSetIn(cur, 'x', 0, s(60, 10))
    expect(out[0].sets.map((x) => x.weight)).toEqual([60, 65])
  })
  it('undo подхода: чужие упражнения не трогает', () => {
    const cur = [entry(wEx('x'), [s(1, 1)]), entry(wEx('y'), [s(2, 2)])]
    const out = insertSetIn(cur, 'x', 0, s(9, 9))
    expect(out[1].sets).toHaveLength(1)
  })
})

describe('revertProgIn / applyProgIn / toggleProgSettingsIn', () => {
  const withProg = () => [entry(wEx(), [s(62.5, 10)], {
    prev: [s(60, 10)], recSets: [s(62.5, 10)], applied: true, settingsOpen: false,
  })]
  it('revert: подходы = prev, applied false, свежие ключи', () => {
    const out = revertProgIn(withProg(), 0)
    expect(out[0].sets.map((x) => [x.weight, x.reps])).toEqual([[60, 10]])
    expect(out[0].prog.applied).toBe(false)
    expect(out[0].sets[0]._k).toBeTruthy()
  })
  it('apply: подходы = recSets, applied true', () => {
    const out = applyProgIn(withProg(), 0)
    expect(out[0].sets.map((x) => x.weight)).toEqual([62.5])
    expect(out[0].prog.applied).toBe(true)
  })
  it('без prog → запись не трогается', () => {
    const cur = [entry(wEx(), [s(60, 10)])]
    expect(revertProgIn(cur, 0)[0].sets[0].weight).toBe(60)
  })
  it('toggle настроек переключает settingsOpen', () => {
    const out = toggleProgSettingsIn(withProg(), 0)
    expect(out[0].prog.settingsOpen).toBe(true)
  })
})

describe('setsFromTemplate', () => {
  it('нет плана → один дефолтный подход', () => {
    const out = setsFromTemplate(wEx(), {})
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ weight: 20, reps: 10 })
  })
  it('план 3×8×50 (весовое) → 3 одинаковых подхода', () => {
    const out = setsFromTemplate(wEx(), { sets: 3, reps: 8, weight: 50 })
    expect(out).toHaveLength(3)
    expect(out.every((x) => x.weight === 50 && x.reps === 8)).toBe(true)
    expect(out.every((x) => x._k)).toBe(true)
  })
  it('не-весовое → вес 0 даже если в плане задан', () => {
    const out = setsFromTemplate(rEx(), { sets: 2, reps: 12, weight: 40 })
    expect(out.every((x) => x.weight === 0 && x.reps === 12)).toBe(true)
  })
})
