// @vitest-environment jsdom
// Браузерная часть выгрузки (lib/exportWorkout.js downloadJson/exportWorkouts; покрытие
// тестами 20.10.2026: было 48 % строк): файл JSON с отступами, имя по правилу, временная
// ссылка убрана, URL освобожден; пустой список — ничего не скачиваем.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadJson, exportWorkouts } from './exportWorkout.js'

let blobs, clicks
beforeEach(() => {
  vi.useFakeTimers()
  blobs = []
  clicks = []
  URL.createObjectURL = vi.fn((b) => { blobs.push(b); return 'blob:x' })
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { clicks.push({ href: this.href, download: this.download }) })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('downloadJson', () => {
  it('JSON с отступами, клик по временной ссылке, ссылка убрана, URL освобожден позже', async () => {
    downloadJson({ a: 1 }, 'f.json')
    expect(clicks).toEqual([{ href: 'blob:x', download: 'f.json' }])
    expect(document.querySelector('a[download]')).toBeNull()
    expect(blobs[0].type).toBe('application/json')
    expect(await blobs[0].text()).toBe('{\n  "a": 1\n}')
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x')
  })
})

describe('exportWorkouts', () => {
  const W = { id: 'w1', performed_at: '2026-10-19T10:00:00Z', entries: [{ exercise: { id: 'e', name: 'Жим' }, sets: [{ weight: '60', reps: 8 }] }] }

  it('одна тренировка — файл по ее дате, без служебных полей', async () => {
    exportWorkouts({ ...W, _dirty: 1, user_id: 'me' }, '1.1.1', new Date('2026-10-20T12:00:00Z'))
    expect(clicks[0].download).toBe('workout-2026-10-19.json')
    const json = JSON.parse(await blobs[0].text())
    expect(json).toMatchObject({ app_version: '1.1.1', count: 1 })
    expect(json.workouts[0]).not.toHaveProperty('_dirty')
    expect(json.workouts[0].entries[0].sets).toEqual([{ weight: 60, reps: 8 }])
  })

  it('несколько — workouts-N-<дата выгрузки>; пусто — ничего', () => {
    exportWorkouts([W, { ...W, id: 'w2' }], 'dev', new Date('2026-10-20T12:00:00Z'))
    expect(clicks[0].download).toBe('workouts-2-2026-10-20.json')
    exportWorkouts([])
    expect(clicks).toHaveLength(1)
  })
})
