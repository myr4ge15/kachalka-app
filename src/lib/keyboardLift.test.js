import { describe, expect, it } from 'vitest'
import { keyboardLift } from './keyboardLift.js'

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
