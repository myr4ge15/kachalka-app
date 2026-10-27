import { describe, expect, it } from 'vitest'
import { keyboardAlign, keyboardLift, keyboardOpen, sheetKeyboardInsets } from './keyboardLift.js'

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

// fb_d3f74593 (27.10.2026, iOS 27): iOS сдвинула видимую полосу — шапка листа ушла вверх, над клавиатурой пустота.
describe('sheetKeyboardInsets', () => {
  it('без сдвига — низ = клавиатура, верх 0', () => {
    expect(sheetKeyboardInsets({ height: 383, offsetTop: 0 }, 793)).toEqual({ top: 0, bottom: 410 })
  })
  it('со сдвигом — верх на сдвиг, низ без него (иначе зазор над клавиатурой)', () => {
    expect(sheetKeyboardInsets({ height: 383, offsetTop: 57.4 }, 793)).toEqual({ top: 57, bottom: 353 })
  })
  it('мусорные замеры — нули', () => {
    expect(sheetKeyboardInsets(null, 793)).toEqual({ top: 0, bottom: 0 })
    expect(sheetKeyboardInsets({ height: 0, offsetTop: 0 }, 793)).toEqual({ top: 0, bottom: 0 })
    expect(sheetKeyboardInsets({ height: 900, offsetTop: -5 }, 793)).toEqual({ top: 0, bottom: 0 })
  })
})
