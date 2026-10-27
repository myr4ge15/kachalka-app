// @vitest-environment jsdom
// График веса: ширина — по контейнеру (ResizeObserver), подписи оси и цели — только без «Скрыть цифры»,
// подпись цели — слева (справа конец тренда), средняя дата — только на длинном периоде.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import BodyChart from './BodyChart.jsx'

const days = [
  { date: '2026-09-01', weight: 72 }, { date: '2026-09-20', weight: 71.4 }, { date: '2026-10-27', weight: 70.2 },
]
const trend = days.map((d) => ({ date: d.date, value: d.weight }))
const texts = (c) => [...c.querySelectorAll('text')].map((t) => t.textContent)

afterEach(() => { vi.unstubAllGlobals() })

describe('BodyChart', () => {
  it('без точек — ничего не рисует', () => {
    const { container } = render(<BodyChart days={[]} trend={[]} />)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('ось, точки, тренд, конец линии, даты; цель — пунктир и подпись слева', () => {
    const { container } = render(<BodyChart days={days} trend={trend} goal={{ target: 68 }} />)
    expect(container.querySelectorAll('.bc-dot')).toHaveLength(3)
    expect(container.querySelector('.bc-trend').getAttribute('d')).toMatch(/^M[\d.]+ [\d.]+ L/)
    expect(container.querySelector('.bc-end')).toBeTruthy()
    const lbl = container.querySelector('.bc-goal-lbl')
    expect(lbl.textContent).toBe('цель 68')
    expect(Number(lbl.getAttribute('x'))).toBeLessThan(60)
    expect(texts(container)).toEqual(expect.arrayContaining(['1 сент', '27 окт']))
    expect(texts(container).some((t) => /^\d+(\.\d+)?$/.test(t))).toBe(true) // деления оси
  })

  it('«Скрыть цифры»: ни делений, ни подписи цели — только даты', () => {
    const { container } = render(<BodyChart days={days} trend={trend} goal={{ target: 68 }} hide />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-label', 'График веса: направление без цифр')
    expect(container.querySelector('.bc-goal')).toBeTruthy()
    expect(container.querySelector('.bc-goal-lbl')).toBeNull()
    expect(texts(container).every((t) => !/\d+(\.\d+)?$/.test(t) || /[а-я]/.test(t))).toBe(true)
  })

  it('короткий период: без средней даты; одна точка — без линии тренда', () => {
    const two = days.slice(1)
    const { container, rerender } = render(<BodyChart days={two} trend={trend.slice(1)} />)
    expect(texts(container).filter((t) => /[а-я]/.test(t))).toHaveLength(2)
    rerender(<BodyChart days={days.slice(0, 1)} trend={trend.slice(0, 1)} />)
    expect(container.querySelector('.bc-trend')).toBeNull()
    expect(texts(container).filter((t) => /[а-я]/.test(t))).toHaveLength(1)
  })

  it('тап — ближайшее взвешивание: дата, вес и тренд; при скрытых цифрах — только дата (fb_5a1ecb11)', () => {
    const tr = [{ date: '2026-09-01', value: 72 }, { date: '2026-09-20', value: 71.8 }, { date: '2026-10-27', value: 70.2 }]
    const { container, rerender } = render(<BodyChart days={days} trend={tr} />)
    const svg = container.querySelector('svg')
    expect(container.closest('body').querySelector('[data-no-swipe-back]')).toBeTruthy()
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 330, height: 190, right: 330, bottom: 190 })
    fireEvent.pointerDown(svg, { clientX: 320, clientY: 50 })
    expect(container.querySelector('.bc-tip-txt').textContent).toBe('27 окт · 70.2 кг')
    fireEvent.pointerMove(svg, { clientX: 150, clientY: 50, buttons: 1 })
    expect(container.querySelector('.bc-tip-txt').textContent).toBe('20 сент · 71.4 кг · тренд 71.8')
    fireEvent.pointerMove(svg, { clientX: 40, clientY: 50, buttons: 0, pointerType: 'touch' }) // палец не прижат — не двигаем
    expect(container.querySelector('.bc-tip-txt').textContent).toMatch(/^20 сент/)
    fireEvent.pointerLeave(svg, { pointerType: 'mouse' })
    expect(container.querySelector('.bc-tip')).toBeNull()
    rerender(<BodyChart days={days} trend={tr} hide />)
    fireEvent.pointerDown(svg, { clientX: 320, clientY: 50 })
    expect(container.querySelector('.bc-tip-txt').textContent).toBe('27 окт')
  })

  it('тап по невидимому графику (нулевая ширина) — без подсказки', () => {
    const { container } = render(<BodyChart days={days} trend={trend} />)
    const svg = container.querySelector('svg')
    svg.getBoundingClientRect = () => ({ left: 0, width: 0 })
    fireEvent.pointerDown(svg, { clientX: 10 })
    expect(container.querySelector('.bc-tip')).toBeNull()
  })

  it('ширина — по контейнеру, в пределах 260..1000; отписка при размонтировании', () => {
    let cb = null
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(fn) { cb = fn }
      observe() {}
      disconnect() { disconnect() }
    })
    const { container, unmount } = render(<BodyChart days={days} trend={trend} />)
    const svg = () => container.querySelector('svg')
    expect(svg().getAttribute('width')).toBe('330')
    act(() => cb([{ contentRect: { width: 600 } }]))
    expect(svg().getAttribute('viewBox')).toBe('0 0 600 190')
    act(() => cb([{ contentRect: { width: 100 } }]))
    expect(svg().getAttribute('width')).toBe('260')
    act(() => cb([{ contentRect: { width: 4000 } }]))
    expect(svg().getAttribute('width')).toBe('1000')
    act(() => cb([{ contentRect: { width: 0 } }])) // скрытый контейнер — размер не трогаем
    expect(svg().getAttribute('width')).toBe('1000')
    unmount()
    expect(disconnect).toHaveBeenCalled()
  })
})
