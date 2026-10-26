import { describe, expect, it } from 'vitest'
import { centerTop, scrollToTop, settleScroll } from './scrollBox.js'

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

describe('scrollToTop', () => {
  function fakeTimers() {
    const q = new Map(); let n = 0
    return { set: (fn, ms) => { q.set(++n, { fn, ms }); return n }, clear: (id) => q.delete(id),
      run: (ms) => { for (const [id, t] of [...q]) if (t.ms <= ms) { q.delete(id); t.fn() } }, size: () => q.size }
  }
  function fakeBox(top) {
    const ls = {}
    return {
      style: { overflowY: '' }, scrollTop: top, calls: [],
      scrollTo(o) { this.calls.push(o) },
      addEventListener: (t, fn) => { ls[t] = fn }, removeEventListener: (t) => { delete ls[t] },
      fire: (t) => ls[t]?.(), ls,
    }
  }

  it('плавно; браузер поехал — подстраховка не вмешивается', () => {
    const box = fakeBox(800); const timers = fakeTimers(); const raf = fakeRaf()
    scrollToTop(box, { timers, raf })
    expect(box.calls).toEqual([{ top: 0, behavior: 'smooth' }])
    box.scrollTop = 500
    timers.run(150)
    expect(box.style.overflowY).toBe('')
    box.scrollTop = 0
    timers.run(900)
    expect(box.scrollTop).toBe(0)
    expect(box.ls).toEqual({})
  })

  it('WebKit пропустил scrollTo — через 150 мс ставит 0 через settleScroll', () => {
    const box = fakeBox(800); const timers = fakeTimers(); const raf = fakeRaf()
    scrollToTop(box, { timers, raf })
    timers.run(150)
    expect(box.scrollTop).toBe(0)
    expect(box.style.overflowY).toBe('hidden')
    raf.flush()
    expect(box.style.overflowY).toBe('')
  })

  it('застрял на полпути — догоняет к концу', () => {
    const box = fakeBox(800); const timers = fakeTimers(); const raf = fakeRaf()
    scrollToTop(box, { timers, raf })
    box.scrollTop = 300
    timers.run(150)
    expect(box.scrollTop).toBe(300)
    timers.run(900)
    expect(box.scrollTop).toBe(0)
  })

  it('палец пользователя отменяет подстраховку', () => {
    const box = fakeBox(800); const timers = fakeTimers(); const raf = fakeRaf()
    scrollToTop(box, { timers, raf })
    box.fire('touchstart')
    timers.run(900)
    expect(box.scrollTop).toBe(800)
  })

  it('уже наверху, без анимации и без скроллера', () => {
    const top = fakeBox(0)
    scrollToTop(top, { timers: fakeTimers() })
    expect(top.calls).toEqual([])
    const instant = fakeBox(400); const raf = fakeRaf()
    scrollToTop(instant, { smooth: false, raf })
    expect(instant.scrollTop).toBe(0)
    expect(instant.calls).toEqual([])
    expect(() => scrollToTop(null)()).not.toThrow()
  })
})

describe('centerTop', () => {
  const rect = (top, height) => ({ getBoundingClientRect: () => ({ top, height }) })
  it('карточка ниже экрана — по центру видимой части', () => {
    const box = { ...rect(50, 600), scrollTop: 100 }
    expect(centerTop(box, rect(950, 200))).toBe(100 + 900 - 200) // 1000 − (600 − 200) / 2
  })
  it('выше видимой части — по верху; у самого начала — не меньше 0', () => {
    expect(centerTop({ ...rect(0, 600), scrollTop: 0 }, rect(300, 800))).toBe(300)
    expect(centerTop({ ...rect(0, 600), scrollTop: 0 }, rect(40, 100))).toBe(0)
  })
})
