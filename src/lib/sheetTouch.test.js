import { describe, expect, it } from 'vitest'
import { scrollableAncestor, shouldBlockSheetTouch } from './sheetTouch.js'

describe('shouldBlockSheetTouch', () => {
  const box = (scrollTop) => ({ scrollTop, scrollHeight: 900, clientHeight: 300 })
  it('прокручивать нечего — жест гасим (иначе на iPhone едет вся страница)', () => {
    expect(shouldBlockSheetTouch(null, 20)).toBe(true)
    expect(shouldBlockSheetTouch(null, -20)).toBe(true)
  })
  it('у края по ходу жеста — гасим, в середине — пропускаем', () => {
    expect(shouldBlockSheetTouch(box(0), 20)).toBe(true)
    expect(shouldBlockSheetTouch(box(0), -20)).toBe(false)
    expect(shouldBlockSheetTouch(box(600), -20)).toBe(true)
    expect(shouldBlockSheetTouch(box(600), 20)).toBe(false)
    expect(shouldBlockSheetTouch(box(300), 20)).toBe(false)
  })
  it('без сдвига по вертикали — не трогаем', () => {
    expect(shouldBlockSheetTouch(null, 0)).toBe(false)
  })
})

describe('scrollableAncestor', () => {
  const node = (oy, sh, ch, parent = null) => ({ nodeType: 1, parentElement: parent, scrollHeight: sh, clientHeight: ch, oy })
  const style = (el) => ({ overflowY: el.oy })
  it('находит ближайший блок с настоящей прокруткой, не выходя за stop', () => {
    const stop = node('visible', 0, 0)
    const list = node('auto', 900, 300, stop)
    const row = node('visible', 40, 40, list)
    expect(scrollableAncestor(row, stop, style)).toBe(list)
    const short = node('auto', 300, 300, stop)
    expect(scrollableAncestor(node('visible', 1, 1, short), stop, style)).toBeNull()
  })
})
