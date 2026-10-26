// db/phaseColumn.js — выборка с колонкой phase и откат на старый сервер (покрытие 26.10.2026:
// строки 5/8 — не проверялся сам откат). Сервер без колонки отвечает 42703: повторяем без
// 'phase, ' и дальше до перезапуска сразу ходим без нее; чужая ошибка — как есть, без повтора.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPhaseColumnError, resetPhaseColumn, withPhase } from './phaseColumn.js'

const SELECT = 'id, phase, exercise_id'
const noPhase = { code: '42703', message: 'column workout_exercises.phase does not exist' }
const same = (p) => p // без таймаута: билдер в тестах — уже готовый ответ

afterEach(() => resetPhaseColumn())

describe('isPhaseColumnError', () => {
  it('только 42703 про phase', () => {
    expect(isPhaseColumnError(noPhase)).toBe(true)
    expect(isPhaseColumnError({ code: '42703', message: 'column target_plan does not exist' })).toBe(false)
    expect(isPhaseColumnError({ code: '57014', message: 'phase' })).toBe(false)
    expect(isPhaseColumnError(null)).toBe(false)
    expect(isPhaseColumnError({ code: '42703' })).toBe(false)
  })
})

describe('withPhase', () => {
  it('сервер с колонкой — один запрос с phase', async () => {
    const build = vi.fn(async () => ({ data: [{ id: 1 }], error: null }))
    expect(await withPhase(SELECT, build, { timeout: same })).toEqual({ data: [{ id: 1 }], error: null })
    expect(build.mock.calls).toEqual([[SELECT]])
  })

  it('сервер без колонки — повтор без phase, дальше сразу без нее; reset возвращает', async () => {
    const build = vi.fn(async (sel) => (sel.includes('phase') ? { data: null, error: noPhase } : { data: [], error: null }))
    expect(await withPhase(SELECT, build, { timeout: same })).toEqual({ data: [], error: null })
    expect(build.mock.calls).toEqual([[SELECT], ['id, exercise_id']])

    build.mockClear()
    await withPhase(SELECT, build, { timeout: same })
    expect(build.mock.calls).toEqual([['id, exercise_id']])

    resetPhaseColumn()
    build.mockClear()
    await withPhase(SELECT, build, { timeout: same })
    expect(build.mock.calls[0]).toEqual([SELECT])
  })

  it('другая ошибка — отдается как есть, без повтора и без отката', async () => {
    const other = { code: '57014', message: 'canceling statement due to statement timeout' }
    const build = vi.fn(async () => ({ data: null, error: other }))
    expect(await withPhase(SELECT, build, { timeout: same })).toEqual({ data: null, error: other })
    build.mockClear()
    await withPhase(SELECT, build, { timeout: same })
    expect(build.mock.calls).toEqual([[SELECT]])
  })

  it('по умолчанию запрос идет через withTimeout (билдер получает сигнал отмены)', async () => {
    const abortSignal = vi.fn(() => Promise.resolve({ data: [], error: null }))
    expect(await withPhase(SELECT, () => ({ abortSignal }))).toEqual({ data: [], error: null })
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal))
  })
})
