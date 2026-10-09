// @vitest-environment jsdom
// «Назад» вложенных экранов (свайп от края на iPhone — тот же путь, что кнопка «‹»):
// hooks/useAppNav.js nestedBack. Остальная навигация — App.nav.test.jsx.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

vi.mock('../lib/appEvents.js', () => ({ emitReselect: vi.fn() }))
vi.mock('./useEdgeSwipeBack.js', () => ({ useEdgeSwipeBack: vi.fn() }))
import { useAppNav } from './useAppNav.js'
import { useEdgeSwipeBack } from './useEdgeSwipeBack.js'

const ME = { id: 'me', name: 'Саня' }
beforeEach(() => { sessionStorage.clear(); window.history.replaceState(null, '', '/') })

function from(start, { via } = {}) {
  const { result } = renderHook(() => useAppNav(ME))
  if (via) act(() => result.current.goTab(via))
  act(() => result.current.goTab(start))
  act(() => result.current.nestedBack())
  return result
}

describe('useAppNav: nestedBack', () => {
  it.each([
    ['freshness', 'home'],
    ['admin', 'profile'], ['achievements', 'profile'], ['feedback', 'profile'],
    ['myex', 'profile'], ['whatsnew', 'profile'], ['appearance', 'profile'], ['pushset', 'profile'],
  ])('%s → %s', (start, back) => {
    expect(from(start).current.tab).toBe(back)
  })

  it('под-экраны Настроек возвращают именно в Настройки', () => {
    expect(from('appearance').current.openSettings).toBe(true)
    expect(from('admin').current.openSettings).toBe(false)
  })

  it('уведомления — туда, откуда открыли; без источника — Главная', () => {
    const { result } = renderHook(() => useAppNav(ME))
    act(() => result.current.goTab('progress'))
    act(() => result.current.openNotif())
    act(() => result.current.nestedBack())
    expect(result.current.tab).toBe('progress')
    act(() => result.current.goTab('notif'))
    act(() => result.current.nestedBack())
    expect(result.current.tab).toBe('home')
  })

  it('профиль участника → Лента', () => {
    const { result } = renderHook(() => useAppNav(ME))
    act(() => result.current.goTab('feed'))
    act(() => result.current.openMember('u2'))
    expect(result.current.tab).toBe('member')
    act(() => result.current.nestedBack())
    expect(result.current.tab).toBe('feed')
  })

  it('на вкладке «назад» ничего не делает; свайп включен только на вложенном экране', () => {
    expect(from('history').current.tab).toBe('history')
    const calls = vi.mocked(useEdgeSwipeBack).mock.calls
    expect(calls.at(-1)[3]).toBe(false) // edgeSwipeOn в jsdom выключен
  })
})
