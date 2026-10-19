import { describe, expect, it } from 'vitest'
import { keyboardAlign, keyboardLift, keyboardOpen } from './keyboardLift.js'

describe('keyboardLift', () => {
  const vv = { offsetTop: 0, height: 400 } // клавиатура съела низ экрана

  it('поле видно — не двигаем', () => {
    expect(keyboardLift({ top: 200, bottom: 260 }, vv)).toBe(0)
  })
  it('поле под клавиатурой — поднимаем до зазора над ней', () => {
    expect(keyboardLift({ top: 600, bottom: 660 }, vv)).toBe(272)
  })
  it('поле под шапкой — опускаем', () => {
    expect(keyboardLift({ top: 30, bottom: 90 }, vv, { topInset: 70 })).toBe(-40)
  })
  it('iOS сдвинул visualViewport сам — считаем от его верха', () => {
    expect(keyboardLift({ top: 500, bottom: 560 }, { offsetTop: 200, height: 400 })).toBe(0)
  })
  it('поле выше видимой полосы — показываем верх', () => {
    expect(keyboardLift({ top: 100, bottom: 600 }, vv, { topInset: 70 })).toBe(30)
  })
  it('нет visualViewport — 0', () => {
    expect(keyboardLift({ top: 600, bottom: 660 }, null)).toBe(0)
  })
})

describe('keyboardAlign (fb_5b764337)', () => {
  const vv = { offsetTop: 0, height: 400 } // видно 0..388 (зазор 12)
  it('карточка уехала слишком высоко — опускаем низ к клавиатуре', () => {
    expect(keyboardAlign({ bottom: 300 }, { top: 220 }, vv)).toBe(-88)
  })
  it('низ под клавиатурой — поднимаем ровно до нее', () => {
    expect(keyboardAlign({ bottom: 600 }, { top: 520 }, vv)).toBe(212)
  })
  it('уже ровно — 0', () => {
    expect(keyboardAlign({ bottom: 388 }, { top: 300 }, vv)).toBe(0)
  })
  it('поле не уходит под шапку', () => {
    expect(keyboardAlign({ bottom: 900 }, { top: 100 }, vv, { topInset: 70 })).toBe(30)
  })
  it('keyboardOpen: сжат только visualViewport', () => {
    expect(keyboardOpen({ height: 400 }, 793)).toBe(true)
    expect(keyboardOpen({ height: 793 }, 793)).toBe(false)
    expect(keyboardOpen(null, 793)).toBe(false)
  })
})
