// @vitest-environment jsdom
// Черновик формы тренировки (вынесен из WorkoutScreen, аудит 14.10): новая — состав,
// оценки и выбранная дата переживают уход с экрана; правка — черновик привязан к версии
// документа. Сценарии экрана целиком — WorkoutScreen*.test.jsx.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { readDraft, clearDraft } from '../lib/draftStore.js'
import { useWorkoutDraft } from './useWorkoutDraft.js'

vi.mock('../db/repo.js', () => ({
  getWorkout: vi.fn(),
  getWorkoutFeels: vi.fn(async () => ({})),
}))
const { getWorkout } = await import('../db/repo.js')

const U = 'u1'
const BENCH = { id: 'ex1', name: 'Жим' }
const KEYS = ['workout_draft_new_u1', 'workout_feel_new_u1', 'workout_date_new_u1', 'workout_edit_u1_w1']
afterEach(() => { for (const k of KEYS) clearDraft(k); vi.mocked(getWorkout).mockReset() })

describe('useWorkoutDraft — новая тренировка', () => {
  it('состав, оценки и выбранная дата ложатся в черновик и поднимаются заново', () => {
    const { result, unmount } = renderHook(() => useWorkoutDraft({ userId: U }))
    expect(result.current.loading).toBe(false)
    act(() => {
      result.current.setEntries([{ exercise: BENCH, sets: [{ weight: 50, reps: 5 }] }])
      result.current.setFeels({ ex1: 'ok' })
      result.current.setPerformedAt('2026-10-10T08:00:00.000Z')
    })
    unmount()
    const again = renderHook(() => useWorkoutDraft({ userId: U })).result.current
    expect(again.entries).toHaveLength(1)
    expect(again.feels).toEqual({ ex1: 'ok' })
    expect(again.performedAt).toBe('2026-10-10T08:00:00.000Z')
  })

  it('невыбранная дата в черновик не пишется — завтра черновик станет «сегодняшним»', () => {
    const { result } = renderHook(() => useWorkoutDraft({ userId: U }))
    act(() => result.current.setEntries([{ exercise: BENCH, sets: [] }]))
    expect(readDraft('workout_date_new_u1')).toBeUndefined()
  })

  it('clearDraft — чистый лист; dropSaved после сохранения стирает все три ключа', () => {
    const { result } = renderHook(() => useWorkoutDraft({ userId: U }))
    act(() => {
      result.current.setEntries([{ exercise: BENCH, sets: [{ weight: 50, reps: 5 }] }])
      result.current.setFeels({ ex1: 'hard' })
    })
    act(() => result.current.clearDraft())
    expect(result.current.entries).toEqual([])
    expect(result.current.feels).toEqual({})
    act(() => {
      result.current.setEntries([{ exercise: BENCH, sets: [{ weight: 60, reps: 5 }] }])
      result.current.setPerformedAt('2026-10-11T08:00:00.000Z')
    })
    act(() => result.current.dropSaved())
    expect(readDraft('workout_draft_new_u1')).toBeUndefined()
    expect(readDraft('workout_date_new_u1')).toBeUndefined()
  })
})

describe('useWorkoutDraft — правка существующей', () => {
  const doc = {
    id: 'w1', updated_at: 'v1', performed_at: '2026-10-01T08:00:00.000Z',
    entries: [{ exercise_id: 'ex1', exercise: BENCH, sets: [{ weight: 50, reps: 5 }] }],
  }

  it('правка ложится в черновик, «Вернуть как было» — к документу', async () => {
    vi.mocked(getWorkout).mockResolvedValue(doc)
    const { result } = renderHook(() => useWorkoutDraft({ userId: U, workoutId: 'w1' }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.setEntries((p) => [{ ...p[0], sets: [{ weight: 55, reps: 5 }] }]))
    expect(readDraft('workout_edit_u1_w1')).toMatchObject({ base: 'v1' })
    act(() => result.current.revertEdits())
    expect(result.current.entries[0].sets[0].weight).toBe(50)
    expect(readDraft('workout_edit_u1_w1')).toBeUndefined()
  })

  it('черновик от прежней версии документа не накатывается', async () => {
    vi.mocked(getWorkout).mockResolvedValue({ ...doc, updated_at: 'v2' })
    const { result } = renderHook(() => useWorkoutDraft({ userId: U, workoutId: 'w1' }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.editRestored).toBe(false)
    act(() => result.current.setEntries((p) => [{ ...p[0], sets: [{ weight: 70, reps: 5 }] }]))
    const stale = { base: 'v1', entries: [{ exercise: BENCH, sets: [{ weight: 99, reps: 1 }] }] }
    act(() => result.current.dropSaved())
    // Подложим черновик старой версии и откроем заново.
    const { writeDraft } = await import('../lib/draftStore.js')
    writeDraft('workout_edit_u1_w1', stale)
    const again = renderHook(() => useWorkoutDraft({ userId: U, workoutId: 'w1' }))
    await waitFor(() => expect(again.result.current.loading).toBe(false))
    expect(again.result.current.entries[0].sets[0].weight).toBe(50)
    expect(again.result.current.editRestored).toBe(false)
    expect(readDraft('workout_edit_u1_w1')).toBeUndefined()
  })

  it('документа нет — onLoadError, загрузка заканчивается', async () => {
    vi.mocked(getWorkout).mockResolvedValue(null)
    const onLoadError = vi.fn()
    const { result } = renderHook(() => useWorkoutDraft({ userId: U, workoutId: 'w1', onLoadError }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(onLoadError).toHaveBeenCalledWith('Тренировка не найдена.')
  })
})
