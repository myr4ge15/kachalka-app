// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import ProfileScreen from './ProfileScreen.jsx'

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (_fn, _deps, fallback) => fallback }))
vi.mock('../hooks/usePushToggle.js', () => ({ usePushToggle: () => ({ availability: 'unsupported' }) }))
vi.mock('../db/sync.js', () => ({ syncNow: vi.fn() }))

function Harness({ role = 'admin', enabled = true, startInSettings = false, onOpenAdmin = vi.fn() }) {
  const contentRef = useRef(null)
  const screenRef = useRef(null)
  return <main className="content" ref={contentRef}><div ref={screenRef} data-testid="surface">
    <ProfileScreen user={{ id: 'test', name: 'Тест', role }} contentRef={contentRef}
      screenRef={screenRef} edgeSwipeOn={enabled} startInSettings={startInSettings} onOpenAdmin={onOpenAdmin} />
  </div></main>
}
function swipe() {
  const box = document.querySelector('.content')
  fireEvent.touchStart(box, { touches: [{ clientX: 10, clientY: 100 }] })
  fireEvent.touchMove(box, { touches: [{ clientX: 500, clientY: 100 }] })
  fireEvent.touchEnd(box, { touches: [] })
  act(() => vi.advanceTimersByTime(300))
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('навигация профиля', () => {
  it.each([false, true])('свайп закрывает настройки и сбрасывает смещение, старт в настройках: %s', (startInSettings) => {
    vi.useFakeTimers()
    Element.prototype.scrollTo = vi.fn()
    render(<Harness startInSettings={startInSettings} />)
    if (!startInSettings) fireEvent.click(screen.getByRole('button', { name: 'Настройки' }))
    swipe()
    expect(screen.queryByRole('heading', { name: 'Настройки' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Настройки' })).toBeInTheDocument()
    expect(screen.getByTestId('surface').style.left).toBe('')
    expect(screen.getByTestId('surface')).not.toHaveClass('edge-dragging')
    fireEvent.click(screen.getByRole('button', { name: 'Настройки' }))
    swipe()
    expect(screen.queryByRole('heading', { name: 'Настройки' })).toBeNull()
  })
  it('на неподдерживаемой платформе свайп не закрывает настройки, стрелка работает', () => {
    vi.useFakeTimers()
    Element.prototype.scrollTo = vi.fn()
    render(<Harness enabled={false} startInSettings />)
    swipe()
    expect(screen.getByRole('heading', { name: 'Настройки' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }))
    expect(screen.queryByRole('heading', { name: 'Настройки' })).toBeNull()
  })
  it('админка доступна из профиля администратора и отсутствует в настройках', () => {
    const onOpenAdmin = vi.fn()
    Element.prototype.scrollTo = vi.fn()
    render(<Harness onOpenAdmin={onOpenAdmin} />)
    fireEvent.click(screen.getByRole('button', { name: 'Админка' }))
    expect(onOpenAdmin).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Настройки' }))
    expect(screen.queryByRole('button', { name: /Админка/ })).toBeNull()
  })
  it('обычному участнику админка не показывается', () => {
    render(<Harness role="user" />)
    expect(screen.queryByRole('button', { name: /Админка/ })).toBeNull()
  })
})
