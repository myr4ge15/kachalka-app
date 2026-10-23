// @vitest-environment jsdom
// Админка → «Журнал свайпов (это устройство)»: список из localStorage и «Очистить».
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import SwipeLog from './SwipeLog.jsx'
import { logSwipe } from '../../lib/swipeLog.js'

beforeEach(() => localStorage.clear())

describe('SwipeLog', () => {
  it('пусто — подсказка; с записями — строки и «Очистить»', () => {
    const { unmount } = render(<SwipeLog />)
    expect(screen.getByText(/Пока пусто/)).toBeInTheDocument()
    unmount()
    logSwipe({ kind: 'commit', p: 0.5, v: 0.4, flick: 0.9, moves: 12 })
    render(<SwipeLog />)
    expect(screen.getByRole('listitem')).toHaveTextContent('назад · 50%')
    fireEvent.click(screen.getByRole('button', { name: 'Очистить' }))
    expect(screen.queryByRole('listitem')).toBeNull()
  })
})
