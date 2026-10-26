// @vitest-environment jsdom
// Черновик формы тренировки (вынесен из WorkoutScreen, аудит 14.10): новая — состав,
// оценки и выбранная дата переживают уход с экрана; правка — черновик привязан к версии
// документа. Сценарии экрана целиком — WorkoutScreen*.test.jsx.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { readDraft, clearDraft } from '../lib/draftStore.js'
import { freshStart, useWorkoutDraft, toEntries, hasNewDraft, startNewDraftFrom } from './useWorkoutDraft.js'
import { writeDraft } from '../lib/draftStore.js'

vi.mock('../db/repo.js', () => ({
  getWorkout: vi.fn(),
  getWorkoutFeels: vi.fn(async () => ({})),
}))
const { getWorkout } = await import('../db/repo.js')

const U = 'u1'
const BENCH = { id: 'ex1', name: 'Жим' }
const KEYS = ['workout_focus_new_u1', 'workout_draft_new_u1', 'workout_feel_new_u1', 'workout_date_new_u1', 'workout_start_new_u1', 'workout_edit_u1_w1']
afterEach(() => { for (const k of KEYS) clearDraft(k); vi.mocked(getWorkout).mockReset(); vi.useRealTimers() })

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

describe('useWorkoutDraft — время начала (v8.7.0)', () => {
  it('время — первое упражнение, а не открытие экрана; переживает перезагрузку', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T07:00:00.000Z'))
    const { result, unmount } = renderHook(() => useWorkoutDraft({ userId: U }))
    vi.setSystemTime(new Date('2026-10-15T07:20:00.000Z'))
    act(() => result.current.setEntries([{ exercise: BENCH, sets: [] }]))
    expect(result.current.performedAt).toBe('2026-10-15T07:20:00.000Z')
    act(() => result.current.setEntries((p) => [...p, { exercise: { id: 'ex2', name: 'Тяга' }, sets: [] }]))
    expect(result.current.performedAt).toBe('2026-10-15T07:20:00.000Z')
    unmount()
    vi.setSystemTime(new Date('2026-10-15T08:30:00.000Z')) // iPhone выгрузил PWA посреди зала
    expect(renderHook(() => useWorkoutDraft({ userId: U })).result.current.performedAt).toBe('2026-10-15T07:20:00.000Z')
  })

  it('черновик с вечера, поднятый завтра, — «сегодняшний»', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-14T18:00:00.000Z'))
    const first = renderHook(() => useWorkoutDraft({ userId: U }))
    act(() => first.result.current.setEntries([{ exercise: BENCH, sets: [] }]))
    first.unmount()
    vi.setSystemTime(new Date('2026-10-15T09:00:00.000Z'))
    const { result } = renderHook(() => useWorkoutDraft({ userId: U }))
    expect(result.current.performedAt).toBe('2026-10-15T09:00:00.000Z')
    expect(readDraft('workout_start_new_u1')).toBe('2026-10-15T09:00:00.000Z')
  })

  it('пустой состав сбрасывает отметку; выбранная руками дата главнее', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T07:00:00.000Z'))
    const { result } = renderHook(() => useWorkoutDraft({ userId: U }))
    act(() => result.current.setEntries([{ exercise: BENCH, sets: [] }]))
    act(() => result.current.setEntries([]))
    expect(readDraft('workout_start_new_u1')).toBeUndefined()
    act(() => result.current.setPerformedAt('2026-10-12T07:00:00.000Z'))
    vi.setSystemTime(new Date('2026-10-15T07:40:00.000Z'))
    act(() => result.current.setEntries([{ exercise: BENCH, sets: [] }]))
    expect(result.current.performedAt).toBe('2026-10-12T07:00:00.000Z')
    act(() => result.current.dropSaved())
    expect(readDraft('workout_start_new_u1')).toBeUndefined()
  })

  it('freshStart: не старше 12 часов и не из будущего', () => {
    const now = Date.parse('2026-10-15T12:00:00.000Z')
    expect(freshStart('2026-10-15T01:00:00.000Z', now)).toBe('2026-10-15T01:00:00.000Z')
    expect(freshStart('2026-10-14T23:00:00.000Z', now)).toBeNull()
    expect(freshStart('2026-10-15T13:00:00.000Z', now)).toBeNull()
    expect(freshStart(undefined, now)).toBeNull()
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

describe('«Копировать тренировку» (26.10.2026)', () => {
  it('состав с подходами и разминкой — в черновик новой; дата, оценки и раскрытое — сброшены', () => {
    writeDraft('workout_date_new_u1', '2026-10-01T08:00:00.000Z')
    writeDraft('workout_feel_new_u1', { ex1: 'hard' })
    writeDraft('workout_focus_new_u1', 'ex1')
    expect(hasNewDraft(U)).toBe(false)
    const n = startNewDraftFrom(U, [
      { exercise: BENCH, sets: [{ weight: 50, reps: 5, _k: 'old' }], phase: 'warmup' },
      { exercise: { id: 'ex2', name: 'Пусто' }, sets: [] },
    ])
    expect(n).toBe(1)
    expect(hasNewDraft(U)).toBe(true)
    const d = readDraft('workout_draft_new_u1')
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ exercise: BENCH, phase: 'warmup', sets: [{ weight: 50, reps: 5 }] })
    expect(d[0].sets[0]._k).not.toBe('old')
    for (const k of ['workout_date_new_u1', 'workout_feel_new_u1', 'workout_focus_new_u1']) expect(readDraft(k)).toBeUndefined()
    // новая тренировка поднимает скопированный состав на сегодня
    const { result } = renderHook(() => useWorkoutDraft({ userId: U }))
    expect(result.current.entries).toHaveLength(1)
    expect(Date.now() - Date.parse(result.current.performedAt)).toBeLessThan(60_000)
  })
  it('toEntries сохраняет разминку/заминку — правка тренировки не снимает пометку', () => {
    const e = toEntries({ entries: [{ exercise: BENCH, sets: [{ weight: 1, reps: 2 }], phase: 'cooldown' }, { exercise: BENCH, sets: [], phase: 'x' }] })
    expect(e[0].phase).toBe('cooldown')
    expect('phase' in e[1]).toBe(false)
  })
})
