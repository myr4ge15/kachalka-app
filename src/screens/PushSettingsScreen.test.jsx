// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

let push
vi.mock('../hooks/usePushToggle.js', () => ({ usePushToggle: () => push }))
import PushSettingsScreen from './PushSettingsScreen.jsx'

const base = { availability: 'ok', enabled: true, busy: false, error: '', prefs: {}, prefsBusy: null, prefsError: '', toggle: vi.fn(), setType: vi.fn() }
const user = { id: 'u1' }

describe('PushSettingsScreen (v7.1.4)', () => {
  beforeEach(() => { push = { ...base, toggle: vi.fn(), setType: vi.fn() } })

  it('включены: тумблер устройства и шесть типов', () => {
    render(<PushSettingsScreen user={user} onBack={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Пуш-уведомления' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /на это устройство/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('group', { name: /Какие уведомления/ })).toBeInTheDocument()
    expect(screen.getAllByRole('switch')).toHaveLength(7)
    fireEvent.click(screen.getByRole('switch', { name: /Реакции/ }))
    expect(push.setType).toHaveBeenCalledWith('reaction', false)
  })

  it('список типов сохраняется при переключении, а менять типы можно после включения', () => {
    push.enabled = false
    const { rerender } = render(<PushSettingsScreen user={user} onBack={() => {}} />)
    const reaction = screen.getByRole('switch', { name: /Реакции/ })
    expect(reaction).toBeDisabled()
    fireEvent.click(screen.getByRole('switch', { name: /на это устройство/ }))
    expect(push.toggle).toHaveBeenCalledWith(true)
    push = { ...push, enabled: true, busy: true }
    rerender(<PushSettingsScreen user={user} onBack={() => {}} />)
    expect(screen.getByRole('switch', { name: /Реакции/ })).toBe(reaction)
    expect(reaction).toBeDisabled()
    push.busy = false
    rerender(<PushSettingsScreen user={user} onBack={() => {}} />)
    expect(reaction).toBeEnabled()
  })

  it('включить нельзя (iPhone во вкладке) — объяснение без типов', () => {
    push = { ...push, availability: 'ios-install', enabled: false }
    render(<PushSettingsScreen user={user} onBack={() => {}} />)
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(screen.getByText(/Поделиться/)).toBeInTheDocument()
  })

  it('«Назад»', () => {
    const onBack = vi.fn()
    render(<PushSettingsScreen user={user} onBack={onBack} />)
    fireEvent.click(screen.getByRole('button', { name: /Назад/ }))
    expect(onBack).toHaveBeenCalled()
  })
})
