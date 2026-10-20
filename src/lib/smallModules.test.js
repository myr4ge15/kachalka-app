// @vitest-environment jsdom
// Мелкие модули, которые раньше покрывались частично (покрытие тестами 20.10.2026):
// вибро (lib/haptics.js vibrate), выгрузка шаблонов (exportTemplates), тексты и ссылки
// восстановления PIN (lib/recovery.js), сжатие обрезанного аватара (lib/avatar.js cropToJpeg).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { vibrate, HAPTIC } from './haptics.js'
import { exportTemplates, cleanTemplateForExport } from './exportTemplate.js'
import { resetErrorText, stripReset, tgStartLink, normalizeRecoveryCode } from './recovery.js'
import { cropToJpeg } from './avatar.js'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('vibrate', () => {
  it('есть вибро и движение не уменьшено — дергает navigator.vibrate', () => {
    const v = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate: v })
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect(vibrate()).toBe(true)
    expect(v).toHaveBeenCalledWith(HAPTIC.tap)
  })
  it('«уменьшить движение», нет вибро или оно бросило — false', () => {
    const v = vi.fn(() => { throw new Error('blocked') })
    vi.stubGlobal('navigator', { vibrate: v })
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    expect(vibrate([5])).toBe(false)
    vi.stubGlobal('matchMedia', () => { throw new Error('no mm') })
    expect(vibrate([5])).toBe(false) // matchMedia бросил → считаем «не уменьшено», вибро бросило → false
    vi.stubGlobal('navigator', {})
    expect(vibrate()).toBe(false)
  })
})

describe('exportTemplates', () => {
  it('скачивает файл с шаблонами (план подходов — числами); пусто — ничего', async () => {
    const blobs = []
    URL.createObjectURL = vi.fn((b) => { blobs.push(b); return 'blob:t' })
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    exportTemplates([])
    expect(click).not.toHaveBeenCalled()
    exportTemplates({
      id: 't1', name: 'Грудь',
      exercises: [
        { position: 2, exercise: { id: 'b', name: 'Брусья', metric: 'reps' } },
        { position: 1, exercise_id: 'a', exercise: { name: 'Жим' }, set_plan: [{ weight: '60', reps: '8' }] },
      ],
    }, '1.1.2', new Date('2026-10-20T10:00:00Z'))
    expect(click).toHaveBeenCalledTimes(1)
    const json = JSON.parse(await blobs[0].text())
    const ex = json.templates[0].exercises
    expect(ex.map((e) => e.name ?? e.exercise?.name)).toEqual(['Жим', 'Брусья'])
    expect(ex[0].set_plan).toEqual([{ weight: 60, reps: 8 }])
  })
  it('пустой шаблон — безопасные значения', () => {
    expect(cleanTemplateForExport(null)).toMatchObject({ id: null, name: '—' })
  })
})

describe('recovery', () => {
  it('тексты ошибок сброса — свой на каждый код', () => {
    const codes = ['invalid', 'expired', 'locked', 'weak_pin', 'network', 'reset_login_failed']
    const texts = codes.map(resetErrorText)
    expect(new Set(texts).size).toBe(codes.length)
    expect(resetErrorText('???')).toMatch(/чуть позже/)
  })
  it('ссылки: мусор в адресе и в имени бота — null', () => {
    expect(stripReset('не адрес')).toBeNull()
    expect(tgStartLink('@x', 'tok')).toBeNull()
    expect(tgStartLink(null, null)).toBeNull()
    expect(normalizeRecoveryCode(null)).toBe('')
  })
})

describe('cropToJpeg', () => {
  let drawn
  beforeEach(() => {
    drawn = null
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage: (...a) => { drawn = a } }))
  })
  it('квадрат из исходника → JPEG стороной не больше out', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb, type, q) { cb(new Blob(['j'], { type })); this._q = q })
    const blob = await cropToJpeg('img', { sx: 10, sy: 20, size: 1000 }, 256)
    expect(blob.type).toBe('image/jpeg')
    expect(drawn).toEqual(['img', 10, 20, 1000, 1000, 0, 0, 256, 256])
    await cropToJpeg('img', { sx: 0, sy: 0, size: 100 }, 256)
    expect(drawn.slice(-2)).toEqual([100, 100]) // маленький исходник не растягиваем
  })
  it('браузер не сжал — понятная ошибка', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(null))
    await expect(cropToJpeg('img', { sx: 0, sy: 0, size: 50 })).rejects.toThrow('Сжатие не удалось')
  })
})
