// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { usePullToRefresh } from './usePullToRefresh.js'
import PullIndicator from '../components/ui/PullIndicator.jsx'
import { PULL_HOLD, pullDistance } from '../lib/pullRefresh.js'

vi.mock('../lib/haptics.js', () => ({ vibrate: vi.fn(), HAPTIC: { tap: 10 } }))

let renders = 0
function Screen({ refresh, refreshing = false }) {
  renders++
  const ref = useRef(null)
  const ptr = usePullToRefresh(ref, refresh, refreshing)
  return <div ref={ref} data-testid="root"><PullIndicator {...ptr} /></div>
}
const mount = (props, wrap = (x) => x) => {
  const { container, rerender } = render(<div className="content">{wrap(<Screen {...props} />)}</div>)
  return { sc: container.querySelector('.content'), container, rerender }
}
const down = (sc, dy, dx = 0) => {
  fireEvent.touchStart(sc, { touches: [{ clientY: 100, clientX: 50 }] })
  fireEvent.touchMove(sc, { touches: [{ clientY: 100 + dy, clientX: 50 + dx }] })
}
const px = (n) => `translate3d(0, ${n}px, 0)`

describe('usePullToRefresh + PullIndicator', () => {
  it('экран уезжает за пальцем без перерисовок React (fb_f8a87f1a); колесико в зазоре; на пороге — «готов»', () => {
    const refresh = vi.fn()
    const { sc, container } = mount({ refresh })
    const root = container.querySelector('[data-testid="root"]')
    const ptr = container.querySelector('.ptr')
    expect(root.style.transform).toBe('')
    const before = renders
    down(sc, 40)
    for (const dy of [60, 80, 100]) fireEvent.touchMove(sc, { touches: [{ clientY: 100 + dy, clientX: 50 }] })
    expect(renders).toBe(before) // ни одного рендера за жест
    const d = pullDistance(100)
    expect(root.style.transform).toBe(px(d))
    expect(root.style.transition).toBe('none') // за пальцем — без перехода
    expect(ptr.style.transform).toBe(`translate(-50%, ${-(d + 32) / 2}px)`)
    expect(ptr).not.toHaveClass('ready')
    fireEvent.touchMove(sc, { touches: [{ clientY: 400, clientX: 50 }] })
    expect(ptr).toHaveClass('ready')
    expect(ptr.style.opacity).toBe('1')
  })

  it('отпустил на пороге — обновление, экран доезжает до PULL_HOLD и держится; конец обновления — обратно', async () => {
    let finish
    const refresh = vi.fn(() => new Promise((r) => { finish = r }))
    const { sc, container, rerender } = mount({ refresh })
    const root = container.querySelector('[data-testid="root"]')
    down(sc, 400)
    await act(async () => { fireEvent.touchEnd(sc) })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(root.style.transform).toBe(px(PULL_HOLD))
    expect(root.style.transition).toMatch(/transform/) // доезжает переходом, а не скачком
    expect(container.querySelector('.ptr')).toHaveClass('loading')
    rerender(<div className="content"><Screen refresh={refresh} refreshing /></div>)
    rerender(<div className="content"><Screen refresh={refresh} refreshing={false} /></div>)
    await act(async () => { finish() })
    expect(root.style.transform).toBe('')
    expect(container.querySelector('.ptr')).not.toHaveClass('loading')
  })

  it('обновление вышло сразу (офлайн, флаг не менялся) — экран не зависает опущенным', async () => {
    const refresh = vi.fn(async () => {})
    const { sc, container } = mount({ refresh })
    const root = container.querySelector('[data-testid="root"]')
    down(sc, 400)
    await act(async () => { fireEvent.touchEnd(sc) })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(root.style.transform).toBe('')
    expect(container.querySelector('.ptr')).not.toHaveClass('loading')
  })

  it('не дотянул — экран возвращается переходом, без обновления', async () => {
    const refresh = vi.fn()
    const { sc, container } = mount({ refresh })
    const root = container.querySelector('[data-testid="root"]')
    down(sc, 40)
    await act(async () => { fireEvent.touchEnd(sc) })
    expect(refresh).not.toHaveBeenCalled()
    expect(root.style.transform).toBe('')
    expect(root.style.transition).toMatch(/transform/)
  })

  it('не у верха, вбок и во время обновления — жест не наш', async () => {
    const refresh = vi.fn()
    const { sc } = mount({ refresh })
    down(sc, 20, 200) // горизонталь — свайп «назад»
    fireEvent.touchMove(sc, { touches: [{ clientY: 500, clientX: 250 }] })
    fireEvent.touchEnd(sc)
    sc.scrollTop = 50
    down(sc, 400)
    fireEvent.touchEnd(sc)
    expect(refresh).not.toHaveBeenCalled()

    const busy = mount({ refresh, refreshing: true })
    down(busy.sc, 400)
    await act(async () => { fireEvent.touchEnd(busy.sc) })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('экран под вложенным (inert) — жест не наш', () => {
    const refresh = vi.fn()
    const { sc } = mount({ refresh }, (x) => <div inert>{x}</div>)
    down(sc, 400)
    fireEvent.touchEnd(sc)
    expect(refresh).not.toHaveBeenCalled()
  })
})
