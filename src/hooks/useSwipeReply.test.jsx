// @vitest-environment jsdom
// Ответ свайпом (20.10.2026): влево дальше порога — ответ; короче, вправо, вверх-вниз, отмена — ничего.
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useSwipeReply, SWIPE_REPLY_AT } from './useSwipeReply.js'

function Row({ onReply, enabled = true }) {
  const swipe = useSwipeReply(onReply)
  return <div data-testid="row" {...swipe({ id: 'c1' }, enabled)}>комментарий</div>
}

const at = (x, y = 100) => ({ touches: [{ clientX: x, clientY: y }] })
function drag(el, points, end = 'touchEnd') {
  fireEvent.touchStart(el, at(200))
  for (const [x, y] of points) fireEvent.touchMove(el, at(x, y))
  fireEvent[end](el, { touches: [] })
}

describe('useSwipeReply', () => {
  it('влево дальше порога — строка едет за пальцем, стрелка готова, отпустили — ответ', () => {
    const onReply = vi.fn()
    render(<Row onReply={onReply} />)
    const row = screen.getByTestId('row')
    fireEvent.touchStart(row, at(200))
    fireEvent.touchMove(row, at(185))
    expect(row).toHaveClass('swiping')
    fireEvent.touchMove(row, at(200 - SWIPE_REPLY_AT - 4))
    expect(row.style.transform).toBe(`translateX(-${SWIPE_REPLY_AT + 4}px)`)
    expect(row).toHaveClass('swipe-ready')
    fireEvent.touchMove(row, at(0)) // дальше 80 px не тянется
    expect(row.style.transform).toBe('translateX(-80px)')
    fireEvent.touchEnd(row, { touches: [] })
    expect(onReply).toHaveBeenCalledWith({ id: 'c1' })
    expect(row.style.transform).toBe('')
    expect(row).not.toHaveClass('swiping')
    expect(row.style.getPropertyValue('--swipe')).toBe('')
  })

  it('короткий свайп, вправо, вертикальный жест, отмена — без ответа', () => {
    const onReply = vi.fn()
    render(<Row onReply={onReply} />)
    const row = screen.getByTestId('row')
    drag(row, [[170, 100]]) // 30 px — мало
    drag(row, [[260, 100], [300, 100]]) // вправо — это закрытие листа
    expect(row.style.transform).toBe('')
    drag(row, [[195, 140], [100, 160]]) // сначала вниз — прокрутка
    drag(row, [[195, 100], [120, 100]], 'touchCancel')
    fireEvent.touchMove(row, at(100)) // движение без начала жеста
    fireEvent.touchStart(row, { touches: [{ clientX: 1, clientY: 1 }, { clientX: 2, clientY: 2 }] }) // два пальца
    fireEvent.touchMove(row, at(10))
    fireEvent.touchEnd(row, { touches: [] })
    expect(onReply).not.toHaveBeenCalled()
  })

  it('выключен — обработчиков нет', () => {
    const onReply = vi.fn()
    render(<Row onReply={onReply} enabled={false} />)
    drag(screen.getByTestId('row'), [[100, 100]])
    expect(onReply).not.toHaveBeenCalled()
  })
})
