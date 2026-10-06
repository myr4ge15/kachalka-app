import { describe, expect, it } from 'vitest'
import { settleScroll } from './scrollBox.js'

function fakeRaf() {
  const q = new Map(); let n = 0
  return { request: (fn) => { q.set(++n, fn); return n }, cancel: (id) => q.delete(id), flush: () => { for (const [id, fn] of q) { q.delete(id); fn() } } }
}

describe('settleScroll', () => {
  it('гасит инерцию: на кадр выключает прокрутку, ставит позицию и повторяет ее после', () => {
    const box = { style: { overflowY: '' }, scrollTop: 900 }
    const raf = fakeRaf()
    settleScroll(box, 0, raf)
    expect(box.style.overflowY).toBe('hidden')
    expect(box.scrollTop).toBe(0)
    box.scrollTop = 640 // WebKit «доехал» инерцией после первой установки
    raf.flush()
    expect(box.style.overflowY).toBe('')
    expect(box.scrollTop).toBe(0)
  })

  it('отмена до кадра сразу возвращает прокрутку (размонтирование не оставляет overflow:hidden)', () => {
    const box = { style: { overflowY: '' }, scrollTop: 300 }
    const raf = fakeRaf()
    const cancel = settleScroll(box, 120, raf)
    cancel()
    expect(box.style.overflowY).toBe('')
    expect(box.scrollTop).toBe(120)
    raf.flush()
    expect(box.scrollTop).toBe(120)
  })

  it('нет скроллера или мусор в позиции — без падений, позиция 0', () => {
    expect(() => settleScroll(null)()).not.toThrow()
    const box = { style: { overflowY: '' }, scrollTop: 50 }
    settleScroll(box, 'abc', fakeRaf())
    expect(box.scrollTop).toBe(0)
  })
})
