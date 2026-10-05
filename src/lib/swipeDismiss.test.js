import { describe, expect, it } from 'vitest'
import { dragOpacity, shouldDismiss } from './swipeDismiss.js'

describe('swipeDismiss', () => {
  it('закрывает протяжкой вверх и вниз', () => {
    expect(shouldDismiss({ dy: -120, dt: 600 })).toBe(true)
    expect(shouldDismiss({ dy: 95, dt: 900 })).toBe(true)
  })
  it('быстрый короткий взмах тоже закрывает, медленный — нет', () => {
    expect(shouldDismiss({ dy: -50, dt: 80 })).toBe(true)
    expect(shouldDismiss({ dy: -50, dt: 400 })).toBe(false)
  })
  it('мелкое движение и горизонтальный жест не закрывают', () => {
    expect(shouldDismiss({ dy: 20, dt: 30 })).toBe(false)
    expect(shouldDismiss({ dx: 200, dy: 100, dt: 200 })).toBe(false)
    expect(shouldDismiss({ dy: -60, dt: 0 })).toBe(false)
  })
  it('картинка тускнеет по мере протяжки', () => {
    expect(dragOpacity(0)).toBe(1)
    expect(dragOpacity(-90)).toBe(0.7)
    expect(dragOpacity(500)).toBe(0.4)
  })
})
