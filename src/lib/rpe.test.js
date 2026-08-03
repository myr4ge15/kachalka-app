import { describe, it, expect } from 'vitest'
import {
  FEELS, FEEL_LABELS, RPE_KEEP, RPE_MAX_BYTES,
  normFeel, feelsForWorkout, feelFor, putWorkoutFeels, pruneRpe, mergeRpe, withFeels,
} from './rpe.js'

const rec = (at, ex) => ({ at, ex })

describe('normFeel', () => {
  it('пропускает только три значения шкалы', () => {
    expect(FEELS).toEqual(['easy', 'ok', 'hard'])
    for (const f of FEELS) expect(normFeel(f)).toBe(f)
  })

  it('всё остальное — null (отсутствие оценки легально)', () => {
    for (const v of [undefined, null, '', 'EASY', 'легко', 7, 0, {}, []]) {
      expect(normFeel(v)).toBe(null)
    }
  })

  it('подписи есть у каждого значения шкалы', () => {
    for (const f of FEELS) expect(FEEL_LABELS[f]).toBeTruthy()
  })
})

describe('putWorkoutFeels', () => {
  it('пишет оценки тренировки и не трогает соседние', () => {
    const map = { w1: rec('2026-01-01', { e1: 'easy' }) }
    const out = putWorkoutFeels(map, 'w2', '2026-01-02', { e1: 'hard', e2: 'ok' })
    expect(out.w1).toEqual(rec('2026-01-01', { e1: 'easy' }))
    expect(out.w2).toEqual(rec('2026-01-02', { e1: 'hard', e2: 'ok' }))
    // исходная карта не мутирована
    expect(map.w2).toBeUndefined()
  })

  it('мусорные значения отбрасываются', () => {
    const out = putWorkoutFeels({}, 'w1', '2026-01-01', { e1: 'easy', e2: 'ЛЕГКО', e3: null })
    expect(out.w1.ex).toEqual({ e1: 'easy' })
  })

  it('пустой набор оценок = ОТСУТСТВИЕ записи, а не пустая запись', () => {
    // пропуск оценки — основной сценарий, карта не должна копить {ex:{}}
    expect(putWorkoutFeels({}, 'w1', '2026-01-01', {})).toEqual({})
    expect(putWorkoutFeels({}, 'w1', '2026-01-01', { e1: 'мусор' })).toEqual({})
  })

  it('перезапись тренировки снимает прежние оценки (правка состава)', () => {
    const map = { w1: rec('2026-01-01', { e1: 'easy', e2: 'hard' }) }
    const out = putWorkoutFeels(map, 'w1', '2026-01-01', { e1: 'ok' })
    expect(out.w1.ex).toEqual({ e1: 'ok' })
  })

  it('очистка всех оценок удаляет запись целиком', () => {
    const map = { w1: rec('2026-01-01', { e1: 'easy' }) }
    expect(putWorkoutFeels(map, 'w1', '2026-01-01', {})).toEqual({})
  })

  it('без workoutId возвращает карту как есть', () => {
    const map = { w1: rec('2026-01-01', { e1: 'easy' }) }
    expect(putWorkoutFeels(map, null, '2026-01-01', { e1: 'ok' })).toEqual(map)
  })
})

describe('feelsForWorkout / feelFor', () => {
  const map = { w1: rec('2026-01-01', { e1: 'easy', e2: 'hard' }) }

  it('отдаёт оценки тренировки и одного упражнения', () => {
    expect(feelsForWorkout(map, 'w1')).toEqual({ e1: 'easy', e2: 'hard' })
    expect(feelFor(map, 'w1', 'e2')).toBe('hard')
  })

  it('неизвестная тренировка/упражнение — пусто, а не падение', () => {
    expect(feelsForWorkout(map, 'нет')).toEqual({})
    expect(feelFor(map, 'w1', 'нет')).toBe(null)
    expect(feelFor(null, 'w1', 'e1')).toBe(null)
    expect(feelsForWorkout('мусор', 'w1')).toEqual({})
  })
})

describe('pruneRpe', () => {
  it('оставляет `keep` самых свежих по дате', () => {
    const map = {
      a: rec('2026-01-01', { e: 'easy' }),
      b: rec('2026-03-01', { e: 'ok' }),
      c: rec('2026-02-01', { e: 'hard' }),
    }
    expect(Object.keys(pruneRpe(map, 2)).sort()).toEqual(['b', 'c'])
  })

  it('карта короче лимита не меняется', () => {
    const map = { a: rec('2026-01-01', { e: 'easy' }) }
    expect(pruneRpe(map, 5)).toEqual(map)
  })

  it('записи без даты уходят первыми', () => {
    const map = {
      нет: rec('', { e: 'easy' }),
      есть: rec('2026-01-01', { e: 'ok' }),
    }
    expect(Object.keys(pruneRpe(map, 1))).toEqual(['есть'])
  })

  it('лимит по умолчанию — RPE_KEEP', () => {
    const map = {}
    for (let i = 0; i < RPE_KEEP + 10; i++) {
      map[`w${i}`] = rec(`2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`, { e: 'ok' })
    }
    expect(Object.keys(pruneRpe(map)).length).toBe(RPE_KEEP)
  })

  it('режет и по размеру: у сервера жёсткий лимит 64 КБ на значение', () => {
    // Патология, которую одна обрезка по числу тренировок не ловит: тренировок
    // мало, но упражнений в каждой очень много.
    const map = {}
    for (let i = 0; i < 20; i++) {
      const ex = {}
      for (let j = 0; j < 200; j++) ex[`exercise-uuid-${j}-padding-to-real-length`] = 'hard'
      map[`workout-uuid-${i}`] = rec(`2026-01-${String(i + 1).padStart(2, '0')}`, ex)
    }
    const out = pruneRpe(map)
    expect(Object.keys(out).length).toBeLessThan(20)
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(RPE_MAX_BYTES)
    // выживают САМЫЕ СВЕЖИЕ
    expect(out['workout-uuid-19']).toBeTruthy()
    expect(out['workout-uuid-0']).toBeUndefined()
  })

  it('одна огромная тренировка не вычищается в ноль (лучше видимая ошибка синка, чем пустая карта)', () => {
    const ex = {}
    for (let j = 0; j < 5000; j++) ex[`e${j}`] = 'ok'
    const out = pruneRpe({ w1: rec('2026-01-01', ex) })
    expect(Object.keys(out)).toEqual(['w1'])
  })
})

describe('mergeRpe', () => {
  it('объединяет тренировки с обеих сторон', () => {
    const a = { w1: rec('2026-01-01', { e1: 'easy' }) }
    const b = { w2: rec('2026-01-02', { e1: 'hard' }) }
    expect(mergeRpe(a, b)).toEqual({ ...a, ...b })
  })

  it('внутри одной тренировки объединяет упражнения — оценка офлайн не теряется', () => {
    const local = { w1: rec('2026-01-01', { e1: 'easy' }) }
    const remote = { w1: rec('2026-01-01', { e2: 'hard' }) }
    expect(mergeRpe(local, remote).w1.ex).toEqual({ e1: 'easy', e2: 'hard' })
  })

  it('спор об одной паре решает preferLocal', () => {
    const local = { w1: rec('2026-01-01', { e1: 'easy' }) }
    const remote = { w1: rec('2026-01-01', { e1: 'hard' }) }
    expect(mergeRpe(local, remote, true).w1.ex.e1).toBe('easy')
    expect(mergeRpe(local, remote, false).w1.ex.e1).toBe('hard')
  })

  it('пустая/мусорная сторона не стирает вторую', () => {
    const a = { w1: rec('2026-01-01', { e1: 'easy' }) }
    expect(mergeRpe(a, null)).toEqual(a)
    expect(mergeRpe(null, a)).toEqual(a)
    expect(mergeRpe(a, { w1: rec('2026-01-01', {}) })).toEqual(a)
  })

  it('берёт непустую дату', () => {
    const local = { w1: rec('', { e1: 'easy' }) }
    const remote = { w1: rec('2026-01-01', { e2: 'ok' }) }
    expect(mergeRpe(local, remote).w1.at).toBe('2026-01-01')
  })

  it('результат слияния тоже обрезается', () => {
    const a = {}
    const b = {}
    for (let i = 0; i < RPE_KEEP; i++) a[`a${i}`] = rec(`2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`, { e: 'ok' })
    for (let i = 0; i < RPE_KEEP; i++) b[`b${i}`] = rec(`2026-02-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`, { e: 'ok' })
    expect(Object.keys(mergeRpe(a, b)).length).toBe(RPE_KEEP)
  })
})

describe('withFeels', () => {
  const map = { w1: rec('2026-01-02', { e1: 'hard' }), w2: rec('2026-01-01', { e2: 'easy' }) }

  it('подмешивает оценку нужного упражнения', () => {
    const out = withFeels([{ id: 'w1', sets: [] }, { id: 'w2', sets: [] }], map, 'e1')
    expect(out.map((x) => x.feel)).toEqual(['hard', null])
  })

  it('сессия без оценки получает feel:null, а не отсутствие поля', () => {
    const [only] = withFeels([{ id: 'нет', sets: [] }], map, 'e1')
    expect('feel' in only).toBe(true)
    expect(only.feel).toBe(null)
  })

  it('остальные поля сессии сохраняются', () => {
    const [only] = withFeels([{ id: 'w1', performed_at: '2026-01-02', sets: [1] }], map, 'e1')
    expect(only.performed_at).toBe('2026-01-02')
    expect(only.sets).toEqual([1])
  })

  it('пустой вход не падает', () => {
    expect(withFeels(null, map, 'e1')).toEqual([])
    expect(withFeels([{ id: 'w1' }], null, 'e1')[0].feel).toBe(null)
  })
})
