import { describe, it, expect } from 'vitest'
import {
  REACTION_KINDS, isReactionKind, summarizeReactions, reactorLine, applyReactionQueue,
} from './reactions.js'

const r = (user_id, kind, name) => ({ user_id, kind, name })

describe('isReactionKind / REACTION_KINDS', () => {
  it('распознаёт валидные виды и отвергает мусор', () => {
    expect(REACTION_KINDS.map((k) => k.kind)).toEqual(['muscle', 'fire', 'clap', 'wow'])
    expect(isReactionKind('fire')).toBe(true)
    expect(isReactionKind('like')).toBe(false)
    expect(isReactionKind(undefined)).toBe(false)
  })
})

describe('summarizeReactions', () => {
  it('считает по видам, помечает мои и собирает уникальные имена', () => {
    const list = [
      r('u1', 'fire', 'Петя'),
      r('u2', 'fire', 'Вася'),
      r('u1', 'muscle', 'Петя'),
      r('me', 'clap', 'Я'),
    ]
    const s = summarizeReactions(list, 'me')
    const byKind = Object.fromEntries(s.kinds.map((k) => [k.kind, k]))
    expect(byKind.fire.count).toBe(2)
    expect(byKind.muscle.count).toBe(1)
    expect(byKind.clap.count).toBe(1)
    expect(byKind.wow.count).toBe(0)
    expect(byKind.clap.mine).toBe(true)
    expect(byKind.fire.mine).toBe(false)
    expect(s.total).toBe(4)
    // имена уникальны по пользователю, в порядке появления
    expect(s.names).toEqual(['Петя', 'Вася', 'Я'])
  })

  it('всегда возвращает все 4 вида в фиксированном порядке', () => {
    const s = summarizeReactions([], 'me')
    expect(s.kinds.map((k) => k.kind)).toEqual(['muscle', 'fire', 'clap', 'wow'])
    expect(s.total).toBe(0)
    expect(s.names).toEqual([])
  })

  it('игнорирует неизвестные виды', () => {
    const s = summarizeReactions([r('u1', 'like', 'X'), r('u1', 'fire', 'X')], 'me')
    expect(s.total).toBe(1)
    expect(s.names).toEqual(['X'])
  })

  it('устойчив к мусору на входе', () => {
    expect(summarizeReactions(null, 'me').total).toBe(0)
  })
})

describe('reactorLine', () => {
  it('перечисляет имена, сворачивает хвост в +N', () => {
    expect(reactorLine([])).toBe('')
    expect(reactorLine(['Петя'])).toBe('Петя')
    expect(reactorLine(['Петя', 'Вася', 'Оля'])).toBe('Петя, Вася, Оля')
    expect(reactorLine(['Петя', 'Вася', 'Оля', 'Ким', 'Лео'])).toBe('Петя, Вася, Оля +2')
    expect(reactorLine(['Петя', 'Вася', 'Оля', 'Ким'], 2)).toBe('Петя, Вася +2')
  })
})

describe('applyReactionQueue', () => {
  const items = () => [
    { id: 'w1', reactions: [r('u2', 'fire', 'Вася')] },
    { id: 'w2', reactions: [] },
  ]

  it('add добавляет мою реакцию оптимистично', () => {
    const out = applyReactionQueue(items(), [{ workoutId: 'w2', kind: 'muscle', op: 'add' }],
      { id: 'me', name: 'Я' })
    expect(out[1].reactions).toEqual([{ user_id: 'me', name: 'Я', kind: 'muscle' }])
    // чужие/другие карточки нетронуты
    expect(out[0].reactions).toEqual([r('u2', 'fire', 'Вася')])
  })

  it('add идемпотентен (не дублирует уже стоящую мою)', () => {
    const base = [{ id: 'w1', reactions: [r('me', 'fire', 'Я')] }]
    const out = applyReactionQueue(base, [{ workoutId: 'w1', kind: 'fire', op: 'add' }],
      { id: 'me', name: 'Я' })
    expect(out[0].reactions.filter((x) => x.user_id === 'me')).toHaveLength(1)
  })

  it('remove убирает только мою реакцию нужного вида', () => {
    const base = [{ id: 'w1', reactions: [r('me', 'fire', 'Я'), r('u2', 'fire', 'Вася')] }]
    const out = applyReactionQueue(base, [{ workoutId: 'w1', kind: 'fire', op: 'remove' }],
      { id: 'me', name: 'Я' })
    expect(out[0].reactions).toEqual([r('u2', 'fire', 'Вася')])
  })

  it('не мутирует исходный массив и пустую очередь возвращает как есть', () => {
    const src = items()
    const same = applyReactionQueue(src, [], { id: 'me' })
    expect(same).toBe(src)
    applyReactionQueue(src, [{ workoutId: 'w2', kind: 'wow', op: 'add' }], { id: 'me', name: 'Я' })
    expect(src[1].reactions).toEqual([]) // исходный не тронут
  })
})
