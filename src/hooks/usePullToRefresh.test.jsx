// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { usePullToRefresh } from './usePullToRefresh.js'
import PullIndicator from '../components/ui/PullIndicator.jsx'

vi.mock('../lib/haptics.js', () => ({ vibrate: vi.fn(), HAPTIC: { tap: 10 } }))

function Screen({ refresh, refreshing = false }) {
  const ref = useRef(null)
  const ptr = usePullToRefresh(ref, refresh, refreshing)
  return <div ref={ref}><PullIndicator {...ptr} /></div>
}
const mount = (props, wrap = (x) => x) => {
  const { container, rerender } = render(<div className="content">{wrap(<Screen {...props} />)}</div>)
  return { sc: container.querySelector('.content'), container, rerender }
}
const down = (sc, dy, dx = 0) => {
  fireEvent.touchStart(sc, { touches: [{ clientY: 100, clientX: 50 }] })
  fireEvent.touchMove(sc, { touches: [{ clientY: 100 + dy, clientX: 50 + dx }] })
}

describe('usePullToRefresh + PullIndicator', () => {
  it('индикатор следует за пальцем, на пороге — «готов», отпустил — обновление и спиннер', async () => {
    const refresh = vi.fn()
    const { sc, container, rerender } = mount({ refresh })
    expect(container.querySelector('.ptr')).toBeNull()
    down(sc, 40)
    expect(container.querySelector('.ptr')).not.toHaveClass('ready')
    fireEvent.touchMove(sc, { touches: [{ clientY: 400, clientX: 50 }] })
    expect(container.querySelector('.ptr')).toHaveClass('ready')
    await act(async () => { fireEvent.touchEnd(sc) })
    expect(refresh).toHaveBeenCalledTimes(1)
    rerender(<div className="content"><Screen refresh={refresh} refreshing /></div>)
    expect(container.querySelector('.ptr')).toHaveClass('loading')
    rerender(<div className="content"><Screen refresh={refresh} refreshing={false} /></div>)
    expect(container.querySelector('.ptr')).toBeNull()
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
    fireEvent.touchEnd(busy.sc)
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
