// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { cancelRestPush } from '../../db/restPush.js'
import RestTimerToggle from './RestTimerToggle.jsx'

vi.mock('../../db/restPush.js', () => ({ cancelRestPush: vi.fn() }))

describe('RestTimerToggle', () => {
  beforeEach(() => { localStorage.clear(); vi.mocked(cancelRestPush).mockReset() })

  it('выключение пишет настройку, снимает идущий отдых и его пуш; включение возвращает', () => {
    localStorage.setItem('gym_app_rest_run_u1', JSON.stringify({ endsAt: Date.now() + 60_000, durMs: 90_000 }))
    render(<RestTimerToggle userId="u1" />)
    const sw = screen.getByRole('switch', { name: /Таймер отдыха/ })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(JSON.parse(localStorage.getItem('gym_app_rest_u1')).on).toBe(false)
    expect(localStorage.getItem('gym_app_rest_run_u1')).toBeNull()
    expect(cancelRestPush).toHaveBeenCalledWith('u1')
    fireEvent.click(sw)
    expect(JSON.parse(localStorage.getItem('gym_app_rest_u1')).on).toBe(true)
  })
})
