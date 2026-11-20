// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import NextWorkoutPlan from './NextWorkoutPlan.jsx'
import { readDraft, resetDraftMemory, writeDraft } from '../../lib/draftStore.js'

const star = vi.fn()
const press = { id: 'press', name: 'Жим Арнольда' }
const extras = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id }))
const bench = { id: 'bench', name: 'Жим', metric: 'weight' }
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: fn => fn() }))
vi.mock('../../db/repo.js', () => ({ getExercises: () => [bench, press, ...extras], getFavorites: () => ['press'], toggleFavorite: (...args) => star(...args) }))

beforeEach(() => { resetDraftMemory(); localStorage.clear() })
const click = name => fireEvent.click(screen.getByRole('button', { name }))

it('план переживает перезапуск, позволяет убрать упражнение и расходуется только при старте', () => {
  const onStart = vi.fn()
  const first = render(<NextWorkoutPlan userId="me" onStart={onStart} />)
  click('Запланировать тренировку')
  click('Добавить упражнения')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Жим' }))
  click('Добавить · 1')
  click('Убрать «Жим» из плана')
  expect(screen.queryByRole('button', { name: 'Начать' })).toBeNull()
  click('Добавить упражнения')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Жим' }))
  click('Добавить · 1')
  first.unmount()
  resetDraftMemory()
  expect(readDraft('workout_draft_new_me')).toBeUndefined()
  render(<NextWorkoutPlan userId="me" onStart={onStart} />)
  click(/Запланировать тренировку/)
  click('Начать')
  expect(onStart).toHaveBeenCalledOnce()
  expect(readDraft('workout_draft_new_me')).toMatchObject([{ exercise: bench, sets: [{ reps: 10 }] }])
  expect(readDraft('workout_plan_me')).toEqual([])
})

it('показывает избранные, недавние, частые упражнения и подсказки', () => {
  const workouts = [extras, [bench], [bench]].map((exercises, i) => ({
    performed_at: '2026-11-' + (20 - i), entries: exercises.map(exercise => ({ exercise })),
  }))
  render(<NextWorkoutPlan userId="me" workouts={workouts} />)
  click('Запланировать тренировку')
  click('Добавить упражнения')
  for (const section of ['Избранные', 'Недавние', 'Частые']) expect(screen.getByText(section)).toBeInTheDocument()
  click('Убрать из избранного')
  expect(star).toHaveBeenCalledWith('me', 'press')
  expect(screen.getByRole('button', { name: 'Как выполнять: Жим Арнольда' })).toBeInTheDocument()
})

it('возврат к начатой тренировке сохраняет и план, и текущие подходы', () => {
  const active = [{ exercise: bench, sets: [{ weight: 37, reps: 8 }] }]
  writeDraft('workout_draft_new_me', active)
  writeDraft('workout_plan_me', [bench])
  const onStart = vi.fn()
  render(<NextWorkoutPlan userId="me" onStart={onStart} />)
  click(/Запланировать тренировку/)
  click('Вернуться к текущей тренировке')
  expect(onStart).toHaveBeenCalledOnce()
  expect(readDraft('workout_draft_new_me')).toEqual(active)
  expect(readDraft('workout_plan_me')).toEqual([bench])
})
