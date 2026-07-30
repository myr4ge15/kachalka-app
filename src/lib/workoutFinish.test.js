import { describe, expect, it } from 'vitest'
import {
  formatWorkoutDuration,
  pickWorkoutFinishEvent,
  workoutFinishEvents,
  workoutFinishSummary,
} from './workoutFinish.js'

describe('workoutFinishSummary', () => {
  it('считает упражнения, подходы и весовой тоннаж сохранённой тренировки', () => {
    const summary = workoutFinishSummary({
      entries: [
        {
          exercise: { metric: 'weight' },
          sets: [{ weight: 80, reps: 5 }, { weight: 80, reps: 4 }],
        },
        {
          exercise: { metric: 'reps' },
          sets: [{ weight: 0, reps: 12 }],
        },
      ],
    })

    expect(summary).toEqual({
      exerciseCount: 2,
      setCount: 3,
      tonnage: 720,
      durationSeconds: null,
    })
  })

  it('не считает пустые упражнения и принимает только явную длительность', () => {
    const summary = workoutFinishSummary({
      created_at: '2026-07-30T10:00:00Z',
      updated_at: '2026-07-30T12:00:00Z',
      duration_seconds: 3670,
      entries: [{ sets: [] }],
    })

    expect(summary).toEqual({
      exerciseCount: 0,
      setCount: 0,
      tonnage: 0,
      durationSeconds: 3670,
    })
  })
})

describe('formatWorkoutDuration', () => {
  it('форматирует минуты и часы без секундного шума', () => {
    expect(formatWorkoutDuration(40)).toBe('1 мин')
    expect(formatWorkoutDuration(45 * 60)).toBe('45 мин')
    expect(formatWorkoutDuration(75 * 60)).toBe('1 ч 15 мин')
    expect(formatWorkoutDuration(null)).toBeNull()
  })
})

describe('pickWorkoutFinishEvent', () => {
  const pr = (over = {}) => ({
    exerciseId: 'bench',
    name: 'Жим',
    metric: 'weight',
    value: 100,
    prev: 90,
    ...over,
  })
  const goal = (over = {}) => ({
    exerciseId: 'bench',
    name: 'Жим',
    metric: 'weight',
    value: 100,
    reps: 5,
    ...over,
  })

  it('цель перебивает рекорд и сохраняет переход к упражнению', () => {
    expect(pickWorkoutFinishEvent({ reached: [goal()], prs: [pr()] })).toEqual({
      kind: 'goal',
      emoji: '🎯',
      title: 'Цель достигнута!',
      text: 'Жим — 100 кг × 5',
      exerciseId: 'bench',
      celebrated: true,
    })
  })

  it('сохраняет приоритет и отдаёт до трёх категорий для компактной ленты', () => {
    const events = workoutFinishEvents({
      reached: [goal()],
      prs: [pr()],
      newBadges: [{ icon: '🌱', name: 'Первый шаг' }],
      insights: [{ emoji: '📈', text: 'Объём растёт' }],
    })

    expect(events.map((event) => event.kind)).toEqual(['goal', 'pr', 'badge'])
  })

  it('рекорд показывает прошлое значение и число дополнительных событий', () => {
    expect(pickWorkoutFinishEvent({
      prs: [pr(), pr({ exerciseId: 'deadlift', name: 'Тяга', value: 150, prev: 140 })],
    })).toMatchObject({
      kind: 'pr',
      title: 'Новый рекорд!',
      text: 'Тяга — 150 кг (было 140 кг) +1',
      exerciseId: 'deadlift',
      celebrated: true,
    })
  })

  it('бейдж важнее инсайта, но не предлагает график упражнения', () => {
    expect(pickWorkoutFinishEvent({
      newBadges: [{ icon: '🌱', name: 'Первый шаг' }],
      insights: [{ emoji: '📈', text: 'Объём растёт', exerciseId: 'bench' }],
    })).toEqual({
      kind: 'badge',
      emoji: '🏆',
      title: 'Новое достижение!',
      text: '🌱 Первый шаг',
      exerciseId: null,
      celebrated: true,
    })
  })

  it('тихий инсайт остаётся непраздничным, пустой результат — null', () => {
    expect(pickWorkoutFinishEvent({
      insights: [{ emoji: '💪', text: 'Сильнее себя прошлого', exerciseId: 'bench' }],
    })).toEqual({
      kind: 'insight',
      emoji: '💪',
      title: 'Вывод после тренировки',
      text: 'Сильнее себя прошлого',
      exerciseId: 'bench',
      celebrated: false,
    })
    expect(pickWorkoutFinishEvent()).toBeNull()
  })
})
